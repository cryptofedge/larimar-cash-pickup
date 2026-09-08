/**
 * Settlement arithmetic and lifecycle.
 *
 * Pure: no database, no clock beyond what is passed in.
 */

import { describe, expect, it } from 'vitest';
import {
  SETTLEMENT_TRANSITIONS,
  type SettlementPayout,
  type SettlementStatus,
  assertSettlementTransition,
  calculateSettlement,
  canTransitionSettlement,
  classifyFloat,
  previousSettlementPeriod,
  reconcile,
  settlementPeriod,
  toSettlementCsv,
} from '@/lib/domain/settlement';
import { toDecimal } from '@/lib/domain/money';
import { DomainError } from '@/lib/domain/errors';

function payout(amountMinor: bigint, id = crypto.randomUUID()): SettlementPayout {
  return {
    pickupEventId: id,
    transactionId: 'tx-1',
    transactionRef: 'LRM-TEST0001',
    locationId: 'loc-1',
    locationCode: 'CCD-PUJ-01',
    amountMinor,
    currency: 'DOP',
    disbursedAt: new Date('2026-06-01T14:30:00Z'),
  };
}

describe('settlement totals', () => {
  it('test_settlement_totals_sums_gross_payout_across_lines', () => {
    // Arrange
    const payouts = [payout(500_000n), payout(1_200_000n), payout(300_000n)];

    // Act
    const totals = calculateSettlement(payouts, { commissionBps: 0, currency: 'DOP' });

    // Assert
    expect(totals.payoutCount).toBe(3);
    expect(toDecimal(totals.grossPayout)).toBe('20000.00');
  });

  it('test_settlement_totals_applies_commission_on_the_aggregate_not_per_line', () => {
    // Arrange — three lines that each round differently in isolation.
    const payouts = [payout(33_333n), payout(33_333n), payout(33_334n)];

    // Act — 1.25% of 100,000 minor units is exactly 1,250.
    const totals = calculateSettlement(payouts, { commissionBps: 125, currency: 'DOP' });

    // Assert — rounding per line and summing would drift from the contractual
    // figure; the aggregate is what the agreement says.
    expect(totals.commission.amount).toBe(1_250n);
  });

  it('test_settlement_totals_rounds_commission_half_up', () => {
    // Arrange — 1 bps of 1,005 minor units is 0.1005, so half-up gives 0.
    const totals = calculateSettlement([payout(1_005n)], { commissionBps: 1, currency: 'DOP' });

    // Act / Assert
    expect(totals.commission.amount).toBe(0n);

    // And a case that rounds up: 50 bps of 1,005 = 5.025 -> 5.
    const rounded = calculateSettlement([payout(1_005n)], { commissionBps: 50, currency: 'DOP' });
    expect(rounded.commission.amount).toBe(5n);
  });

  it('test_settlement_totals_net_payable_is_gross_plus_commission', () => {
    // Arrange / Act
    const totals = calculateSettlement([payout(2_000_000n)], {
      commissionBps: 150,
      currency: 'DOP',
    });

    // Assert
    expect(totals.commission.amount).toBe(30_000n);
    expect(totals.netPayable.amount).toBe(2_030_000n);
    expect(totals.netPayable.amount).toBe(
      totals.grossPayout.amount + totals.commission.amount,
    );
  });

  it('test_settlement_totals_handles_an_empty_period', () => {
    // Arrange / Act — a day with no disbursements is legitimate.
    const totals = calculateSettlement([], { commissionBps: 150, currency: 'DOP' });

    // Assert
    expect(totals.payoutCount).toBe(0);
    expect(totals.grossPayout.amount).toBe(0n);
    expect(totals.commission.amount).toBe(0n);
    expect(totals.netPayable.amount).toBe(0n);
  });

  it('test_settlement_totals_rejects_a_currency_mismatch', () => {
    // Arrange
    const mixed = [payout(1_000n), { ...payout(1_000n), currency: 'USD' }];

    // Act / Assert
    expect(() => calculateSettlement(mixed, { commissionBps: 0, currency: 'DOP' })).toThrow(
      /settles in DOP/,
    );
  });

  it('test_settlement_totals_rejects_a_non_positive_payout', () => {
    // Arrange / Act / Assert
    expect(() =>
      calculateSettlement([payout(0n)], { commissionBps: 0, currency: 'DOP' }),
    ).toThrow(DomainError);
  });

  it('test_settlement_totals_rejects_a_negative_commission_rate', () => {
    // Arrange / Act / Assert
    expect(() =>
      calculateSettlement([payout(1_000n)], { commissionBps: -1, currency: 'DOP' }),
    ).toThrow(/non-negative/);
  });
});

describe('settlement lifecycle', () => {
  it('test_settlement_lifecycle_walks_the_expected_happy_path', () => {
    // Arrange
    const path: [SettlementStatus, SettlementStatus][] = [
      ['DRAFT', 'ISSUED'],
      ['ISSUED', 'RECONCILED'],
      ['RECONCILED', 'PAID'],
    ];

    // Act / Assert
    for (const [from, to] of path) {
      expect(canTransitionSettlement(from, to)).toBe(true);
    }
  });

  it('test_settlement_lifecycle_forbids_paying_before_reconciliation', () => {
    // Arrange / Act / Assert — money never leaves before both sides agree.
    expect(canTransitionSettlement('DRAFT', 'PAID')).toBe(false);
    expect(canTransitionSettlement('ISSUED', 'PAID')).toBe(false);
    expect(canTransitionSettlement('DISPUTED', 'PAID')).toBe(false);
    expect(() => assertSettlementTransition('ISSUED', 'PAID')).toThrow(DomainError);
  });

  it('test_settlement_lifecycle_reaches_paid_only_from_reconciled', () => {
    // Arrange
    const predecessors = (Object.keys(SETTLEMENT_TRANSITIONS) as SettlementStatus[]).filter(
      (status) => SETTLEMENT_TRANSITIONS[status].includes('PAID'),
    );

    // Act / Assert
    expect(predecessors).toEqual(['RECONCILED']);
  });

  it('test_settlement_lifecycle_makes_paid_and_cancelled_absorbing', () => {
    // Arrange / Act / Assert — a settled batch is never reopened.
    expect(SETTLEMENT_TRANSITIONS.PAID).toEqual([]);
    expect(SETTLEMENT_TRANSITIONS.CANCELLED).toEqual([]);
  });

  it('test_settlement_lifecycle_allows_reopening_a_dispute_after_reconciliation', () => {
    // Arrange / Act / Assert — a later discrepancy can still be raised.
    expect(canTransitionSettlement('RECONCILED', 'DISPUTED')).toBe(true);
    expect(canTransitionSettlement('DISPUTED', 'RECONCILED')).toBe(true);
  });

  it('test_settlement_lifecycle_never_targets_an_unknown_status', () => {
    // Arrange
    const known = Object.keys(SETTLEMENT_TRANSITIONS);

    // Act / Assert
    for (const status of known as SettlementStatus[]) {
      for (const target of SETTLEMENT_TRANSITIONS[status]) {
        expect(known).toContain(target);
      }
    }
  });
});

describe('reconciliation', () => {
  it('test_reconciliation_matches_on_an_exact_figure', () => {
    // Arrange / Act
    const result = reconcile({
      ourGrossMinor: 2_000_000n,
      partnerReportedMinor: 2_000_000n,
      currency: 'DOP',
    });

    // Assert
    expect(result.matched).toBe(true);
    expect(result.varianceMinor).toBe(0n);
  });

  it('test_reconciliation_flags_a_single_minor_unit_discrepancy', () => {
    // Arrange / Act — no tolerance band, deliberately.
    const result = reconcile({
      ourGrossMinor: 2_000_000n,
      partnerReportedMinor: 2_000_001n,
      currency: 'DOP',
    });

    // Assert — a one-centavo gap usually means a payout is missing from one
    // side's records; burying it under a threshold defers a bigger problem.
    expect(result.matched).toBe(false);
    expect(result.varianceMinor).toBe(1n);
    expect(result.summary).toMatch(/more/);
  });

  it('test_reconciliation_reports_direction_when_the_partner_claims_less', () => {
    // Arrange / Act
    const result = reconcile({
      ourGrossMinor: 2_000_000n,
      partnerReportedMinor: 1_999_000n,
      currency: 'DOP',
    });

    // Assert
    expect(result.varianceMinor).toBe(-1_000n);
    expect(result.summary).toMatch(/fewer/);
  });
});

describe('settlement periods', () => {
  it('test_settlement_periods_align_to_whole_utc_days', () => {
    // Arrange / Act
    const { periodStart, periodEnd } = settlementPeriod(new Date('2026-06-15T17:42:11Z'));

    // Assert
    expect(periodStart.toISOString()).toBe('2026-06-15T00:00:00.000Z');
    expect(periodEnd.toISOString()).toBe('2026-06-16T00:00:00.000Z');
  });

  it('test_settlement_periods_are_half_open_so_a_payout_belongs_to_one_period', () => {
    // Arrange
    const first = settlementPeriod(new Date('2026-06-15T12:00:00Z'));
    const second = settlementPeriod(new Date('2026-06-16T12:00:00Z'));

    // Act / Assert — the boundary instant starts the next period, never both.
    expect(first.periodEnd.getTime()).toBe(second.periodStart.getTime());
  });

  it('test_settlement_periods_previous_returns_yesterday', () => {
    // Arrange / Act
    const { periodStart } = previousSettlementPeriod(new Date('2026-06-16T03:00:00Z'));

    // Assert
    expect(periodStart.toISOString()).toBe('2026-06-15T00:00:00.000Z');
  });
});

describe('float classification', () => {
  const base = {
    locationId: 'loc-1',
    locationCode: 'CCD-PUJ-01',
    branchName: 'Punta Cana',
    city: 'Punta Cana',
    capacityMinor: 100_000_00n,
  };

  it.each([
    [0n, 'OK'],
    [6_900_000n, 'OK'],
    [7_000_000n, 'WATCH'],
    [8_999_999n, 'WATCH'],
    [9_000_000n, 'CRITICAL'],
    [9_999_999n, 'CRITICAL'],
    [10_000_000n, 'EXHAUSTED'],
    [20_000_000n, 'EXHAUSTED'],
  ] as const)('test_float_classification_of_used [%s %s]', (usedMinor, expected) => {
    // Arrange / Act
    const status = classifyFloat({ ...base, usedMinor });

    // Assert
    expect(status.level).toBe(expected);
  });

  it('test_float_classification_never_reports_negative_remaining', () => {
    // Arrange / Act — over-drawn capacity clamps rather than going negative.
    const status = classifyFloat({ ...base, usedMinor: 15_000_000n });

    // Assert
    expect(status.remainingMinor).toBe(0n);
  });

  it('test_float_classification_handles_zero_capacity_without_dividing_by_zero', () => {
    // Arrange / Act
    const status = classifyFloat({ ...base, capacityMinor: 0n, usedMinor: 0n });

    // Assert
    expect(status.utilisationPercent).toBe(0);
    expect(status.level).toBe('EXHAUSTED');
  });
});

describe('csv statement', () => {
  const totals = calculateSettlement([payout(2_000_000n, 'evt-1')], {
    commissionBps: 150,
    currency: 'DOP',
  });

  it('test_csv_statement_reports_amounts_as_integer_minor_units', () => {
    // Arrange / Act
    const csv = toSettlementCsv({
      reference: 'STL-TEST0001',
      institutionName: 'Casa de Cambio Demostración (DEMO)',
      periodStart: new Date('2026-06-01T00:00:00Z'),
      periodEnd: new Date('2026-06-02T00:00:00Z'),
      currency: 'DOP',
      totals,
      lines: [payout(2_000_000n, 'evt-1')],
    });

    // Assert — never a formatted decimal a spreadsheet could reinterpret.
    expect(csv).toContain('# GrossPayoutMinor,2000000');
    expect(csv).toContain('# CommissionMinor,30000');
    expect(csv).toContain('# NetPayableMinor,2030000');
    expect(csv).toContain('evt-1,LRM-TEST0001,CCD-PUJ-01,2000000,DOP,');
  });

  it('test_csv_statement_escapes_separators_in_partner_names', () => {
    // Arrange / Act
    const csv = toSettlementCsv({
      reference: 'STL-TEST0002',
      institutionName: 'Banco "Ejemplo", S.A.',
      periodStart: new Date('2026-06-01T00:00:00Z'),
      periodEnd: new Date('2026-06-02T00:00:00Z'),
      currency: 'DOP',
      totals,
      lines: [],
    });

    // Assert
    expect(csv).toContain('"Banco ""Ejemplo"", S.A."');
  });

  it('test_csv_statement_marks_itself_as_a_demonstration', () => {
    // Arrange / Act
    const csv = toSettlementCsv({
      reference: 'STL-TEST0003',
      institutionName: 'Demo',
      periodStart: new Date('2026-06-01T00:00:00Z'),
      periodEnd: new Date('2026-06-02T00:00:00Z'),
      currency: 'DOP',
      totals,
      lines: [],
    });

    // Assert — a statement that leaves the system must say what it is.
    expect(csv).toMatch(/DEMONSTRATION ONLY/);
  });
});
