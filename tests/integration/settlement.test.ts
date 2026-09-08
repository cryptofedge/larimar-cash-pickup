/**
 * Settlement against a real database.
 *
 * The invariant these exist to prove: **a disbursement is settled exactly once,
 * ever.** It is enforced by a UNIQUE constraint on
 * `settlement_lines.pickup_event_id`, not by application logic, so no amount of
 * careless re-invocation can pay a partner twice for the same cash.
 */

import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { prisma } from '@/server/db';
import {
  createTestUser,
  cleanupUser,
  getInstitutionId,
  getLocationId,
  type TestUser,
} from './helpers';
import { createTransaction } from '@/server/services/transaction';
import { confirmPayment, createPaymentIntent } from '@/server/services/payment';
import { redeemPickupCode } from '@/server/services/pickup';
import {
  cancelSettlementBatch,
  exportSettlementCsv,
  generateSettlementBatch,
  getOutstandingExposure,
  issueSettlementBatch,
  markSettlementPaid,
  reconcileSettlementBatch,
} from '@/server/services/settlement';
import { verifyLedgerIntegrity, getAccountBalances } from '@/server/services/ledger';
import { MOCK_TOKENS } from '@/server/providers/payment';
import { DomainError } from '@/lib/domain/errors';

let agent: TestUser;
let finance: TestUser;
let locationId: string;
let institutionId: string;

const createdUsers: string[] = [];
const createdBatches: string[] = [];

/** Settlement periods are per-institution, so each test gets its own window. */
let periodCursor = 0;
function freshPeriod(): { periodStart: Date; periodEnd: Date } {
  periodCursor += 1;
  const base = Date.UTC(2030, 0, periodCursor);
  return { periodStart: new Date(base), periodEnd: new Date(base + 24 * 3600 * 1000) };
}

beforeAll(async () => {
  locationId = await getLocationId('CCD-PUJ-01');
  institutionId = await getInstitutionId('DEMO-CCD');

  agent = await createTestUser(['PICKUP_AGENT'], {
    institutionCode: 'DEMO-CCD',
    locationCodes: ['CCD-PUJ-01'],
  });
  finance = await createTestUser(['FINANCE_ADMIN']);

  // A commission makes the arithmetic and the expense posting observable.
  await prisma.pickupInstitution.update({
    where: { id: institutionId },
    data: { commissionBps: 150 },
  });
});

afterAll(async () => {
  await prisma.settlementBatch.deleteMany({ where: { id: { in: createdBatches } } });
  for (const userId of createdUsers) await cleanupUser(userId);
  await cleanupUser(agent.id);
  await cleanupUser(finance.id);
  await prisma.pickupInstitution.update({
    where: { id: institutionId },
    data: { commissionBps: 0 },
  });
});

/** Fund a transaction, disburse it, and return the resulting pickup event. */
async function disburse(payoutMinor: bigint, disbursedAt?: Date) {
  const customer = await createTestUser(['CUSTOMER'], { verifiedKyc: true });
  createdUsers.push(customer.id);

  const created = await createTransaction({
    userId: customer.id,
    payoutAmountMinor: payoutMinor,
    countryCode: 'DO',
    fundingCurrency: 'USD',
    pickupLocationId: locationId,
  });

  await createPaymentIntent({
    transactionId: created.transactionId,
    userId: customer.id,
    idempotencyKey: `stl-intent-${created.reference}`,
  });
  const confirmed = await confirmPayment({
    transactionId: created.transactionId,
    userId: customer.id,
    paymentToken: MOCK_TOKENS.SUCCESS_DEBIT,
    idempotencyKey: `stl-confirm-${created.reference}`,
  });

  const credential = confirmed.credential;
  if (!credential) throw new Error('no credential issued');

  await redeemPickupCode({
    code: credential.code,
    agentId: agent.id,
    institutionId,
    locationId,
    documentType: 'PASSPORT',
    documentLast4: '4567',
    amountMinor: payoutMinor,
  });

  const event = await prisma.pickupEvent.findFirstOrThrow({
    where: { transactionId: created.transactionId, eventType: 'PAYOUT_COMPLETED' },
    select: { id: true },
    orderBy: { createdAt: 'desc' },
  });

  // Place the disbursement inside a chosen settlement window.
  if (disbursedAt) {
    await prisma.pickupEvent.update({ where: { id: event.id }, data: { createdAt: disbursedAt } });
  }

  return { transactionId: created.transactionId, pickupEventId: event.id };
}

describe('settlement generation', () => {
  it('test_settlement_generation_collects_the_periods_disbursements', async () => {
    // Arrange
    const period = freshPeriod();
    const inside = new Date(period.periodStart.getTime() + 3600_000);
    await disburse(200_000n, inside);
    await disburse(300_000n, inside);

    // Act
    const batch = await generateSettlementBatch({
      institutionId,
      periodStart: period.periodStart,
      periodEnd: period.periodEnd,
      actorId: finance.id,
    });
    createdBatches.push(batch.batchId);

    // Assert
    expect(batch.alreadyExisted).toBe(false);
    expect(batch.totals.payoutCount).toBe(2);
    expect(batch.totals.grossPayout.amount).toBe(500_000n);
    // 1.50% of RD$5,000.00
    expect(batch.totals.commission.amount).toBe(7_500n);
    expect(batch.totals.netPayable.amount).toBe(507_500n);
  });

  it('test_settlement_generation_excludes_payouts_outside_the_period', async () => {
    // Arrange — one inside the window, one the day before.
    const period = freshPeriod();
    await disburse(100_000n, new Date(period.periodStart.getTime() + 3600_000));
    await disburse(999_999n, new Date(period.periodStart.getTime() - 3600_000));

    // Act
    const batch = await generateSettlementBatch({
      institutionId,
      periodStart: period.periodStart,
      periodEnd: period.periodEnd,
      actorId: finance.id,
    });
    createdBatches.push(batch.batchId);

    // Assert
    expect(batch.totals.payoutCount).toBe(1);
    expect(batch.totals.grossPayout.amount).toBe(100_000n);
  });

  it('test_settlement_generation_treats_the_period_boundary_as_half_open', async () => {
    // Arrange — a payout at exactly midnight belongs to the NEXT period only.
    const period = freshPeriod();
    await disburse(100_000n, period.periodEnd);

    // Act
    const batch = await generateSettlementBatch({
      institutionId,
      periodStart: period.periodStart,
      periodEnd: period.periodEnd,
      actorId: finance.id,
    });
    createdBatches.push(batch.batchId);

    // Assert — overlapping boundaries are how a payout gets settled twice.
    expect(batch.totals.payoutCount).toBe(0);
  });

  it('test_settlement_generation_is_idempotent_for_a_repeated_period', async () => {
    // Arrange
    const period = freshPeriod();
    await disburse(150_000n, new Date(period.periodStart.getTime() + 3600_000));

    const first = await generateSettlementBatch({
      institutionId,
      periodStart: period.periodStart,
      periodEnd: period.periodEnd,
      actorId: finance.id,
    });
    createdBatches.push(first.batchId);

    // Act
    const second = await generateSettlementBatch({
      institutionId,
      periodStart: period.periodStart,
      periodEnd: period.periodEnd,
      actorId: finance.id,
    });

    // Assert — the same batch, not a second one.
    expect(second.alreadyExisted).toBe(true);
    expect(second.batchId).toBe(first.batchId);

    const count = await prisma.settlementBatch.count({
      where: { institutionId, periodStart: period.periodStart },
    });
    expect(count).toBe(1);
  });

  /**
   * The invariant this whole suite exists for.
   */
  it('test_settlement_generation_never_settles_a_payout_twice', async () => {
    // Arrange — one disbursement, then two overlapping periods that both cover it.
    const period = freshPeriod();
    const disbursedAt = new Date(period.periodStart.getTime() + 3600_000);
    const { pickupEventId } = await disburse(250_000n, disbursedAt);

    const first = await generateSettlementBatch({
      institutionId,
      periodStart: period.periodStart,
      periodEnd: period.periodEnd,
      actorId: finance.id,
    });
    createdBatches.push(first.batchId);
    expect(first.totals.payoutCount).toBe(1);

    // Act — a deliberately overlapping window covering the same disbursement.
    const overlapping = await generateSettlementBatch({
      institutionId,
      periodStart: new Date(period.periodStart.getTime() - 3600_000),
      periodEnd: new Date(period.periodEnd.getTime() + 3600_000),
      actorId: finance.id,
    });
    createdBatches.push(overlapping.batchId);

    // Assert — the payout is already settled, so it is excluded entirely.
    expect(overlapping.totals.payoutCount).toBe(0);

    const lines = await prisma.settlementLine.count({ where: { pickupEventId } });
    expect(lines).toBe(1);
  });

  it('test_settlement_generation_excludes_non_payout_events', async () => {
    // Arrange — a verification event moved no cash.
    const period = freshPeriod();
    await prisma.pickupEvent.create({
      data: {
        eventType: 'VERIFICATION_SUCCESS',
        agentId: agent.id,
        institutionId,
        locationId,
        amountMinor: 500_000n,
        currency: 'DOP',
        createdAt: new Date(period.periodStart.getTime() + 3600_000),
      },
    });

    // Act
    const batch = await generateSettlementBatch({
      institutionId,
      periodStart: period.periodStart,
      periodEnd: period.periodEnd,
      actorId: finance.id,
    });
    createdBatches.push(batch.batchId);

    // Assert — only actual disbursements reach a partner's statement.
    expect(batch.totals.payoutCount).toBe(0);
  });
});

describe('settlement lifecycle', () => {
  async function batchWithPayout(amountMinor = 200_000n) {
    const period = freshPeriod();
    await disburse(amountMinor, new Date(period.periodStart.getTime() + 3600_000));
    const batch = await generateSettlementBatch({
      institutionId,
      periodStart: period.periodStart,
      periodEnd: period.periodEnd,
      actorId: finance.id,
    });
    createdBatches.push(batch.batchId);
    return batch;
  }

  it('test_settlement_lifecycle_refuses_payment_before_reconciliation', async () => {
    // Arrange
    const batch = await batchWithPayout();
    await issueSettlementBatch({ batchId: batch.batchId, actorId: finance.id });

    // Act / Assert — money never leaves before both sides agree the figure.
    await expect(
      markSettlementPaid({
        batchId: batch.batchId,
        paymentReference: 'WIRE-001',
        actorId: finance.id,
      }),
    ).rejects.toThrow(DomainError);
  });

  it('test_settlement_lifecycle_disputes_a_variance_without_an_explicit_note', async () => {
    // Arrange
    const batch = await batchWithPayout();
    await issueSettlementBatch({ batchId: batch.batchId, actorId: finance.id });

    // Act — the partner reports one minor unit more than our records show.
    const result = await reconcileSettlementBatch({
      batchId: batch.batchId,
      partnerReportedMinor: batch.totals.grossPayout.amount + 1n,
      actorId: finance.id,
    });

    // Assert
    expect(result.matched).toBe(false);
    expect(result.status).toBe('DISPUTED');
    expect(result.varianceMinor).toBe(1n);

    // And a disputed batch cannot be paid.
    await expect(
      markSettlementPaid({
        batchId: batch.batchId,
        paymentReference: 'WIRE-002',
        actorId: finance.id,
      }),
    ).rejects.toThrow(DomainError);
  });

  it('test_settlement_lifecycle_accepts_a_variance_only_with_a_recorded_reason', async () => {
    // Arrange
    const batch = await batchWithPayout();
    await issueSettlementBatch({ batchId: batch.batchId, actorId: finance.id });

    // Act
    const result = await reconcileSettlementBatch({
      batchId: batch.batchId,
      partnerReportedMinor: batch.totals.grossPayout.amount - 500n,
      varianceNote: 'Partner excluded a reversed payout; agreed by phone',
      actorId: finance.id,
    });

    // Assert — accepted, and the reason is persisted for audit.
    expect(result.status).toBe('RECONCILED');

    const stored = await prisma.settlementBatch.findUniqueOrThrow({
      where: { id: batch.batchId },
      select: { varianceNote: true, varianceMinor: true },
    });
    expect(stored.varianceMinor).toBe(-500n);
    expect(stored.varianceNote).toMatch(/agreed by phone/);
  });

  it('test_settlement_lifecycle_posts_a_balanced_ledger_entry_on_payment', async () => {
    // Arrange
    const batch = await batchWithPayout(400_000n);
    await issueSettlementBatch({ batchId: batch.batchId, actorId: finance.id });
    await reconcileSettlementBatch({
      batchId: batch.batchId,
      partnerReportedMinor: batch.totals.grossPayout.amount,
      actorId: finance.id,
    });

    // Act
    const paid = await markSettlementPaid({
      batchId: batch.batchId,
      paymentReference: 'WIRE-003',
      actorId: finance.id,
    });

    // Assert
    const posting = await prisma.ledgerTransaction.findUniqueOrThrow({
      where: { id: paid.ledgerTransactionId },
      include: { entries: { include: { account: { select: { code: true } } } } },
    });

    const net = posting.entries.reduce(
      (total, entry) => total + (entry.direction === 'DEBIT' ? entry.amountMinor : -entry.amountMinor),
      0n,
    );
    expect(net).toBe(0n);

    const codes = posting.entries.map((entry) => entry.account.code);
    expect(codes).toContain('LIAB_PARTNER_SETTLEMENT_DOP');
    expect(codes).toContain('EXP_PARTNER_COMMISSION_DOP');
    expect(codes).toContain('ASSET_FX_POSITION_DOP');

    expect(await verifyLedgerIntegrity()).toEqual({ balanced: true });
  });

  it('test_settlement_lifecycle_refuses_to_pay_the_same_batch_twice', async () => {
    // Arrange
    const batch = await batchWithPayout();
    await issueSettlementBatch({ batchId: batch.batchId, actorId: finance.id });
    await reconcileSettlementBatch({
      batchId: batch.batchId,
      partnerReportedMinor: batch.totals.grossPayout.amount,
      actorId: finance.id,
    });
    await markSettlementPaid({
      batchId: batch.batchId,
      paymentReference: 'WIRE-004',
      actorId: finance.id,
    });

    // Act / Assert — PAID is absorbing.
    await expect(
      markSettlementPaid({
        batchId: batch.batchId,
        paymentReference: 'WIRE-004-DUPLICATE',
        actorId: finance.id,
      }),
    ).rejects.toThrow(DomainError);
  });

  it('test_settlement_lifecycle_refuses_to_pay_an_empty_batch', async () => {
    // Arrange — a period with no disbursements.
    const period = freshPeriod();
    const batch = await generateSettlementBatch({
      institutionId,
      periodStart: period.periodStart,
      periodEnd: period.periodEnd,
      actorId: finance.id,
    });
    createdBatches.push(batch.batchId);
    expect(batch.totals.netPayable.amount).toBe(0n);

    await issueSettlementBatch({ batchId: batch.batchId, actorId: finance.id });
    await reconcileSettlementBatch({
      batchId: batch.batchId,
      partnerReportedMinor: 0n,
      actorId: finance.id,
    });

    // Act / Assert — a zero-value transfer is a mistake, not a settlement.
    await expect(
      markSettlementPaid({
        batchId: batch.batchId,
        paymentReference: 'WIRE-EMPTY',
        actorId: finance.id,
      }),
    ).rejects.toThrow(/nothing payable/);
  });

  it('test_settlement_lifecycle_cancels_a_draft_batch', async () => {
    // Arrange
    const batch = await batchWithPayout();

    // Act
    await cancelSettlementBatch({
      batchId: batch.batchId,
      reason: 'Generated for the wrong period',
      actorId: finance.id,
    });

    // Assert
    const stored = await prisma.settlementBatch.findUniqueOrThrow({
      where: { id: batch.batchId },
      select: { status: true },
    });
    expect(stored.status).toBe('CANCELLED');
  });
});

describe('settlement reporting', () => {
  it('test_settlement_reporting_exposes_unsettled_exposure', async () => {
    // Arrange
    const period = freshPeriod();
    await disburse(175_000n, new Date(period.periodStart.getTime() + 3600_000));

    // Act
    const exposure = await getOutstandingExposure();
    const entry = exposure.find((e) => e.institutionId === institutionId);

    // Assert — cash fronted and not yet inside a batch.
    expect(entry).toBeDefined();
    expect(entry?.outstandingMinor).toBeGreaterThan(0n);
  });

  it('test_settlement_reporting_exports_a_csv_statement', async () => {
    // Arrange
    const period = freshPeriod();
    await disburse(220_000n, new Date(period.periodStart.getTime() + 3600_000));
    const batch = await generateSettlementBatch({
      institutionId,
      periodStart: period.periodStart,
      periodEnd: period.periodEnd,
      actorId: finance.id,
    });
    createdBatches.push(batch.batchId);

    // Act
    const { filename, csv } = await exportSettlementCsv(batch.batchId);

    // Assert
    expect(filename).toBe(`${batch.reference}.csv`);
    expect(csv).toContain('# GrossPayoutMinor,220000');
    expect(csv).toContain('pickupEventId,transactionRef,locationCode,amountMinor');
    expect(csv).toMatch(/DEMONSTRATION ONLY/);
  });

  it('test_settlement_reporting_keeps_custodial_accounts_non_negative', async () => {
    // Arrange / Act — the platform-wide invariant, after all settlement activity.
    const balances = await getAccountBalances();

    // Assert
    for (const balance of balances.filter((b) => b.isCustodial)) {
      expect(
        balance.balanceMinor >= 0n,
        `${balance.accountCode} holds a negative custodial balance`,
      ).toBe(true);
    }
  });
});
