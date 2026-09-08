import { defineRoute, jsonOk, requirePrincipal } from '@/server/http/api';
import { getPickupCodeStatus } from '@/server/services/pickup';

export const runtime = 'nodejs';

/**
 * Pickup credential status for the owning customer.
 *
 * Note what is absent: the code itself. It is delivered exactly once, in the
 * response to payment confirmation. Making it re-retrievable would turn any
 * session hijack into a cash-out, and would mean the plaintext had to be stored.
 */
export const GET = defineRoute({ permission: 'pickup.code.view.own' }, async ({ ctx, params }) => {
  const principal = requirePrincipal(ctx);
  const status = await getPickupCodeStatus(params.id as string, principal.userId);

  return jsonOk({
    status: status.status,
    prefix: status.prefix,
    expiresAt: status.expiresAt,
    collectableFrom: status.collectableFrom,
    attemptsRemaining: status.maxAttempts - status.attemptCount,
    redeemedAt: status.redeemedAt,
  });
});
