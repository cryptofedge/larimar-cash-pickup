import { NextResponse, type NextRequest } from 'next/server';
import { z } from 'zod';
import { authenticatePartner } from '@/server/partner/auth';
import { redeemPickupCode } from '@/server/services/pickup';
import { documentTypeSchema, minorUnitsSchema, pickupCodeSchema, uuidSchema } from '@/lib/validation/schemas';
import { checkRateLimit } from '@/server/http/rate-limit';
import { writeAuditFailure } from '@/server/services/audit';
import { isDomainError } from '@/lib/domain/errors';
import { httpStatusForCode } from '@/lib/domain/errors';

export const runtime = 'nodejs';

const bodySchema = z
  .object({
    code: pickupCodeSchema,
    locationId: uuidSchema,
    amountMinor: minorUnitsSchema,
    documentType: documentTypeSchema,
    documentLast4: z.string().regex(/^[A-Za-z0-9*]{4}$/),
    operatorRef: z.string().max(120),
    /** The partner's own idempotency key. Their retry must not pay twice. */
    idempotencyKey: z.string().min(8).max(200),
    identityVerified: z.literal(true, {
      errorMap: () => ({ message: 'You must confirm the customer identity was verified' }),
    }),
  })
  .strict();

/**
 * Partner endpoint: confirm a cash payout.
 *
 * This is the endpoint that moves money out of the system, so it carries every
 * control the in-house portal does: signature auth, location scoping, an explicit
 * identity-verification assertion, single-redemption enforcement at the database,
 * and a full audit record naming the institution and operator.
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
      action: 'partner.pickup.redeem',
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
    { key: 'partner-redeem', limit: 60, windowSeconds: 60 },
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
      {
        error: {
          code: 'VALIDATION_ERROR',
          message: 'Invalid request body',
          fields: parsed.error.issues.map((i) => ({ path: i.path.join('.'), message: i.message })),
        },
      },
      { status: 422 },
    );
  }

  if (!auth.partner.locationIds.includes(parsed.data.locationId)) {
    return NextResponse.json(
      { error: { code: 'FORBIDDEN', message: 'That location does not belong to your institution' } },
      { status: 403 },
    );
  }

  try {
    const result = await redeemPickupCode({
      code: parsed.data.code,
      agentId: auth.partner.institutionId,
      institutionId: auth.partner.institutionId,
      locationId: parsed.data.locationId,
      documentType: parsed.data.documentType,
      documentLast4: parsed.data.documentLast4,
      amountMinor: BigInt(parsed.data.amountMinor),
      ipAddress: headers['x-forwarded-for'] ?? null,
      userAgent: `partner:${auth.partner.institutionCode}:${parsed.data.operatorRef}`,
    });

    return NextResponse.json({
      transactionRef: result.reference,
      paidMinor: result.paidMinor.toString(),
      remainingMinor: result.remainingMinor.toString(),
      status: result.fullyPaid ? 'PICKED_UP' : 'PARTIALLY_PICKED_UP',
      settlement: {
        // What the platform now owes this partner for fronting the cash.
        payableMinor: result.paidMinor.toString(),
        currency: 'DOP',
      },
    });
  } catch (error) {
    if (isDomainError(error)) {
      return NextResponse.json(
        { error: { code: error.code, message: error.message } },
        { status: httpStatusForCode(error.code) },
      );
    }
    console.error('[partner:redeem] failed:', error);
    return NextResponse.json(
      { error: { code: 'INTERNAL_ERROR', message: 'Processing failed' } },
      { status: 500 },
    );
  }
}
