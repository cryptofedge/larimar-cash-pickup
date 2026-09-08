import { NextResponse, type NextRequest } from 'next/server';

/**
 * Security headers, with a per-request CSP nonce.
 *
 * WHY THIS IS MIDDLEWARE AND NOT STATIC CONFIG
 * --------------------------------------------
 * The App Router streams its React Server Component payload through inline
 * `<script>self.__next_f.push(...)</script>` tags. A static `script-src 'self'`
 * policy blocks every one of them: the server-rendered HTML arrives, hydration
 * never runs, and the page renders blank. The build succeeds, types check, and
 * the application is completely unusable — which is exactly what happened here
 * until a browser-based end-to-end test caught it.
 *
 * The fix is a fresh nonce per request. Next.js reads the `Content-Security-
 * Policy` header off the *request* and stamps the same nonce onto the inline
 * scripts it generates, so they execute while anything injected by an attacker
 * still does not.
 *
 * `'strict-dynamic'` lets the nonced bootstrap load the chunk scripts it needs
 * without enumerating them. CSP Level 3 browsers ignore `'self'` once
 * `'strict-dynamic'` is present; it stays as a fallback for older parsers.
 *
 * Weakening this to `'unsafe-inline'` would have been the quick fix and would
 * have thrown away the protection entirely. This application renders a bearer
 * credential for cash, so it keeps the strict policy.
 */
export function middleware(request: NextRequest): NextResponse {
  const nonce = Buffer.from(crypto.randomUUID()).toString('base64');
  const isDev = process.env.NODE_ENV === 'development';

  const csp = [
    "default-src 'self'",
    // 'unsafe-eval' is required by the dev-mode React refresh runtime only.
    `script-src 'self' 'nonce-${nonce}' 'strict-dynamic'${isDev ? " 'unsafe-eval'" : ''}`,
    // Next injects styles inline; there is no nonce hook for them. Style
    // injection is a far weaker vector than script injection.
    "style-src 'self' 'unsafe-inline'",
    "img-src 'self' data: blob:",
    "font-src 'self' data:",
    "connect-src 'self'",
    // The service worker is same-origin and caches no personal data; see public/sw.js.
    "worker-src 'self'",
    "manifest-src 'self'",
    "form-action 'self'",
    "frame-ancestors 'none'",
    "base-uri 'self'",
    "object-src 'none'",
    ...(isDev ? [] : ['upgrade-insecure-requests']),
  ].join('; ');

  // Next reads the policy from the request headers to find the nonce.
  const requestHeaders = new Headers(request.headers);
  requestHeaders.set('x-nonce', nonce);
  requestHeaders.set('Content-Security-Policy', csp);

  const response = NextResponse.next({ request: { headers: requestHeaders } });

  response.headers.set('Content-Security-Policy', csp);
  response.headers.set('X-Content-Type-Options', 'nosniff');
  response.headers.set('X-Frame-Options', 'DENY');
  response.headers.set('Referrer-Policy', 'strict-origin-when-cross-origin');
  response.headers.set(
    'Permissions-Policy',
    'camera=(), microphone=(), geolocation=(self), payment=()',
  );
  response.headers.set('Cross-Origin-Opener-Policy', 'same-origin');
  response.headers.set('X-DNS-Prefetch-Control', 'off');

  if (!isDev) {
    response.headers.set(
      'Strict-Transport-Security',
      'max-age=63072000; includeSubDomains; preload',
    );
  }

  return response;
}

export const config = {
  matcher: [
    /*
     * Everything except static assets.
     *
     * Next's own build output is immutable and hashed, so running middleware
     * over it only adds latency and generates pointless nonces.
     *
     * `sw.js` must be excluded for a different and less obvious reason: the CSP
     * on a service worker script's own response governs the worker's execution
     * context. Serving it with `script-src 'nonce-… ' 'strict-dynamic'` blocks
     * the worker outright — the script carries no nonce — and the browser
     * reports only "an unknown error occurred when fetching the script", which
     * is exactly as diagnosable as it sounds.
     */
    {
      source:
        '/((?!_next/static|_next/image|favicon.ico|sw\\.js|offline\\.html|icons/).*)',
      missing: [
        { type: 'header', key: 'next-router-prefetch' },
        { type: 'header', key: 'purpose', value: 'prefetch' },
      ],
    },
  ],
};
