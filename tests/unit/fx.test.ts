import { describe, expect, it } from 'vitest';
import {
  RATE_SCALE,
  applySpread,
  buildRate,
  convert,
  convertInverse,
  formatRate,
  hasDriftedBeyondTolerance,
  invertRate,
  isRateExpired,
  parseRate,
  rateDriftBps,
} from '@/lib/domain/fx';
import { fromDecimal, money, toDecimal } from '@/lib/domain/money';
import { DomainError } from '@/lib/domain/errors';

const USD_DOP = parseRate('60.25');

describe('rate parsing and formatting', () => {
  it('test_rate_parsing_and_formatting_scales_a_decimal_rate_to_1e8', () => {
    expect(parseRate('60.25')).toBe(6_025_000_000n);
    expect(parseRate('1')).toBe(100_000_000n);
    expect(parseRate('0.01660000')).toBe(1_660_000n);
  });

  it('test_rate_parsing_and_formatting_rejects_excess_precision_rather_than_truncating_silently', () => {
    expect(() => parseRate('60.123456789')).toThrow(/precision/);
  });

  it('test_rate_parsing_and_formatting_rejects_negatives_and_garbage', () => {
    expect(() => parseRate('-1')).toThrow(DomainError);
    expect(() => parseRate('abc')).toThrow(DomainError);
  });

  it('test_rate_parsing_and_formatting_formats_with_rounding_not_truncation', () => {
    expect(formatRate(parseRate('60.25'), 4)).toBe('60.2500');
    expect(formatRate(parseRate('60.256789'), 4)).toBe('60.2568');
    expect(formatRate(parseRate('60.25'), 2)).toBe('60.25');
  });

  it('test_rate_parsing_and_formatting_carries_correctly_when_rounding_pushes_the_fraction_over', () => {
    expect(formatRate(parseRate('59.99999'), 4)).toBe('60.0000');
  });
});

describe('spread application', () => {
  it('test_spread_application_moves_the_rate_against_the_customer', () => {
    const effective = applySpread(USD_DOP, 75); // 0.75%
    expect(effective).toBeLessThan(USD_DOP);
    expect(formatRate(effective, 4)).toBe('59.7981');
  });

  it('test_spread_application_is_a_no_op_at_zero_spread', () => {
    expect(applySpread(USD_DOP, 0)).toBe(USD_DOP);
  });

  it('test_spread_application_rejects_out_of_range_spreads', () => {
    expect(() => applySpread(USD_DOP, -1)).toThrow(DomainError);
    expect(() => applySpread(USD_DOP, 10_000)).toThrow(DomainError);
    expect(() => applySpread(USD_DOP, 1.5)).toThrow(DomainError);
  });

  it('test_spread_application_rejects_a_non_positive_mid_rate', () => {
    expect(() => applySpread(0n, 75)).toThrow(DomainError);
  });
});

describe('conversion', () => {
  it('test_conversion_converts_usd_to_dop', () => {
    const result = convert(fromDecimal('100.00', 'USD'), 'DOP', USD_DOP);
    expect(toDecimal(result)).toBe('6025.00');
  });

  it('test_conversion_reconciles_differing_currency_exponents_usd_2dp_jpy_0dp', () => {
    // 1 USD = 150 JPY; $10.00 -> 1500 JPY
    const result = convert(fromDecimal('10.00', 'USD'), 'JPY', parseRate('150'));
    expect(toDecimal(result)).toBe('1500');
  });

  it('test_conversion_reconciles_the_other_direction_jpy_0dp_usd_2dp', () => {
    // 1 JPY = 0.00666667 USD; 1500 JPY -> $10.00
    const result = convert(fromDecimal('1500', 'JPY'), 'USD', parseRate('0.00666667'));
    expect(toDecimal(result)).toBe('10.00');
  });

  it('test_conversion_rejects_a_non_positive_rate', () => {
    expect(() => convert(money(100n, 'USD'), 'DOP', 0n)).toThrow(DomainError);
  });
});

describe('convertInverse — the funding calculation', () => {
  it('test_convertinverse_the_funding_calculation_computes_the_usd_needed_to_deliver_an_exact_dop_payout', () => {
    const effective = applySpread(USD_DOP, 75);
    const needed = convertInverse(fromDecimal('20000', 'DOP'), 'USD', effective);
    expect(toDecimal(needed)).toBe('334.46');
  });

  it('test_convertinverse_the_funding_calculation_rounds_up_by_default_so_the_platform_is_never_short_of_the_promised_payout', () => {
    // A rate chosen so the division does not resolve evenly.
    const rate = parseRate('3');
    const needed = convertInverse(fromDecimal('10.00', 'DOP'), 'USD', rate);
    // 1000 / 3 = 333.33 -> must be 334 minor units, not 333.
    expect(needed.amount).toBe(334n);
  });

  it('test_convertinverse_the_funding_calculation_always_funds_at_least_the_payout_it_promises_across_many_amounts', () => {
    const effective = applySpread(USD_DOP, 75);
    for (let dop = 100; dop <= 5000; dop += 137) {
      const payout = fromDecimal(String(dop), 'DOP');
      const funding = convertInverse(payout, 'USD', effective);
      const delivered = convert(funding, 'DOP', effective, 'FLOOR');
      expect(delivered.amount).toBeGreaterThanOrEqual(payout.amount);
    }
  });

  it('test_convertinverse_the_funding_calculation_handles_exponent_shifts_in_reverse', () => {
    const needed = convertInverse(fromDecimal('1500', 'JPY'), 'USD', parseRate('150'));
    expect(toDecimal(needed)).toBe('10.00');
  });
});

describe('rate inversion', () => {
  it('test_rate_inversion_round_trips_within_rounding_tolerance', () => {
    const inverted = invertRate(USD_DOP);
    const back = invertRate(inverted);
    const delta = back > USD_DOP ? back - USD_DOP : USD_DOP - back;
    expect(delta).toBeLessThan(1000n); // sub-0.00001 of a unit
  });

  it('test_rate_inversion_rejects_a_non_positive_rate', () => {
    expect(() => invertRate(0n)).toThrow(DomainError);
  });
});

describe('drift detection', () => {
  it('test_drift_detection_reports_zero_drift_for_an_unchanged_rate', () => {
    expect(rateDriftBps(USD_DOP, USD_DOP)).toBe(0);
  });

  it('test_drift_detection_measures_drift_symmetrically', () => {
    const up = parseRate('60.85'); // ~ +1%
    expect(rateDriftBps(USD_DOP, up)).toBe(100);
    const down = parseRate('59.65');
    expect(rateDriftBps(USD_DOP, down)).toBe(100);
  });

  it('test_drift_detection_gates_on_tolerance', () => {
    const moved = parseRate('60.55'); // ~50 bps
    expect(hasDriftedBeyondTolerance(USD_DOP, moved, 50)).toBe(false);
    expect(hasDriftedBeyondTolerance(USD_DOP, moved, 10)).toBe(true);
  });
});

describe('rate freshness', () => {
  const fetchedAt = new Date('2026-01-01T00:00:00Z');

  it('test_rate_freshness_builds_a_rate_with_the_effective_value_derived_not_supplied', () => {
    const rate = buildRate({
      base: 'USD',
      quote: 'DOP',
      midRate: USD_DOP,
      spreadBps: 75,
      source: 'test',
      fetchedAt,
      ttlSeconds: 900,
    });
    expect(rate.effectiveRate).toBe(applySpread(USD_DOP, 75));
    expect(rate.expiresAt.getTime()).toBe(fetchedAt.getTime() + 900_000);
  });

  it('test_rate_freshness_expires_exactly_at_the_boundary', () => {
    const rate = buildRate({
      base: 'USD',
      quote: 'DOP',
      midRate: USD_DOP,
      spreadBps: 0,
      source: 'test',
      fetchedAt,
      ttlSeconds: 60,
    });
    expect(isRateExpired(rate, new Date(fetchedAt.getTime() + 59_999))).toBe(false);
    expect(isRateExpired(rate, new Date(fetchedAt.getTime() + 60_000))).toBe(true);
  });
});

describe('scale constant', () => {
  it('test_scale_constant_is_1e8_changing_it_would_silently_reprice_every_historical_quote', () => {
    expect(RATE_SCALE).toBe(100_000_000n);
  });
});
