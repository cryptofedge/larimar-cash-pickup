import { defineRoute, jsonError, jsonOk, requirePrincipal } from '@/server/http/api';
import { complianceReviewSchema } from '@/lib/validation/schemas';
import { placeHold, releaseHold, rejectOnReview, listComplianceCases } from '@/server/services/compliance';
import { hasPermission } from '@/server/auth/rbac';

export const runtime = 'nodejs';

export const GET = defineRoute({ permission: 'compliance.case.read' }, async () => {
  const cases = await listComplianceCases();
  return jsonOk({
    cases: cases.map((c) => ({
      id: c.id,
      caseNumber: c.caseNumber,
      type: c.type,
      status: c.status,
      priority: c.priority,
      summary: c.summary,
      openedAt: c.openedAt,
      transaction: c.transaction,
      subjectEmail: c.subjectUser?.email ?? null,
    })),
  });
});

/**
 * Act on a case.
 *
 * `HOLD` needs `compliance.hold.place`; `RELEASE` and `REJECT` need
 * `compliance.hold.release`, which SYSTEM_ADMIN deliberately does not have —
 * the person who configures the platform must not also clear its holds.
 */
export const POST = defineRoute(
  { permission: 'compliance.hold.place', schema: complianceReviewSchema },
  async ({ body, ctx }) => {
    const principal = requirePrincipal(ctx);

    if (body.action !== 'HOLD' && !hasPermission(principal.roles, 'compliance.hold.release')) {
      return jsonError(
        'FORBIDDEN',
        'Releasing or rejecting a held transaction requires a compliance analyst.',
        403,
      );
    }

    switch (body.action) {
      case 'HOLD': {
        const result = await placeHold({
          transactionId: body.transactionId,
          analystId: principal.userId,
          reason: body.reason,
          priority: body.priority,
          ipAddress: ctx.ipAddress,
        });
        return jsonOk({ action: 'HOLD', caseNumber: result.caseNumber });
      }
      case 'RELEASE': {
        const result = await releaseHold({
          transactionId: body.transactionId,
          analystId: principal.userId,
          resolution: body.reason,
          ipAddress: ctx.ipAddress,
        });
        return jsonOk({ action: 'RELEASE', credentialIssued: result.credentialIssued });
      }
      case 'REJECT': {
        await rejectOnReview({
          transactionId: body.transactionId,
          analystId: principal.userId,
          reason: body.reason,
          ipAddress: ctx.ipAddress,
        });
        return jsonOk({ action: 'REJECT' });
      }
    }
  },
);
