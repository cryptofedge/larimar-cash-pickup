/**
 * Double-entry ledger.
 *
 * Balances are never stored. They are the sum of entries, and entries are never
 * updated or deleted — a correction is a new reversing transaction. That is what
 * makes the ledger defensible to an auditor: the history cannot be rewritten,
 * only appended to.
 *
 * Two rules are enforced mechanically before anything reaches the database:
 *
 *  1. Every posting balances. Debits minus credits equals exactly zero.
 *  2. Every posting is single-currency. Cross-currency movement is modelled as
 *     two linked postings joined by FX position accounts — which is how a real
 *     treasury holds the exposure, rather than pretending USD and DOP can sit on
 *     opposite sides of one balanced entry.
 *
 * Pure module.
 */

import { LedgerImbalanceError, DomainError } from './errors';
import { type CurrencyCode, type Money, isNegative, isZero } from './money';

export type LedgerAccountType = 'ASSET' | 'LIABILITY' | 'REVENUE' | 'EXPENSE' | 'EQUITY';
export type LedgerDirection = 'DEBIT' | 'CREDIT';

export type LedgerEventType =
  | 'CUSTOMER_PAYMENT'
  | 'PLATFORM_FEE'
  | 'PROCESSING_FEE'
  | 'FX_CONVERSION'
  | 'PAYOUT_LIABILITY'
  | 'BANK_SETTLEMENT'
  | 'REFUND'
  | 'CHARGEBACK'
  | 'ADJUSTMENT';

export interface AccountDefinition {
  readonly code: string;
  readonly name: string;
  readonly type: LedgerAccountType;
  readonly currency: CurrencyCode;
  readonly normalBalance: LedgerDirection;
  /** Held on behalf of customers or partners rather than owned by the platform. */
  readonly isCustodial: boolean;
}

const account = (
  code: string,
  name: string,
  type: LedgerAccountType,
  currency: CurrencyCode,
  isCustodial = false,
): AccountDefinition =>
  Object.freeze({
    code,
    name,
    type,
    currency,
    normalBalance: type === 'ASSET' || type === 'EXPENSE' ? 'DEBIT' : 'CREDIT',
    isCustodial,
  });

/**
 * Chart of accounts.
 *
 * Deliberately small. A real deployment adds per-partner settlement accounts and
 * per-corridor FX position accounts, but the shape stays exactly this.
 */
export const CHART_OF_ACCOUNTS: readonly AccountDefinition[] = Object.freeze([
  // Assets
  account('ASSET_PROCESSOR_RECEIVABLE_USD', 'Card processor receivable (USD)', 'ASSET', 'USD'),
  account('ASSET_OPERATING_BANK_USD', 'Operating bank account (USD)', 'ASSET', 'USD'),
  account('ASSET_FX_POSITION_DOP', 'FX position — DOP leg', 'ASSET', 'DOP'),
  account('ASSET_PARTNER_FLOAT_DOP', 'Payout partner float (DOP)', 'ASSET', 'DOP'),

  // Liabilities
  account('LIAB_CUSTOMER_FUNDS_USD', 'Customer funds in suspense (USD)', 'LIABILITY', 'USD', true),
  account('LIAB_FX_POSITION_USD', 'FX position — USD leg', 'LIABILITY', 'USD'),
  account('LIAB_PAYOUT_DOP', 'Payout obligation to customers (DOP)', 'LIABILITY', 'DOP', true),
  account('LIAB_PARTNER_SETTLEMENT_DOP', 'Payable to payout partners (DOP)', 'LIABILITY', 'DOP'),

  // Revenue
  account('REV_PLATFORM_FEE_USD', 'Platform fee revenue (USD)', 'REVENUE', 'USD'),
  account('REV_FX_SPREAD_USD', 'FX spread revenue (USD)', 'REVENUE', 'USD'),
  account('REV_PROCESSING_RECOVERY_USD', 'Processing fee recovered from customer (USD)', 'REVENUE', 'USD'),

  // Expenses
  account('EXP_PROCESSING_FEE_USD', 'Card processing cost (USD)', 'EXPENSE', 'USD'),
  account('EXP_FRAUD_LOSS_USD', 'Fraud and chargeback losses (USD)', 'EXPENSE', 'USD'),
  account('EXP_PARTNER_COMMISSION_DOP', 'Payout partner commission (DOP)', 'EXPENSE', 'DOP'),

  // Equity
  account('EQUITY_RETAINED_USD', 'Retained earnings (USD)', 'EQUITY', 'USD'),
]);

const ACCOUNTS_BY_CODE = new Map(CHART_OF_ACCOUNTS.map((a) => [a.code, a]));

export function getAccount(code: string): AccountDefinition {
  const found = ACCOUNTS_BY_CODE.get(code);
  if (!found) {
    throw new DomainError('LEDGER_INVALID_ENTRY', `Unknown ledger account code: ${code}`);
  }
  return found;
}

export interface PostingEntry {
  readonly accountCode: string;
  readonly direction: LedgerDirection;
  /** Always positive. `direction` carries the sign. */
  readonly amount: Money;
  readonly memo?: string;
}

export interface LedgerPosting {
  readonly eventType: LedgerEventType;
  readonly currency: CurrencyCode;
  readonly description: string;
  /** Uniqueness guard: one posting per business event per transaction. */
  readonly postingKey: string;
  readonly entries: readonly PostingEntry[];
}

const entry = (
  accountCode: string,
  direction: LedgerDirection,
  amount: Money,
  memo?: string,
): PostingEntry => Object.freeze({ accountCode, direction, amount, memo });

/**
 * The gate every posting passes through. Throws rather than returns, because a
 * silently ignored boolean here would corrupt the books.
 */
export function assertBalanced(posting: LedgerPosting): void {
  if (posting.entries.length < 2) {
    throw new DomainError(
      'LEDGER_INVALID_ENTRY',
      `Posting ${posting.postingKey} has ${posting.entries.length} entries; at least 2 are required`,
    );
  }

  let net = 0n;
  for (const e of posting.entries) {
    if (isNegative(e.amount)) {
      throw new DomainError(
        'LEDGER_INVALID_ENTRY',
        `Entry amounts must be positive; direction carries the sign (${e.accountCode})`,
      );
    }
    if (isZero(e.amount)) {
      throw new DomainError('LEDGER_INVALID_ENTRY', `Zero-amount entry on ${e.accountCode}`);
    }
    if (e.amount.currency !== posting.currency) {
      throw new DomainError(
        'LEDGER_CURRENCY_MISMATCH',
        `Entry on ${e.accountCode} is ${e.amount.currency} but the posting is ${posting.currency}`,
      );
    }

    const definition = getAccount(e.accountCode);
    if (definition.currency !== posting.currency) {
      throw new DomainError(
        'LEDGER_CURRENCY_MISMATCH',
        `Account ${e.accountCode} is denominated in ${definition.currency}, not ${posting.currency}`,
      );
    }

    net += e.direction === 'DEBIT' ? e.amount.amount : -e.amount.amount;
  }

  if (net !== 0n) {
    throw new LedgerImbalanceError(net, posting.currency);
  }
}

function posting(
  eventType: LedgerEventType,
  currency: CurrencyCode,
  description: string,
  postingKey: string,
  entries: readonly PostingEntry[],
): LedgerPosting {
  const result = Object.freeze({ eventType, currency, description, postingKey, entries });
  assertBalanced(result);
  return result;
}

// ---------------------------------------------------------------------------
// Posting builders — one per business event
// ---------------------------------------------------------------------------

/** The customer's card is charged. We are owed by the processor; we owe the customer a service. */
export function buildCustomerPaymentPosting(input: {
  transactionRef: string;
  totalCharged: Money;
}): LedgerPosting {
  return posting(
    'CUSTOMER_PAYMENT',
    input.totalCharged.currency,
    `Card payment received for ${input.transactionRef}`,
    `${input.transactionRef}:CUSTOMER_PAYMENT`,
    [
      entry('ASSET_PROCESSOR_RECEIVABLE_USD', 'DEBIT', input.totalCharged, 'Due from processor'),
      entry('LIAB_CUSTOMER_FUNDS_USD', 'CREDIT', input.totalCharged, 'Customer funds held'),
    ],
  );
}

/** Our fee is earned out of the funds the customer already paid. */
export function buildPlatformFeePosting(input: {
  transactionRef: string;
  platformFee: Money;
}): LedgerPosting {
  return posting(
    'PLATFORM_FEE',
    input.platformFee.currency,
    `Platform fee earned on ${input.transactionRef}`,
    `${input.transactionRef}:PLATFORM_FEE`,
    [
      entry('LIAB_CUSTOMER_FUNDS_USD', 'DEBIT', input.platformFee, 'Fee taken from customer funds'),
      entry('REV_PLATFORM_FEE_USD', 'CREDIT', input.platformFee, 'Platform fee revenue'),
    ],
  );
}

/**
 * The processing fee has two simultaneous truths: the customer funded it (revenue
 * recovery), and the processor keeps it (expense, and a receivable we never collect).
 * Modelling only one side would misstate both revenue and cost.
 */
export function buildProcessingFeePosting(input: {
  transactionRef: string;
  processingFee: Money;
}): LedgerPosting {
  return posting(
    'PROCESSING_FEE',
    input.processingFee.currency,
    `Card processing cost on ${input.transactionRef}`,
    `${input.transactionRef}:PROCESSING_FEE`,
    [
      entry('LIAB_CUSTOMER_FUNDS_USD', 'DEBIT', input.processingFee, 'Recovered from customer'),
      entry('EXP_PROCESSING_FEE_USD', 'DEBIT', input.processingFee, 'Processor cost'),
      entry('REV_PROCESSING_RECOVERY_USD', 'CREDIT', input.processingFee, 'Recovery revenue'),
      entry('ASSET_PROCESSOR_RECEIVABLE_USD', 'CREDIT', input.processingFee, 'Netted by processor'),
    ],
  );
}

/**
 * FX, USD leg. The customer's remaining USD moves to the FX position; the spread
 * we captured is recognised as revenue here rather than buried in the rate.
 */
export function buildFxConversionPosting(input: {
  transactionRef: string;
  principal: Money;
  fxSpreadRevenue: Money;
}): LedgerPosting {
  const entries: PostingEntry[] = [
    entry('LIAB_CUSTOMER_FUNDS_USD', 'DEBIT', input.principal, 'Converted to payout currency'),
  ];

  if (!isZero(input.fxSpreadRevenue)) {
    // The spread is inside the principal: less goes to the FX desk than the
    // customer funded, and the difference is our margin.
    const toFxDesk = {
      amount: input.principal.amount - input.fxSpreadRevenue.amount,
      currency: input.principal.currency,
    } as Money;
    entries.push(entry('LIAB_FX_POSITION_USD', 'CREDIT', toFxDesk, 'USD owed to FX desk'));
    entries.push(entry('REV_FX_SPREAD_USD', 'CREDIT', input.fxSpreadRevenue, 'FX spread revenue'));
  } else {
    entries.push(entry('LIAB_FX_POSITION_USD', 'CREDIT', input.principal, 'USD owed to FX desk'));
  }

  return posting(
    'FX_CONVERSION',
    input.principal.currency,
    `FX conversion (funding leg) for ${input.transactionRef}`,
    `${input.transactionRef}:FX_CONVERSION`,
    entries,
  );
}

/** FX, payout leg. We now hold a DOP position and owe the customer DOP cash. */
export function buildPayoutLiabilityPosting(input: {
  transactionRef: string;
  payoutAmount: Money;
}): LedgerPosting {
  return posting(
    'PAYOUT_LIABILITY',
    input.payoutAmount.currency,
    `Payout obligation created for ${input.transactionRef}`,
    `${input.transactionRef}:PAYOUT_LIABILITY`,
    [
      entry('ASSET_FX_POSITION_DOP', 'DEBIT', input.payoutAmount, 'DOP acquired'),
      entry('LIAB_PAYOUT_DOP', 'CREDIT', input.payoutAmount, 'Owed to customer at pickup'),
    ],
  );
}

/**
 * Cash handed over at the window. The customer obligation is discharged and
 * replaced by a payable to the partner who actually fronted the notes.
 */
export function buildBankSettlementPosting(input: {
  transactionRef: string;
  payoutAmount: Money;
  sequence?: number;
}): LedgerPosting {
  const suffix = input.sequence === undefined ? '' : `:${input.sequence}`;
  return posting(
    'BANK_SETTLEMENT',
    input.payoutAmount.currency,
    `Cash disbursed at payout partner for ${input.transactionRef}`,
    `${input.transactionRef}:BANK_SETTLEMENT${suffix}`,
    [
      entry('LIAB_PAYOUT_DOP', 'DEBIT', input.payoutAmount, 'Customer obligation discharged'),
      entry('LIAB_PARTNER_SETTLEMENT_DOP', 'CREDIT', input.payoutAmount, 'Owed to payout partner'),
    ],
  );
}

/**
 * Settling a batch with a payout partner.
 *
 * Discharges what we owe them for cash they fronted, recognises the commission
 * as an expense, and reduces our DOP position by the total transferred. This is
 * the posting that finally closes the loop opened by `buildBankSettlementPosting`
 * at the moment of disbursement.
 */
export function buildPartnerSettlementPosting(input: {
  batchReference: string;
  grossPayout: Money;
  commission: Money;
  netPayable: Money;
}): LedgerPosting {
  const entries: PostingEntry[] = [
    entry('LIAB_PARTNER_SETTLEMENT_DOP', 'DEBIT', input.grossPayout, 'Partner payable discharged'),
  ];

  if (!isZero(input.commission)) {
    entries.push(
      entry('EXP_PARTNER_COMMISSION_DOP', 'DEBIT', input.commission, 'Partner commission'),
    );
  }

  entries.push(
    entry('ASSET_FX_POSITION_DOP', 'CREDIT', input.netPayable, 'DOP transferred to partner'),
  );

  return posting(
    'BANK_SETTLEMENT',
    input.netPayable.currency,
    `Settlement paid to partner for ${input.batchReference}`,
    `SETTLEMENT:${input.batchReference}`,
    entries,
  );
}

/** Money returned to the customer before any cash was collected. */
export function buildRefundPosting(input: {
  transactionRef: string;
  refundAmount: Money;
  refundId: string;
}): LedgerPosting {
  return posting(
    'REFUND',
    input.refundAmount.currency,
    `Refund issued for ${input.transactionRef}`,
    `${input.transactionRef}:REFUND:${input.refundId}`,
    [
      entry('LIAB_CUSTOMER_FUNDS_USD', 'DEBIT', input.refundAmount, 'Customer funds released'),
      entry('ASSET_PROCESSOR_RECEIVABLE_USD', 'CREDIT', input.refundAmount, 'Returned via processor'),
    ],
  );
}

/**
 * A chargeback after the cash is gone is a straight loss, and the ledger says so
 * plainly. This is the single most important number for the risk model to watch.
 */
export function buildChargebackPosting(input: {
  transactionRef: string;
  chargebackAmount: Money;
  chargebackId: string;
  cashAlreadyDisbursed: boolean;
}): LedgerPosting {
  const debitAccount = input.cashAlreadyDisbursed
    ? 'EXP_FRAUD_LOSS_USD'
    : 'LIAB_CUSTOMER_FUNDS_USD';

  return posting(
    'CHARGEBACK',
    input.chargebackAmount.currency,
    input.cashAlreadyDisbursed
      ? `Chargeback loss on disbursed ${input.transactionRef}`
      : `Chargeback on undisbursed ${input.transactionRef}`,
    `${input.transactionRef}:CHARGEBACK:${input.chargebackId}`,
    [
      entry(debitAccount, 'DEBIT', input.chargebackAmount, 'Chargeback'),
      entry('ASSET_PROCESSOR_RECEIVABLE_USD', 'CREDIT', input.chargebackAmount, 'Clawed back by processor'),
    ],
  );
}

/**
 * Reverse an existing posting. Corrections are new transactions with the
 * directions flipped — the original stays exactly as it was posted.
 */
export function buildReversalPosting(
  original: LedgerPosting,
  reason: string,
): LedgerPosting {
  return posting(
    'ADJUSTMENT',
    original.currency,
    `Reversal of ${original.postingKey}: ${reason}`,
    `${original.postingKey}:REVERSAL`,
    original.entries.map((e) =>
      entry(e.accountCode, e.direction === 'DEBIT' ? 'CREDIT' : 'DEBIT', e.amount, `Reversal: ${e.memo ?? ''}`),
    ),
  );
}

// ---------------------------------------------------------------------------
// Balance computation
// ---------------------------------------------------------------------------

export interface BalanceLine {
  readonly accountCode: string;
  readonly type: LedgerAccountType;
  readonly currency: CurrencyCode;
  /** Signed in the account's own normal direction: positive means a normal balance. */
  readonly balanceMinor: bigint;
}

/**
 * Fold raw entries into per-account balances.
 *
 * A liability with a credit balance reports positive, which is what a reader
 * expects — "we owe RD$20,000", not "minus twenty thousand".
 */
export function computeBalances(
  entries: readonly { accountCode: string; direction: LedgerDirection; amountMinor: bigint }[],
): BalanceLine[] {
  const totals = new Map<string, bigint>();

  for (const e of entries) {
    const definition = getAccount(e.accountCode);
    const signed =
      definition.normalBalance === 'DEBIT'
        ? e.direction === 'DEBIT'
          ? e.amountMinor
          : -e.amountMinor
        : e.direction === 'CREDIT'
          ? e.amountMinor
          : -e.amountMinor;
    totals.set(e.accountCode, (totals.get(e.accountCode) ?? 0n) + signed);
  }

  return [...totals.entries()].map(([accountCode, balanceMinor]) => {
    const definition = getAccount(accountCode);
    return {
      accountCode,
      type: definition.type,
      currency: definition.currency,
      balanceMinor,
    };
  });
}

/**
 * The global invariant: within each currency, total debits equal total credits.
 * A dedicated integrity job runs this across the whole ledger.
 */
export function verifyGlobalBalance(
  entries: readonly { accountCode: string; direction: LedgerDirection; amountMinor: bigint; currency: string }[],
): { balanced: true } | { balanced: false; imbalances: { currency: string; deltaMinor: bigint }[] } {
  const byCurrency = new Map<string, bigint>();

  for (const e of entries) {
    const delta = e.direction === 'DEBIT' ? e.amountMinor : -e.amountMinor;
    byCurrency.set(e.currency, (byCurrency.get(e.currency) ?? 0n) + delta);
  }

  const imbalances = [...byCurrency.entries()]
    .filter(([, delta]) => delta !== 0n)
    .map(([currency, deltaMinor]) => ({ currency, deltaMinor }));

  return imbalances.length === 0 ? { balanced: true } : { balanced: false, imbalances };
}
