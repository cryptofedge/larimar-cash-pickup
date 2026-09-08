import { defineRoute, jsonError, jsonOk, requirePrincipal } from '@/server/http/api';
import { RATE_LIMITS } from '@/server/http/rate-limit';
import { redeemPickupSchema } from '@/lib/validation/schemas';
import { redeemPickupCode } from '@/server/services/pickup';
import { canActAtLocation } from '@/server/auth/rbac';

export const runtime = 'nodejs';

/**
 * Disburse cash.
 *
 * Requires `pickup.redeem`, which SUPPORT_AGENT deliberately does not have, plus
 * an active assignment to the location, plus an explicit identity-confirmation
 * flag from the agent. Idempotent, so a retried request cannot pay twice.
 */
export const POST = defineRoute(
  {
    permission: 'pickup.redeem',
    schema: redeemPickupSchema,
    rateLimit: RATE_LIMITS.pickupRedeem,
    idempotent: true,
    auditAction: 'pickup.redeem',
  },
  async ({ body, ctx }) => {
    const principal = requirePrincipal(ctx);

    if (!canActAtLocation(principal.roles, principal.locationIds, body.locationId)) {
      return jsonError('FORBIDDEN', 'You are not authorised to act at that location.', 403);
    }

    const result = await redeemPickupCode({
      code: body.code,
      agentId: principal.userId,
      institutionId: principal.institutionId,
      locationId: body.locationId,
      documentType: body.documentType,
      documentLast4: body.documentLast4,
      amountMinor: BigInt(body.amountMinor),
      ipAddress: ctx.ipAddress,
      userAgent: ctx.userAgent,
    });

    return jsonOk({
      reference: result.reference,
      paidMinor: result.paidMinor,
      remainingMinor: result.remainingMinor,
      fullyPaid: result.fullyPaid,
      status: result.fullyPaid ? 'PICKED_UP' : 'PARTIALLY_PICKED_UP',
    });
  },
);
