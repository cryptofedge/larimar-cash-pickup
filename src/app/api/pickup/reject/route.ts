import { defineRoute, jsonError, jsonOk, requirePrincipal } from '@/server/http/api';
import { rejectPickupSchema } from '@/lib/validation/schemas';
import { rejectPickup } from '@/server/services/pickup';
import { canActAtLocation } from '@/server/auth/rbac';

export const runtime = 'nodejs';

/**
 * Refuse a payout at the window.
 *
 * Records the refusal without changing transaction state — the customer's funds
 * are untouched and they can present the code again elsewhere. Refusing is not a
 * financial action, which is why it needs `pickup.reject` rather than
 * `pickup.redeem`.
 */
export const POST = defineRoute(
  { permission: 'pickup.reject', schema: rejectPickupSchema, auditAction: 'pickup.reject' },
  async ({ body, ctx }) => {
    const principal = requirePrincipal(ctx);

    if (!canActAtLocation(principal.roles, principal.locationIds, body.locationId)) {
      return jsonError('FORBIDDEN', 'You are not authorised to act at that location.', 403);
    }

    await rejectPickup({
      transactionId: body.transactionId,
      agentId: principal.userId,
      institutionId: principal.institutionId,
      locationId: body.locationId,
      reason: body.reason,
      ipAddress: ctx.ipAddress,
    });

    return jsonOk({ rejected: true });
  },
);
