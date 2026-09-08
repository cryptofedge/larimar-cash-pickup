import { defineRoute, jsonError, jsonOk } from '@/server/http/api';
import { RATE_LIMITS } from '@/server/http/rate-limit';
import { loginSchema } from '@/lib/validation/schemas';
import { login } from '@/server/services/auth';
import { setSessionCookie } from '@/server/auth/session';

export const runtime = 'nodejs';

export const POST = defineRoute(
  { permission: null, schema: loginSchema, rateLimit: RATE_LIMITS.login },
  async ({ body, ctx }) => {
    const result = await login({
      email: body.email,
      password: body.password,
      totpCode: body.totpCode,
      deviceFingerprint: body.deviceFingerprint,
      ipAddress: ctx.ipAddress,
      userAgent: ctx.userAgent,
    });

    if (!result.ok) {
      switch (result.code) {
        case 'ACCOUNT_LOCKED':
          return jsonError(
            'ACCOUNT_LOCKED',
            'This account is temporarily locked after too many failed attempts.',
            403,
          );
        case 'MFA_REQUIRED':
          return jsonError('MFA_REQUIRED', 'Enter the code from your authenticator app.', 401);
        case 'MFA_INVALID':
          return jsonError('MFA_REQUIRED', 'That code is not valid.', 401);
        default:
          // Deliberately identical for "no such account" and "wrong password".
          return jsonError(
            'INVALID_CREDENTIALS',
            'That email and password combination is not correct.',
            401,
          );
      }
    }

    await setSessionCookie(result.auth.token, result.auth.expiresAt);
    return jsonOk({ userId: result.auth.userId, roles: result.auth.roles });
  },
);
