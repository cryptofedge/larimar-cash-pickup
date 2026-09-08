import { defineRoute, jsonError, jsonOk, requirePrincipal } from '@/server/http/api';
import { escalatePickupSchema } from '@/lib/validation/schemas';
import { escalatePickup } from '@/server/services/pickup';
import { canActAtLocation } from '@/server/auth/rbac';

export const runtime = 'nodejs';

/**
 * Escalate to compliance.
 *
 * Opens a case and moves the transaction to COMPLIANCE_REVIEW, which blocks
 * disbursement everywhere — including at other branches of the same institution.
 * An agent who is suspicious can stop a payout; only a compliance analyst can
 * restart it.
 */
export const POST = defineRoute(
  { permission: 'pickup.escalate', schema: escalatePickupSchema, auditAction: 'pickup.escalate' },
  async ({ body, ctx }) => {
    const principal = requirePrincipal(ctx);

    if (!canActAtLocation(principal.roles, principal.locationIds, body.locationId)) {
      return jsonError('FORBIDDEN', 'You are not authorised to act at that location.', 403);
    }

    const result = await escalatePickup({
      transactionId: body.transactionId,
      agentId: principal.userId,
      institutionId: principal.institutionId,
      locationId: body.locationId,
      reason: body.reason,
      ipAddress: ctx.ipAddress,
    });

    return jsonOk({ escalated: true, caseNumber: result.caseNumber });
  },
);
