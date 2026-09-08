import { NextResponse, type NextRequest } from 'next/server';
import { handlePaymentWebhook } from '@/server/services/payment';
import { isDomainError } from '@/lib/domain/errors';

export const runtime = 'nodejs';

/**
 * Payment provider webhook.
 *
 * Deliberately NOT wrapped in `defineRoute`: this endpoint authenticates with an
 * HMAC signature over the raw body rather than a session cookie, and the raw
 * bytes must be read before any parsing so the signature covers exactly what was
 * sent. Passing the body through JSON.parse and re-serialising would change
 * whitespace and break verification.
 *
 * Three guards: signature validity, timestamp freshness (replay window), and a
 * unique constraint on the provider's event id (replay of a valid old event).
 */
export async function POST(req: NextRequest): Promise<NextResponse> {
  const rawBody = await req.text();

  const headers: Record<string, string> = {};
  req.headers.forEach((value, key) => {
    headers[key.toLowerCase()] = value;
  });

  try {
    const result = await handlePaymentWebhook({ rawBody, headers });
    // 200 on a duplicate too: the provider should stop retrying an event we
    // have already recorded.
    return NextResponse.json({ received: true, handled: result.handled, reason: result.reason });
  } catch (error) {
    if (isDomainError(error) && error.code === 'WEBHOOK_SIGNATURE_INVALID') {
      return NextResponse.json(
        { error: { code: error.code, message: 'Signature verification failed' } },
        { status: 400 },
      );
    }
    console.error('[webhook:payment] processing failed:', error);
    // 500 so the provider retries a genuine processing failure.
    return NextResponse.json(
      { error: { code: 'INTERNAL_ERROR', message: 'Processing failed' } },
      { status: 500 },
    );
  }
}
