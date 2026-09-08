/**
 * Fee engine and quote construction.
 *
 * Given "the customer wants exactly RD$20,000", this computes what their card
 * must be charged and itemises every component. Nothing here is a constant: the
 * schedule is a versioned record loaded from the database, so pricing can change
 * without a deploy and every historical receipt can still be recomputed against
 * the version that priced it.
 *
 * Pure module — no I/O, no clock beyond what is passed in.
 */

import { DomainError } from './errors';
import { applySpread, convertInverse, RATE_SCALE } from './fx';
import {
  type CurrencyCode,
  type Money,
  add,
  compare,
  divideRounded,
  fromMinor,
  money,
  multiplyBps,
  zero,
} from './money';

/**
 * A versioned pricing schedule. Basis points throughout: 150 bps = 1.50%.
 *
 * These are ENGINEERING DEFAULTS, not commercial rates. Real pricing requires
 * unit economics against actual processor costs, FX funding costs, payout
 * commissions, and chargeback provisioning.
 */
export interface FeeScheduleConfig {
  readonly id: string;
  readonly key: string;
  readonly version: number;
  readonly countryCode: string;

  readonly platformFeeBps: number;
  readonly platformFeeMinMinor: bigint;
  readonly platformFeeMaxMinor: bigint | null;

  readonly fxSpreadBps: number;

  readonly processingFeeBps: number;
  readonly processingFeeFixedMinor: bigint;

  readonly expeditedFeeMinor: bigint;
  readonly feeCurrency: CurrencyCode;
}

export interface QuoteInput {
  /** Exactly what the customer will collect at the window. */
  readonly payoutAmount: Money;
  readonly fundingCurrency: CurrencyCode;
  /** Mid-market rate, funding -> payout, scaled by RATE_SCALE. */
  readonly midRate: bigint;
  readonly schedule: FeeScheduleConfig;
  readonly expedited?: boolean;
}

export interface QuoteBreakdown {
  /** Guaranteed amount handed over in cash. */
  readonly payoutAmount: Money;
  /** Pre-fee funding required to deliver the payout. */
  readonly principal: Money;
  readonly platformFee: Money;
  readonly processingFee: Money;
  readonly expeditedFee: Money;
  /** principal + all fees — the exact card charge. */
  readonly totalCharged: Money;

  readonly midRate: bigint;
  readonly effectiveRate: bigint;
  readonly fxSpreadBps: number;
  /** What the spread cost the customer, expressed in funding currency. */
  readonly fxSpreadCost: Money;
  /** All fees plus the spread cost — the true all-in price of the service. */
  readonly totalCost: Money;

  readonly feeScheduleId: string;
  readonly feeScheduleVersion: number;
}

function clampFee(fee: Money, minMinor: bigint, maxMinor: bigint | null): Money {
  const currency = fee.currency;
  let result = fee;
  const minimum = fromMinor(minMinor, currency);
  if (compare(result, minimum) < 0) result = minimum;
  if (maxMinor !== null) {
    const maximum = fromMinor(maxMinor, currency);
    if (compare(result, maximum) > 0) result = maximum;
  }
  return result;
}

/**
 * Build a complete, itemised quote.
 *
 * Order matters and is deliberate:
 *   1. principal is derived from the payout at the *effective* (spread-adjusted)
 *      rate, rounded CEIL so the platform is never short of the cash it promised;
 *   2. the platform fee applies to the principal;
 *   3. the processing fee applies to principal + platform fee, because that is
 *      the amount the card network actually authorises and charges us for.
 *
 * Computing the processing fee on the principal alone would under-recover on
 * every single transaction.
 */
export function calculateQuote(input: QuoteInput): QuoteBreakdown {
  const { payoutAmount, fundingCurrency, midRate, schedule } = input;

  if (payoutAmount.amount <= 0n) {
    throw new DomainError('AMOUNT_BELOW_MINIMUM', 'Payout amount must be positive');
  }
  if (midRate <= 0n) {
    throw new DomainError('INVALID_RATE', 'Mid-market rate must be positive');
  }
  if (schedule.feeCurrency.toUpperCase() !== fundingCurrency.toUpperCase()) {
    throw new DomainError(
      'CURRENCY_MISMATCH',
      `Fee schedule is denominated in ${schedule.feeCurrency} but funding is ${fundingCurrency}`,
    );
  }

  const funding = fundingCurrency.toUpperCase();
  const effectiveRate = applySpread(midRate, schedule.fxSpreadBps);

  // 1. Funding needed to deliver the exact payout, at the customer's rate.
  const principal = convertInverse(payoutAmount, funding, effectiveRate, 'CEIL');

  // 2. Platform fee on the principal, clamped to the schedule's floor/ceiling.
  const platformFee = clampFee(
    multiplyBps(principal, schedule.platformFeeBps, 'HALF_UP'),
    schedule.platformFeeMinMinor,
    schedule.platformFeeMaxMinor,
  );

  // 3. Processing fee on what the card is actually asked to authorise.
  const processingBase = add(principal, platformFee);
  const processingFee = add(
    multiplyBps(processingBase, schedule.processingFeeBps, 'HALF_UP'),
    fromMinor(schedule.processingFeeFixedMinor, funding),
  );

  const expeditedFee = input.expedited
    ? fromMinor(schedule.expeditedFeeMinor, funding)
    : zero(funding);

  const totalCharged = add(add(add(principal, platformFee), processingFee), expeditedFee);

  // What the spread cost: principal at our rate minus principal at mid-market.
  const principalAtMid = convertInverse(payoutAmount, funding, midRate, 'CEIL');
  const fxSpreadCost = money(principal.amount - principalAtMid.amount, funding);

  const totalCost = add(add(add(platformFee, processingFee), expeditedFee), fxSpreadCost);

  return Object.freeze({
    payoutAmount,
    principal,
    platformFee,
    processingFee,
    expeditedFee,
    totalCharged,
    midRate,
    effectiveRate,
    fxSpreadBps: schedule.fxSpreadBps,
    fxSpreadCost,
    totalCost,
    feeScheduleId: schedule.id,
    feeScheduleVersion: schedule.version,
  });
}

/**
 * The all-in cost as a percentage of the payout's mid-market value, in bps.
 * This is the number a customer should be able to compare against an ATM, and
 * the number the fees page is built around.
 */
export function effectiveCostBps(quote: QuoteBreakdown): number {
  const principalAtMid = quote.totalCharged.amount - quote.totalCost.amount;
  if (principalAtMid <= 0n) return 0;
  return Number(divideRounded(quote.totalCost.amount * 10_000n, principalAtMid, 'HALF_UP'));
}

/** Recompute a stored quote to prove a historical receipt is arithmetically sound. */
export function verifyQuoteIntegrity(
  quote: QuoteBreakdown,
): { valid: true } | { valid: false; reason: string } {
  const recomputedTotal =
    quote.principal.amount +
    quote.platformFee.amount +
    quote.processingFee.amount +
    quote.expeditedFee.amount;

  if (recomputedTotal !== quote.totalCharged.amount) {
    return {
      valid: false,
      reason: `Components sum to ${recomputedTotal} but totalCharged is ${quote.totalCharged.amount}`,
    };
  }

  const expectedEffective = applySpread(quote.midRate, quote.fxSpreadBps);
  if (expectedEffective !== quote.effectiveRate) {
    return {
      valid: false,
      reason: `Effective rate ${quote.effectiveRate} does not match mid ${quote.midRate} at ${quote.fxSpreadBps} bps`,
    };
  }

  // The principal must be sufficient to fund the promised payout.
  const deliverable = (quote.principal.amount * quote.effectiveRate) / RATE_SCALE;
  if (deliverable < quote.payoutAmount.amount) {
    return {
      valid: false,
      reason: `Principal funds only ${deliverable} of the promised ${quote.payoutAmount.amount} payout`,
    };
  }

  return { valid: true };
}
