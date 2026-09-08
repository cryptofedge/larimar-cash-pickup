import { defineRoute, jsonOk } from '@/server/http/api';
import { adminSearchSchema } from '@/lib/validation/schemas';
import { searchTransactions } from '@/server/services/admin';
import { TRANSACTION_STATUSES, type TransactionStatus } from '@/lib/domain/transaction-state';

export const runtime = 'nodejs';

export const GET = defineRoute(
  { permission: 'transaction.read.any', schema: adminSearchSchema, source: 'query' },
  async ({ body }) => {
    const statuses = body.status
      ?.split(',')
      .map((s) => s.trim())
      .filter((s): s is TransactionStatus => (TRANSACTION_STATUSES as readonly string[]).includes(s));

    const results = await searchTransactions({
      q: body.q,
      status: statuses,
      riskLevel: body.riskLevel,
      locationId: body.locationId,
      from: body.from ? new Date(body.from) : undefined,
      to: body.to ? new Date(body.to) : undefined,
      limit: body.limit,
    });

    return jsonOk({
      transactions: results.map((t) => ({
        id: t.id,
        reference: t.reference,
        status: t.status,
        riskLevel: t.riskLevel,
        riskScore: t.riskScore,
        payoutAmountMinor: t.payoutAmountMinor,
        payoutCurrency: t.payoutCurrency,
        totalChargedMinor: t.totalChargedMinor,
        fundingCurrency: t.fundingCurrency,
        customerEmail: t.user.email,
        location: t.pickupLocation
          ? `${t.pickupLocation.branchName}, ${t.pickupLocation.city}`
          : null,
        codeStatus: t.pickupCode?.status ?? null,
        createdAt: t.createdAt,
        completedAt: t.completedAt,
      })),
    });
  },
);
