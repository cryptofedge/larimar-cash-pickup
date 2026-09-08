import { NextResponse, type NextRequest } from 'next/server';
import { prisma } from '@/server/db';
import { getKycProvider } from '@/server/providers/kyc';

export const runtime = 'nodejs';

/**
 * KYC provider webhook.
 *
 * Same shape as the payment webhook: HMAC over the raw body, timestamp window,
 * and a replay guard on the provider's event id. Asynchronous verification
 * results arrive here when a decision takes longer than the submit call.
 */
export async function POST(req: NextRequest): Promise<NextResponse> {
  const rawBody = await req.text();

  const headers: Record<string, string> = {};
  req.headers.forEach((value, key) => {
    headers[key.toLowerCase()] = value;
  });

  const provider = getKycProvider();
  const signature = provider.verifyWebhookSignature(rawBody, headers);

  if (!signature.valid) {
    await prisma.webhookEvent.create({
      data: {
        provider: `kyc:${provider.name}`,
        externalId: `invalid_${Date.now()}_${Math.random().toString(36).slice(2, 10)}`,
        eventType: 'unknown',
        status: 'INVALID_SIGNATURE',
        signatureValid: false,
        payload: { raw: rawBody.slice(0, 1000) },
        error: signature.reason ?? 'Signature verification failed',
      },
    });
    return NextResponse.json(
      { error: { code: 'WEBHOOK_SIGNATURE_INVALID', message: 'Signature verification failed' } },
      { status: 400 },
    );
  }

  let parsed: { id?: string; type?: string; providerRef?: string; decision?: string };
  try {
    parsed = JSON.parse(rawBody) as typeof parsed;
  } catch {
    return NextResponse.json(
      { error: { code: 'VALIDATION_ERROR', message: 'Malformed payload' } },
      { status: 400 },
    );
  }

  const externalId = parsed.id ?? `kyc_${Date.now()}`;

  const seen = await prisma.webhookEvent.findUnique({
    where: { provider_externalId: { provider: `kyc:${provider.name}`, externalId } },
    select: { id: true },
  });
  if (seen) {
    return NextResponse.json({ received: true, handled: false, reason: 'Duplicate event' });
  }

  await prisma.webhookEvent.create({
    data: {
      provider: `kyc:${provider.name}`,
      externalId,
      eventType: parsed.type ?? 'kyc.updated',
      status: 'PROCESSED',
      signatureValid: true,
      payload: parsed as object,
      processedAt: new Date(),
    },
  });

  if (parsed.providerRef && parsed.decision) {
    await prisma.identityVerification.updateMany({
      where: { providerRef: parsed.providerRef, status: 'PENDING' },
      data: {
        status: parsed.decision === 'APPROVED' ? 'APPROVED' : 'REJECTED',
        level: parsed.decision === 'APPROVED' ? 'BASIC' : 'NONE',
        decidedAt: new Date(),
      },
    });
  }

  return NextResponse.json({ received: true, handled: true });
}
