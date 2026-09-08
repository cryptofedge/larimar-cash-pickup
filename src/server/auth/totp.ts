/**
 * RFC 6238 TOTP, implemented on node:crypto.
 *
 * Multi-factor authentication is mandatory for every staff role. An agent
 * account is a cash-dispensing credential and a compliance account can release
 * held funds; a password alone is not an adequate control on either.
 */

import { createHmac, randomBytes, randomInt, timingSafeEqual } from 'node:crypto';

const DIGITS = 6;
const PERIOD_SECONDS = 30;
/** Accept the neighbouring steps to tolerate clock skew — about 90s of window. */
const DEFAULT_WINDOW = 1;

const BASE32_ALPHABET = 'ABCDEFGHIJKLMNOPQRSTUVWXYZ234567';

export function generateTotpSecret(): string {
  return base32Encode(randomBytes(20)); // 160 bits, the RFC 4226 recommendation
}

function base32Encode(buffer: Buffer): string {
  let bits = 0;
  let value = 0;
  let output = '';

  for (const byte of buffer) {
    value = (value << 8) | byte;
    bits += 8;
    while (bits >= 5) {
      output += BASE32_ALPHABET[(value >>> (bits - 5)) & 31] as string;
      bits -= 5;
    }
  }
  if (bits > 0) {
    output += BASE32_ALPHABET[(value << (5 - bits)) & 31] as string;
  }
  return output;
}

function base32Decode(input: string): Buffer {
  const cleaned = input.toUpperCase().replace(/=+$/, '').replace(/\s/g, '');
  let bits = 0;
  let value = 0;
  const bytes: number[] = [];

  for (const char of cleaned) {
    const index = BASE32_ALPHABET.indexOf(char);
    if (index === -1) throw new Error('Invalid base32 character in TOTP secret');
    value = (value << 5) | index;
    bits += 5;
    if (bits >= 8) {
      bytes.push((value >>> (bits - 8)) & 0xff);
      bits -= 8;
    }
  }
  return Buffer.from(bytes);
}

function hotp(secret: Buffer, counter: number): string {
  const buffer = Buffer.alloc(8);
  buffer.writeBigUInt64BE(BigInt(counter));

  const digest = createHmac('sha1', secret).update(buffer).digest();
  const offset = (digest[digest.length - 1] as number) & 0x0f;
  const binary =
    (((digest[offset] as number) & 0x7f) << 24) |
    (((digest[offset + 1] as number) & 0xff) << 16) |
    (((digest[offset + 2] as number) & 0xff) << 8) |
    ((digest[offset + 3] as number) & 0xff);

  return (binary % 10 ** DIGITS).toString().padStart(DIGITS, '0');
}

export function generateTotp(secret: string, at: Date = new Date()): string {
  const counter = Math.floor(at.getTime() / 1000 / PERIOD_SECONDS);
  return hotp(base32Decode(secret), counter);
}

/**
 * Verify a submitted code.
 *
 * Every candidate step is compared in constant time and the loop always runs to
 * completion, so response timing does not reveal which step matched.
 */
export function verifyTotp(
  secret: string,
  token: string,
  options: { at?: Date; window?: number } = {},
): boolean {
  const normalized = token.replace(/\D/g, '');
  if (normalized.length !== DIGITS) return false;

  const at = options.at ?? new Date();
  const window = options.window ?? DEFAULT_WINDOW;
  const counter = Math.floor(at.getTime() / 1000 / PERIOD_SECONDS);

  let key: Buffer;
  try {
    key = base32Decode(secret);
  } catch {
    return false;
  }

  const submitted = Buffer.from(normalized, 'utf8');
  let matched = false;

  for (let offset = -window; offset <= window; offset += 1) {
    const candidate = Buffer.from(hotp(key, counter + offset), 'utf8');
    if (candidate.length === submitted.length && timingSafeEqual(candidate, submitted)) {
      matched = true;
    }
  }

  return matched;
}

/** otpauth:// URI for authenticator apps. */
export function buildOtpAuthUri(input: {
  secret: string;
  accountName: string;
  issuer: string;
}): string {
  const label = encodeURIComponent(`${input.issuer}:${input.accountName}`);
  const params = new URLSearchParams({
    secret: input.secret,
    issuer: input.issuer,
    algorithm: 'SHA1',
    digits: String(DIGITS),
    period: String(PERIOD_SECONDS),
  });
  return `otpauth://totp/${label}?${params.toString()}`;
}

/**
 * Recovery codes for a lost authenticator. Stored hashed and single-use, so a
 * database dump does not yield usable second factors.
 */
export function generateRecoveryCodes(count = 10): string[] {
  const codes: string[] = [];
  for (let i = 0; i < count; i += 1) {
    const part = () => String(randomInt(0, 100_000)).padStart(5, '0');
    codes.push(`${part()}-${part()}`);
  }
  return codes;
}

export function normalizeRecoveryCode(code: string): string {
  return code.replace(/\D/g, '');
}

export const TOTP_PERIOD_SECONDS = PERIOD_SECONDS;
export const TOTP_DIGITS = DIGITS;
