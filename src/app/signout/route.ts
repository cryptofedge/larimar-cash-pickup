import { NextResponse, type NextRequest } from 'next/server';
import { clearSessionCookie, getCurrentPrincipal } from '@/server/auth/session';
import { logout } from '@/server/services/auth';
import { env } from '@/server/env';

export const runtime = 'nodejs';

/** Form-post sign out, so it works with JavaScript disabled. */
export async function POST(req: NextRequest): Promise<NextResponse> {
  const principal = await getCurrentPrincipal();
  if (principal) {
    await logout(principal.sessionId, principal.userId, req.headers.get('x-forwarded-for'));
  }
  await clearSessionCookie();
  // The flag tells the client to purge the service worker cache. Nothing
  // personal is cached by design, so this is belt and braces on a shared device.
  return NextResponse.redirect(new URL('/?signedout=1', env.APP_URL), { status: 303 });
}
