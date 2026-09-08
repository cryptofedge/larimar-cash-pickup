/**
 * Pickup credentials.
 *
 * A pickup code is a bearer instrument for cash. Anyone holding a valid code and
 * a matching identity document walks away with pesos, so this module is written
 * to the standard that implies.
 *
 * Design decisions and why:
 *
 *  * FORMAT `DR-XXXX-XXXX` over a 32-symbol alphabet = **40 bits** of entropy
 *    (1.1 x 10^12 combinations). Plain 8-digit codes give only 10^8 (~26.6 bits),
 *    which is too thin for something redeemable for cash. The alphabet is
 *    Crockford-style: no I, L, O, or U, so nothing is misread across a counter or
 *    mistyped from a phone screen. `DR-4829-7316` is still a valid member of the
 *    set — an all-digit draw — so the format matches the customer-facing example.
 *
 *  * SECOND FACTOR. The typed code is one factor. A 128-bit `secret` is embedded
 *    only in the QR payload. A shoulder-surfer who reads the printed code off a
 *    screen does not have the QR secret, and the agent still checks a government
 *    ID. Three independent factors guard a payout.
 *
 *  * NEVER STORED IN PLAINTEXT. Only `sha256(pepper || code)` is persisted. An
 *    attacker with a full database dump cannot redeem anything, because the
 *    pepper lives in the secret store, not in the database.
 *
 *  * REJECTION SAMPLING. `randomBytes` values are drawn from a range that is an
 *    exact multiple of the alphabet size; out-of-range bytes are discarded rather
 *    than folded with `%`. Modulo on a 256-value byte over a 32-symbol alphabet
 *    happens to be unbiased, but the guard is kept so that changing the alphabet
 *    length later cannot silently introduce bias.
 *
 * No I/O and no clock of its own — times are always passed in.
 */

import { createHash, randomBytes, timingSafeEqual } from 'node:crypto';
import { DomainError } from './errors';

/** Crockford-style base32: no I, L, O, U. 32 symbols = 5 bits each. */
const ALPHABET = '0123456789ABCDEFGHJKMNPQRSTVWXYZ';
const ALPHABET_SIZE = ALPHABET.length; // 32

/** Two groups of four symbols = 8 symbols = 40 bits. */
const GROUP_LENGTH = 4;
const GROUP_COUNT = 2;
export const CODE_SYMBOL_COUNT = GROUP_LENGTH * GROUP_COUNT;
export const CODE_ENTROPY_BITS = CODE_SYMBOL_COUNT * 5;

/** Confusable characters a human might type, mapped to their canonical symbol. */
const CONFUSABLES: Readonly<Record<string, string>> = {
  I: '1',
  L: '1',
  O: '0',
  U: 'V',
};

export interface PickupCredential {
  /** Human-typed, hyphenated. Returned to the owning customer exactly once. */
  readonly code: string;
  /** 128-bit hex secret carried only in the QR payload. */
  readonly secret: string;
  /** What is persisted for the code. */
  readonly codeHash: string;
  /** What is persisted for the secret. */
  readonly secretHash: string;
  readonly prefix: string;
}

function randomSymbols(count: number): string {
  const max = Math.floor(256 / ALPHABET_SIZE) * ALPHABET_SIZE; // 256 exactly
  let out = '';
  while (out.length < count) {
    const bytes = randomBytes(count * 2);
    for (const byte of bytes) {
      if (out.length >= count) break;
      if (byte >= max) continue; // rejection sampling — no modulo bias
      out += ALPHABET[byte % ALPHABET_SIZE] as string;
    }
  }
  return out;
}

/**
 * Normalise anything a human might type into the canonical code.
 * Accepts "dr 4829 7316", "DR48297316", "dr-4829-7316" — all the same credential.
 */
export function normalizeCode(input: string): string {
  const stripped = input
    .toUpperCase()
    .replace(/[^0-9A-Z]/g, '')
    .split('')
    .map((ch) => CONFUSABLES[ch] ?? ch)
    .join('');

  const match = /^([A-Z]{2})([0-9A-Z]+)$/.exec(stripped);
  if (!match) {
    throw new DomainError('PICKUP_CODE_INVALID', 'Pickup code format not recognised');
  }

  const prefix = match[1] as string;
  const body = match[2] as string;
  if (body.length !== CODE_SYMBOL_COUNT) {
    throw new DomainError('PICKUP_CODE_INVALID', 'Pickup code format not recognised');
  }
  for (const ch of body) {
    if (!ALPHABET.includes(ch)) {
      throw new DomainError('PICKUP_CODE_INVALID', 'Pickup code format not recognised');
    }
  }

  const groups: string[] = [];
  for (let i = 0; i < body.length; i += GROUP_LENGTH) {
    groups.push(body.slice(i, i + GROUP_LENGTH));
  }
  return `${prefix}-${groups.join('-')}`;
}

export function isWellFormedCode(input: string): boolean {
  try {
    normalizeCode(input);
    return true;
  } catch {
    return false;
  }
}

/**
 * Peppered hash. The pepper is an environment secret and is deliberately NOT in
 * the database, so a dump of `pickup_codes` is not a cash-out opportunity.
 */
export function hashCode(code: string, pepper: string): string {
  if (!pepper || pepper.length < 16) {
    throw new DomainError(
      'CONFIGURATION_ERROR',
      'PICKUP_CODE_PEPPER must be set to at least 16 characters',
    );
  }
  return createHash('sha256').update(`${pepper}:${normalizeCode(code)}`, 'utf8').digest('hex');
}

export function hashSecret(secret: string, pepper: string): string {
  return createHash('sha256').update(`${pepper}:secret:${secret}`, 'utf8').digest('hex');
}

/** Constant-time comparison. Never compare credential hashes with `===`. */
export function safeCompareHash(a: string, b: string): boolean {
  const bufA = Buffer.from(a, 'utf8');
  const bufB = Buffer.from(b, 'utf8');
  if (bufA.length !== bufB.length) return false;
  return timingSafeEqual(bufA, bufB);
}

export function generatePickupCredential(prefix: string, pepper: string): PickupCredential {
  const upperPrefix = prefix.toUpperCase();
  if (!/^[A-Z]{2}$/.test(upperPrefix)) {
    throw new DomainError('CONFIGURATION_ERROR', `Pickup code prefix must be two letters; got "${prefix}"`);
  }

  const body = randomSymbols(CODE_SYMBOL_COUNT);
  const groups: string[] = [];
  for (let i = 0; i < body.length; i += GROUP_LENGTH) {
    groups.push(body.slice(i, i + GROUP_LENGTH));
  }
  const code = `${upperPrefix}-${groups.join('-')}`;
  const secret = randomBytes(16).toString('hex'); // 128 bits

  return Object.freeze({
    code,
    secret,
    codeHash: hashCode(code, pepper),
    secretHash: hashSecret(secret, pepper),
    prefix: upperPrefix,
  });
}

/**
 * QR payload. Contains the code and the second-factor secret and NOTHING else —
 * no name, email, phone, amount, or transaction id. A photographed QR reveals
 * only a credential that is still gated on an identity check at the window.
 */
export function buildQrPayload(code: string, secret: string): string {
  return `LARIMAR:1:${normalizeCode(code)}:${secret}`;
}

export interface ParsedQrPayload {
  readonly code: string;
  readonly secret: string;
}

export function parseQrPayload(payload: string): ParsedQrPayload {
  const parts = payload.trim().split(':');
  if (parts.length !== 4 || parts[0] !== 'LARIMAR' || parts[1] !== '1') {
    throw new DomainError('PICKUP_CODE_INVALID', 'Unrecognised QR payload');
  }
  const secret = parts[3] as string;
  if (!/^[0-9a-f]{32}$/.test(secret)) {
    throw new DomainError('PICKUP_CODE_INVALID', 'Unrecognised QR payload');
  }
  return { code: normalizeCode(parts[2] as string), secret };
}

/** For logs, support screens, and audit records. Never log a full code. */
export function maskCode(code: string): string {
  try {
    const normalized = normalizeCode(code);
    const [prefix, , second] = normalized.split('-');
    return `${prefix}-****-${second ?? '****'}`;
  } catch {
    return '****';
  }
}

// ---------------------------------------------------------------------------
// Redemption eligibility
// ---------------------------------------------------------------------------

export type PickupCodeStatus = 'ACTIVE' | 'LOCKED' | 'REDEEMED' | 'EXPIRED' | 'CANCELLED';

export interface PickupCodeState {
  readonly status: PickupCodeStatus;
  readonly attemptCount: number;
  readonly maxAttempts: number;
  readonly expiresAt: Date;
  /** When a risk-based delay applies. NULL means immediately collectable. */
  readonly collectableFrom?: Date | null;
}

export type CodeCheckFailureCode =
  | 'PICKUP_CODE_EXPIRED'
  | 'PICKUP_CODE_LOCKED'
  | 'PICKUP_CODE_ALREADY_REDEEMED'
  | 'PICKUP_CODE_ATTEMPTS_EXCEEDED'
  | 'PICKUP_CODE_NOT_YET_COLLECTABLE'
  | 'PICKUP_CODE_INVALID';

export type CodeCheckResult =
  | { readonly ok: true }
  | {
      readonly ok: false;
      readonly code: CodeCheckFailureCode;
      readonly reason: string;
      /** Present only for NOT_YET_COLLECTABLE. */
      readonly collectableFrom?: Date;
    };

/**
 * Whether presenting a code in this state should consume a verification attempt.
 *
 * Arriving before the delay window opens is a legitimate customer being early,
 * not an attacker guessing. Burning an attempt for it would let an impatient
 * customer lock themselves out of their own cash.
 */
export function shouldBurnAttempt(code: CodeCheckFailureCode): boolean {
  return code !== 'PICKUP_CODE_NOT_YET_COLLECTABLE';
}

/**
 * When a code issued now becomes collectable, given the policy.
 *
 * Returns null when no delay applies, which keeps the common path free of a
 * timestamp that would otherwise need checking everywhere.
 */
export function collectableFromFor(input: {
  issuedAt: Date;
  riskScore: number;
  delayMinutes: number;
  riskThreshold: number;
}): Date | null {
  if (input.delayMinutes <= 0) return null;
  if (input.riskScore < input.riskThreshold) return null;
  return new Date(input.issuedAt.getTime() + input.delayMinutes * 60_000);
}

/**
 * Whether a code may be presented for verification right now.
 *
 * Expiry is evaluated before attempt count so an expired code reports honestly
 * rather than looking like a lockout, and a caller cannot burn attempts against
 * a code that was never going to work.
 */
export function checkCodeUsable(state: PickupCodeState, now: Date): CodeCheckResult {
  if (state.status === 'REDEEMED') {
    return { ok: false, code: 'PICKUP_CODE_ALREADY_REDEEMED', reason: 'This code has already been redeemed' };
  }
  if (state.status === 'CANCELLED') {
    return { ok: false, code: 'PICKUP_CODE_INVALID', reason: 'This code is no longer valid' };
  }
  if (state.status === 'EXPIRED' || now.getTime() >= state.expiresAt.getTime()) {
    return { ok: false, code: 'PICKUP_CODE_EXPIRED', reason: 'This code has expired' };
  }
  if (state.status === 'LOCKED') {
    return { ok: false, code: 'PICKUP_CODE_LOCKED', reason: 'This code is locked after too many failed attempts' };
  }
  if (state.attemptCount >= state.maxAttempts) {
    return { ok: false, code: 'PICKUP_CODE_ATTEMPTS_EXCEEDED', reason: 'Maximum verification attempts reached' };
  }
  // Checked last, and deliberately after the attempt cap: a locked or exhausted
  // code is a harder failure and should report as such rather than telling the
  // holder to come back later for cash they can no longer collect.
  if (state.collectableFrom && now.getTime() < state.collectableFrom.getTime()) {
    return {
      ok: false,
      code: 'PICKUP_CODE_NOT_YET_COLLECTABLE',
      reason: 'This transaction is in its security hold period and cannot be collected yet',
      collectableFrom: state.collectableFrom,
    };
  }
  return { ok: true };
}

export function shouldLockAfterFailure(state: PickupCodeState): boolean {
  return state.attemptCount + 1 >= state.maxAttempts;
}

export function expiryFrom(issuedAt: Date, ttlDays: number): Date {
  return new Date(issuedAt.getTime() + ttlDays * 24 * 60 * 60 * 1000);
}

/**
 * Expected attempts to guess one specific live code, given the attempt cap.
 * Used in SECURITY.md to justify the format rather than assert it is fine.
 */
export function bruteForceKeyspace(): bigint {
  return BigInt(ALPHABET_SIZE) ** BigInt(CODE_SYMBOL_COUNT);
}
