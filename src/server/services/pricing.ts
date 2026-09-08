/**
 * Pricing service — the only place a quote is ever produced.
 *
 * Server-side, always. A client may send the amount it wants to receive and
 * nothing else. Rates, spreads, fees, and totals are computed here from database
 * rows, frozen into a Quote, and re-verified at authorisation time.
 */

import { prisma, type PrismaTransactionClient } from '../db';
import { env } from '../env';
import { DomainError } from '@/lib/domain/errors';
import { calculateQuote, type FeeScheduleConfig, type QuoteBreakdown } from '@/lib/domain/fees';
import { hasDriftedBeyondTolerance } from '@/lib/domain/fx';
import { fromMinor, money, type Money } from '@/lib/domain/money';
import { getCountry, type CountryConfig } from '@/lib/domain/countries';
import { getExchangeRateProvider } from '../providers/exchange-rate';

export async function getActiveFeeSchedule(
  countryCode: string,
  client: PrismaTransactionClient = prisma,
): Promise<FeeScheduleConfig> {
  const row = await client.feeSchedule.findFirst({
    where: { countryCode, active: true },
    orderBy: { version: 'desc' },
  });

  if (!row) {
    throw new DomainError(
      'CONFIGURATION_ERROR',
      `No active fee schedule for ${countryCode}. Seed the database or configure pricing in the admin console.`,
    );
  }

  return {
    id: row.id,
    key: row.key,
    version: row.version,
    countryCode: row.countryCode,
    platformFeeBps: row.platformFeeBps,
    platformFeeMinMinor: row.platformFeeMinMinor,
    platformFeeMaxMinor: row.platformFeeMaxMinor,
    fxSpreadBps: row.fxSpreadBps,
    processingFeeBps: row.processingFeeBps,
    processingFeeFixedMinor: row.processingFeeFixedMinor,
    expeditedFeeMinor: row.expeditedFeeMinor,
    feeCurrency: row.feeCurrency,
  };
}

export interface QuoteRequest {
  readonly payoutAmountMinor: bigint;
  readonly payoutCurrency: string;
  readonly fundingCurrency: string;
  readonly countryCode: string;
  readonly expedited?: boolean;
}

export interface PricedQuote {
  readonly breakdown: QuoteBreakdown;
  readonly country: CountryConfig;
  readonly exchangeRateId: string;
  readonly rateSource: string;
  readonly rateFetchedAt: Date;
  readonly expiresAt: Date;
}

/**
 * Price a request without persisting anything. Backs the public calculator,
 * which must not be able to create rows.
 */
export async function priceQuote(request: QuoteRequest): Promise<Omit<PricedQuote, 'exchangeRateId'>> {
  const country = getCountry(request.countryCode);

  if (!country.enabled) {
    throw new DomainError('UNSUPPORTED_COUNTRY', `${country.code} is not an operational market`);
  }
  if (request.payoutCurrency.toUpperCase() !== country.payoutCurrency) {
    throw new DomainError(
      'UNSUPPORTED_CURRENCY',
      `${country.code} pays out in ${country.payoutCurrency}, not ${request.payoutCurrency}`,
    );
  }
  if (!country.supportedFundingCurrencies.includes(request.fundingCurrency.toUpperCase())) {
    throw new DomainError(
      'UNSUPPORTED_CURRENCY',
      `${request.fundingCurrency} is not an accepted funding currency for ${country.code}`,
    );
  }

  const schedule = await getActiveFeeSchedule(country.code);
  const provider = getExchangeRateProvider();
  const rate = await provider.getRate(request.fundingCurrency, country.payoutCurrency, {
    spreadBps: schedule.fxSpreadBps,
  });

  const breakdown = calculateQuote({
    payoutAmount: money(request.payoutAmountMinor, country.payoutCurrency),
    fundingCurrency: request.fundingCurrency,
    midRate: rate.midRate,
    schedule,
    expedited: request.expedited ?? false,
  });

  return {
    breakdown,
    country,
    rateSource: rate.source,
    rateFetchedAt: rate.fetchedAt,
    expiresAt: new Date(Date.now() + country.quoteTtlSeconds * 1000),
  };
}

/**
 * Price and persist. The stored row carries every input and output, so a receipt
 * can be recomputed and defended years later.
 */
export async function createQuote(
  request: QuoteRequest,
  client: PrismaTransactionClient = prisma,
): Promise<PricedQuote & { quoteId: string }> {
  const priced = await priceQuote(request);
  const { breakdown } = priced;

  const rateRow = await client.exchangeRate.create({
    data: {
      baseCurrency: request.fundingCurrency.toUpperCase(),
      quoteCurrency: priced.country.payoutCurrency,
      midRate: breakdown.midRate,
      spreadBps: breakdown.fxSpreadBps,
      effectiveRate: breakdown.effectiveRate,
      source: priced.rateSource,
      fetchedAt: priced.rateFetchedAt,
      expiresAt: priced.expiresAt,
    },
    select: { id: true },
  });

  const quoteRow = await client.quote.create({
    data: {
      payoutCurrency: breakdown.payoutAmount.currency,
      payoutAmountMinor: breakdown.payoutAmount.amount,
      fundingCurrency: breakdown.principal.currency,
      principalMinor: breakdown.principal.amount,
      platformFeeMinor: breakdown.platformFee.amount,
      processingFeeMinor: breakdown.processingFee.amount,
      expeditedFeeMinor: breakdown.expeditedFee.amount,
      totalChargedMinor: breakdown.totalCharged.amount,
      midRate: breakdown.midRate,
      effectiveRate: breakdown.effectiveRate,
      fxSpreadBps: breakdown.fxSpreadBps,
      exchangeRateId: rateRow.id,
      feeScheduleId: breakdown.feeScheduleId,
      countryCode: priced.country.code,
      expiresAt: priced.expiresAt,
    },
    select: { id: true },
  });

  return { ...priced, exchangeRateId: rateRow.id, quoteId: quoteRow.id };
}

/**
 * Re-validate a frozen quote at authorisation time.
 *
 * Two independent checks. The quote must not have expired or been consumed, and
 * the live rate must not have moved beyond tolerance. Without the second check,
 * a customer could hold a favourable quote through a market move and the platform
 * would fund the difference on every transaction.
 */
export async function validateQuoteForAuthorization(
  quoteId: string,
  client: PrismaTransactionClient = prisma,
): Promise<{ ok: true } | { ok: false; code: 'QUOTE_EXPIRED' | 'QUOTE_ALREADY_USED' | 'RATE_DRIFTED'; driftBps?: number }> {
  const quote = await client.quote.findUnique({ where: { id: quoteId } });
  if (!quote) throw new DomainError('NOT_FOUND', 'Quote not found');

  if (quote.consumedAt) return { ok: false, code: 'QUOTE_ALREADY_USED' };
  if (new Date() >= quote.expiresAt) return { ok: false, code: 'QUOTE_EXPIRED' };

  const provider = getExchangeRateProvider();
  const live = await provider.getRate(quote.fundingCurrency, quote.payoutCurrency, {
    spreadBps: quote.fxSpreadBps,
  });

  if (hasDriftedBeyondTolerance(quote.midRate, live.midRate, env.RATE_DRIFT_TOLERANCE_BPS)) {
    return { ok: false, code: 'RATE_DRIFTED' };
  }

  return { ok: true };
}

export async function consumeQuote(
  quoteId: string,
  client: PrismaTransactionClient,
): Promise<void> {
  const result = await client.quote.updateMany({
    where: { id: quoteId, consumedAt: null },
    data: { consumedAt: new Date() },
  });
  if (result.count === 0) {
    throw new DomainError('QUOTE_ALREADY_USED', 'This quote has already been used');
  }
}

/** Convenience for services that need Money objects back out of a stored quote. */
export function quoteToMoney(quote: {
  payoutCurrency: string;
  payoutAmountMinor: bigint;
  fundingCurrency: string;
  principalMinor: bigint;
  platformFeeMinor: bigint;
  processingFeeMinor: bigint;
  expeditedFeeMinor: bigint;
  totalChargedMinor: bigint;
}): {
  payout: Money;
  principal: Money;
  platformFee: Money;
  processingFee: Money;
  expeditedFee: Money;
  totalCharged: Money;
} {
  return {
    payout: fromMinor(quote.payoutAmountMinor, quote.payoutCurrency),
    principal: fromMinor(quote.principalMinor, quote.fundingCurrency),
    platformFee: fromMinor(quote.platformFeeMinor, quote.fundingCurrency),
    processingFee: fromMinor(quote.processingFeeMinor, quote.fundingCurrency),
    expeditedFee: fromMinor(quote.expeditedFeeMinor, quote.fundingCurrency),
    totalCharged: fromMinor(quote.totalChargedMinor, quote.fundingCurrency),
  };
}
