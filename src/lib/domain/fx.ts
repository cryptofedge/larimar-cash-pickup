/**
 * Foreign exchange — integer-scaled rates only.
 *
 * A rate is a `bigint` numerator with a fixed scale of 1e8. "1 USD = 60.25 DOP"
 * is 6_025_000_000n. Conversion is integer multiply then integer divide with an
 * explicit rounding mode; no float ever touches a rate, at rest or in flight.
 *
 * Pure module. The provider that *fetches* rates lives in src/server/providers.
 */

import { DomainError } from './errors';
import {
  type CurrencyCode,
  type Money,
  type RoundingMode,
  currencyExponent,
  divideRounded,
  money,
} from './money';

/** All rates are stored and computed at 8 decimal places of precision. */
export const RATE_SCALE = 100_000_000n;
export const RATE_SCALE_DECIMALS = 8;

export interface FxRate {
  readonly base: CurrencyCode;
  readonly quote: CurrencyCode;
  /** Mid-market rate, scaled by RATE_SCALE. */
  readonly midRate: bigint;
  /** Spread applied to build the customer rate, in basis points. */
  readonly spreadBps: number;
  /** The rate actually offered to the customer, scaled by RATE_SCALE. */
  readonly effectiveRate: bigint;
  readonly source: string;
  readonly fetchedAt: Date;
  readonly expiresAt: Date;
}

export function parseRate(decimal: string): bigint {
  const trimmed = decimal.trim();
  const match = /^(\d+)(?:\.(\d*))?$/.exec(trimmed);
  if (!match) {
    throw new DomainError('INVALID_RATE', `Not a valid exchange rate: "${decimal}"`);
  }
  const whole = match[1] as string;
  const fraction = match[2] ?? '';
  if (fraction.length > RATE_SCALE_DECIMALS) {
    throw new DomainError(
      'INVALID_RATE',
      `Rate precision exceeds ${RATE_SCALE_DECIMALS} decimal places: "${decimal}"`,
    );
  }
  return BigInt(whole + fraction.padEnd(RATE_SCALE_DECIMALS, '0'));
}

export function formatRate(rate: bigint, decimals = 4): string {
  if (rate < 0n) throw new DomainError('INVALID_RATE', 'Exchange rates cannot be negative');
  const whole = rate / RATE_SCALE;
  const fractionFull = (rate % RATE_SCALE).toString().padStart(RATE_SCALE_DECIMALS, '0');

  if (decimals >= RATE_SCALE_DECIMALS) return `${whole}.${fractionFull}`;

  // Round the displayed fraction rather than truncating it.
  const keepScale = 10n ** BigInt(RATE_SCALE_DECIMALS - decimals);
  const rounded = divideRounded(rate % RATE_SCALE, keepScale, 'HALF_UP');
  const carry = rounded === 10n ** BigInt(decimals) ? 1n : 0n;
  const shown = carry === 1n ? 0n : rounded;
  return `${whole + carry}.${shown.toString().padStart(decimals, '0')}`;
}

/**
 * Apply the platform's spread to a mid-market rate.
 *
 * The spread always works against the customer: they receive fewer quote units
 * per base unit than the mid-market rate implies. That is the economics of the
 * product, and it is disclosed as a separate line item rather than hidden.
 */
export function applySpread(midRate: bigint, spreadBps: number): bigint {
  if (midRate <= 0n) throw new DomainError('INVALID_RATE', 'Mid-market rate must be positive');
  if (!Number.isInteger(spreadBps) || spreadBps < 0 || spreadBps >= 10_000) {
    throw new DomainError('INVALID_RATE', `Spread must be an integer in [0, 10000) bps; got ${spreadBps}`);
  }
  return divideRounded(midRate * BigInt(10_000 - spreadBps), 10_000n, 'FLOOR');
}

export function buildRate(input: {
  base: CurrencyCode;
  quote: CurrencyCode;
  midRate: bigint;
  spreadBps: number;
  source: string;
  fetchedAt: Date;
  ttlSeconds: number;
}): FxRate {
  return Object.freeze({
    base: input.base.toUpperCase(),
    quote: input.quote.toUpperCase(),
    midRate: input.midRate,
    spreadBps: input.spreadBps,
    effectiveRate: applySpread(input.midRate, input.spreadBps),
    source: input.source,
    fetchedAt: input.fetchedAt,
    expiresAt: new Date(input.fetchedAt.getTime() + input.ttlSeconds * 1000),
  });
}

/**
 * Convert base -> quote at a given rate.
 *
 * Currency exponents differ (USD has 2 decimals, JPY has 0), so the minor-unit
 * scales must be reconciled or a USD->JPY conversion is wrong by 100x.
 */
export function convert(
  amount: Money,
  toCurrency: CurrencyCode,
  rate: bigint,
  mode: RoundingMode = 'HALF_UP',
): Money {
  if (rate <= 0n) throw new DomainError('INVALID_RATE', 'Exchange rate must be positive');

  const target = toCurrency.toUpperCase();
  const fromExponent = currencyExponent(amount.currency);
  const toExponent = currencyExponent(target);
  const exponentShift = toExponent - fromExponent;

  let numerator = amount.amount * rate;
  let denominator = RATE_SCALE;

  if (exponentShift > 0) numerator *= 10n ** BigInt(exponentShift);
  else if (exponentShift < 0) denominator *= 10n ** BigInt(-exponentShift);

  return money(divideRounded(numerator, denominator, mode), target);
}

/**
 * The inverse: how much base currency is needed to deliver an exact quote amount.
 *
 * Rounds CEIL by default and that is deliberate. The customer is promised an
 * exact payout; the platform must collect at least enough to fund it. Rounding
 * down here would leave a systematic shortfall of one minor unit per transaction
 * — small individually, structurally insolvent at volume.
 */
export function convertInverse(
  targetAmount: Money,
  fromCurrency: CurrencyCode,
  rate: bigint,
  mode: RoundingMode = 'CEIL',
): Money {
  if (rate <= 0n) throw new DomainError('INVALID_RATE', 'Exchange rate must be positive');

  const source = fromCurrency.toUpperCase();
  const fromExponent = currencyExponent(source);
  const toExponent = currencyExponent(targetAmount.currency);
  const exponentShift = toExponent - fromExponent;

  let numerator = targetAmount.amount * RATE_SCALE;
  let denominator = rate;

  if (exponentShift > 0) denominator *= 10n ** BigInt(exponentShift);
  else if (exponentShift < 0) numerator *= 10n ** BigInt(-exponentShift);

  return money(divideRounded(numerator, denominator, mode), source);
}

export function invertRate(rate: bigint): bigint {
  if (rate <= 0n) throw new DomainError('INVALID_RATE', 'Exchange rate must be positive');
  return divideRounded(RATE_SCALE * RATE_SCALE, rate, 'HALF_UP');
}

export function isRateExpired(rate: FxRate, now: Date): boolean {
  return now.getTime() >= rate.expiresAt.getTime();
}

/**
 * Drift between a locked quote rate and the live rate, in basis points.
 *
 * If the market moves beyond tolerance between quoting and authorisation, the
 * quote is void and the customer re-confirms. This is what keeps "you will
 * receive exactly RD$20,000" true without exposing the platform to unbounded
 * FX risk on a stale price.
 */
export function rateDriftBps(quotedRate: bigint, liveRate: bigint): number {
  if (quotedRate <= 0n) throw new DomainError('INVALID_RATE', 'Quoted rate must be positive');
  const delta = liveRate > quotedRate ? liveRate - quotedRate : quotedRate - liveRate;
  return Number(divideRounded(delta * 10_000n, quotedRate, 'HALF_UP'));
}

export function hasDriftedBeyondTolerance(
  quotedRate: bigint,
  liveRate: bigint,
  toleranceBps: number,
): boolean {
  return rateDriftBps(quotedRate, liveRate) > toleranceBps;
}
