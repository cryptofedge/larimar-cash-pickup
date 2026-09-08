/**
 * Cryptographic primitives, all from `node:crypto`.
 *
 * There is no third-party crypto dependency here, deliberately. Node's built-ins
 * cover everything this application needs (scrypt, AES-256-GCM, HMAC, CSPRNG),
 * they are maintained as part of the runtime, and they remove an entire class of
 * supply-chain risk from the most security-sensitive code in the system.
 */

import {
  createCipheriv,
  createDecipheriv,
  createHash,
  createHmac,
  randomBytes,
  scrypt as scryptCallback,
  timingSafeEqual,
} from 'node:crypto';
import { promisify } from 'node:util';
import { env } from '../env';

const scrypt = promisify(scryptCallback) as (
  password: string | Buffer,
  salt: string | Buffer,
  keylen: number,
  options: { N: number; r: number; p: number; maxmem: number },
) => Promise<Buffer>;

// ---------------------------------------------------------------------------
// Password hashing — scrypt
// ---------------------------------------------------------------------------

/**
 * Memory-hard parameters. N=2^15 with r=8 needs ~32 MB per hash, which is the
 * point: it makes large-scale offline cracking expensive without making a single
 * login noticeably slow.
 *
 * The parameters are encoded into the stored string, so they can be raised later
 * and old hashes still verify — and `needsRehash` tells the login path when to
 * transparently upgrade one.
 */
const SCRYPT_N = 32_768;
const SCRYPT_R = 8;
const SCRYPT_P = 1;
const SCRYPT_KEYLEN = 64;
const SCRYPT_MAXMEM = 96 * 1024 * 1024;

export async function hashPassword(password: string): Promise<string> {
  if (password.length < 12) {
    throw new Error('Password must be at least 12 characters');
  }
  const salt = randomBytes(16);
  const derived = await scrypt(password.normalize('NFKC'), salt, SCRYPT_KEYLEN, {
    N: SCRYPT_N,
    r: SCRYPT_R,
    p: SCRYPT_P,
    maxmem: SCRYPT_MAXMEM,
  });
  return `scrypt$${SCRYPT_N}$${SCRYPT_R}$${SCRYPT_P}$${salt.toString('base64')}$${derived.toString('base64')}`;
}

/**
 * Verify a password. Returns false rather than throwing on a malformed stored
 * hash, so a corrupted row cannot be distinguished from a wrong password by an
 * attacker probing the login endpoint.
 */
export async function verifyPassword(password: string, stored: string): Promise<boolean> {
  try {
    const parts = stored.split('$');
    if (parts.length !== 6 || parts[0] !== 'scrypt') return false;

    const N = Number(parts[1]);
    const r = Number(parts[2]);
    const p = Number(parts[3]);
    const salt = Buffer.from(parts[4] as string, 'base64');
    const expected = Buffer.from(parts[5] as string, 'base64');

    if (!Number.isFinite(N) || !Number.isFinite(r) || !Number.isFinite(p)) return false;
    if (N > 1_048_576 || r > 32 || p > 16) return false; // resource-exhaustion guard

    const derived = await scrypt(password.normalize('NFKC'), salt, expected.length, {
      N,
      r,
      p,
      maxmem: SCRYPT_MAXMEM,
    });

    return derived.length === expected.length && timingSafeEqual(derived, expected);
  } catch {
    return false;
  }
}

/** True when a stored hash uses weaker parameters than the current policy. */
export function needsRehash(stored: string): boolean {
  const parts = stored.split('$');
  if (parts.length !== 6 || parts[0] !== 'scrypt') return true;
  return Number(parts[1]) < SCRYPT_N || Number(parts[2]) < SCRYPT_R;
}

// ---------------------------------------------------------------------------
// Symmetric encryption — AES-256-GCM
// ---------------------------------------------------------------------------

function encryptionKey(): Buffer {
  return Buffer.from(env.ENCRYPTION_KEY, 'base64');
}

/**
 * Encrypt a secret for storage (TOTP seeds, partner API secrets).
 *
 * GCM is authenticated: tampering with ciphertext at rest is detected on
 * decryption rather than silently producing garbage. Format is
 * `v1.iv.tag.ciphertext`, all base64, with the version prefix so the scheme can
 * be rotated without ambiguity.
 */
export function encryptSecret(plaintext: string): string {
  const iv = randomBytes(12);
  const cipher = createCipheriv('aes-256-gcm', encryptionKey(), iv);
  const ciphertext = Buffer.concat([cipher.update(plaintext, 'utf8'), cipher.final()]);
  const tag = cipher.getAuthTag();
  return `v1.${iv.toString('base64')}.${tag.toString('base64')}.${ciphertext.toString('base64')}`;
}

export function decryptSecret(encoded: string): string {
  const parts = encoded.split('.');
  if (parts.length !== 4 || parts[0] !== 'v1') {
    throw new Error('Unrecognised ciphertext format');
  }
  const iv = Buffer.from(parts[1] as string, 'base64');
  const tag = Buffer.from(parts[2] as string, 'base64');
  const ciphertext = Buffer.from(parts[3] as string, 'base64');

  const decipher = createDecipheriv('aes-256-gcm', encryptionKey(), iv);
  decipher.setAuthTag(tag);
  return Buffer.concat([decipher.update(ciphertext), decipher.final()]).toString('utf8');
}

// ---------------------------------------------------------------------------
// Tokens, hashes, signatures
// ---------------------------------------------------------------------------

/** URL-safe opaque token. 32 bytes = 256 bits. */
export function generateToken(bytes = 32): string {
  return randomBytes(bytes).toString('base64url');
}

/**
 * Hash a bearer token for storage.
 *
 * Plain SHA-256 with no salt is correct here and not a mistake: the input is
 * already 256 bits of uniform randomness, so there is no dictionary to defend
 * against, and an unsalted digest keeps lookup a single indexed equality match.
 */
export function hashToken(token: string): string {
  return createHash('sha256').update(token, 'utf8').digest('hex');
}

export function sha256Hex(input: string): string {
  return createHash('sha256').update(input, 'utf8').digest('hex');
}

export function constantTimeEquals(a: string, b: string): boolean {
  const bufA = Buffer.from(a, 'utf8');
  const bufB = Buffer.from(b, 'utf8');
  if (bufA.length !== bufB.length) return false;
  return timingSafeEqual(bufA, bufB);
}

export function hmacSha256(payload: string, secret: string): string {
  return createHmac('sha256', secret).update(payload, 'utf8').digest('hex');
}

/**
 * Verify a webhook or partner signature.
 *
 * Both the signature AND the timestamp must check out. A valid signature on a
 * replayed old request is still an attack, so the timestamp window is not
 * optional.
 */
export function verifySignature(input: {
  payload: string;
  timestamp: string;
  signature: string;
  secret: string;
  toleranceSeconds: number;
  now?: Date;
}): { valid: boolean; reason?: string } {
  const timestampSeconds = Number(input.timestamp);
  if (!Number.isFinite(timestampSeconds)) {
    return { valid: false, reason: 'Malformed timestamp' };
  }

  const now = input.now ?? new Date();
  const ageSeconds = Math.abs(now.getTime() / 1000 - timestampSeconds);
  if (ageSeconds > input.toleranceSeconds) {
    return { valid: false, reason: 'Timestamp outside the accepted window' };
  }

  // The timestamp is inside the signed payload, so it cannot be altered.
  const expected = hmacSha256(`${input.timestamp}.${input.payload}`, input.secret);
  if (!constantTimeEquals(expected, input.signature)) {
    return { valid: false, reason: 'Signature mismatch' };
  }

  return { valid: true };
}

export function buildSignature(payload: string, secret: string, timestamp?: string): {
  timestamp: string;
  signature: string;
} {
  const ts = timestamp ?? String(Math.floor(Date.now() / 1000));
  return { timestamp: ts, signature: hmacSha256(`${ts}.${payload}`, secret) };
}

/** Human-readable reference, e.g. LRM-7F3K2Q8M. Not a secret and not sequential. */
export function generateReference(prefix: string): string {
  const alphabet = '0123456789ABCDEFGHJKMNPQRSTVWXYZ';
  const bytes = randomBytes(8);
  let out = '';
  for (const byte of bytes) {
    out += alphabet[byte % alphabet.length] as string;
  }
  return `${prefix}-${out}`;
}
