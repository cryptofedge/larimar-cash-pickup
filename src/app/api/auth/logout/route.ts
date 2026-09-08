import { defineRoute, jsonOk, requirePrincipal } from '@/server/http/api';
import { logout } from '@/server/services/auth';
import { clearSessionCookie } from '@/server/auth/session';

export const runtime = 'nodejs';

export const POST = defineRoute({ permission: 'profile.read.own' }, async ({ ctx }) => {
  const principal = requirePrincipal(ctx);
  await logout(principal.sessionId, principal.userId, ctx.ipAddress);
  await clearSessionCookie();
  return jsonOk({ signedOut: true });
});
