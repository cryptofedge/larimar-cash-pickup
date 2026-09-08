import { NextResponse, type NextRequest } from 'next/server';
import { authenticatePartner } from '@/server/partner/auth';
import { listSettlementBatches } from '@/server/services/settlement';
import { checkRateLimit } from '@/server/http/rate-limit';
import { writeAuditFailure } from '@/server/services/audit';

export const runtime = 'nodejs';

/**
 * Partner endpoint: retrieve your own settlement statements.
 *
 * Scoped to the authenticated institution — a partner can never enumerate
 * another partner's settlements, and the scoping comes from the verified
 * signature rather than from anything in the request.
 *
 * DRAFT batches are excluded: an internal working figure is not a statement, and
 * exposing one invites a partner to reconcile against a number that may still
 * change.
 */
export async function GET(req: NextRequest): Promise<NextResponse> {
  const headers: Record<string, string> = {};
  req.headers.forEach((value, key) => {
    headers[key.toLowerCase()] = value;
  });

  const path = new URL(req.url).pathname;
  // A GET has no body; the empty string is what the partner signs.
  const auth = await authenticatePartner({ method: 'GET', path, body: '', headers });

  if (!auth.ok) {
    await writeAuditFailure({
      actorType: 'partner',
      action: 'partner.settlements.list',
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
    { key: 'partner-settlements', limit: 60, windowSeconds: 60 },
    { identifier: auth.partner.institutionId },
  );
  if (!limited.allowed) {
    return NextResponse.json(
      { error: { code: 'RATE_LIMITED', message: 'Too many requests' } },
      { status: 429, headers: { 'Retry-After': String(limited.retryAfterSeconds) } },
    );
  }

  const batches = await listSettlementBatches({
    institutionId: auth.partner.institutionId,
    status: ['ISSUED', 'RECONCILED', 'PAID', 'DISPUTED'],
    limit: 100,
  });

  return NextResponse.json({
    institution: auth.partner.institutionCode,
    isDemo: auth.partner.isDemo,
    settlements: batches.map((batch) => ({
      reference: batch.reference,
      periodStart: batch.periodStart.toISOString(),
      periodEnd: batch.periodEnd.toISOString(),
      currency: batch.currency,
      payoutCount: batch.payoutCount,
      // Integer minor units as strings, per the API convention.
      grossPayoutMinor: batch.grossPayoutMinor.toString(),
      commissionBps: batch.commissionBps,
      commissionMinor: batch.commissionMinor.toString(),
      netPayableMinor: batch.netPayableMinor.toString(),
      status: batch.status,
      issuedAt: batch.issuedAt?.toISOString() ?? null,
      paidAt: batch.paidAt?.toISOString() ?? null,
      paymentReference: batch.paymentReference,
    })),
  });
}
