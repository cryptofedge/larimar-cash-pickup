import { defineRoute, jsonError, jsonOk, requirePrincipal } from '@/server/http/api';
import {
  generateSettlementSchema,
  listSettlementsSchema,
  settlementActionSchema,
} from '@/lib/validation/schemas';
import {
  cancelSettlementBatch,
  generateSettlementBatch,
  getFloatStatus,
  getOutstandingExposure,
  issueSettlementBatch,
  listSettlementBatches,
  markSettlementPaid,
  previousSettlementPeriod,
  reconcileSettlementBatch,
} from '@/server/services/settlement';
import { hasPermission } from '@/server/auth/rbac';
import type { SettlementStatus } from '@/lib/domain/settlement';

export const runtime = 'nodejs';

const STATUSES: SettlementStatus[] = [
  'DRAFT',
  'ISSUED',
  'RECONCILED',
  'PAID',
  'DISPUTED',
  'CANCELLED',
];

export const GET = defineRoute(
  { permission: 'settlement.read', schema: listSettlementsSchema, source: 'query' },
  async ({ body }) => {
    const statuses = body.status
      ?.split(',')
      .map((s) => s.trim())
      .filter((s): s is SettlementStatus => (STATUSES as string[]).includes(s));

    const [batches, exposure, float] = await Promise.all([
      listSettlementBatches({
        institutionId: body.institutionId,
        status: statuses,
        limit: body.limit,
      }),
      getOutstandingExposure(),
      getFloatStatus(),
    ]);

    return jsonOk({
      batches: batches.map((batch) => ({
        id: batch.id,
        reference: batch.reference,
        institution: batch.institution.name,
        institutionCode: batch.institution.code,
        isDemo: batch.institution.isDemo,
        periodStart: batch.periodStart,
        periodEnd: batch.periodEnd,
        currency: batch.currency,
        payoutCount: batch.payoutCount,
        grossPayoutMinor: batch.grossPayoutMinor,
        commissionBps: batch.commissionBps,
        commissionMinor: batch.commissionMinor,
        netPayableMinor: batch.netPayableMinor,
        status: batch.status,
        partnerReportedMinor: batch.partnerReportedMinor,
        varianceMinor: batch.varianceMinor,
        issuedAt: batch.issuedAt,
        paidAt: batch.paidAt,
        lineCount: batch._count.lines,
      })),
      // Cash partners have fronted that we have not paid back yet — the number a
      // treasury function watches daily.
      exposure,
      float,
    });
  },
);

/** Generate a batch for a period. Idempotent per (institution, period). */
export const POST = defineRoute(
  {
    permission: 'settlement.generate',
    schema: generateSettlementSchema,
    idempotent: true,
    auditAction: 'settlement.generate',
  },
  async ({ body, ctx }) => {
    const principal = requirePrincipal(ctx);

    // Default to the previous whole UTC day.
    const period =
      body.periodStart && body.periodEnd
        ? { periodStart: new Date(body.periodStart), periodEnd: new Date(body.periodEnd) }
        : previousSettlementPeriod(new Date());

    const result = await generateSettlementBatch({
      institutionId: body.institutionId,
      periodStart: period.periodStart,
      periodEnd: period.periodEnd,
      actorId: principal.userId,
      ipAddress: ctx.ipAddress,
    });

    return jsonOk(
      {
        batchId: result.batchId,
        reference: result.reference,
        alreadyExisted: result.alreadyExisted,
        payoutCount: result.totals.payoutCount,
        grossPayoutMinor: result.totals.grossPayout.amount,
        commissionMinor: result.totals.commission.amount,
        netPayableMinor: result.totals.netPayable.amount,
        currency: result.totals.netPayable.currency,
      },
      result.alreadyExisted ? 200 : 201,
    );
  },
);

/**
 * Act on a batch.
 *
 * Note the permission split: issuing and cancelling need `settlement.generate`,
 * reconciling needs `settlement.reconcile`, and marking paid — the only action
 * that moves money — needs `settlement.pay`.
 */
export const PUT = defineRoute(
  {
    permission: 'settlement.read',
    schema: settlementActionSchema,
    idempotent: true,
    auditAction: 'settlement.action',
  },
  async ({ body, ctx }) => {
    const principal = requirePrincipal(ctx);

    const required = {
      ISSUE: 'settlement.generate',
      CANCEL: 'settlement.generate',
      RECONCILE: 'settlement.reconcile',
      PAY: 'settlement.pay',
    } as const;

    if (!hasPermission(principal.roles, required[body.action])) {
      return jsonError('FORBIDDEN', 'You do not have access to that.', 403);
    }

    switch (body.action) {
      case 'ISSUE': {
        await issueSettlementBatch({
          batchId: body.batchId,
          actorId: principal.userId,
          ipAddress: ctx.ipAddress,
        });
        return jsonOk({ status: 'ISSUED' });
      }

      case 'RECONCILE': {
        const result = await reconcileSettlementBatch({
          batchId: body.batchId,
          partnerReportedMinor: BigInt(body.partnerReportedMinor as string),
          varianceNote: body.varianceNote,
          actorId: principal.userId,
          ipAddress: ctx.ipAddress,
        });
        return jsonOk(result);
      }

      case 'PAY': {
        const result = await markSettlementPaid({
          batchId: body.batchId,
          paymentReference: body.paymentReference as string,
          actorId: principal.userId,
          ipAddress: ctx.ipAddress,
        });
        return jsonOk({ status: 'PAID', ledgerTransactionId: result.ledgerTransactionId });
      }

      case 'CANCEL': {
        await cancelSettlementBatch({
          batchId: body.batchId,
          reason: body.reason as string,
          actorId: principal.userId,
          ipAddress: ctx.ipAddress,
        });
        return jsonOk({ status: 'CANCELLED' });
      }
    }
  },
);
