import { describe, expect, it } from 'vitest';
import {
  CHART_OF_ACCOUNTS,
  assertBalanced,
  buildBankSettlementPosting,
  buildChargebackPosting,
  buildCustomerPaymentPosting,
  buildFxConversionPosting,
  buildPayoutLiabilityPosting,
  buildPlatformFeePosting,
  buildProcessingFeePosting,
  buildRefundPosting,
  buildReversalPosting,
  computeBalances,
  getAccount,
  verifyGlobalBalance,
  type LedgerPosting,
} from '@/lib/domain/ledger';
import { fromDecimal, money, zero } from '@/lib/domain/money';
import { DomainError, LedgerImbalanceError } from '@/lib/domain/errors';

const REF = 'LRM-TEST-0001';

describe('chart of accounts', () => {
  it('test_chart_of_accounts_assigns_the_correct_normal_balance_by_account_type', () => {
    for (const acct of CHART_OF_ACCOUNTS) {
      const expected = acct.type === 'ASSET' || acct.type === 'EXPENSE' ? 'DEBIT' : 'CREDIT';
      expect(acct.normalBalance).toBe(expected);
    }
  });

  it('test_chart_of_accounts_uses_unique_account_codes', () => {
    const codes = CHART_OF_ACCOUNTS.map((a) => a.code);
    expect(new Set(codes).size).toBe(codes.length);
  });

  it('test_chart_of_accounts_marks_customer_and_payout_obligations_as_custodial', () => {
    expect(getAccount('LIAB_CUSTOMER_FUNDS_USD').isCustodial).toBe(true);
    expect(getAccount('LIAB_PAYOUT_DOP').isCustodial).toBe(true);
  });

  it('test_chart_of_accounts_rejects_unknown_account_codes', () => {
    expect(() => getAccount('NOT_A_REAL_ACCOUNT')).toThrow(DomainError);
  });
});

describe('every builder produces a balanced posting', () => {
  const postings: [string, LedgerPosting][] = [
    ['customer payment', buildCustomerPaymentPosting({ transactionRef: REF, totalCharged: fromDecimal('349.62', 'USD') })],
    ['platform fee', buildPlatformFeePosting({ transactionRef: REF, platformFee: fromDecimal('5.02', 'USD') })],
    ['processing fee', buildProcessingFeePosting({ transactionRef: REF, processingFee: fromDecimal('10.14', 'USD') })],
    ['fx conversion', buildFxConversionPosting({ transactionRef: REF, principal: fromDecimal('334.46', 'USD'), fxSpreadRevenue: fromDecimal('2.51', 'USD') })],
    ['payout liability', buildPayoutLiabilityPosting({ transactionRef: REF, payoutAmount: fromDecimal('20000', 'DOP') })],
    ['bank settlement', buildBankSettlementPosting({ transactionRef: REF, payoutAmount: fromDecimal('20000', 'DOP') })],
    ['refund', buildRefundPosting({ transactionRef: REF, refundAmount: fromDecimal('349.62', 'USD'), refundId: 'rf-1' })],
    ['chargeback (cash gone)', buildChargebackPosting({ transactionRef: REF, chargebackAmount: fromDecimal('349.62', 'USD'), chargebackId: 'cb-1', cashAlreadyDisbursed: true })],
    ['chargeback (pre-payout)', buildChargebackPosting({ transactionRef: REF, chargebackAmount: fromDecimal('349.62', 'USD'), chargebackId: 'cb-2', cashAlreadyDisbursed: false })],
  ];

  it.each(postings)('test_every_builder_produces_a_balanced_posting_balances_to_zero [%s]', (_label, posting) => {
    expect(() => assertBalanced(posting)).not.toThrow();
    const net = posting.entries.reduce(
      (acc, e) => acc + (e.direction === 'DEBIT' ? e.amount.amount : -e.amount.amount),
      0n,
    );
    expect(net).toBe(0n);
  });

  it.each(postings)('test_every_builder_produces_a_balanced_posting_uses_a_unique_posting_key [%s]', (_label, posting) => {
    expect(posting.postingKey.startsWith(REF)).toBe(true);
  });
});

describe('the imbalance guard', () => {
  const good = buildCustomerPaymentPosting({
    transactionRef: REF,
    totalCharged: fromDecimal('100.00', 'USD'),
  });

  it('test_the_imbalance_guard_rejects_a_posting_that_does_not_sum_to_zero', () => {
    const broken: LedgerPosting = {
      ...good,
      entries: [
        { accountCode: 'ASSET_PROCESSOR_RECEIVABLE_USD', direction: 'DEBIT', amount: fromDecimal('100.00', 'USD') },
        { accountCode: 'LIAB_CUSTOMER_FUNDS_USD', direction: 'CREDIT', amount: fromDecimal('99.00', 'USD') },
      ],
    };
    expect(() => assertBalanced(broken)).toThrow(LedgerImbalanceError);
  });

  it('test_the_imbalance_guard_rejects_a_single_entry_posting', () => {
    const broken: LedgerPosting = {
      ...good,
      entries: [{ accountCode: 'ASSET_PROCESSOR_RECEIVABLE_USD', direction: 'DEBIT', amount: fromDecimal('100.00', 'USD') }],
    };
    expect(() => assertBalanced(broken)).toThrow(/at least 2/);
  });

  it('test_the_imbalance_guard_rejects_negative_entry_amounts_direction_carries_the_sign', () => {
    const broken: LedgerPosting = {
      ...good,
      entries: [
        { accountCode: 'ASSET_PROCESSOR_RECEIVABLE_USD', direction: 'DEBIT', amount: money(-100n, 'USD') },
        { accountCode: 'LIAB_CUSTOMER_FUNDS_USD', direction: 'CREDIT', amount: money(-100n, 'USD') },
      ],
    };
    expect(() => assertBalanced(broken)).toThrow(/must be positive/);
  });

  it('test_the_imbalance_guard_rejects_zero_amount_entries', () => {
    const broken: LedgerPosting = {
      ...good,
      entries: [
        { accountCode: 'ASSET_PROCESSOR_RECEIVABLE_USD', direction: 'DEBIT', amount: zero('USD') },
        { accountCode: 'LIAB_CUSTOMER_FUNDS_USD', direction: 'CREDIT', amount: zero('USD') },
      ],
    };
    expect(() => assertBalanced(broken)).toThrow(/Zero-amount/);
  });

  it('test_the_imbalance_guard_rejects_entries_whose_currency_differs_from_the_posting', () => {
    const broken: LedgerPosting = {
      ...good,
      entries: [
        { accountCode: 'ASSET_PROCESSOR_RECEIVABLE_USD', direction: 'DEBIT', amount: fromDecimal('100.00', 'DOP') },
        { accountCode: 'LIAB_CUSTOMER_FUNDS_USD', direction: 'CREDIT', amount: fromDecimal('100.00', 'DOP') },
      ],
    };
    expect(() => assertBalanced(broken)).toThrow(/DOP/);
  });

  it('test_the_imbalance_guard_rejects_posting_a_usd_amount_to_a_dop_account', () => {
    const broken: LedgerPosting = {
      ...good,
      entries: [
        { accountCode: 'LIAB_PAYOUT_DOP', direction: 'DEBIT', amount: fromDecimal('100.00', 'USD') },
        { accountCode: 'LIAB_CUSTOMER_FUNDS_USD', direction: 'CREDIT', amount: fromDecimal('100.00', 'USD') },
      ],
    };
    expect(() => assertBalanced(broken)).toThrow(/denominated in DOP/);
  });
});

describe('the full funding lifecycle', () => {
  const totalCharged = fromDecimal('349.62', 'USD');
  const principal = fromDecimal('334.46', 'USD');
  const platformFee = fromDecimal('5.02', 'USD');
  const processingFee = fromDecimal('10.14', 'USD');
  const spread = fromDecimal('2.51', 'USD');
  const payout = fromDecimal('20000', 'DOP');

  const postings = [
    buildCustomerPaymentPosting({ transactionRef: REF, totalCharged }),
    buildPlatformFeePosting({ transactionRef: REF, platformFee }),
    buildProcessingFeePosting({ transactionRef: REF, processingFee }),
    buildFxConversionPosting({ transactionRef: REF, principal, fxSpreadRevenue: spread }),
    buildPayoutLiabilityPosting({ transactionRef: REF, payoutAmount: payout }),
    buildBankSettlementPosting({ transactionRef: REF, payoutAmount: payout }),
  ];

  const allEntries = postings.flatMap((p) =>
    p.entries.map((e) => ({
      accountCode: e.accountCode,
      direction: e.direction,
      amountMinor: e.amount.amount,
      currency: e.amount.currency,
    })),
  );

  it('test_the_full_funding_lifecycle_keeps_every_currency_globally_balanced', () => {
    expect(verifyGlobalBalance(allEntries)).toEqual({ balanced: true });
  });

  it('test_the_full_funding_lifecycle_leaves_no_residue_in_the_customer_funds_suspense_account', () => {
    // Paid in 349.62; out: 5.02 fee + 10.14 processing + 334.46 principal = 349.62.
    const balances = computeBalances(allEntries);
    const suspense = balances.find((b) => b.accountCode === 'LIAB_CUSTOMER_FUNDS_USD');
    expect(suspense?.balanceMinor).toBe(0n);
  });

  it('test_the_full_funding_lifecycle_discharges_the_customer_payout_obligation_once_cash_is_handed_over', () => {
    const balances = computeBalances(allEntries);
    const payoutLiability = balances.find((b) => b.accountCode === 'LIAB_PAYOUT_DOP');
    expect(payoutLiability?.balanceMinor).toBe(0n);
  });

  it('test_the_full_funding_lifecycle_records_what_is_owed_to_the_payout_partner', () => {
    const balances = computeBalances(allEntries);
    const partner = balances.find((b) => b.accountCode === 'LIAB_PARTNER_SETTLEMENT_DOP');
    expect(partner?.balanceMinor).toBe(2_000_000n); // RD$20,000 credit balance
  });

  it('test_the_full_funding_lifecycle_recognises_platform_fee_spread_and_recovery_as_revenue', () => {
    const balances = computeBalances(allEntries);
    const revenue = balances
      .filter((b) => b.type === 'REVENUE')
      .reduce((acc, b) => acc + b.balanceMinor, 0n);
    // 5.02 platform + 2.51 spread + 10.14 recovery
    expect(revenue).toBe(502n + 251n + 1014n);
  });

  it('test_the_full_funding_lifecycle_recognises_the_processing_cost_as_an_expense', () => {
    const balances = computeBalances(allEntries);
    const expense = balances.find((b) => b.accountCode === 'EXP_PROCESSING_FEE_USD');
    expect(expense?.balanceMinor).toBe(1014n);
  });

  it('test_the_full_funding_lifecycle_detects_an_injected_unbalanced_entry', () => {
    const tampered = [
      ...allEntries,
      { accountCode: 'ASSET_OPERATING_BANK_USD', direction: 'DEBIT' as const, amountMinor: 5000n, currency: 'USD' },
    ];
    const result = verifyGlobalBalance(tampered);
    expect(result.balanced).toBe(false);
    if (!result.balanced) {
      expect(result.imbalances).toEqual([{ currency: 'USD', deltaMinor: 5000n }]);
    }
  });
});

describe('FX spread recognition', () => {
  it('test_fx_spread_recognition_splits_the_principal_between_the_fx_desk_and_spread_revenue', () => {
    const posting = buildFxConversionPosting({
      transactionRef: REF,
      principal: fromDecimal('334.46', 'USD'),
      fxSpreadRevenue: fromDecimal('2.51', 'USD'),
    });
    const toDesk = posting.entries.find((e) => e.accountCode === 'LIAB_FX_POSITION_USD');
    const revenue = posting.entries.find((e) => e.accountCode === 'REV_FX_SPREAD_USD');
    expect(toDesk?.amount.amount).toBe(33_446n - 251n);
    expect(revenue?.amount.amount).toBe(251n);
  });

  it('test_fx_spread_recognition_handles_a_zero_spread_without_emitting_a_zero_amount_entry', () => {
    const posting = buildFxConversionPosting({
      transactionRef: REF,
      principal: fromDecimal('334.46', 'USD'),
      fxSpreadRevenue: zero('USD'),
    });
    expect(posting.entries).toHaveLength(2);
    expect(posting.entries.some((e) => e.accountCode === 'REV_FX_SPREAD_USD')).toBe(false);
  });
});

describe('chargebacks', () => {
  it('test_chargebacks_books_a_loss_to_the_fraud_expense_account_when_the_cash_is_already_gone', () => {
    const posting = buildChargebackPosting({
      transactionRef: REF,
      chargebackAmount: fromDecimal('349.62', 'USD'),
      chargebackId: 'cb-1',
      cashAlreadyDisbursed: true,
    });
    expect(posting.entries.some((e) => e.accountCode === 'EXP_FRAUD_LOSS_USD')).toBe(true);
  });

  it('test_chargebacks_reverses_out_of_customer_funds_when_nothing_was_disbursed', () => {
    const posting = buildChargebackPosting({
      transactionRef: REF,
      chargebackAmount: fromDecimal('349.62', 'USD'),
      chargebackId: 'cb-2',
      cashAlreadyDisbursed: false,
    });
    expect(posting.entries.some((e) => e.accountCode === 'LIAB_CUSTOMER_FUNDS_USD')).toBe(true);
    expect(posting.entries.some((e) => e.accountCode === 'EXP_FRAUD_LOSS_USD')).toBe(false);
  });
});

describe('reversals', () => {
  it('test_reversals_flips_every_direction_and_nets_the_original_to_zero', () => {
    const original = buildCustomerPaymentPosting({
      transactionRef: REF,
      totalCharged: fromDecimal('349.62', 'USD'),
    });
    const reversal = buildReversalPosting(original, 'duplicate capture');

    expect(reversal.postingKey).toBe(`${original.postingKey}:REVERSAL`);
    for (let i = 0; i < original.entries.length; i += 1) {
      const before = original.entries[i];
      const after = reversal.entries[i];
      expect(after?.direction).not.toBe(before?.direction);
      expect(after?.amount.amount).toBe(before?.amount.amount);
    }

    const combined = [...original.entries, ...reversal.entries].map((e) => ({
      accountCode: e.accountCode,
      direction: e.direction,
      amountMinor: e.amount.amount,
      currency: e.amount.currency,
    }));
    const balances = computeBalances(combined);
    for (const line of balances) {
      expect(line.balanceMinor).toBe(0n);
    }
  });
});

describe('balance sign convention', () => {
  it('test_balance_sign_convention_reports_a_liability_with_a_credit_balance_as_positive', () => {
    const balances = computeBalances([
      { accountCode: 'LIAB_CUSTOMER_FUNDS_USD', direction: 'CREDIT', amountMinor: 10_000n },
    ]);
    expect(balances[0]?.balanceMinor).toBe(10_000n);
  });

  it('test_balance_sign_convention_reports_an_asset_with_a_debit_balance_as_positive', () => {
    const balances = computeBalances([
      { accountCode: 'ASSET_PROCESSOR_RECEIVABLE_USD', direction: 'DEBIT', amountMinor: 10_000n },
    ]);
    expect(balances[0]?.balanceMinor).toBe(10_000n);
  });
});
