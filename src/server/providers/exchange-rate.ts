/**
 * Exchange-rate provider port.
 *
 * The mock generates plausible, deterministic rates. It is NOT market data and
 * must never be presented to a customer as such — the UI labels every demo rate
 * accordingly. Real deployment needs a licensed feed plus the platform's own
 * funding cost, which is a treasury question, not just a data question.
 */

import { createHash } from 'node:crypto';
import { type FxRate, buildRate, parseRate } from '@/lib/domain/fx';
import { DomainError } from '@/lib/domain/errors';
import { env } from '../env';

export interface ExchangeRateProvider {
  readonly name: string;
  /** Mid-market rate. Spread is applied by the fee engine, not the provider. */
  getRate(base: string, quote: string, options?: { spreadBps?: number }): Promise<FxRate>;
  supports(base: string, quote: string): boolean;
}

/**
 * Anchor rates. Approximate real-world magnitudes so the demo produces
 * believable numbers, chosen once and clearly labelled as fabricated.
 */
const ANCHORS: Record<string, string> = {
  'USD:DOP': '60.25',
  'USD:MXN': '17.10',
  'USD:COP': '3950.00',
  'USD:CRC': '512.00',
  'USD:PAB': '1.00',
  'USD:JMD': '156.00',
  'EUR:DOP': '65.40',
};

/**
 * Deterministic pseudo-movement.
 *
 * Hashing the pair and the current 5-minute bucket gives a rate that drifts
 * gently over time and is identical for every process and every test run — so a
 * quote-then-authorise flow can exercise real drift logic without flakiness.
 */
function driftBps(pair: string, at: Date): number {
  const bucket = Math.floor(at.getTime() / (5 * 60 * 1000));
  const digest = createHash('sha256').update(`${pair}:${bucket}`).digest();
  const raw = ((digest[0] as number) << 8) | (digest[1] as number);
  return (raw % 61) - 30; // -30..+30 bps
}

export class MockExchangeRateProvider implements ExchangeRateProvider {
  readonly name = 'mock';

  supports(base: string, quote: string): boolean {
    return `${base.toUpperCase()}:${quote.toUpperCase()}` in ANCHORS;
  }

  async getRate(base: string, quote: string, options: { spreadBps?: number } = {}): Promise<FxRate> {
    const pair = `${base.toUpperCase()}:${quote.toUpperCase()}`;
    const anchor = ANCHORS[pair];
    if (!anchor) {
      throw new DomainError('RATE_UNAVAILABLE', `No rate available for ${pair}`);
    }

    const now = new Date();
    const anchorScaled = parseRate(anchor);
    const drift = driftBps(pair, now);
    const midRate = (anchorScaled * BigInt(10_000 + drift)) / 10_000n;

    return buildRate({
      base,
      quote,
      midRate,
      spreadBps: options.spreadBps ?? 0,
      // Named so it can never be mistaken for a market source in a log or receipt.
      source: 'mock-deterministic-demo',
      fetchedAt: now,
      ttlSeconds: env.QUOTE_TTL_SECONDS,
    });
  }
}

let instance: ExchangeRateProvider | null = null;

export function getExchangeRateProvider(): ExchangeRateProvider {
  if (instance) return instance;
  switch (env.EXCHANGE_RATE_PROVIDER) {
    case 'mock':
      instance = new MockExchangeRateProvider();
      return instance;
    default:
      throw new Error(
        `No ExchangeRateProvider implementation for "${env.EXCHANGE_RATE_PROVIDER}".`,
      );
  }
}

export function resetExchangeRateProvider(): void {
  instance = null;
}
