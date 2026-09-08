import { NextResponse } from 'next/server';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

/**
 * Digital Asset Links, for Trusted Web Activity verification.
 *
 * Android fetches this at `https://<domain>/.well-known/assetlinks.json` and
 * checks that the signing certificate of the installed app matches. If it does,
 * the app renders without a browser URL bar; if it does not, the user sees a
 * Chrome address bar inside the app and the TWA illusion is gone.
 *
 * Generated from configuration rather than committed as a static file with
 * placeholder values. A placeholder would be *served* in production and would
 * fail verification while looking like it had been set up — worse than returning
 * nothing at all. With the two variables unset this endpoint 404s, which is the
 * honest state of an unconfigured deployment.
 *
 * Set both after creating the Android app:
 *
 *   ANDROID_PACKAGE_NAME=com.example.larimar
 *   ANDROID_SHA256_FINGERPRINT=AB:CD:...:EF
 *
 * The fingerprint MUST be the one Google Play re-signs with (Play Console →
 * Setup → App integrity → App signing key certificate), not your local upload
 * key. Using the upload key is the single most common reason a TWA ships with a
 * visible URL bar.
 */
export async function GET(): Promise<NextResponse> {
  const packageName = process.env.ANDROID_PACKAGE_NAME;
  const fingerprint = process.env.ANDROID_SHA256_FINGERPRINT;

  if (!packageName || !fingerprint) {
    return NextResponse.json(
      {
        error: {
          code: 'NOT_CONFIGURED',
          message:
            'Digital Asset Links are not configured. Set ANDROID_PACKAGE_NAME and ANDROID_SHA256_FINGERPRINT. See docs/MOBILE_AND_PLAY_STORE.md.',
        },
      },
      { status: 404 },
    );
  }

  return NextResponse.json(
    [
      {
        relation: ['delegate_permission/common.handle_all_urls'],
        target: {
          namespace: 'android_app',
          package_name: packageName,
          // Accepts a comma-separated list so an upload key and the Play signing
          // key can both be trusted during a migration.
          sha256_cert_fingerprints: fingerprint
            .split(',')
            .map((value) => value.trim().toUpperCase())
            .filter(Boolean),
        },
      },
    ],
    {
      headers: {
        'content-type': 'application/json',
        // Android caches this; a short TTL keeps a fingerprint rotation from
        // taking a day to propagate.
        'cache-control': 'public, max-age=300',
      },
    },
  );
}
