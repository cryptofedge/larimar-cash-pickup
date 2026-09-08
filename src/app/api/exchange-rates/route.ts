import { defineRoute, jsonOk } from '@/server/http/api';
import { RATE_LIMITS } from '@/server/http/rate-limit';
import { quoteRequestSchema } from '@/lib/validation/schemas';
import { priceQuote, getActiveFeeSchedule } from '@/server/services/pricing';
import { getExchangeRateProvider } from '@/server/providers/exchange-rate';
import { formatRate } from '@/lib/domain/fx';
import { getCountry } from '@/lib/domain/countries';
import { env } from '@/server/env';

export const runtime = 'nodejs';

/**
 * The current rate for a corridor. Public — a traveler must be able to check the
 * price before creating an account.
 */
export const GET = defineRoute(
  { permission: null, rateLimit: RATE_LIMITS.quote },
  async ({ req }) => {
    const url = new URL(req.url);
    const base = (url.searchParams.get('base') ?? 'USD').toUpperCase();
    const countryCode = (url.searchParams.get('country') ?? env.DEFAULT_COUNTRY).toUpperCase();
    const country = getCountry(countryCode);

    const schedule = await getActiveFeeSchedule(country.code);
    const rate = await getExchangeRateProvider().getRate(base, country.payoutCurrency, {
      spreadBps: schedule.fxSpreadBps,
    });

    return jsonOk({
      base: rate.base,
      quote: rate.quote,
      midRate: formatRate(rate.midRate, 4),
      effectiveRate: formatRate(rate.effectiveRate, 4),
      spreadBps: rate.spreadBps,
      source: rate.source,
      fetchedAt: rate.fetchedAt,
      expiresAt: rate.expiresAt,
      // Stated on every response so a demo rate can never be mistaken for market data.
      isDemoRate: env.EXCHANGE_RATE_PROVIDER === 'mock',
    });
  },
);

/**
 * Price a specific amount. Server-computed and not persisted — the public
 * calculator must not be able to create database rows.
 */
export const POST = defineRoute(
  { permission: null, schema: quoteRequestSchema, rateLimit: RATE_LIMITS.quote },
  async ({ body }) => {
    const priced = await priceQuote({
      payoutAmountMinor: BigInt(body.payoutAmountMinor),
      payoutCurrency: body.payoutCurrency,
      fundingCurrency: body.fundingCurrency,
      countryCode: body.countryCode,
      expedited: body.expedited,
    });

    const b = priced.breakdown;

    return jsonOk({
      payoutAmountMinor: b.payoutAmount.amount,
      payoutCurrency: b.payoutAmount.currency,
      principalMinor: b.principal.amount,
      platformFeeMinor: b.platformFee.amount,
      processingFeeMinor: b.processingFee.amount,
      expeditedFeeMinor: b.expeditedFee.amount,
      totalChargedMinor: b.totalCharged.amount,
      fundingCurrency: b.principal.currency,
      fxSpreadCostMinor: b.fxSpreadCost.amount,
      totalCostMinor: b.totalCost.amount,
      midRate: formatRate(b.midRate, 4),
      effectiveRate: formatRate(b.effectiveRate, 4),
      fxSpreadBps: b.fxSpreadBps,
      expiresAt: priced.expiresAt,
      rateSource: priced.rateSource,
      isDemoRate: env.EXCHANGE_RATE_PROVIDER === 'mock',
    });
  },
);
