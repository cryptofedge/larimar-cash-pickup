import { defineRoute, jsonError, jsonOk, requirePrincipal } from '@/server/http/api';
import { RATE_LIMITS } from '@/server/http/rate-limit';
import { verifyPickupSchema } from '@/lib/validation/schemas';
import { verifyPickupCode } from '@/server/services/pickup';
import { canActAtLocation } from '@/server/auth/rbac';

export const runtime = 'nodejs';

export const POST = defineRoute(
  {
    permission: 'pickup.verify',
    schema: verifyPickupSchema,
    rateLimit: RATE_LIMITS.pickupVerify,
    auditAction: 'pickup.verify',
  },
  async ({ body, ctx }) => {
    const principal = requirePrincipal(ctx);

    // Location scoping, checked before the code is even looked up. An agent must
    // not be able to probe codes against a location they do not staff.
    if (!canActAtLocation(principal.roles, principal.locationIds, body.locationId)) {
      return jsonError('FORBIDDEN', 'You are not authorised to act at that location.', 403);
    }

    const result = await verifyPickupCode({
      code: body.code,
      secret: body.secret ?? null,
      agentId: principal.userId,
      institutionId: principal.institutionId,
      locationId: body.locationId,
      ipAddress: ctx.ipAddress,
      userAgent: ctx.userAgent,
    });

    if (!result.ok) {
      return jsonError(result.code, result.message, 400);
    }

    return jsonOk({ transactionId: result.transactionId, transaction: result.view });
  },
);
