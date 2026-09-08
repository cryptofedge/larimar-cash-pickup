/** @type {import('next').NextConfig} */
const nextConfig = {
  reactStrictMode: true,
  poweredByHeader: false,

  // Pin the workspace root: an unrelated lockfile in a parent directory would
  // otherwise be inferred as the root and pull the wrong files into the trace.
  outputFileTracingRoot: import.meta.dirname,

  /**
   * Security headers live in `src/middleware.ts`, not here.
   *
   * The Content-Security-Policy needs a fresh nonce per request so that Next's
   * inline RSC payload scripts can execute while injected script cannot. A
   * static header cannot carry a per-request nonce, and a static
   * `script-src 'self'` silently breaks hydration — the page renders blank.
   *
   * These two are safe to set statically because they never vary.
   */
  async headers() {
    return [
      {
        source: '/:path*',
        headers: [
          { key: 'X-Content-Type-Options', value: 'nosniff' },
          { key: 'X-DNS-Prefetch-Control', value: 'off' },
        ],
      },
    ];
  },
};

export default nextConfig;
