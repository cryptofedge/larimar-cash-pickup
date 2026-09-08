/**
 * Settlement service.
 *
 * Closes the loop the payout opens. When an agent hands over pesos the platform
 * records a payable to that partner; settlement totals those payables for a
 * period, agrees them with the partner, and pays.
 *
 * The invariant that matters: **a disbursement is settled exactly once, ever.**
 * It is enforced by a UNIQUE constraint on `settlement_lines.pickup_event_id`
 * rather than by application logic, so no amount of careless re-invocation can
 * pay a partner twice for the same cash.
 */

import type { Prisma } from '@prisma/client';
import { prisma, withSerializableTransaction, isUniqueViolation } from '../db';
import { DomainError } from '@/lib/domain/errors';
import { fromMinor } from '@/lib/domain/money';
import { buildPartnerSettlementPosting } from '@/lib/domain/ledger';
import {
  type SettlementPayout,
  type SettlementStatus,
  type SettlementTotals,
  assertSettlementTransition,
  calculateSettlement,
  classifyFloat,
  previousSettlementPeriod,
  reconcile,
  settlementPeriod,
  toSettlementCsv,
} from '@/lib/domain/settlement';
import { postLedgerTransaction } from './ledger';
import { writeAudit } from './audit';
import { generateReference } from '../auth/crypto';

// ---------------------------------------------------------------------------
// Generation
// ---------------------------------------------------------------------------

export interface GenerateBatchInput {
  readonly institutionId: string;
  readonly periodStart: Date;
  readonly periodEnd: Date;
  readonly actorId?: string | null;
  readonly ipAddress?: string | null;
}

export interface GeneratedBatch {
  readonly batchId: string;
  readonly reference: string;
  readonly totals: SettlementTotals;
  /** True when a batch for this institution and period already existed. */
  readonly alreadyExisted: boolean;
}

/**
 * Collect the period's disbursements into a batch.
 *
 * Idempotent in two independent ways: the batch is unique per
 * (institution, period), and each line is unique per pickup event. Re-running
 * generation returns the existing batch rather than creating a second one.
 *
 * Only `PAYOUT_COMPLETED` events count — a verification, a rejection, or an
 * escalation moved no cash and must never appear on a partner's statement.
 */
export async function generateSettlementBatch(
  input: GenerateBatchInput,
): Promise<GeneratedBatch> {
  if (input.periodEnd <= input.periodStart) {
    throw new DomainError('VALIDATION_ERROR', 'Settlement period end must be after its start');
  }

  const institution = await prisma.pickupInstitution.findUnique({
    where: { id: input.institutionId },
    select: {
      id: true,
      name: true,
      code: true,
      commissionBps: true,
      settlementCurrency: true,
      deletedAt: true,
    },
  });

  if (!institution || institution.deletedAt) {
    throw new DomainError('NOT_FOUND', 'Payout institution not found');
  }

  const existing = await prisma.settlementBatch.findUnique({
    where: {
      institutionId_periodStart_periodEnd: {
        institutionId: input.institutionId,
        periodStart: input.periodStart,
        periodEnd: input.periodEnd,
      },
    },
    select: {
      id: true,
      reference: true,
      payoutCount: true,
      grossPayoutMinor: true,
      commissionBps: true,
      commissionMinor: true,
      netPayableMinor: true,
      currency: true,
    },
  });

  if (existing) {
    return {
      batchId: existing.id,
      reference: existing.reference,
      alreadyExisted: true,
      totals: {
        payoutCount: existing.payoutCount,
        grossPayout: fromMinor(existing.grossPayoutMinor, existing.currency),
        commissionBps: existing.commissionBps,
        commission: fromMinor(existing.commissionMinor, existing.currency),
        netPayable: fromMinor(existing.netPayableMinor, existing.currency),
      },
    };
  }

  // Half-open [start, end): a payout at exactly midnight belongs to one period
  // only. Overlapping boundaries are how a disbursement gets settled twice.
  const events = await prisma.pickupEvent.findMany({
    where: {
      institutionId: input.institutionId,
      eventType: 'PAYOUT_COMPLETED',
      createdAt: { gte: input.periodStart, lt: input.periodEnd },
      amountMinor: { not: null },
      // Anything already on another batch is excluded outright.
      NOT: { id: { in: await settledEventIds(input.institutionId) } },
    },
    select: {
      id: true,
      transactionId: true,
      locationId: true,
      amountMinor: true,
      currency: true,
      createdAt: true,
      transaction: { select: { reference: true } },
      location: { select: { code: true } },
    },
    orderBy: { createdAt: 'asc' },
  });

  const payouts: SettlementPayout[] = events.map((event) => ({
    pickupEventId: event.id,
    transactionId: event.transactionId,
    transactionRef: event.transaction?.reference ?? null,
    locationId: event.locationId,
    locationCode: event.location?.code ?? null,
    amountMinor: event.amountMinor as bigint,
    currency: event.currency ?? institution.settlementCurrency,
    disbursedAt: event.createdAt,
  }));

  const totals = calculateSettlement(payouts, {
    commissionBps: institution.commissionBps,
    currency: institution.settlementCurrency,
  });

  const reference = generateReference('STL');

  try {
    const batch = await prisma.settlementBatch.create({
      data: {
        reference,
        institutionId: institution.id,
        periodStart: input.periodStart,
        periodEnd: input.periodEnd,
        currency: institution.settlementCurrency,
        payoutCount: totals.payoutCount,
        grossPayoutMinor: totals.grossPayout.amount,
        commissionBps: totals.commissionBps,
        commissionMinor: totals.commission.amount,
        netPayableMinor: totals.netPayable.amount,
        status: 'DRAFT',
        createdBy: input.actorId ?? null,
        lines: {
          create: payouts.map((payout) => ({
            pickupEventId: payout.pickupEventId,
            transactionId: payout.transactionId,
            transactionRef: payout.transactionRef,
            locationId: payout.locationId,
            locationCode: payout.locationCode,
            amountMinor: payout.amountMinor,
            currency: payout.currency,
            disbursedAt: payout.disbursedAt,
          })),
        },
      },
      select: { id: true, reference: true },
    });

    await writeAudit({
      actorId: input.actorId ?? null,
      actorType: input.actorId ? 'admin' : 'system',
      action: 'settlement.generate',
      resourceType: 'settlement_batch',
      resourceId: batch.id,
      after: {
        reference: batch.reference,
        institution: institution.code,
        payoutCount: totals.payoutCount,
        grossPayoutMinor: totals.grossPayout.amount.toString(),
        netPayableMinor: totals.netPayable.amount.toString(),
      },
      ipAddress: input.ipAddress,
    });

    return {
      batchId: batch.id,
      reference: batch.reference,
      totals,
      alreadyExisted: false,
    };
  } catch (error) {
    if (isUniqueViolation(error)) {
      // Either a concurrent generation won, or a payout was already settled
      // elsewhere. Both are the constraint doing its job.
      throw new DomainError(
        'CONFLICT',
        'A settlement batch covering these payouts already exists. Re-read before generating.',
      );
    }
    throw error;
  }
}

/** Pickup events already attached to a batch for this institution. */
async function settledEventIds(institutionId: string): Promise<string[]> {
  const lines = await prisma.settlementLine.findMany({
    where: { batch: { institutionId } },
    select: { pickupEventId: true },
  });
  return lines.map((line) => line.pickupEventId);
}

/** Generate yesterday's batch for every active institution. For a scheduled job. */
export async function generateDailyBatches(now = new Date()): Promise<GeneratedBatch[]> {
  const { periodStart, periodEnd } = previousSettlementPeriod(now);

  const institutions = await prisma.pickupInstitution.findMany({
    where: { active: true, deletedAt: null },
    select: { id: true },
  });

  const results: GeneratedBatch[] = [];
  for (const institution of institutions) {
    results.push(
      await generateSettlementBatch({
        institutionId: institution.id,
        periodStart,
        periodEnd,
      }),
    );
  }
  return results;
}

// ---------------------------------------------------------------------------
// Lifecycle
// ---------------------------------------------------------------------------

async function transitionBatch(
  batchId: string,
  to: SettlementStatus,
  data: Prisma.SettlementBatchUpdateInput,
): Promise<void> {
  const batch = await prisma.settlementBatch.findUnique({
    where: { id: batchId },
    select: { status: true },
  });
  if (!batch) throw new DomainError('NOT_FOUND', 'Settlement batch not found');

  assertSettlementTransition(batch.status as SettlementStatus, to);

  const updated = await prisma.settlementBatch.updateMany({
    where: { id: batchId, status: batch.status },
    data: { ...(data as Prisma.SettlementBatchUpdateManyMutationInput), status: to },
  });

  if (updated.count === 0) {
    throw new DomainError('CONFLICT', 'The settlement batch changed while this request was in flight');
  }
}

/** Issue the statement to the partner. */
export async function issueSettlementBatch(input: {
  batchId: string;
  actorId: string;
  ipAddress?: string | null;
}): Promise<void> {
  await transitionBatch(input.batchId, 'ISSUED', { issuedAt: new Date() });

  await writeAudit({
    actorId: input.actorId,
    actorType: 'admin',
    action: 'settlement.issue',
    resourceType: 'settlement_batch',
    resourceId: input.batchId,
    ipAddress: input.ipAddress,
  });
}

export interface ReconcileInput {
  readonly batchId: string;
  readonly partnerReportedMinor: bigint;
  readonly actorId: string;
  /** Required when accepting a non-zero variance. */
  readonly varianceNote?: string;
  readonly ipAddress?: string | null;
}

/**
 * Record the partner's figure and compare.
 *
 * An exact match reconciles. A variance moves the batch to DISPUTED unless the
 * analyst supplies an explicit note accepting it — a discrepancy on a cash
 * settlement is never waved through silently, because the usual cause is a payout
 * missing from one side's records.
 */
export async function reconcileSettlementBatch(input: ReconcileInput): Promise<{
  matched: boolean;
  varianceMinor: bigint;
  status: SettlementStatus;
  summary: string;
}> {
  const batch = await prisma.settlementBatch.findUnique({
    where: { id: input.batchId },
    select: { id: true, status: true, grossPayoutMinor: true, currency: true },
  });
  if (!batch) throw new DomainError('NOT_FOUND', 'Settlement batch not found');

  const result = reconcile({
    ourGrossMinor: batch.grossPayoutMinor,
    partnerReportedMinor: input.partnerReportedMinor,
    currency: batch.currency,
  });

  const accepted = result.matched || Boolean(input.varianceNote);
  const next: SettlementStatus = accepted ? 'RECONCILED' : 'DISPUTED';

  await transitionBatch(input.batchId, next, {
    partnerReportedMinor: input.partnerReportedMinor,
    varianceMinor: result.varianceMinor,
    varianceNote: input.varianceNote ?? null,
    reconciledAt: new Date(),
    reconciledBy: input.actorId,
  });

  await writeAudit({
    actorId: input.actorId,
    actorType: 'admin',
    action: accepted ? 'settlement.reconcile' : 'settlement.dispute',
    resourceType: 'settlement_batch',
    resourceId: input.batchId,
    after: {
      partnerReportedMinor: input.partnerReportedMinor.toString(),
      ourGrossMinor: batch.grossPayoutMinor.toString(),
      varianceMinor: result.varianceMinor.toString(),
      accepted,
      varianceNote: input.varianceNote ?? null,
    },
    success: accepted,
    ipAddress: input.ipAddress,
  });

  return {
    matched: result.matched,
    varianceMinor: result.varianceMinor,
    status: next,
    summary: result.summary,
  };
}

/**
 * Record that funds were transferred, and post the ledger.
 *
 * Only reachable from RECONCILED — money never leaves before both sides agree
 * the figure. Runs at SERIALIZABLE so a double submission cannot post twice, and
 * the posting key is unique per batch as a second guard.
 */
export async function markSettlementPaid(input: {
  batchId: string;
  paymentReference: string;
  actorId: string;
  ipAddress?: string | null;
}): Promise<{ ledgerTransactionId: string }> {
  return withSerializableTransaction(async (tx) => {
    const batch = await tx.settlementBatch.findUnique({
      where: { id: input.batchId },
      select: {
        id: true,
        reference: true,
        status: true,
        currency: true,
        grossPayoutMinor: true,
        commissionMinor: true,
        netPayableMinor: true,
      },
    });
    if (!batch) throw new DomainError('NOT_FOUND', 'Settlement batch not found');

    assertSettlementTransition(batch.status as SettlementStatus, 'PAID');

    if (batch.netPayableMinor <= 0n) {
      throw new DomainError(
        'VALIDATION_ERROR',
        'This batch has nothing payable. Cancel it rather than marking it paid.',
      );
    }

    const claimed = await tx.settlementBatch.updateMany({
      where: { id: batch.id, status: 'RECONCILED' },
      data: {
        status: 'PAID',
        paidAt: new Date(),
        paidBy: input.actorId,
        paymentReference: input.paymentReference,
      },
    });
    if (claimed.count === 0) {
      throw new DomainError('CONFLICT', 'This batch was already settled');
    }

    const posted = await postLedgerTransaction(
      buildPartnerSettlementPosting({
        batchReference: batch.reference,
        grossPayout: fromMinor(batch.grossPayoutMinor, batch.currency),
        commission: fromMinor(batch.commissionMinor, batch.currency),
        netPayable: fromMinor(batch.netPayableMinor, batch.currency),
      }),
      {},
      tx,
    );

    await writeAudit(
      {
        actorId: input.actorId,
        actorType: 'admin',
        action: 'settlement.paid',
        resourceType: 'settlement_batch',
        resourceId: batch.id,
        after: {
          reference: batch.reference,
          netPayableMinor: batch.netPayableMinor.toString(),
          paymentReference: input.paymentReference,
          ledgerTransactionId: posted.ledgerTransactionId,
        },
        ipAddress: input.ipAddress,
      },
      tx,
    );

    return { ledgerTransactionId: posted.ledgerTransactionId };
  });
}

export async function cancelSettlementBatch(input: {
  batchId: string;
  reason: string;
  actorId: string;
  ipAddress?: string | null;
}): Promise<void> {
  await transitionBatch(input.batchId, 'CANCELLED', { varianceNote: input.reason });

  await writeAudit({
    actorId: input.actorId,
    actorType: 'admin',
    action: 'settlement.cancel',
    resourceType: 'settlement_batch',
    resourceId: input.batchId,
    metadata: { reason: input.reason },
    ipAddress: input.ipAddress,
  });
}

// ---------------------------------------------------------------------------
// Reads
// ---------------------------------------------------------------------------

export async function listSettlementBatches(options: {
  institutionId?: string;
  status?: SettlementStatus[];
  limit?: number;
} = {}) {
  return prisma.settlementBatch.findMany({
    where: {
      ...(options.institutionId ? { institutionId: options.institutionId } : {}),
      ...(options.status ? { status: { in: options.status } } : {}),
    },
    include: {
      institution: { select: { name: true, code: true, isDemo: true } },
      _count: { select: { lines: true } },
    },
    orderBy: [{ periodEnd: 'desc' }, { createdAt: 'desc' }],
    take: options.limit ?? 50,
  });
}

export async function getSettlementBatch(batchId: string) {
  const batch = await prisma.settlementBatch.findUnique({
    where: { id: batchId },
    include: {
      institution: { select: { name: true, code: true, isDemo: true } },
      lines: { orderBy: { disbursedAt: 'asc' } },
    },
  });
  if (!batch) throw new DomainError('NOT_FOUND', 'Settlement batch not found');
  return batch;
}

/** CSV statement for a batch. */
export async function exportSettlementCsv(batchId: string): Promise<{
  filename: string;
  csv: string;
}> {
  const batch = await getSettlementBatch(batchId);

  const csv = toSettlementCsv({
    reference: batch.reference,
    institutionName: batch.institution.name,
    periodStart: batch.periodStart,
    periodEnd: batch.periodEnd,
    currency: batch.currency,
    totals: {
      payoutCount: batch.payoutCount,
      grossPayout: fromMinor(batch.grossPayoutMinor, batch.currency),
      commissionBps: batch.commissionBps,
      commission: fromMinor(batch.commissionMinor, batch.currency),
      netPayable: fromMinor(batch.netPayableMinor, batch.currency),
    },
    lines: batch.lines.map((line) => ({
      pickupEventId: line.pickupEventId,
      transactionId: line.transactionId,
      transactionRef: line.transactionRef,
      locationId: line.locationId,
      locationCode: line.locationCode,
      amountMinor: line.amountMinor,
      currency: line.currency,
      disbursedAt: line.disbursedAt,
    })),
  });

  return { filename: `${batch.reference}.csv`, csv };
}

/**
 * Unsettled exposure: cash partners have fronted that we have not yet paid back.
 *
 * The number a treasury function watches daily.
 */
export async function getOutstandingExposure(): Promise<
  { institutionId: string; institutionName: string; currency: string; outstandingMinor: bigint; payoutCount: number }[]
> {
  const institutions = await prisma.pickupInstitution.findMany({
    where: { active: true, deletedAt: null },
    select: { id: true, name: true, settlementCurrency: true },
  });

  const results = [];
  for (const institution of institutions) {
    const settled = await settledEventIds(institution.id);

    const unsettled = await prisma.pickupEvent.aggregate({
      where: {
        institutionId: institution.id,
        eventType: 'PAYOUT_COMPLETED',
        amountMinor: { not: null },
        ...(settled.length > 0 ? { NOT: { id: { in: settled } } } : {}),
      },
      _sum: { amountMinor: true },
      _count: { _all: true },
    });

    results.push({
      institutionId: institution.id,
      institutionName: institution.name,
      currency: institution.settlementCurrency,
      outstandingMinor: unsettled._sum.amountMinor ?? 0n,
      payoutCount: unsettled._count._all,
    });
  }

  return results;
}

/** Float pressure across active locations, worst first. */
export async function getFloatStatus() {
  const locations = await prisma.pickupLocation.findMany({
    where: { status: 'ACTIVE', deletedAt: null },
    select: {
      id: true,
      code: true,
      branchName: true,
      city: true,
      dailyUsedMinor: true,
      dailyCapacityMinor: true,
    },
  });

  return locations
    .map((location) =>
      classifyFloat({
        locationId: location.id,
        locationCode: location.code,
        branchName: location.branchName,
        city: location.city,
        usedMinor: location.dailyUsedMinor,
        capacityMinor: location.dailyCapacityMinor,
      }),
    )
    .sort((a, b) => b.utilisationPercent - a.utilisationPercent);
}

export { settlementPeriod, previousSettlementPeriod };
