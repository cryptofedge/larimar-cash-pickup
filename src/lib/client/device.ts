/**
 * Device fingerprint — PLACEHOLDER.
 *
 * This is a stable-ish, low-entropy identifier derived from coarse browser
 * characteristics plus a random value persisted in localStorage. It is
 * deliberately simple and it is trivially spoofable: any client can send any
 * value it likes.
 *
 * That is acceptable ONLY because of how the value is used. The risk engine
 * treats device signals as *contributing weight*, never as authentication and
 * never as a hard allow. A spoofed fingerprint cannot approve a payout; at worst
 * it avoids a small risk score increment.
 *
 * Production should replace this with a dedicated device-intelligence vendor.
 * The interface stays the same: one opaque string sent with the request.
 */

const STORAGE_KEY = 'larimar_device';

function randomId(): string {
  const bytes = new Uint8Array(16);
  crypto.getRandomValues(bytes);
  return Array.from(bytes, (b) => b.toString(16).padStart(2, '0')).join('');
}

export function deviceFingerprint(): string {
  if (typeof window === 'undefined') return 'server';

  try {
    const existing = window.localStorage.getItem(STORAGE_KEY);
    if (existing) return existing;

    // Coarse, non-identifying characteristics, plus randomness so two users on
    // identical hardware do not collide into one "shared device" signal.
    const traits = [
      navigator.language,
      String(screen.width),
      String(screen.height),
      String(new Date().getTimezoneOffset()),
      randomId(),
    ].join('|');

    let hash = 0;
    for (let i = 0; i < traits.length; i += 1) {
      hash = (hash << 5) - hash + traits.charCodeAt(i);
      hash |= 0;
    }

    const fingerprint = `dev_${Math.abs(hash).toString(36)}_${randomId().slice(0, 12)}`;
    window.localStorage.setItem(STORAGE_KEY, fingerprint);
    return fingerprint;
  } catch {
    // Private browsing, disabled storage, or a hardened browser. Not an error.
    return `ephemeral_${randomId().slice(0, 16)}`;
  }
}

/** A fresh idempotency key for a mutating request. */
export function idempotencyKey(): string {
  return crypto.randomUUID();
}
