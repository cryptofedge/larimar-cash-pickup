import { defineRoute, jsonOk } from '@/server/http/api';
import { RATE_LIMITS } from '@/server/http/rate-limit';
import { completePasswordResetSchema, requestPasswordResetSchema } from '@/lib/validation/schemas';
import { completePasswordReset, requestPasswordReset } from '@/server/services/auth';

export const runtime = 'nodejs';

/** Begin a reset. Always responds identically — no account enumeration. */
export const POST = defineRoute(
  { permission: null, schema: requestPasswordResetSchema, rateLimit: RATE_LIMITS.passwordReset },
  async ({ body, ctx }) => {
    await requestPasswordReset({ email: body.email, ipAddress: ctx.ipAddress });
    return jsonOk({
      sent: true,
      message: 'If that address is registered, a reset link is on its way.',
    });
  },
);

/** Complete a reset. Revokes every existing session for the account. */
export const PUT = defineRoute(
  { permission: null, schema: completePasswordResetSchema, rateLimit: RATE_LIMITS.passwordReset },
  async ({ body, ctx }) => {
    await completePasswordReset({
      token: body.token,
      password: body.password,
      ipAddress: ctx.ipAddress,
    });
    return jsonOk({ reset: true });
  },
);
