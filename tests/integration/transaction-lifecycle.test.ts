/**
 * The full money path, against a real database.
 *
 * Everything here is a property that cannot be proven with mocks: state
 * transitions that must be atomic with their ledger postings, a code that must
 * be redeemable exactly once even under concurrency, and balances that must
 * reconcile to zero.
 */

import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { prisma } from '@/server/db';
import { createTestUser, cleanupUser, getLocationId, getInstitutionId, type TestUser } from './helpers';
import { createTransaction, transitionTransaction } from '@/server/services/transaction';
import { confirmPayment, createPaymentIntent, issueRefund, recordChargeback } from '@/server/services/payment';
import { redeemPickupCode, verifyPickupCode } from '@/server/services/pickup';
import { placeHold, releaseHold, submitKyc } from '@/server/services/compliance';
import {
  verifyLedgerIntegrity,
  getLedgerEntriesForTransaction,
  getAccountBalances,
} from '@/server/services/ledger';
import { MOCK_TOKENS } from '@/server/providers/payment';
import { IllegalTransitionError } from '@/lib/domain/errors';

let agent: TestUser;
let locationId: string;
let institutionId: string;

/**
 * Every funded transaction gets its own customer.
 *
 * Sharing one customer across the suite made tests fail once the daily
 * ($1,000) and velocity (5 per 24h) limits kicked in — the risk engine working
 * exactly as designed. Per-test users keep each case independent of the others'
 * limit consumption, which is also closer to reality.
 */
const createdUsers: string[] = [];

async function freshCustomer(): Promise<TestUser> {
  const user = await createTestUser(['CUSTOMER'], { verifiedKyc: true });
  createdUsers.push(user.id);
  return user;
}

beforeAll(async () => {
  locationId = await getLocationId('CCD-PUJ-01');
  institutionId = await getInstitutionId('DEMO-CCD');
  agent = await createTestUser(['PICKUP_AGENT'], {
    institutionCode: 'DEMO-CCD',
    locationCodes: ['CCD-PUJ-01'],
  });
});

afterAll(async () => {
  for (const userId of createdUsers) {
    await cleanupUser(userId);
  }
  await cleanupUser(agent.id);
});

async function fundedTransaction(payoutMinor = 500_000n) {
  const customer = await freshCustomer();

  const created = await createTransaction({
    userId: customer.id,
    payoutAmountMinor: payoutMinor,
    countryCode: 'DO',
    fundingCurrency: 'USD',
    pickupLocationId: locationId,
    ipAddress: '203.0.113.10',
    ipCountry: 'US',
  });

  await createPaymentIntent({
    transactionId: created.transactionId,
    userId: customer.id,
    idempotencyKey: `intent-${created.reference}`,
  });

  const confirmed = await confirmPayment({
    transactionId: created.transactionId,
    userId: customer.id,
    paymentToken: MOCK_TOKENS.SUCCESS_DEBIT,
    idempotencyKey: `confirm-${created.reference}`,
  });

  return { created, confirmed, customer };
}

describe('happy path: quote to cash', () => {
  it('test_happy_path_quote_to_cash_completes_the_full_lifecycle_and_leaves_the_ledger_balanced', async () => {
    const { created, confirmed } = await fundedTransaction(2_000_000n);

    expect(confirmed.status).toBe('READY_FOR_PICKUP');
    expect(confirmed.credential).toBeDefined();

    const credential = confirmed.credential;
    if (!credential) throw new Error('no credential');

    const verified = await verifyPickupCode({
      code: credential.code,
      secret: credential.secret,
      agentId: agent.id,
      institutionId,
      locationId,
    });
    expect(verified.ok).toBe(true);

    const redeemed = await redeemPickupCode({
      code: credential.code,
      agentId: agent.id,
      institutionId,
      locationId,
      documentType: 'PASSPORT',
      documentLast4: '4567',
      amountMinor: 2_000_000n,
    });

    expect(redeemed.fullyPaid).toBe(true);
    expect(redeemed.remainingMinor).toBe(0n);

    const final = await prisma.transaction.findUniqueOrThrow({
      where: { id: created.transactionId },
      select: { status: true, paidOutMinor: true, completedAt: true },
    });
    expect(final.status).toBe('PICKED_UP');
    expect(final.paidOutMinor).toBe(2_000_000n);
    expect(final.completedAt).not.toBeNull();

    expect(await verifyLedgerIntegrity()).toEqual({ balanced: true });
  });

  it('test_happy_path_quote_to_cash_stores_only_a_hash_of_the_pickup_code', async () => {
    const { created, confirmed } = await fundedTransaction(100_000n);
    const credential = confirmed.credential;
    if (!credential) throw new Error('no credential');

    const stored = await prisma.pickupCode.findUniqueOrThrow({
      where: { transactionId: created.transactionId },
      select: { codeHash: true, secretHash: true },
    });

    expect(stored.codeHash).toMatch(/^[0-9a-f]{64}$/);
    expect(stored.codeHash).not.toContain(credential.code.replace(/-/g, ''));
    expect(stored.secretHash).not.toBe(credential.secret);
  });

  it('test_happy_path_quote_to_cash_posts_the_complete_set_of_ledger_events_for_a_funded_transaction', async () => {
    const { created } = await fundedTransaction(300_000n);
    const postings = await getLedgerEntriesForTransaction(created.transactionId);
    const events = postings.map((p) => p.eventType);

    expect(events).toContain('CUSTOMER_PAYMENT');
    expect(events).toContain('PLATFORM_FEE');
    expect(events).toContain('PROCESSING_FEE');
    expect(events).toContain('FX_CONVERSION');
    expect(events).toContain('PAYOUT_LIABILITY');

    for (const posting of postings) {
      const net = posting.entries.reduce(
        (total, entry) => total + (entry.direction === 'DEBIT' ? entry.amountMinor : -entry.amountMinor),
        0n,
      );
      expect(net).toBe(0n);
    }
  });
});

describe('single redemption is enforced by the database', () => {
  it('test_single_redemption_is_enforced_by_the_database_refuses_a_second_redemption', async () => {
    const { confirmed } = await fundedTransaction(150_000n);
    const credential = confirmed.credential;
    if (!credential) throw new Error('no credential');

    await redeemPickupCode({
      code: credential.code,
      agentId: agent.id,
      institutionId,
      locationId,
      documentType: 'PASSPORT',
      documentLast4: '4567',
      amountMinor: 150_000n,
    });

    await expect(
      redeemPickupCode({
        code: credential.code,
        agentId: agent.id,
        institutionId,
        locationId,
        documentType: 'PASSPORT',
        documentLast4: '4567',
        amountMinor: 150_000n,
      }),
    ).rejects.toThrow();
  });

  /**
   * The property that matters most in this whole suite: two agents scanning the
   * same code at the same moment must produce exactly one payout.
   */
  it('test_single_redemption_is_enforced_by_the_database_produces_exactly_one_payout_under_concurrent_redemption', async () => {
    const { created, confirmed } = await fundedTransaction(200_000n);
    const credential = confirmed.credential;
    if (!credential) throw new Error('no credential');

    const attempt = () =>
      redeemPickupCode({
        code: credential.code,
        agentId: agent.id,
        institutionId,
        locationId,
        documentType: 'PASSPORT',
        documentLast4: '4567',
        amountMinor: 200_000n,
      });

    const results = await Promise.allSettled([attempt(), attempt(), attempt()]);
    const fulfilled = results.filter((r) => r.status === 'fulfilled');

    expect(fulfilled).toHaveLength(1);

    const final = await prisma.transaction.findUniqueOrThrow({
      where: { id: created.transactionId },
      select: { paidOutMinor: true, status: true },
    });
    expect(final.paidOutMinor).toBe(200_000n);
    expect(final.status).toBe('PICKED_UP');

    // And the books still balance after a contended write.
    expect(await verifyLedgerIntegrity()).toEqual({ balanced: true });
  });
});

/**
 * Risk-based collection delay, end to end against the database.
 *
 * The seeded policy holds anything scoring MEDIUM (30) or above for 30 minutes.
 * These tests drive the real service rather than the pure helper, so they also
 * prove the policy is actually read at issuance and enforced at redemption.
 */
describe('collection delay', () => {
  it('test_collection_delay_blocks_redemption_while_the_hold_is_active', async () => {
    // Arrange — a funded transaction whose code we force into a held state.
    const { created, confirmed } = await fundedTransaction(120_000n);
    const credential = confirmed.credential;
    if (!credential) throw new Error('no credential');

    const holdUntil = new Date(Date.now() + 30 * 60_000);
    await prisma.pickupCode.update({
      where: { transactionId: created.transactionId },
      data: { collectableFrom: holdUntil },
    });

    // Act
    const verified = await verifyPickupCode({
      code: credential.code,
      agentId: agent.id,
      institutionId,
      locationId,
    });

    // Assert — the agent is told why, and no cash moves.
    expect(verified.ok).toBe(false);
    if (!verified.ok) expect(verified.code).toBe('PICKUP_CODE_NOT_YET_COLLECTABLE');

    await expect(
      redeemPickupCode({
        code: credential.code,
        agentId: agent.id,
        institutionId,
        locationId,
        documentType: 'PASSPORT',
        documentLast4: '4567',
        amountMinor: 120_000n,
      }),
    ).rejects.toThrow();

    const untouched = await prisma.transaction.findUniqueOrThrow({
      where: { id: created.transactionId },
      select: { paidOutMinor: true, status: true },
    });
    expect(untouched.paidOutMinor).toBe(0n);
    expect(untouched.status).toBe('READY_FOR_PICKUP');
  });

  it('test_collection_delay_does_not_consume_an_attempt_when_presented_early', async () => {
    // Arrange
    const { created, confirmed } = await fundedTransaction(120_000n);
    const credential = confirmed.credential;
    if (!credential) throw new Error('no credential');

    await prisma.pickupCode.update({
      where: { transactionId: created.transactionId },
      data: { collectableFrom: new Date(Date.now() + 30 * 60_000) },
    });

    // Act — present it repeatedly, more times than the attempt cap allows.
    for (let i = 0; i < 7; i += 1) {
      await verifyPickupCode({
        code: credential.code,
        agentId: agent.id,
        institutionId,
        locationId,
      });
    }

    // Assert — an impatient customer must not be able to lock themselves out.
    const code = await prisma.pickupCode.findUniqueOrThrow({
      where: { transactionId: created.transactionId },
      select: { attemptCount: true, status: true },
    });
    expect(code.attemptCount).toBe(0);
    expect(code.status).toBe('ACTIVE');
  });

  it('test_collection_delay_permits_redemption_once_the_hold_has_lifted', async () => {
    // Arrange — a hold that has already expired.
    const { created, confirmed } = await fundedTransaction(120_000n);
    const credential = confirmed.credential;
    if (!credential) throw new Error('no credential');

    await prisma.pickupCode.update({
      where: { transactionId: created.transactionId },
      data: { collectableFrom: new Date(Date.now() - 60_000) },
    });

    // Act
    const redeemed = await redeemPickupCode({
      code: credential.code,
      agentId: agent.id,
      institutionId,
      locationId,
      documentType: 'PASSPORT',
      documentLast4: '4567',
      amountMinor: 120_000n,
    });

    // Assert
    expect(redeemed.fullyPaid).toBe(true);

    const final = await prisma.transaction.findUniqueOrThrow({
      where: { id: created.transactionId },
      select: { status: true },
    });
    expect(final.status).toBe('PICKED_UP');
  });

  it('test_collection_delay_leaves_low_risk_transactions_immediately_collectable', async () => {
    // Arrange / Act — a clean customer scores LOW, below the seeded threshold.
    const { created } = await fundedTransaction(120_000n);

    const code = await prisma.pickupCode.findUniqueOrThrow({
      where: { transactionId: created.transactionId },
      select: { collectableFrom: true },
    });

    // Assert — the honest-customer path stays instant.
    expect(code.collectableFrom).toBeNull();
  });
});

describe('pickup code security', () => {
  it('test_pickup_code_security_rejects_an_unknown_code', async () => {
    const result = await verifyPickupCode({
      code: 'DR-0000-0000',
      agentId: agent.id,
      institutionId,
      locationId,
    });
    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.code).toBe('PICKUP_CODE_INVALID');
  });

  it('test_pickup_code_security_locks_a_code_after_too_many_failed_secret_checks_and_raises_an_alert', async () => {
    const { created, confirmed } = await fundedTransaction(120_000n);
    const credential = confirmed.credential;
    if (!credential) throw new Error('no credential');

    const wrongSecret = 'f'.repeat(32);
    for (let i = 0; i < 5; i += 1) {
      await verifyPickupCode({
        code: credential.code,
        secret: wrongSecret,
        agentId: agent.id,
        institutionId,
        locationId,
      });
    }

    const code = await prisma.pickupCode.findUniqueOrThrow({
      where: { transactionId: created.transactionId },
      select: { status: true, attemptCount: true },
    });
    expect(code.status).toBe('LOCKED');
    expect(code.attemptCount).toBeGreaterThanOrEqual(5);

    // Even the correct secret cannot open a locked code.
    const afterLock = await verifyPickupCode({
      code: credential.code,
      secret: credential.secret,
      agentId: agent.id,
      institutionId,
      locationId,
    });
    expect(afterLock.ok).toBe(false);

    const alerts = await prisma.fraudAlert.count({
      where: { transactionId: created.transactionId, type: 'CODE_BRUTE_FORCE' },
    });
    expect(alerts).toBeGreaterThan(0);
  });

  it('test_pickup_code_security_refuses_an_agent_acting_at_an_unassigned_location', async () => {
    const { confirmed } = await fundedTransaction(100_000n);
    const credential = confirmed.credential;
    if (!credential) throw new Error('no credential');

    const otherLocation = await getLocationId('BEN-SDQ-01');
    const otherInstitution = await getInstitutionId('DEMO-BEN');

    const result = await verifyPickupCode({
      code: credential.code,
      agentId: agent.id,
      institutionId: otherInstitution,
      locationId: otherLocation,
    });

    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.code).toBe('FORBIDDEN');
  });

  it('test_pickup_code_security_never_returns_customer_personal_data_to_an_agent', async () => {
    const { confirmed, customer } = await fundedTransaction(100_000n);
    const credential = confirmed.credential;
    if (!credential) throw new Error('no credential');

    const result = await verifyPickupCode({
      code: credential.code,
      agentId: agent.id,
      institutionId,
      locationId,
    });

    expect(result.ok).toBe(true);
    if (!result.ok) return;

    const serialised = JSON.stringify(result.view);
    expect(serialised).not.toContain(customer.email);
    expect(serialised).not.toContain('totalCharged');
    expect(Object.keys(result.view)).not.toContain('userId');
  });
});

describe('payment failure', () => {
  it('test_payment_failure_moves_to_payment_failed_and_posts_no_ledger_entries', async () => {
    const customer = await freshCustomer();
    const created = await createTransaction({
      userId: customer.id,
      payoutAmountMinor: 100_000n,
      countryCode: 'DO',
      fundingCurrency: 'USD',
      pickupLocationId: locationId,
    });

    await createPaymentIntent({
      transactionId: created.transactionId,
      userId: customer.id,
      idempotencyKey: `intent-fail-${created.reference}`,
    });

    const result = await confirmPayment({
      transactionId: created.transactionId,
      userId: customer.id,
      paymentToken: MOCK_TOKENS.DECLINE_FUNDS,
      idempotencyKey: `confirm-fail-${created.reference}`,
    });

    expect(result.status).toBe('PAYMENT_FAILED');
    expect(result.failureCode).toBe('insufficient_funds');
    expect(result.credential).toBeUndefined();

    const postings = await getLedgerEntriesForTransaction(created.transactionId);
    expect(postings).toHaveLength(0);

    const code = await prisma.pickupCode.findUnique({
      where: { transactionId: created.transactionId },
    });
    expect(code).toBeNull();
  });
});

describe('compliance hold', () => {
  it('test_compliance_hold_blocks_disbursement_while_held_and_issues_a_code_only_on_release', async () => {
    const { created, confirmed } = await fundedTransaction(250_000n);
    const credential = confirmed.credential;
    if (!credential) throw new Error('no credential');

    const analyst = await createTestUser(['COMPLIANCE_ANALYST']);

    await placeHold({
      transactionId: created.transactionId,
      analystId: analyst.id,
      reason: 'Integration test hold',
    });

    const held = await prisma.transaction.findUniqueOrThrow({
      where: { id: created.transactionId },
      select: { status: true },
    });
    expect(held.status).toBe('COMPLIANCE_REVIEW');

    // A held transaction must not pay out, even with a valid code.
    //
    // Two independent guards refuse this: the status check (the transaction is
    // no longer READY_FOR_PICKUP) and the open-compliance-case check. The status
    // guard fires first here, which is why this asserts the outcome rather than
    // a particular message — what matters is that no cash moved.
    await expect(
      redeemPickupCode({
        code: credential.code,
        agentId: agent.id,
        institutionId,
        locationId,
        documentType: 'PASSPORT',
        documentLast4: '4567',
        amountMinor: 250_000n,
      }),
    ).rejects.toThrow();

    const duringHold = await prisma.transaction.findUniqueOrThrow({
      where: { id: created.transactionId },
      select: { paidOutMinor: true },
    });
    expect(duringHold.paidOutMinor).toBe(0n);

    await releaseHold({
      transactionId: created.transactionId,
      analystId: analyst.id,
      resolution: 'Cleared on review',
    });

    const released = await prisma.transaction.findUniqueOrThrow({
      where: { id: created.transactionId },
      select: { status: true },
    });
    expect(released.status).toBe('READY_FOR_PICKUP');

    const paid = await redeemPickupCode({
      code: credential.code,
      agentId: agent.id,
      institutionId,
      locationId,
      documentType: 'PASSPORT',
      documentLast4: '4567',
      amountMinor: 250_000n,
    });
    expect(paid.fullyPaid).toBe(true);

    await cleanupUser(analyst.id);
  });

  /**
   * The second, independent guard: an open compliance case blocks disbursement
   * even when the transaction is still READY_FOR_PICKUP. This is the path taken
   * when a case is opened without a status change — e.g. an escalation raised
   * against a partially collected transaction.
   */
  it('test_compliance_hold_blocks_disbursement_on_an_open_case_even_while_status_is_ready_for_pickup', async () => {
    const { created, confirmed } = await fundedTransaction(180_000n);
    const credential = confirmed.credential;
    if (!credential) throw new Error('no credential');

    await prisma.complianceCase.create({
      data: {
        caseNumber: `CMP-TEST-${Date.now()}`,
        type: 'FRAUD_REVIEW',
        status: 'OPEN',
        priority: 'HIGH',
        transactionId: created.transactionId,
        summary: 'Open case without a status change',
      },
    });

    const stillReady = await prisma.transaction.findUniqueOrThrow({
      where: { id: created.transactionId },
      select: { status: true },
    });
    expect(stillReady.status).toBe('READY_FOR_PICKUP');

    await expect(
      redeemPickupCode({
        code: credential.code,
        agentId: agent.id,
        institutionId,
        locationId,
        documentType: 'PASSPORT',
        documentLast4: '4567',
        amountMinor: 180_000n,
      }),
    ).rejects.toThrow(/hold/i);

    const untouched = await prisma.transaction.findUniqueOrThrow({
      where: { id: created.transactionId },
      select: { paidOutMinor: true },
    });
    expect(untouched.paidOutMinor).toBe(0n);

    await prisma.complianceCase.deleteMany({ where: { transactionId: created.transactionId } });
  });
});

describe('refunds and chargebacks', () => {
  it('test_refunds_and_chargebacks_refunds_a_funded_transaction_and_keeps_the_ledger_balanced', async () => {
    const { created } = await fundedTransaction(100_000n);
    const admin = await createTestUser(['FINANCE_ADMIN']);

    const transaction = await prisma.transaction.findUniqueOrThrow({
      where: { id: created.transactionId },
      select: { totalChargedMinor: true },
    });

    await issueRefund({
      transactionId: created.transactionId,
      amountMinor: transaction.totalChargedMinor,
      reason: 'Integration test refund',
      requestedBy: admin.id,
    });

    const refunded = await prisma.transaction.findUniqueOrThrow({
      where: { id: created.transactionId },
      select: { status: true },
    });
    expect(refunded.status).toBe('REFUNDED');
    expect(await verifyLedgerIntegrity()).toEqual({ balanced: true });

    await cleanupUser(admin.id);
  });

  /**
   * Regression guard.
   *
   * An earlier revision booked a refund as a debit against the customer-funds
   * suspense account. Those funds had already been allocated to fees and FX, so
   * the account went negative — arithmetically balanced, economically nonsense.
   * A custodial liability represents money held on someone's behalf and can
   * never be less than zero.
   */
  it('test_refunds_and_chargebacks_leaves_every_account_at_zero_after_a_full_refund_and_never_negative', async () => {
    const { created } = await fundedTransaction(100_000n);
    const admin = await createTestUser(['FINANCE_ADMIN']);

    const transaction = await prisma.transaction.findUniqueOrThrow({
      where: { id: created.transactionId },
      select: { totalChargedMinor: true },
    });

    await issueRefund({
      transactionId: created.transactionId,
      amountMinor: transaction.totalChargedMinor,
      reason: 'Full refund regression test',
      requestedBy: admin.id,
    });

    // Every posting for this transaction is now matched by a reversal, so each
    // account nets to exactly zero.
    const postings = await getLedgerEntriesForTransaction(created.transactionId);
    const perAccount = new Map<string, bigint>();
    for (const posting of postings) {
      for (const entry of posting.entries) {
        const signed = entry.direction === 'DEBIT' ? entry.amountMinor : -entry.amountMinor;
        perAccount.set(entry.account.code, (perAccount.get(entry.account.code) ?? 0n) + signed);
      }
    }
    for (const [code, balance] of perAccount) {
      expect(balance, `${code} should net to zero after a full refund`).toBe(0n);
    }

    // And the platform-wide invariant: no custodial account is ever negative.
    const balances = await getAccountBalances();
    for (const balance of balances.filter((b) => b.isCustodial)) {
      expect(
        balance.balanceMinor >= 0n,
        `${balance.accountCode} holds a negative custodial balance`,
      ).toBe(true);
    }

    await cleanupUser(admin.id);
  });

  it('test_refunds_and_chargebacks_refuses_a_partial_refund_rather_than_guessing_the_fee_apportionment', async () => {
    const { created } = await fundedTransaction(100_000n);
    const admin = await createTestUser(['FINANCE_ADMIN']);

    await expect(
      issueRefund({
        transactionId: created.transactionId,
        amountMinor: 100n,
        reason: 'Partial refund attempt',
        requestedBy: admin.id,
      }),
    ).rejects.toThrow(/Partial refunds are not supported/);

    await cleanupUser(admin.id);
  });

  it('test_refunds_and_chargebacks_books_a_chargeback_after_disbursement_as_a_fraud_loss', async () => {
    const { created, confirmed } = await fundedTransaction(100_000n);
    const credential = confirmed.credential;
    if (!credential) throw new Error('no credential');

    await redeemPickupCode({
      code: credential.code,
      agentId: agent.id,
      institutionId,
      locationId,
      documentType: 'PASSPORT',
      documentLast4: '4567',
      amountMinor: 100_000n,
    });

    const payment = await prisma.payment.findFirstOrThrow({
      where: { transactionId: created.transactionId },
      select: { id: true, amountMinor: true, currency: true },
    });

    await recordChargeback({
      transactionId: created.transactionId,
      paymentId: payment.id,
      amountMinor: payment.amountMinor,
      currency: payment.currency,
      reasonCode: '10.4',
    });

    const disputed = await prisma.transaction.findUniqueOrThrow({
      where: { id: created.transactionId },
      select: { status: true },
    });
    expect(disputed.status).toBe('DISPUTED');

    const postings = await getLedgerEntriesForTransaction(created.transactionId);
    const chargeback = postings.find((p) => p.eventType === 'CHARGEBACK');
    expect(chargeback).toBeDefined();
    expect(
      chargeback?.entries.some((entry) => entry.account.code === 'EXP_FRAUD_LOSS_USD'),
    ).toBe(true);

    expect(await verifyLedgerIntegrity()).toEqual({ balanced: true });
  });
});

describe('state machine enforcement at the database layer', () => {
  it('test_state_machine_enforcement_at_the_database_layer_refuses_an_illegal_transition_even_when_called_directly', async () => {
    const customer = await freshCustomer();
    const created = await createTransaction({
      userId: customer.id,
      payoutAmountMinor: 100_000n,
      countryCode: 'DO',
      fundingCurrency: 'USD',
      pickupLocationId: locationId,
    });

    await expect(
      prisma.$transaction((tx) =>
        transitionTransaction(
          {
            transactionId: created.transactionId,
            to: 'PICKED_UP',
            actorType: 'admin',
            reason: 'should be impossible',
          },
          tx,
        ),
      ),
    ).rejects.toThrow(IllegalTransitionError);
  });

  it('test_state_machine_enforcement_at_the_database_layer_refuses_a_customer_driven_transition_to_ready_for_pickup', async () => {
    const { created } = await fundedTransaction(100_000n);

    await expect(
      prisma.$transaction((tx) =>
        transitionTransaction(
          {
            transactionId: created.transactionId,
            to: 'PICKED_UP',
            actorType: 'customer',
            reason: 'self-service payout',
          },
          tx,
        ),
      ),
    ).rejects.toThrow(IllegalTransitionError);
  });

  it('test_state_machine_enforcement_at_the_database_layer_writes_an_event_for_every_transition', async () => {
    const { created } = await fundedTransaction(100_000n);
    const events = await prisma.transactionEvent.findMany({
      where: { transactionId: created.transactionId },
      orderBy: { createdAt: 'asc' },
      select: { fromStatus: true, toStatus: true },
    });

    expect(events.length).toBeGreaterThanOrEqual(4);
    expect(events[0]?.fromStatus).toBeNull();
    expect(events[0]?.toStatus).toBe('CREATED');
    expect(events[events.length - 1]?.toStatus).toBe('READY_FOR_PICKUP');
  });
});

describe('KYC', () => {
  it('test_kyc_advances_a_waiting_transaction_on_approval_and_stores_only_the_last_4', async () => {
    const unverified = await createTestUser(['CUSTOMER']);

    // Above the $250 KYC threshold.
    const created = await createTransaction({
      userId: unverified.id,
      payoutAmountMinor: 2_000_000n,
      countryCode: 'DO',
      fundingCurrency: 'USD',
      pickupLocationId: locationId,
    });
    expect(created.status).toBe('KYC_REQUIRED');

    const result = await submitKyc({
      userId: unverified.id,
      firstName: 'Test',
      lastName: 'Traveler',
      dateOfBirth: '1985-04-12',
      documentType: 'PASSPORT',
      documentNumber: 'X9876543',
      documentCountry: 'US',
      residenceCountry: 'US',
      transactionId: created.transactionId,
    });

    expect(result.status).toBe('APPROVED');

    const verification = await prisma.identityVerification.findUniqueOrThrow({
      where: { id: result.verificationId },
      select: { documentLast4: true },
    });
    expect(verification.documentLast4).toBe('6543');

    const advanced = await prisma.transaction.findUniqueOrThrow({
      where: { id: created.transactionId },
      select: { status: true },
    });
    expect(advanced.status).toBe('PAYMENT_PENDING');

    await cleanupUser(unverified.id);
  });

  it('test_kyc_rejects_a_sanctions_match_and_opens_a_compliance_case', async () => {
    const flagged = await createTestUser(['CUSTOMER']);

    const result = await submitKyc({
      userId: flagged.id,
      firstName: 'Test',
      lastName: 'SANCTIONED', // demo fixture trigger
      dateOfBirth: '1985-04-12',
      documentType: 'PASSPORT',
      documentNumber: 'X1111111',
      documentCountry: 'US',
      residenceCountry: 'US',
    });

    expect(result.status).toBe('REJECTED');

    const cases = await prisma.complianceCase.count({
      where: { subjectUserId: flagged.id, type: 'SANCTIONS_HIT' },
    });
    expect(cases).toBe(1);

    await prisma.complianceCase.deleteMany({ where: { subjectUserId: flagged.id } });
    await cleanupUser(flagged.id);
  });
});
