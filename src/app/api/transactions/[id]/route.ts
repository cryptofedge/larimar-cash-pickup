import { defineRoute, jsonOk, requirePrincipal } from '@/server/http/api';
import { getTransactionForUser } from '@/server/services/transaction';
import { getLedgerEntriesForTransaction } from '@/server/services/ledger';
import { hasPermission } from '@/server/auth/rbac';

export const runtime = 'nodejs';

export const GET = defineRoute({ permission: 'transaction.read.own' }, async ({ ctx, params }) => {
  const principal = requirePrincipal(ctx);
  const id = params.id as string;

  const transaction = await getTransactionForUser(id, principal.userId);

  // Ledger detail is a finance view, not a customer view.
  const ledger = hasPermission(principal.roles, 'ledger.read')
    ? await getLedgerEntriesForTransaction(id)
    : null;

  return jsonOk({
    id: transaction.id,
    reference: transaction.reference,
    status: transaction.status,
    countryCode: transaction.countryCode,
    payoutAmountMinor: transaction.payoutAmountMinor,
    payoutCurrency: transaction.payoutCurrency,
    paidOutMinor: transaction.paidOutMinor,
    fundingCurrency: transaction.fundingCurrency,
    totalChargedMinor: transaction.totalChargedMinor,
    platformFeeMinor: transaction.platformFeeMinor,
    processingFeeMinor: transaction.processingFeeMinor,
    principalMinor: transaction.quote.principalMinor,
    effectiveRate: transaction.effectiveRate.toString(),
    createdAt: transaction.createdAt,
    fundedAt: transaction.fundedAt,
    readyAt: transaction.readyAt,
    completedAt: transaction.completedAt,
    expiresAt: transaction.expiresAt,
    pickupLocation: transaction.pickupLocation
      ? {
          id: transaction.pickupLocation.id,
          branchName: transaction.pickupLocation.branchName,
          addressLine1: transaction.pickupLocation.addressLine1,
          city: transaction.pickupLocation.city,
          province: transaction.pickupLocation.province,
          institutionName: transaction.pickupLocation.institution.name,
          isDemo: transaction.pickupLocation.institution.isDemo,
        }
      : null,
    pickupCode: transaction.pickupCode
      ? {
          status: transaction.pickupCode.status,
          expiresAt: transaction.pickupCode.expiresAt,
          // The code itself is never returned here. It is shown once, at issue.
          attemptsRemaining:
            transaction.pickupCode.maxAttempts - transaction.pickupCode.attemptCount,
        }
      : null,
    payments: transaction.payments.map((p) => ({
      status: p.status,
      cardBrand: p.cardBrand,
      cardLast4: p.cardLast4,
      methodType: p.methodType,
      createdAt: p.createdAt,
    })),
    timeline: transaction.events.map((e) => ({
      from: e.fromStatus,
      to: e.toStatus,
      reason: e.reason,
      actorType: e.actorType,
      at: e.createdAt,
    })),
    ...(ledger ? { ledger } : {}),
  });
});
