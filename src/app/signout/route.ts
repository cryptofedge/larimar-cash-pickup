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
  return NextResponse.redirect(new URL('/', env.APP_URL), { status: 303 });
}
