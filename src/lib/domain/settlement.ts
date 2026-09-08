/**
 * Settlement arithmetic.
 *
 * When a partner hands over pesos, the platform owes them that cash back plus an
 * agreed commission. Settlement is the periodic act of totalling those
 * obligations, agreeing them with the partner, and paying.
 *
 * The lifecycle is deliberately explicit. "We think we owe you this", "you agree
 * we owe you this", and "we have actually paid you" are three separate facts, and
 * collapsing them into one boolean is how settlement disputes become unresolvable.
 *
 * Pure module — no I/O, no clock beyond what is passed in.
 */

import { DomainError } from './errors';
import { type CurrencyCode, type Money, add, divideRounded, fromMinor, money } from './money';

export type SettlementStatus =
  | 'DRAFT'
  | 'ISSUED'
  | 'RECONCILED'
  | 'PAID'
  | 'DISPUTED'
  | 'CANCELLED';

/**
 * Legal status transitions.
 *
 * Same principle as the transaction state machine: the graph is data so it can
 * be asserted exhaustively. The property that matters most is that **PAID is
 * only reachable from RECONCILED** — money never leaves before both sides agree
 * the figure.
 */
export const SETTLEMENT_TRANSITIONS: Readonly<Record<SettlementStatus, readonly SettlementStatus[]>> =
  Object.freeze({
    DRAFT: Object.freeze(['ISSUED', 'CANCELLED'] as const),
    ISSUED: Object.freeze(['RECONCILED', 'DISPUTED', 'CANCELLED'] as const),
    // A dispute can be reopened from RECONCILED if a later discrepancy surfaces.
    RECONCILED: Object.freeze(['PAID', 'DISPUTED'] as const),
    DISPUTED: Object.freeze(['RECONCILED', 'CANCELLED'] as const),
    PAID: Object.freeze([] as const),
    CANCELLED: Object.freeze([] as const),
  });

export function canTransitionSettlement(from: SettlementStatus, to: SettlementStatus): boolean {
  return SETTLEMENT_TRANSITIONS[from].includes(to);
}

export function assertSettlementTransition(from: SettlementStatus, to: SettlementStatus): void {
  if (!canTransitionSettlement(from, to)) {
    throw new DomainError(
      'CONFLICT',
      `Settlement cannot move from ${from} to ${to}`,
      { from, to },
    );
  }
}

export interface SettlementPayout {
  readonly pickupEventId: string;
  readonly transactionId: string | null;
  readonly transactionRef: string | null;
  readonly locationId: string | null;
  readonly locationCode: string | null;
  readonly amountMinor: bigint;
  readonly currency: CurrencyCode;
  readonly disbursedAt: Date;
}

export interface SettlementTotals {
  readonly payoutCount: number;
  readonly grossPayout: Money;
  readonly commissionBps: number;
  readonly commission: Money;
  /** gross + commission — what is actually transferred to the partner. */
  readonly netPayable: Money;
}

/**
 * Total a set of disbursements and apply the partner's commission.
 *
 * Commission rounds HALF_UP on the aggregate, not per payout. Rounding each line
 * and summing would drift from the contractual figure by up to half a minor unit
 * per payout — invisible at ten transactions and a genuine reconciliation
 * argument at ten thousand.
 */
export function calculateSettlement(
  payouts: readonly SettlementPayout[],
  input: { commissionBps: number; currency: CurrencyCode },
): SettlementTotals {
  if (!Number.isInteger(input.commissionBps) || input.commissionBps < 0) {
    throw new DomainError(
      'INVALID_BPS',
      `Commission must be a non-negative integer in basis points; got ${input.commissionBps}`,
    );
  }

  const currency = input.currency.toUpperCase();

  for (const payout of payouts) {
    if (payout.currency.toUpperCase() !== currency) {
      throw new DomainError(
        'CURRENCY_MISMATCH',
        `Payout ${payout.pickupEventId} is ${payout.currency} but the batch settles in ${currency}`,
      );
    }
    if (payout.amountMinor <= 0n) {
      throw new DomainError(
        'INVALID_MONEY',
        `Payout ${payout.pickupEventId} has a non-positive amount`,
      );
    }
  }

  const grossMinor = payouts.reduce((total, payout) => total + payout.amountMinor, 0n);
  const grossPayout = money(grossMinor, currency);

  const commission = money(
    divideRounded(grossMinor * BigInt(input.commissionBps), 10_000n, 'HALF_UP'),
    currency,
  );

  return Object.freeze({
    payoutCount: payouts.length,
    grossPayout,
    commissionBps: input.commissionBps,
    commission,
    netPayable: add(grossPayout, commission),
  });
}

export interface ReconciliationResult {
  readonly matched: boolean;
  /** partner figure minus ours. Positive means the partner claims more. */
  readonly varianceMinor: bigint;
  readonly variance: Money;
  readonly summary: string;
}

/**
 * Compare the partner's reported total against ours.
 *
 * Deliberately exact: there is no tolerance band. A one-centavo discrepancy on a
 * cash settlement is a signal that a payout is missing from one side's records,
 * and burying it under a threshold means discovering it much later against a much
 * larger number. Accepting a variance is a human decision, recorded as one.
 */
export function reconcile(input: {
  ourGrossMinor: bigint;
  partnerReportedMinor: bigint;
  currency: CurrencyCode;
}): ReconciliationResult {
  const varianceMinor = input.partnerReportedMinor - input.ourGrossMinor;
  const variance = money(varianceMinor, input.currency);

  if (varianceMinor === 0n) {
    return { matched: true, varianceMinor, variance, summary: 'Figures match exactly' };
  }

  return {
    matched: false,
    varianceMinor,
    variance,
    summary:
      varianceMinor > 0n
        ? `Partner reports ${varianceMinor} more minor units than our records show`
        : `Partner reports ${-varianceMinor} fewer minor units than our records show`,
  };
}

/**
 * A settlement period, aligned to whole UTC days.
 *
 * Half-open [start, end): a payout at exactly midnight belongs to the next
 * period, never to both. Overlapping boundaries are how a disbursement ends up
 * settled twice.
 */
export function settlementPeriod(day: Date): { periodStart: Date; periodEnd: Date } {
  const periodStart = new Date(
    Date.UTC(day.getUTCFullYear(), day.getUTCMonth(), day.getUTCDate(), 0, 0, 0, 0),
  );
  const periodEnd = new Date(periodStart.getTime() + 24 * 60 * 60 * 1000);
  return { periodStart, periodEnd };
}

export function previousSettlementPeriod(now: Date): { periodStart: Date; periodEnd: Date } {
  return settlementPeriod(new Date(now.getTime() - 24 * 60 * 60 * 1000));
}

/** Float pressure at a payout location. Advisory, not an accounting figure. */
export interface FloatStatus {
  readonly locationId: string;
  readonly locationCode: string;
  readonly branchName: string;
  readonly city: string;
  readonly usedMinor: bigint;
  readonly capacityMinor: bigint;
  readonly remainingMinor: bigint;
  readonly utilisationPercent: number;
  readonly level: 'OK' | 'WATCH' | 'CRITICAL' | 'EXHAUSTED';
}

/**
 * Classify how much of a location's daily cash capacity is consumed.
 *
 * This is the number that predicts a customer arriving at a window and being
 * turned away — the single worst experience the product can deliver, because the
 * money has already left their account.
 */
export function classifyFloat(input: {
  locationId: string;
  locationCode: string;
  branchName: string;
  city: string;
  usedMinor: bigint;
  capacityMinor: bigint;
}): FloatStatus {
  const remainingMinor =
    input.capacityMinor > input.usedMinor ? input.capacityMinor - input.usedMinor : 0n;

  const utilisationPercent =
    input.capacityMinor > 0n ? Number((input.usedMinor * 100n) / input.capacityMinor) : 0;

  const level: FloatStatus['level'] =
    remainingMinor === 0n
      ? 'EXHAUSTED'
      : utilisationPercent >= 90
        ? 'CRITICAL'
        : utilisationPercent >= 70
          ? 'WATCH'
          : 'OK';

  return {
    locationId: input.locationId,
    locationCode: input.locationCode,
    branchName: input.branchName,
    city: input.city,
    usedMinor: input.usedMinor,
    capacityMinor: input.capacityMinor,
    remainingMinor,
    utilisationPercent,
    level,
  };
}

/**
 * CSV settlement statement.
 *
 * Every value is a string of integer minor units, matching the API convention —
 * a spreadsheet that silently reformats "20000.00" as a float is exactly the
 * class of error this codebase avoids everywhere else.
 */
export function toSettlementCsv(input: {
  reference: string;
  institutionName: string;
  periodStart: Date;
  periodEnd: Date;
  currency: CurrencyCode;
  totals: SettlementTotals;
  lines: readonly SettlementPayout[];
}): string {
  const escape = (value: string): string =>
    /[",\n]/.test(value) ? `"${value.replace(/"/g, '""')}"` : value;

  const rows: string[] = [
    `# Larimar settlement statement — DEMONSTRATION ONLY, no real funds`,
    `# Batch,${escape(input.reference)}`,
    `# Institution,${escape(input.institutionName)}`,
    `# Period,${input.periodStart.toISOString()},${input.periodEnd.toISOString()}`,
    `# Currency,${input.currency}`,
    `# Payouts,${input.totals.payoutCount}`,
    `# GrossPayoutMinor,${input.totals.grossPayout.amount}`,
    `# CommissionBps,${input.totals.commissionBps}`,
    `# CommissionMinor,${input.totals.commission.amount}`,
    `# NetPayableMinor,${input.totals.netPayable.amount}`,
    '',
    'pickupEventId,transactionRef,locationCode,amountMinor,currency,disbursedAt',
  ];

  for (const line of input.lines) {
    rows.push(
      [
        line.pickupEventId,
        escape(line.transactionRef ?? ''),
        escape(line.locationCode ?? ''),
        line.amountMinor.toString(),
        line.currency,
        line.disbursedAt.toISOString(),
      ].join(','),
    );
  }

  return `${rows.join('\n')}\n`;
}

/** Convenience for services that need Money out of stored minor units. */
export function settlementMoney(minor: bigint, currency: CurrencyCode): Money {
  return fromMinor(minor, currency);
}
