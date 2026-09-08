/**
 * Money — integer minor units, never floating point.
 *
 * IEEE-754 doubles cannot represent 0.1 exactly. `0.1 + 0.2 !== 0.3`. A platform
 * that promises "you will receive exactly RD$20,000" has no business using them.
 * Every value here is a `bigint` count of the currency's smallest unit, paired
 * with its ISO-4217 code, and every rounding site states its direction explicitly.
 *
 * This module is pure: no I/O, no clock, no database. It is the reason the
 * pricing tests run in milliseconds.
 */

import { DomainError } from './errors';

export type CurrencyCode = string;

export interface Money {
  readonly amount: bigint;
  readonly currency: CurrencyCode;
}

/**
 * How a division that does not divide evenly should resolve.
 *
 * The choice is never incidental. `CEIL` on the funding calculation means the
 * platform collects at least what it must pay out; `HALF_UP` on fees is the
 * conventional, disclosed treatment.
 */
export type RoundingMode = 'HALF_UP' | 'HALF_EVEN' | 'CEIL' | 'FLOOR' | 'TRUNCATE';

/** ISO-4217 exponents. Not every currency has two decimal places. */
const CURRENCY_EXPONENTS: Readonly<Record<string, number>> = {
  USD: 2,
  DOP: 2,
  EUR: 2,
  GBP: 2,
  CAD: 2,
  CHF: 2,
  MXN: 2,
  COP: 2,
  CRC: 2,
  PAB: 2,
  JMD: 2,
  BRL: 2,
  JPY: 0,
  CLP: 0,
  KRW: 0,
  ISK: 0,
  BHD: 3,
  KWD: 3,
  TND: 3,
};

export function currencyExponent(currency: CurrencyCode): number {
  const exponent = CURRENCY_EXPONENTS[currency.toUpperCase()];
  if (exponent === undefined) {
    throw new DomainError('UNSUPPORTED_CURRENCY', `Unknown currency code: ${currency}`);
  }
  return exponent;
}

export function isSupportedCurrency(currency: string): boolean {
  return Object.prototype.hasOwnProperty.call(CURRENCY_EXPONENTS, currency.toUpperCase());
}

function minorUnitScale(currency: CurrencyCode): bigint {
  return 10n ** BigInt(currencyExponent(currency));
}

// ---------------------------------------------------------------------------
// Construction
// ---------------------------------------------------------------------------

export function money(amount: bigint | number | string, currency: CurrencyCode): Money {
  const code = currency.toUpperCase();
  currencyExponent(code); // validates

  let value: bigint;
  if (typeof amount === 'bigint') {
    value = amount;
  } else if (typeof amount === 'number') {
    if (!Number.isInteger(amount)) {
      throw new DomainError(
        'INVALID_MONEY',
        `Minor-unit amounts must be integers; received ${amount}. ` +
          'Use fromDecimal() if you have a decimal string.',
      );
    }
    value = BigInt(amount);
  } else {
    if (!/^-?\d+$/.test(amount)) {
      throw new DomainError('INVALID_MONEY', `Not an integer minor-unit string: "${amount}"`);
    }
    value = BigInt(amount);
  }

  return Object.freeze({ amount: value, currency: code });
}

export function zero(currency: CurrencyCode): Money {
  return money(0n, currency);
}

/**
 * Parse a human decimal string ("20000", "342.11", "-1.5") into minor units.
 * Rejects excess precision rather than silently rounding it away — a caller who
 * writes "1.005" for USD has a bug, and swallowing it would hide a real defect.
 */
export function fromDecimal(decimal: string, currency: CurrencyCode): Money {
  const code = currency.toUpperCase();
  const exponent = currencyExponent(code);

  const trimmed = decimal.trim().replace(/,/g, '');
  const match = /^(-)?(\d*)(?:\.(\d*))?$/.exec(trimmed);
  if (!match || (match[2] === '' && (match[3] ?? '') === '')) {
    throw new DomainError('INVALID_MONEY', `Not a valid decimal amount: "${decimal}"`);
  }

  const negative = match[1] === '-';
  const whole = match[2] === '' ? '0' : (match[2] as string);
  const fraction = match[3] ?? '';

  if (fraction.length > exponent) {
    throw new DomainError(
      'INVALID_MONEY',
      `${code} supports ${exponent} decimal place(s); "${decimal}" has ${fraction.length}.`,
    );
  }

  const padded = fraction.padEnd(exponent, '0');
  const magnitude = BigInt(whole + padded);
  return money(negative ? -magnitude : magnitude, code);
}

/** Render minor units as a plain decimal string. No symbol, no grouping. */
export function toDecimal(value: Money): string {
  const exponent = currencyExponent(value.currency);
  const negative = value.amount < 0n;
  const magnitude = negative ? -value.amount : value.amount;

  if (exponent === 0) return `${negative ? '-' : ''}${magnitude}`;

  const scale = 10n ** BigInt(exponent);
  const whole = magnitude / scale;
  const fraction = (magnitude % scale).toString().padStart(exponent, '0');
  return `${negative ? '-' : ''}${whole}.${fraction}`;
}

// ---------------------------------------------------------------------------
// Arithmetic
// ---------------------------------------------------------------------------

function assertSameCurrency(a: Money, b: Money): void {
  if (a.currency !== b.currency) {
    throw new DomainError(
      'CURRENCY_MISMATCH',
      `Cannot combine ${a.currency} with ${b.currency}. Convert explicitly first.`,
    );
  }
}

export function add(a: Money, b: Money): Money {
  assertSameCurrency(a, b);
  return money(a.amount + b.amount, a.currency);
}

export function sum(values: readonly Money[], currency: CurrencyCode): Money {
  return values.reduce<Money>((acc, v) => add(acc, v), zero(currency));
}

export function subtract(a: Money, b: Money): Money {
  assertSameCurrency(a, b);
  return money(a.amount - b.amount, a.currency);
}

export function negate(value: Money): Money {
  return money(-value.amount, value.currency);
}

export function abs(value: Money): Money {
  return money(value.amount < 0n ? -value.amount : value.amount, value.currency);
}

export function compare(a: Money, b: Money): -1 | 0 | 1 {
  assertSameCurrency(a, b);
  if (a.amount < b.amount) return -1;
  if (a.amount > b.amount) return 1;
  return 0;
}

export const isZero = (v: Money): boolean => v.amount === 0n;
export const isNegative = (v: Money): boolean => v.amount < 0n;
export const isPositive = (v: Money): boolean => v.amount > 0n;
export const equals = (a: Money, b: Money): boolean => a.currency === b.currency && a.amount === b.amount;
export const greaterThan = (a: Money, b: Money): boolean => compare(a, b) === 1;
export const lessThan = (a: Money, b: Money): boolean => compare(a, b) === -1;
export const gte = (a: Money, b: Money): boolean => compare(a, b) >= 0;
export const lte = (a: Money, b: Money): boolean => compare(a, b) <= 0;

export function min(a: Money, b: Money): Money {
  return compare(a, b) <= 0 ? a : b;
}

export function max(a: Money, b: Money): Money {
  return compare(a, b) >= 0 ? a : b;
}

/**
 * Integer division with an explicit rounding mode.
 *
 * This is the single place in the codebase where a non-exact division resolves.
 * Everything monetary funnels through it so that rounding behaviour is auditable
 * in one file rather than scattered across the pricing path.
 */
export function divideRounded(
  numerator: bigint,
  denominator: bigint,
  mode: RoundingMode = 'HALF_UP',
): bigint {
  if (denominator === 0n) {
    throw new DomainError('DIVISION_BY_ZERO', 'Division by zero in monetary calculation');
  }

  // Normalise so the remainder logic only deals with a positive denominator.
  const negativeResult = numerator < 0n !== denominator < 0n;
  const absNumerator = numerator < 0n ? -numerator : numerator;
  const absDenominator = denominator < 0n ? -denominator : denominator;

  const quotient = absNumerator / absDenominator;
  const remainder = absNumerator % absDenominator;

  if (remainder === 0n) {
    return negativeResult ? -quotient : quotient;
  }

  let magnitude: bigint;
  switch (mode) {
    case 'TRUNCATE':
      magnitude = quotient;
      break;
    case 'CEIL':
      // Ceiling on the true (signed) value: away from zero only when positive.
      magnitude = negativeResult ? quotient : quotient + 1n;
      break;
    case 'FLOOR':
      magnitude = negativeResult ? quotient + 1n : quotient;
      break;
    case 'HALF_UP': {
      magnitude = remainder * 2n >= absDenominator ? quotient + 1n : quotient;
      break;
    }
    case 'HALF_EVEN': {
      const doubled = remainder * 2n;
      if (doubled > absDenominator) magnitude = quotient + 1n;
      else if (doubled < absDenominator) magnitude = quotient;
      else magnitude = quotient % 2n === 0n ? quotient : quotient + 1n;
      break;
    }
    default: {
      const exhaustive: never = mode;
      throw new DomainError('INVALID_ROUNDING_MODE', `Unknown rounding mode: ${String(exhaustive)}`);
    }
  }

  return negativeResult ? -magnitude : magnitude;
}

/** Multiply by a basis-point rate. 150 bps = 1.50%. */
export function multiplyBps(value: Money, bps: number, mode: RoundingMode = 'HALF_UP'): Money {
  if (!Number.isInteger(bps)) {
    throw new DomainError('INVALID_BPS', `Basis points must be an integer; received ${bps}`);
  }
  return money(divideRounded(value.amount * BigInt(bps), 10_000n, mode), value.currency);
}

/** Multiply by an integer factor. Exact — no rounding involved. */
export function multiplyInt(value: Money, factor: bigint | number): Money {
  return money(value.amount * BigInt(factor), value.currency);
}

/**
 * Split a value into `parts` shares that sum to exactly the original.
 *
 * Naive division loses or invents minor units — RD$100 split three ways is not
 * three lots of RD$33.33. The remainder is distributed one minor unit at a time
 * to the leading parts, so the total is preserved exactly.
 */
export function allocateEvenly(value: Money, parts: number): Money[] {
  if (!Number.isInteger(parts) || parts <= 0) {
    throw new DomainError('INVALID_ALLOCATION', `Parts must be a positive integer; received ${parts}`);
  }

  const divisor = BigInt(parts);
  const base = value.amount / divisor;
  let remainder = value.amount - base * divisor;
  const step = value.amount < 0n ? -1n : 1n;

  const result: Money[] = [];
  for (let i = 0; i < parts; i += 1) {
    let share = base;
    if (remainder !== 0n) {
      share += step;
      remainder -= step;
    }
    result.push(money(share, value.currency));
  }
  return result;
}

/**
 * Split a value across integer weights, preserving the total exactly.
 * Used for splitting fees or payouts proportionally without leakage.
 */
export function allocateByRatio(value: Money, weights: readonly number[]): Money[] {
  if (weights.length === 0) {
    throw new DomainError('INVALID_ALLOCATION', 'At least one weight is required');
  }
  if (weights.some((w) => !Number.isInteger(w) || w < 0)) {
    throw new DomainError('INVALID_ALLOCATION', 'Weights must be non-negative integers');
  }

  const total = weights.reduce((a, b) => a + b, 0);
  if (total === 0) {
    throw new DomainError('INVALID_ALLOCATION', 'Weights must not sum to zero');
  }

  const totalBig = BigInt(total);
  const shares = weights.map((w) => (value.amount * BigInt(w)) / totalBig);
  const distributed = shares.reduce((a, b) => a + b, 0n);
  let remainder = value.amount - distributed;
  const step = remainder < 0n ? -1n : 1n;

  const result = shares.slice();
  let index = 0;
  while (remainder !== 0n && index < result.length) {
    result[index] = (result[index] as bigint) + step;
    remainder -= step;
    index += 1;
  }

  return result.map((amount) => money(amount, value.currency));
}

// ---------------------------------------------------------------------------
// Presentation
// ---------------------------------------------------------------------------

/**
 * Locale-aware formatting.
 *
 * DOP renders as "RD$20,000.00" in both English and Spanish because that is how
 * the currency is actually written in the Dominican Republic — `Intl` alone
 * yields "DOP 20,000.00" for en-US, which reads as a foreign abstraction rather
 * than money the traveler is about to hold.
 */
export function formatMoney(
  value: Money,
  locale = 'en-US',
  options: { showCode?: boolean; compact?: boolean } = {},
): string {
  const exponent = currencyExponent(value.currency);
  const numeric = Number(toDecimal(value));

  const formatted = new Intl.NumberFormat(locale, {
    minimumFractionDigits: options.compact ? 0 : exponent,
    maximumFractionDigits: exponent,
  }).format(numeric);

  const symbol = currencySymbol(value.currency);
  const base = value.amount < 0n ? `-${symbol}${formatted.replace('-', '')}` : `${symbol}${formatted}`;
  return options.showCode ? `${base} ${value.currency}` : base;
}

export function currencySymbol(currency: CurrencyCode): string {
  switch (currency.toUpperCase()) {
    case 'DOP':
      return 'RD$';
    case 'USD':
      return '$';
    case 'EUR':
      return '€';
    case 'GBP':
      return '£';
    case 'CAD':
      return 'CA$';
    case 'MXN':
      return 'MX$';
    case 'JMD':
      return 'J$';
    default:
      return `${currency.toUpperCase()} `;
  }
}

/** Prisma stores minor units as BigInt columns; these are the boundary casts. */
export const toMinor = (value: Money): bigint => value.amount;
export const fromMinor = (amount: bigint, currency: CurrencyCode): Money => money(amount, currency);
