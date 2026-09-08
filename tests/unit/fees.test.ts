import { describe, expect, it } from 'vitest';
import { calculateQuote, effectiveCostBps, verifyQuoteIntegrity, type FeeScheduleConfig } from '@/lib/domain/fees';
import { applySpread, convert, parseRate } from '@/lib/domain/fx';
import { fromDecimal, toDecimal } from '@/lib/domain/money';
import { DomainError } from '@/lib/domain/errors';

const SCHEDULE: FeeScheduleConfig = {
  id: 'fs-1',
  key: 'do-standard',
  version: 1,
  countryCode: 'DO',
  platformFeeBps: 150, // 1.50%
  platformFeeMinMinor: 299n, // $2.99
  platformFeeMaxMinor: null,
  fxSpreadBps: 75, // 0.75%
  processingFeeBps: 290, // 2.90%
  processingFeeFixedMinor: 30n, // $0.30
  expeditedFeeMinor: 499n,
  feeCurrency: 'USD',
};

const MID = parseRate('60.25');

describe('the headline quote — RD$20,000 from USD', () => {
  const quote = calculateQuote({
    payoutAmount: fromDecimal('20000', 'DOP'),
    fundingCurrency: 'USD',
    midRate: MID,
    schedule: SCHEDULE,
  });

  it('test_the_headline_quote_rd_20_000_from_usd_delivers_exactly_the_requested_payout', () => {
    expect(toDecimal(quote.payoutAmount)).toBe('20000.00');
  });

  it('test_the_headline_quote_rd_20_000_from_usd_itemises_every_component', () => {
    expect(toDecimal(quote.principal)).toBe('334.46');
    expect(toDecimal(quote.platformFee)).toBe('5.02');
    expect(toDecimal(quote.processingFee)).toBe('10.14');
    expect(toDecimal(quote.expeditedFee)).toBe('0.00');
    expect(toDecimal(quote.totalCharged)).toBe('349.62');
  });

  it('test_the_headline_quote_rd_20_000_from_usd_sums_components_to_exactly_the_total_charged', () => {
    const parts =
      quote.principal.amount +
      quote.platformFee.amount +
      quote.processingFee.amount +
      quote.expeditedFee.amount;
    expect(parts).toBe(quote.totalCharged.amount);
  });

  it('test_the_headline_quote_rd_20_000_from_usd_derives_the_effective_rate_from_the_mid_rate_and_spread', () => {
    expect(quote.effectiveRate).toBe(applySpread(MID, 75));
    expect(quote.effectiveRate).toBeLessThan(quote.midRate);
  });

  it('test_the_headline_quote_rd_20_000_from_usd_discloses_the_spread_as_a_cost_rather_than_burying_it', () => {
    expect(quote.fxSpreadCost.amount).toBeGreaterThan(0n);
    // $334.46 funded at our rate vs $331.96 at mid-market.
    expect(toDecimal(quote.fxSpreadCost)).toBe('2.50');
  });

  it('test_the_headline_quote_rd_20_000_from_usd_reports_the_all_in_cost_as_fees_plus_spread', () => {
    const expected =
      quote.platformFee.amount + quote.processingFee.amount + quote.fxSpreadCost.amount;
    expect(quote.totalCost.amount).toBe(expected);
  });

  it('test_the_headline_quote_rd_20_000_from_usd_funds_at_least_the_promised_payout', () => {
    const delivered = convert(quote.principal, 'DOP', quote.effectiveRate, 'FLOOR');
    expect(delivered.amount).toBeGreaterThanOrEqual(quote.payoutAmount.amount);
  });

  it('test_the_headline_quote_rd_20_000_from_usd_passes_its_own_integrity_check', () => {
    expect(verifyQuoteIntegrity(quote)).toEqual({ valid: true });
  });

  it('test_the_headline_quote_rd_20_000_from_usd_pins_the_fee_schedule_version_that_priced_it', () => {
    expect(quote.feeScheduleId).toBe('fs-1');
    expect(quote.feeScheduleVersion).toBe(1);
  });
});

describe('fee floors and ceilings', () => {
  it('test_fee_floors_and_ceilings_applies_the_minimum_platform_fee_on_small_amounts', () => {
    // RD$500 -> ~$8.36 principal; 1.5% = $0.13, below the $2.99 floor.
    const quote = calculateQuote({
      payoutAmount: fromDecimal('500', 'DOP'),
      fundingCurrency: 'USD',
      midRate: MID,
      schedule: SCHEDULE,
    });
    expect(toDecimal(quote.platformFee)).toBe('2.99');
  });

  it('test_fee_floors_and_ceilings_applies_a_maximum_platform_fee_when_configured', () => {
    const capped = { ...SCHEDULE, platformFeeMaxMinor: 1000n }; // $10.00
    const quote = calculateQuote({
      payoutAmount: fromDecimal('200000', 'DOP'),
      fundingCurrency: 'USD',
      midRate: MID,
      schedule: capped,
    });
    expect(toDecimal(quote.platformFee)).toBe('10.00');
  });

  it('test_fee_floors_and_ceilings_charges_the_processing_fee_on_principal_plus_platform_fee_not_principal_alone', () => {
    const quote = calculateQuote({
      payoutAmount: fromDecimal('20000', 'DOP'),
      fundingCurrency: 'USD',
      midRate: MID,
      schedule: SCHEDULE,
    });
    const base = quote.principal.amount + quote.platformFee.amount;
    const expected = (base * 290n + 5000n) / 10_000n + 30n; // half-up + fixed
    expect(quote.processingFee.amount).toBe(expected);
  });
});

describe('expedited pickup', () => {
  it('test_expedited_pickup_is_excluded_by_default', () => {
    const quote = calculateQuote({
      payoutAmount: fromDecimal('20000', 'DOP'),
      fundingCurrency: 'USD',
      midRate: MID,
      schedule: SCHEDULE,
    });
    expect(quote.expeditedFee.amount).toBe(0n);
  });

  it('test_expedited_pickup_adds_a_flat_fee_when_requested', () => {
    const quote = calculateQuote({
      payoutAmount: fromDecimal('20000', 'DOP'),
      fundingCurrency: 'USD',
      midRate: MID,
      schedule: SCHEDULE,
      expedited: true,
    });
    expect(toDecimal(quote.expeditedFee)).toBe('4.99');
    expect(toDecimal(quote.totalCharged)).toBe('354.61');
  });
});

describe('zero-fee configuration', () => {
  it('test_zero_fee_configuration_produces_a_total_equal_to_the_principal', () => {
    const free: FeeScheduleConfig = {
      ...SCHEDULE,
      platformFeeBps: 0,
      platformFeeMinMinor: 0n,
      fxSpreadBps: 0,
      processingFeeBps: 0,
      processingFeeFixedMinor: 0n,
    };
    const quote = calculateQuote({
      payoutAmount: fromDecimal('20000', 'DOP'),
      fundingCurrency: 'USD',
      midRate: MID,
      schedule: free,
    });
    expect(quote.totalCharged.amount).toBe(quote.principal.amount);
    expect(quote.effectiveRate).toBe(quote.midRate);
    expect(quote.fxSpreadCost.amount).toBe(0n);
  });
});

describe('input validation', () => {
  it('test_input_validation_rejects_a_non_positive_payout', () => {
    expect(() =>
      calculateQuote({
        payoutAmount: fromDecimal('0', 'DOP'),
        fundingCurrency: 'USD',
        midRate: MID,
        schedule: SCHEDULE,
      }),
    ).toThrow(DomainError);
  });

  it('test_input_validation_rejects_a_non_positive_rate', () => {
    expect(() =>
      calculateQuote({
        payoutAmount: fromDecimal('100', 'DOP'),
        fundingCurrency: 'USD',
        midRate: 0n,
        schedule: SCHEDULE,
      }),
    ).toThrow(/positive/);
  });

  it('test_input_validation_rejects_a_schedule_denominated_in_a_different_currency_than_the_funding', () => {
    expect(() =>
      calculateQuote({
        payoutAmount: fromDecimal('100', 'DOP'),
        fundingCurrency: 'EUR',
        midRate: MID,
        schedule: SCHEDULE,
      }),
    ).toThrow(/Fee schedule is denominated/);
  });
});

describe('pricing is monotonic — more pesos never costs less', () => {
  it('test_pricing_is_monotonic_more_pesos_never_costs_less_increases_the_total_charged_as_the_payout_increases', () => {
    let previous = 0n;
    for (let dop = 1000; dop <= 100_000; dop += 4321) {
      const quote = calculateQuote({
        payoutAmount: fromDecimal(String(dop), 'DOP'),
        fundingCurrency: 'USD',
        midRate: MID,
        schedule: SCHEDULE,
      });
      expect(quote.totalCharged.amount).toBeGreaterThan(previous);
      previous = quote.totalCharged.amount;
    }
  });

  it('test_pricing_is_monotonic_more_pesos_never_costs_less_always_funds_the_promised_payout_across_the_range', () => {
    for (let dop = 100; dop <= 50_000; dop += 997) {
      const quote = calculateQuote({
        payoutAmount: fromDecimal(String(dop), 'DOP'),
        fundingCurrency: 'USD',
        midRate: MID,
        schedule: SCHEDULE,
      });
      const delivered = convert(quote.principal, 'DOP', quote.effectiveRate, 'FLOOR');
      expect(delivered.amount).toBeGreaterThanOrEqual(quote.payoutAmount.amount);
      expect(verifyQuoteIntegrity(quote).valid).toBe(true);
    }
  });
});

describe('effective cost disclosure', () => {
  it('test_effective_cost_disclosure_expresses_the_all_in_cost_in_basis_points_of_the_mid_market_value', () => {
    const quote = calculateQuote({
      payoutAmount: fromDecimal('20000', 'DOP'),
      fundingCurrency: 'USD',
      midRate: MID,
      schedule: SCHEDULE,
    });
    const bps = effectiveCostBps(quote);
    // ~1.5% platform + ~2.9% processing + 0.75% spread on a $332 principal.
    expect(bps).toBeGreaterThan(400);
    expect(bps).toBeLessThan(700);
  });
});

describe('integrity checking catches tampering', () => {
  const good = calculateQuote({
    payoutAmount: fromDecimal('20000', 'DOP'),
    fundingCurrency: 'USD',
    midRate: MID,
    schedule: SCHEDULE,
  });

  it('test_integrity_checking_catches_tampering_detects_a_total_that_does_not_match_its_components', () => {
    const tampered = { ...good, totalCharged: fromDecimal('1.00', 'USD') };
    const result = verifyQuoteIntegrity(tampered);
    expect(result.valid).toBe(false);
  });

  it('test_integrity_checking_catches_tampering_detects_an_effective_rate_inconsistent_with_the_mid_rate_and_spread', () => {
    const tampered = { ...good, effectiveRate: good.midRate };
    const result = verifyQuoteIntegrity(tampered);
    expect(result.valid).toBe(false);
  });

  it('test_integrity_checking_catches_tampering_detects_a_principal_too_small_to_fund_the_promised_payout', () => {
    const tampered = {
      ...good,
      principal: fromDecimal('1.00', 'USD'),
      totalCharged: fromDecimal('1.00', 'USD'),
      platformFee: fromDecimal('0', 'USD'),
      processingFee: fromDecimal('0', 'USD'),
      expeditedFee: fromDecimal('0', 'USD'),
    };
    const result = verifyQuoteIntegrity(tampered);
    expect(result.valid).toBe(false);
    if (!result.valid) expect(result.reason).toMatch(/funds only/);
  });
});
