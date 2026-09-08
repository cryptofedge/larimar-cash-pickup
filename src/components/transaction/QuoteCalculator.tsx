'use client';

import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { useRouter } from 'next/navigation';
import { formatMoney, fromMinor } from '@/lib/domain/money';
import type { Messages } from '@/i18n';
import { INTL_LOCALES, interpolate, type Locale } from '@/i18n/config';

interface QuoteResponse {
  payoutAmountMinor: string;
  payoutCurrency: string;
  principalMinor: string;
  platformFeeMinor: string;
  processingFeeMinor: string;
  expeditedFeeMinor: string;
  totalChargedMinor: string;
  fundingCurrency: string;
  fxSpreadCostMinor: string;
  totalCostMinor: string;
  midRate: string;
  effectiveRate: string;
  fxSpreadBps: number;
  expiresAt: string;
  isDemoRate: boolean;
}

/**
 * The live quote calculator.
 *
 * Every number shown here is computed on the server. The component holds the
 * requested amount and nothing else — it cannot derive a rate, a fee, or a
 * total, which is exactly the point: a client that can compute a price is a
 * client that can tamper with one.
 */
export function QuoteCalculator({
  m,
  locale,
  ctaHref = '/new',
  compact = false,
}: {
  m: Messages;
  locale: Locale;
  ctaHref?: string;
  compact?: boolean;
}) {
  const router = useRouter();
  const [amount, setAmount] = useState('20000');
  const [quote, setQuote] = useState<QuoteResponse | null>(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const requestSeq = useRef(0);

  const intl = INTL_LOCALES[locale];

  const payoutMinor = useMemo(() => {
    const digits = amount.replace(/[^\d]/g, '');
    if (!digits) return null;
    // DOP has 2 decimal places; the field takes whole pesos.
    return `${digits}00`;
  }, [amount]);

  const fetchQuote = useCallback(
    async (minor: string) => {
      const seq = ++requestSeq.current;
      setLoading(true);
      setError(null);

      try {
        const response = await fetch('/api/exchange-rates', {
          method: 'POST',
          headers: { 'content-type': 'application/json' },
          body: JSON.stringify({
            payoutAmountMinor: minor,
            payoutCurrency: 'DOP',
            fundingCurrency: 'USD',
            countryCode: 'DO',
            expedited: false,
          }),
        });

        const payload = (await response.json()) as QuoteResponse | { error: { message: string } };

        // Ignore a response that a newer keystroke has already superseded.
        if (seq !== requestSeq.current) return;

        if (!response.ok) {
          setQuote(null);
          setError('error' in payload ? payload.error.message : m.errors.generic);
          return;
        }
        setQuote(payload as QuoteResponse);
      } catch {
        if (seq === requestSeq.current) setError(m.errors.generic);
      } finally {
        if (seq === requestSeq.current) setLoading(false);
      }
    },
    [m.errors.generic],
  );

  // Debounced so typing "20000" is one request, not five.
  useEffect(() => {
    if (!payoutMinor || payoutMinor === '00') {
      setQuote(null);
      return;
    }
    const timer = setTimeout(() => void fetchQuote(payoutMinor), 350);
    return () => clearTimeout(timer);
  }, [payoutMinor, fetchQuote]);

  const money = (minor: string, currency: string) =>
    formatMoney(fromMinor(BigInt(minor), currency), intl);

  return (
    <div className="card overflow-hidden">
      <div className="border-b border-navy-100 bg-navy-50/50 p-5 sm:p-6">
        <label htmlFor="payout-amount" className="field-label">
          {m.calculator.amountToReceive}
        </label>
        <div className="relative">
          <span className="pointer-events-none absolute left-4 top-1/2 -translate-y-1/2 text-lg font-semibold text-navy-400">
            RD$
          </span>
          <input
            id="payout-amount"
            type="text"
            inputMode="numeric"
            autoComplete="off"
            value={amount}
            onChange={(event) => setAmount(event.target.value.replace(/[^\d,]/g, ''))}
            className="field-input tabular pl-14 text-2xl font-bold"
            aria-describedby="amount-hint"
          />
        </div>
        <p id="amount-hint" className="mt-2 text-xs text-navy-400">
          {m.calculator.fundingCurrency} USD
        </p>
      </div>

      <div className="p-5 sm:p-6">
        {error ? (
          <p className="rounded-lg bg-danger-50 p-3 text-sm text-danger-600" role="alert">
            {error}
          </p>
        ) : null}

        {!quote && !error ? (
          <p className="py-8 text-center text-sm text-navy-400">
            {loading ? m.calculator.recalculating : m.common.loading}
          </p>
        ) : null}

        {quote ? (
          <div className={loading ? 'opacity-60 transition-opacity' : 'transition-opacity'}>
            <div className="mb-4 rounded-xl bg-larimar-50 p-4 text-center">
              <p className="text-xs font-semibold uppercase tracking-wide text-larimar-700">
                {m.calculator.youReceive}
              </p>
              <p className="amount-hero mt-1 text-larimar-900">
                {money(quote.payoutAmountMinor, quote.payoutCurrency)}
              </p>
            </div>

            <div className="divide-y divide-navy-100">
              <div className="amount-row text-sm">
                <span>{m.calculator.exchangeRate}</span>
                <span className="amount-row-value">
                  1 USD = {quote.effectiveRate} DOP
                </span>
              </div>
              <div className="amount-row text-sm">
                <span>{m.calculator.youPay}</span>
                <span className="amount-row-value">
                  {money(quote.principalMinor, quote.fundingCurrency)}
                </span>
              </div>
              <div className="amount-row text-sm">
                <span>{m.calculator.platformFee}</span>
                <span className="amount-row-value">
                  {money(quote.platformFeeMinor, quote.fundingCurrency)}
                </span>
              </div>
              <div className="amount-row text-sm">
                <span>{m.calculator.processingFee}</span>
                <span className="amount-row-value">
                  {money(quote.processingFeeMinor, quote.fundingCurrency)}
                </span>
              </div>
              {/* The spread is disclosed as its own line rather than hidden in the rate. */}
              <div className="amount-row text-sm">
                <span className="text-navy-400">{m.calculator.fxSpread}</span>
                <span className="amount-row-value text-navy-500">
                  {money(quote.fxSpreadCostMinor, quote.fundingCurrency)}
                </span>
              </div>
              <div className="amount-row border-t border-navy-200 pt-3">
                <span className="text-base font-semibold text-navy-900">{m.calculator.total}</span>
                <span className="amount-row-value text-xl">
                  {money(quote.totalChargedMinor, quote.fundingCurrency)}
                </span>
              </div>
            </div>

            <p className="mt-4 rounded-lg bg-success-50 p-3 text-center text-sm font-semibold text-success-700">
              {interpolate(m.calculator.guarantee, {
                amount: money(quote.payoutAmountMinor, quote.payoutCurrency),
              })}
            </p>

            {quote.isDemoRate ? (
              <p className="mt-3 text-center text-xs font-medium text-warning-700">
                {m.calculator.demoRateWarning}
              </p>
            ) : null}

            {!compact ? (
              <button
                type="button"
                onClick={() => router.push(`${ctaHref}?amount=${amount.replace(/[^\d]/g, '')}`)}
                className="btn-primary mt-5 w-full text-lg"
              >
                {m.home.ctaPrimary}
              </button>
            ) : null}
          </div>
        ) : null}
      </div>
    </div>
  );
}
