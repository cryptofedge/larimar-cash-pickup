import { NextResponse, type NextRequest } from 'next/server';
import { z } from 'zod';
import { authenticatePartner } from '@/server/partner/auth';
import { verifyPickupCode } from '@/server/services/pickup';
import { pickupCodeSchema, uuidSchema } from '@/lib/validation/schemas';
import { checkRateLimit } from '@/server/http/rate-limit';
import { writeAuditFailure } from '@/server/services/audit';

export const runtime = 'nodejs';

const bodySchema = z
  .object({
    code: pickupCodeSchema,
    locationId: uuidSchema,
    /** The partner's own operator identifier, recorded for their audit trail. */
    operatorRef: z.string().max(120).optional(),
  })
  .strict();

/**
 * Partner endpoint: verify a pickup code.
 *
 * Returns the same narrow view the in-house agent portal sees — amount, currency,
 * document requirements, compliance flag — and no customer personal data. A
 * payout partner is a third party; they get the minimum needed to hand over cash.
 */
export async function POST(req: NextRequest): Promise<NextResponse> {
  const rawBody = await req.text();
  const headers: Record<string, string> = {};
  req.headers.forEach((value, key) => {
    headers[key.toLowerCase()] = value;
  });

  const path = new URL(req.url).pathname;
  const auth = await authenticatePartner({ method: 'POST', path, body: rawBody, headers });

  if (!auth.ok) {
    await writeAuditFailure({
      actorType: 'partner',
      action: 'partner.pickup.verify',
      resourceType: 'api',
      resourceId: path,
      reason: auth.reason,
      ipAddress: headers['x-forwarded-for'] ?? null,
    });
    return NextResponse.json(
      { error: { code: 'UNAUTHENTICATED', message: 'Authentication failed' } },
      { status: 401 },
    );
  }

  const limited = await checkRateLimit(
    { key: 'partner-verify', limit: 120, windowSeconds: 60 },
    { identifier: auth.partner.institutionId },
  );
  if (!limited.allowed) {
    return NextResponse.json(
      { error: { code: 'RATE_LIMITED', message: 'Too many requests' } },
      { status: 429, headers: { 'Retry-After': String(limited.retryAfterSeconds) } },
    );
  }

  const parsed = bodySchema.safeParse(JSON.parse(rawBody || '{}'));
  if (!parsed.success) {
    return NextResponse.json(
      { error: { code: 'VALIDATION_ERROR', message: 'Invalid request body' } },
      { status: 422 },
    );
  }

  // A partner may only verify at their own locations.
  if (!auth.partner.locationIds.includes(parsed.data.locationId)) {
    return NextResponse.json(
      { error: { code: 'FORBIDDEN', message: 'That location does not belong to your institution' } },
      { status: 403 },
    );
  }

  const result = await verifyPickupCode({
    code: parsed.data.code,
    agentId: auth.partner.institutionId, // partner-level attribution
    institutionId: auth.partner.institutionId,
    locationId: parsed.data.locationId,
    ipAddress: headers['x-forwarded-for'] ?? null,
    userAgent: headers['user-agent'] ?? null,
  });

  if (!result.ok) {
    return NextResponse.json(
      { error: { code: result.code, message: result.message } },
      { status: 400 },
    );
  }

  return NextResponse.json({
    transactionRef: result.view.reference,
    status: result.view.status,
    payout: {
      amountMinor: result.view.remainingMinor,
      currency: result.view.payoutCurrency,
    },
    identityRequirements: { acceptedDocuments: result.view.acceptedDocuments },
    createdAt: result.view.createdAt,
    expiresAt: result.view.expiresAt,
    compliance: {
      cleared: result.view.complianceCleared,
      note: result.view.complianceNote,
    },
    isDemo: result.view.isDemoLocation,
  });
}
