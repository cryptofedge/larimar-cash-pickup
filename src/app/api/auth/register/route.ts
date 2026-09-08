import { defineRoute, jsonOk } from '@/server/http/api';
import { RATE_LIMITS } from '@/server/http/rate-limit';
import { registerSchema } from '@/lib/validation/schemas';
import { register } from '@/server/services/auth';
import { setSessionCookie } from '@/server/auth/session';

export const runtime = 'nodejs';

export const POST = defineRoute(
  {
    permission: null, // Public by design.
    schema: registerSchema,
    rateLimit: RATE_LIMITS.register,
  },
  async ({ body, ctx }) => {
    const result = await register({
      email: body.email,
      password: body.password,
      firstName: body.firstName,
      lastName: body.lastName,
      locale: body.locale,
      deviceFingerprint: body.deviceFingerprint,
      ipAddress: ctx.ipAddress,
      userAgent: ctx.userAgent,
    });

    // `null` means the address was already registered. The response is identical
    // either way so this endpoint cannot be used to enumerate accounts; a real
    // owner is told by email that someone tried to re-register their address.
    if (!result) {
      return jsonOk({ created: true }, 201);
    }

    await setSessionCookie(result.token, result.expiresAt);
    return jsonOk({ created: true, userId: result.userId, roles: result.roles }, 201);
  },
);
