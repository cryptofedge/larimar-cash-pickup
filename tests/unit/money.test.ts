import { describe, expect, it } from 'vitest';
import {
  add,
  allocateByRatio,
  allocateEvenly,
  compare,
  divideRounded,
  formatMoney,
  fromDecimal,
  money,
  multiplyBps,
  subtract,
  sum,
  toDecimal,
  zero,
} from '@/lib/domain/money';
import { DomainError } from '@/lib/domain/errors';

describe('money construction', () => {
  it('test_money_construction_builds_from_minor_units', () => {
    const m = money(2_000_000n, 'DOP');
    expect(m.amount).toBe(2_000_000n);
    expect(m.currency).toBe('DOP');
  });

  it('test_money_construction_uppercases_the_currency_code', () => {
    expect(money(100n, 'usd').currency).toBe('USD');
  });

  it('test_money_construction_rejects_unknown_currencies', () => {
    expect(() => money(100n, 'XYZ')).toThrow(DomainError);
  });

  it('test_money_construction_rejects_non_integer_numbers_which_are_the_classic_float_bug', () => {
    expect(() => money(10.5, 'USD')).toThrow(/must be integers/);
  });

  it('test_money_construction_freezes_the_value_so_it_cannot_be_mutated_downstream', () => {
    const m = money(100n, 'USD');
    expect(Object.isFrozen(m)).toBe(true);
  });
});

describe('decimal parsing', () => {
  it.each([
    ['20000', 'DOP', 2_000_000n],
    ['342.11', 'USD', 34_211n],
    ['0.01', 'USD', 1n],
    ['1', 'USD', 100n],
    ['.5', 'USD', 50n],
    ['-1.50', 'USD', -150n],
    ['20,000.00', 'DOP', 2_000_000n],
  ])('parses "%s" %s to %s minor units', (input, currency, expected) => {
    expect(fromDecimal(input, currency).amount).toBe(expected);
  });

  it('test_decimal_parsing_handles_zero_exponent_currencies', () => {
    expect(fromDecimal('1500', 'JPY').amount).toBe(1500n);
  });

  it('test_decimal_parsing_rejects_excess_precision_instead_of_silently_rounding_it_away', () => {
    expect(() => fromDecimal('1.005', 'USD')).toThrow(/decimal place/);
  });

  it('test_decimal_parsing_rejects_garbage', () => {
    expect(() => fromDecimal('abc', 'USD')).toThrow(DomainError);
    expect(() => fromDecimal('', 'USD')).toThrow(DomainError);
  });

  it('test_decimal_parsing_round_trips_through_todecimal', () => {
    for (const input of ['0.00', '1.00', '342.11', '99999.99', '-5.25']) {
      expect(toDecimal(fromDecimal(input, 'USD'))).toBe(input);
    }
  });
});

describe('arithmetic', () => {
  it('test_arithmetic_adds_and_subtracts', () => {
    const a = fromDecimal('10.00', 'USD');
    const b = fromDecimal('2.50', 'USD');
    expect(toDecimal(add(a, b))).toBe('12.50');
    expect(toDecimal(subtract(a, b))).toBe('7.50');
  });

  it('test_arithmetic_refuses_to_mix_currencies', () => {
    expect(() => add(money(100n, 'USD'), money(100n, 'DOP'))).toThrow(/Cannot combine/);
  });

  it('test_arithmetic_sums_a_list', () => {
    const values = [fromDecimal('1.11', 'USD'), fromDecimal('2.22', 'USD'), fromDecimal('3.33', 'USD')];
    expect(toDecimal(sum(values, 'USD'))).toBe('6.66');
  });

  it('test_arithmetic_sums_an_empty_list_to_zero', () => {
    expect(sum([], 'USD').amount).toBe(0n);
  });

  it('test_arithmetic_orders_values', () => {
    expect(compare(money(1n, 'USD'), money(2n, 'USD'))).toBe(-1);
    expect(compare(money(2n, 'USD'), money(2n, 'USD'))).toBe(0);
    expect(compare(money(3n, 'USD'), money(2n, 'USD'))).toBe(1);
  });

  it('test_arithmetic_does_not_suffer_the_0_1_0_2_float_defect', () => {
    const result = add(fromDecimal('0.1', 'USD'), fromDecimal('0.2', 'USD'));
    expect(toDecimal(result)).toBe('0.30');
    // The value this whole design exists to avoid:
    expect(0.1 + 0.2).not.toBe(0.3);
  });
});

describe('divideRounded', () => {
  it.each([
    [10n, 3n, 'HALF_UP', 3n],
    [11n, 3n, 'HALF_UP', 4n],
    [5n, 2n, 'HALF_UP', 3n],
    [5n, 2n, 'HALF_EVEN', 2n],
    [7n, 2n, 'HALF_EVEN', 4n],
    [5n, 2n, 'CEIL', 3n],
    [5n, 2n, 'FLOOR', 2n],
    [5n, 2n, 'TRUNCATE', 2n],
    [-5n, 2n, 'CEIL', -2n],
    [-5n, 2n, 'FLOOR', -3n],
    [-5n, 2n, 'TRUNCATE', -2n],
    [-5n, 2n, 'HALF_UP', -3n],
    [10n, 5n, 'HALF_UP', 2n],
  ] as const)('%s / %s (%s) = %s', (n, d, mode, expected) => {
    expect(divideRounded(n, d, mode)).toBe(expected);
  });

  it('test_dividerounded_rejects_division_by_zero', () => {
    expect(() => divideRounded(1n, 0n)).toThrow(/Division by zero/);
  });
});

describe('multiplyBps', () => {
  it('test_multiplybps_applies_1_50_correctly', () => {
    // $326.61 * 1.50% = $4.899... -> $4.90 half-up
    expect(toDecimal(multiplyBps(fromDecimal('326.61', 'USD'), 150))).toBe('4.90');
  });

  it('test_multiplybps_handles_zero_bps', () => {
    expect(multiplyBps(fromDecimal('100.00', 'USD'), 0).amount).toBe(0n);
  });

  it('test_multiplybps_handles_100_10000_bps', () => {
    expect(toDecimal(multiplyBps(fromDecimal('100.00', 'USD'), 10_000))).toBe('100.00');
  });

  it('test_multiplybps_rejects_fractional_basis_points', () => {
    expect(() => multiplyBps(money(100n, 'USD'), 1.5)).toThrow(/integer/);
  });
});

describe('allocation preserves the total exactly', () => {
  it('test_allocation_preserves_the_total_exactly_splits_rd_100_three_ways_without_losing_a_centavo', () => {
    const parts = allocateEvenly(fromDecimal('100.00', 'DOP'), 3);
    expect(parts.map(toDecimal)).toEqual(['33.34', '33.33', '33.33']);
    expect(sum(parts, 'DOP').amount).toBe(fromDecimal('100.00', 'DOP').amount);
  });

  it('test_allocation_preserves_the_total_exactly_splits_an_exact_multiple_evenly', () => {
    const parts = allocateEvenly(fromDecimal('90.00', 'USD'), 3);
    expect(parts.map(toDecimal)).toEqual(['30.00', '30.00', '30.00']);
  });

  it('test_allocation_preserves_the_total_exactly_handles_negative_totals_without_leaking_units', () => {
    const parts = allocateEvenly(fromDecimal('-100.00', 'USD'), 3);
    expect(sum(parts, 'USD').amount).toBe(-10_000n);
  });

  it('test_allocation_preserves_the_total_exactly_allocates_by_weight_preserving_the_total', () => {
    const parts = allocateByRatio(fromDecimal('100.00', 'USD'), [1, 1, 1]);
    expect(sum(parts, 'USD').amount).toBe(10_000n);

    const uneven = allocateByRatio(fromDecimal('10.00', 'USD'), [70, 20, 10]);
    expect(uneven.map(toDecimal)).toEqual(['7.00', '2.00', '1.00']);
    expect(sum(uneven, 'USD').amount).toBe(1000n);
  });

  it('test_allocation_preserves_the_total_exactly_never_loses_a_unit_across_many_random_splits', () => {
    for (let total = 1; total <= 200; total += 7) {
      for (let parts = 1; parts <= 9; parts += 1) {
        const value = money(BigInt(total), 'USD');
        expect(sum(allocateEvenly(value, parts), 'USD').amount).toBe(BigInt(total));
      }
    }
  });

  it('test_allocation_preserves_the_total_exactly_rejects_nonsense_inputs', () => {
    expect(() => allocateEvenly(money(100n, 'USD'), 0)).toThrow(DomainError);
    expect(() => allocateByRatio(money(100n, 'USD'), [])).toThrow(DomainError);
    expect(() => allocateByRatio(money(100n, 'USD'), [0, 0])).toThrow(/sum to zero/);
  });
});

describe('formatting', () => {
  it('test_formatting_renders_dop_the_way_it_is_written_in_the_dominican_republic', () => {
    expect(formatMoney(fromDecimal('20000', 'DOP'), 'en-US')).toBe('RD$20,000.00');
    expect(formatMoney(fromDecimal('20000', 'DOP'), 'es-DO')).toBe('RD$20,000.00');
  });

  it('test_formatting_renders_usd', () => {
    expect(formatMoney(fromDecimal('342.11', 'USD'), 'en-US')).toBe('$342.11');
  });

  it('test_formatting_renders_negatives_with_the_sign_outside_the_symbol', () => {
    expect(formatMoney(fromDecimal('-5.00', 'USD'), 'en-US')).toBe('-$5.00');
  });

  it('test_formatting_can_append_the_iso_code_for_disambiguation', () => {
    expect(formatMoney(fromDecimal('10.00', 'USD'), 'en-US', { showCode: true })).toBe('$10.00 USD');
  });

  it('test_formatting_formats_zero', () => {
    expect(formatMoney(zero('USD'), 'en-US')).toBe('$0.00');
  });
});
