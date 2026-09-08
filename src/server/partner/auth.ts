/**
 * Partner API authentication.
 *
 * Payout institutions are server-to-server callers, not browser sessions, so
 * they authenticate with an HMAC signature over the request rather than a
 * cookie. The signed string includes the method, path, timestamp, and a hash of
 * the body, so a captured signature cannot be replayed against a different
 * endpoint or with altered content.
 *
 * Each institution holds an API key id (public) and a secret (encrypted at rest
 * with the platform encryption key, never stored in plaintext).
 */

import { createHash } from 'node:crypto';
import { prisma } from '../db';
import { env } from '../env';
import { constantTimeEquals, decryptSecret, hmacSha256 } from '../auth/crypto';

export interface PartnerPrincipal {
  readonly institutionId: string;
  readonly institutionCode: string;
  readonly institutionName: string;
  readonly isDemo: boolean;
  readonly locationIds: readonly string[];
}

export type PartnerAuthResult =
  | { readonly ok: true; readonly partner: PartnerPrincipal }
  | { readonly ok: false; readonly reason: string };

/**
 * The canonical string that gets signed.
 *
 * Binding the method and path is what stops a signature captured from a
 * read-only call being replayed against the redeem endpoint.
 */
export function canonicalRequest(input: {
  method: string;
  path: string;
  timestamp: string;
  body: string;
}): string {
  const bodyHash = createHash('sha256').update(input.body, 'utf8').digest('hex');
  return [input.method.toUpperCase(), input.path, input.timestamp, bodyHash].join('\n');
}

export async function authenticatePartner(input: {
  method: string;
  path: string;
  body: string;
  headers: Record<string, string>;
}): Promise<PartnerAuthResult> {
  if (!env.PARTNER_API_ENABLED) {
    return { ok: false, reason: 'Partner API is disabled' };
  }

  const keyId = input.headers['x-larimar-key-id'];
  const timestamp = input.headers['x-larimar-timestamp'];
  const signature = input.headers['x-larimar-signature'];

  if (!keyId || !timestamp || !signature) {
    return { ok: false, reason: 'Missing key id, timestamp, or signature' };
  }

  const seconds = Number(timestamp);
  if (!Number.isFinite(seconds)) {
    return { ok: false, reason: 'Malformed timestamp' };
  }
  const age = Math.abs(Date.now() / 1000 - seconds);
  if (age > env.PARTNER_SIGNATURE_TOLERANCE_SECONDS) {
    return { ok: false, reason: 'Timestamp outside the accepted window' };
  }

  const institution = await prisma.pickupInstitution.findUnique({
    where: { apiKeyId: keyId },
    select: {
      id: true,
      code: true,
      name: true,
      isDemo: true,
      active: true,
      deletedAt: true,
      apiSecretEnc: true,
      locations: { where: { deletedAt: null }, select: { id: true } },
    },
  });

  if (!institution || !institution.active || institution.deletedAt || !institution.apiSecretEnc) {
    // Deliberately identical to a signature mismatch: a caller must not be able
    // to enumerate valid key ids by comparing error messages.
    return { ok: false, reason: 'Authentication failed' };
  }

  let secret: string;
  try {
    secret = decryptSecret(institution.apiSecretEnc);
  } catch {
    return { ok: false, reason: 'Authentication failed' };
  }

  const expected = hmacSha256(
    canonicalRequest({ method: input.method, path: input.path, timestamp, body: input.body }),
    secret,
  );

  if (!constantTimeEquals(expected, signature)) {
    return { ok: false, reason: 'Authentication failed' };
  }

  return {
    ok: true,
    partner: {
      institutionId: institution.id,
      institutionCode: institution.code,
      institutionName: institution.name,
      isDemo: institution.isDemo,
      locationIds: institution.locations.map((l) => l.id),
    },
  };
}

/** Helper for partners (and our own tests) to construct a valid signature. */
export function signPartnerRequest(input: {
  method: string;
  path: string;
  body: string;
  keyId: string;
  secret: string;
  timestamp?: string;
}): Record<string, string> {
  const timestamp = input.timestamp ?? String(Math.floor(Date.now() / 1000));
  const signature = hmacSha256(
    canonicalRequest({ method: input.method, path: input.path, timestamp, body: input.body }),
    input.secret,
  );
  return {
    'x-larimar-key-id': input.keyId,
    'x-larimar-timestamp': timestamp,
    'x-larimar-signature': signature,
    'content-type': 'application/json',
  };
}
