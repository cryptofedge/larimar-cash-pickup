/**
 * Fixed-window rate limiting.
 *
 * Database-backed, which is honest about what this is: adequate for a demo and
 * for moderate traffic, and explicitly the wrong tool at scale. Production
 * should move these counters to Redis — the interface here is deliberately small
 * so that swap is a single file.
 *
 * Fixed windows allow a burst at a boundary. That is an accepted trade for
 * simplicity; the limits that actually matter for fraud (pickup-code attempts)
 * are additionally enforced per-code in the database, not only here.
 */

import { prisma } from '../db';
import { env } from '../env';

export interface RateLimitRule {
  readonly key: string;
  readonly limit: number;
  readonly windowSeconds: number;
  /** Also bucket per authenticated user, not only per address. */
  readonly perUser?: boolean;
}

export const RATE_LIMITS = {
  login: { key: 'login', limit: env.RATE_LIMIT_LOGIN_PER_15MIN, windowSeconds: 900 },
  register: { key: 'register', limit: env.RATE_LIMIT_REGISTER_PER_HOUR, windowSeconds: 3600 },
  passwordReset: { key: 'password-reset', limit: 5, windowSeconds: 3600 },
  quote: { key: 'quote', limit: env.RATE_LIMIT_QUOTE_PER_MIN, windowSeconds: 60 },
  transactionCreate: { key: 'transaction-create', limit: 20, windowSeconds: 3600, perUser: true },
  payment: { key: 'payment', limit: 20, windowSeconds: 3600, perUser: true },
  pickupVerify: {
    key: 'pickup-verify',
    limit: env.RATE_LIMIT_PICKUP_VERIFY_PER_MIN,
    windowSeconds: 60,
    perUser: true,
  },
  pickupRedeem: { key: 'pickup-redeem', limit: 30, windowSeconds: 3600, perUser: true },
  kyc: { key: 'kyc', limit: 5, windowSeconds: 3600, perUser: true },
  support: { key: 'support', limit: 10, windowSeconds: 3600 },
  default: { key: 'default', limit: env.RATE_LIMIT_DEFAULT_PER_MIN, windowSeconds: 60 },
} as const satisfies Record<string, RateLimitRule>;

export interface RateLimitResult {
  readonly allowed: boolean;
  readonly remaining: number;
  readonly retryAfterSeconds: number;
}

function windowStart(windowSeconds: number, now: Date): Date {
  const ms = windowSeconds * 1000;
  return new Date(Math.floor(now.getTime() / ms) * ms);
}

export async function checkRateLimit(
  rule: RateLimitRule,
  context: { ipAddress?: string | null; identifier?: string | null; userId?: string | null },
): Promise<RateLimitResult> {
  const now = new Date();
  const start = windowStart(rule.windowSeconds, now);
  const expiresAt = new Date(start.getTime() + rule.windowSeconds * 1000);

  const subject =
    (rule.perUser && context.userId) || context.ipAddress || context.identifier || 'anonymous';
  const bucketKey = `${rule.key}:${subject}`;

  // Atomic upsert-and-increment. Two concurrent requests cannot both read a
  // stale count and both decide they are under the limit.
  const counter = await prisma.rateLimitCounter.upsert({
    where: { bucketKey_windowStart: { bucketKey, windowStart: start } },
    update: { count: { increment: 1 } },
    create: { bucketKey, windowStart: start, count: 1, expiresAt },
    select: { count: true },
  });

  const allowed = counter.count <= rule.limit;
  return {
    allowed,
    remaining: Math.max(0, rule.limit - counter.count),
    retryAfterSeconds: allowed ? 0 : Math.ceil((expiresAt.getTime() - now.getTime()) / 1000),
  };
}

/** Housekeeping. A scheduled job calls this; Redis would expire keys for free. */
export async function pruneExpiredRateLimits(): Promise<number> {
  const result = await prisma.rateLimitCounter.deleteMany({
    where: { expiresAt: { lt: new Date() } },
  });
  return result.count;
}
