'use client';

import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { useRouter } from 'next/navigation';
import Link from 'next/link';
import type { Messages } from '@/i18n';
import { INTL_LOCALES, interpolate, type Locale } from '@/i18n/config';
import { formatMoney, fromMinor } from '@/lib/domain/money';
import { deviceFingerprint, idempotencyKey } from '@/lib/client/device';
import { MOCK_TOKENS } from '@/lib/client/demo-tokens';

interface Quote {
  payoutAmountMinor: string;
  payoutCurrency: string;
  principalMinor: string;
  platformFeeMinor: string;
  processingFeeMinor: string;
  totalChargedMinor: string;
  fundingCurrency: string;
  fxSpreadCostMinor: string;
  effectiveRate: string;
  isDemoRate: boolean;
}

interface LocationOption {
  id: string;
  branchName: string;
  institutionName: string;
  city: string;
  province: string;
  maxPayoutMinor: string;
  isDemo: boolean;
  demoNotice: string | null;
}

type Step = 'amount' | 'location' | 'review' | 'result';

/**
 * The transaction flow.
 *
 * Four steps on one page so a traveler on a phone never loses context. Note what
 * this component never does: it never computes a price, never decides whether
 * KYC is needed, and never sets a status. It renders what the server returns and
 * sends back only the amount and the chosen location.
 */
export function NewTransactionFlow({
  m,
  locale,
  initialAmount,
  kycApproved,
}: {
  m: Messages;
  locale: Locale;
  initialAmount?: string;
  kycApproved: boolean;
}) {
  const router = useRouter();
  const intl = INTL_LOCALES[locale];

  const [step, setStep] = useState<Step>('amount');
  const [amount, setAmount] = useState(initialAmount || '20000');
  const [quote, setQuote] = useState<Quote | null>(null);
  const [quoteLoading, setQuoteLoading] = useState(false);
  const [locations, setLocations] = useState<LocationOption[]>([]);
  const [locationId, setLocationId] = useState<string>('');
  const [scenario, setScenario] = useState<string>(MOCK_TOKENS.SUCCESS_DEBIT);
  const [error, setError] = useState<string | null>(null);
  const [pending, setPending] = useState(false);
  const [result, setResult] = useState<{
    status: string;
    reference: string;
    pickupCode: string | null;
    pickupSecret: string | null;
    expiresAt: string | null;
    collectableFrom: string | null;
    transactionId: string;
  } | null>(null);

  const seq = useRef(0);

  const payoutMinor = useMemo(() => {
    const digits = amount.replace(/[^\d]/g, '');
    return digits ? `${digits}00` : null;
  }, [amount]);

  const money = (minor: string, currency: string) =>
    formatMoney(fromMinor(BigInt(minor), currency), intl);

  // ---------------------------------------------------------------- quoting
  const fetchQuote = useCallback(async (minor: string) => {
    const current = ++seq.current;
    setQuoteLoading(true);
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
      const payload = (await response.json()) as Quote | { error: { message: string } };
      if (current !== seq.current) return;
      if (!response.ok) {
        setQuote(null);
        setError('error' in payload ? payload.error.message : null);
        return;
      }
      setError(null);
      setQuote(payload as Quote);
    } finally {
      if (current === seq.current) setQuoteLoading(false);
    }
  }, []);

  useEffect(() => {
    if (!payoutMinor || payoutMinor === '00') return;
    const timer = setTimeout(() => void fetchQuote(payoutMinor), 350);
    return () => clearTimeout(timer);
  }, [payoutMinor, fetchQuote]);

  useEffect(() => {
    void (async () => {
      const response = await fetch('/api/pickup/locations?countryCode=DO&limit=50');
      if (!response.ok) return;
      const payload = (await response.json()) as { locations: LocationOption[] };
      setLocations(payload.locations);
      setLocationId((current) => current || (payload.locations[0]?.id ?? ''));
    })();
  }, []);

  // -------------------------------------------------------------- submitting
  async function submit() {
    if (!payoutMinor) return;
    setPending(true);
    setError(null);

    try {
      // 1. Create — the server prices it, scores it, and decides what comes next.
      const createResponse = await fetch('/api/transactions', {
        method: 'POST',
        headers: { 'content-type': 'application/json', 'idempotency-key': idempotencyKey() },
        body: JSON.stringify({
          payoutAmountMinor: payoutMinor,
          countryCode: 'DO',
          fundingCurrency: 'USD',
          pickupLocationId: locationId || undefined,
          expedited: false,
          deviceFingerprint: deviceFingerprint(),
        }),
      });

      const created = (await createResponse.json()) as
        | { transactionId: string; reference: string; status: string; kycRequired: boolean }
        | { error: { code: string; message: string } };

      if (!createResponse.ok) {
        setError('error' in created ? created.error.message : m.errors.generic);
        return;
      }
      if (!('transactionId' in created)) return;

      // The server decided verification is required. It is not optional and the
      // client cannot skip it.
      if (created.status === 'KYC_REQUIRED') {
        router.push(`/verify-identity?tx=${created.transactionId}`);
        return;
      }

      // 2. Payment intent.
      const intentResponse = await fetch(`/api/transactions/${created.transactionId}/payment`, {
        method: 'POST',
        headers: { 'content-type': 'application/json', 'idempotency-key': idempotencyKey() },
        body: JSON.stringify({}),
      });
      if (!intentResponse.ok) {
        const payload = (await intentResponse.json()) as { error?: { message: string } };
        setError(payload.error?.message ?? m.errors.paymentFailed);
        return;
      }

      // 3. Confirm. In a real integration the token comes from the provider's
      //    hosted fields; here the demo scenario selector stands in for that.
      const confirmResponse = await fetch(`/api/transactions/${created.transactionId}/payment`, {
        method: 'PUT',
        headers: { 'content-type': 'application/json', 'idempotency-key': idempotencyKey() },
        body: JSON.stringify({ paymentToken: scenario }),
      });

      const confirmed = (await confirmResponse.json()) as {
        status: string;
        reference: string;
        pickupCode: string | null;
        pickupSecret: string | null;
        expiresAt: string | null;
        collectableFrom: string | null;
        transactionId: string;
        failureMessage?: string | null;
        error?: { message: string };
      };

      if (!confirmResponse.ok) {
        setError(confirmed.error?.message ?? m.errors.paymentFailed);
        return;
      }

      if (confirmed.status === 'PAYMENT_FAILED') {
        setError(confirmed.failureMessage ?? m.errors.paymentFailed);
        return;
      }

      setResult({
        status: confirmed.status,
        reference: confirmed.reference,
        pickupCode: confirmed.pickupCode,
        pickupSecret: confirmed.pickupSecret,
        expiresAt: confirmed.expiresAt,
        collectableFrom: confirmed.collectableFrom,
        transactionId: confirmed.transactionId,
      });
      setStep('result');
      router.refresh();
    } catch {
      setError(m.errors.generic);
    } finally {
      setPending(false);
    }
  }

  const selectedLocation = locations.find((l) => l.id === locationId);

  // ------------------------------------------------------------------ result
  if (step === 'result' && result) {
    return (
      <ResultPanel
        m={m}
        locale={locale}
        result={result}
        payoutLabel={quote ? money(quote.payoutAmountMinor, quote.payoutCurrency) : ''}
      />
    );
  }

  return (
    <div className="mx-auto max-w-xl space-y-6">
      <StepIndicator step={step} />

      {/* ------------------------------------------------------------ amount */}
      {step === 'amount' ? (
        <div className="card overflow-hidden">
          <div className="border-b border-navy-100 bg-navy-50/50 p-5">
            <label htmlFor="amount" className="field-label">
              {m.calculator.amountToReceive}
            </label>
            <div className="relative">
              <span className="pointer-events-none absolute left-4 top-1/2 -translate-y-1/2 text-lg font-semibold text-navy-400">
                RD$
              </span>
              <input
                id="amount"
                type="text"
                inputMode="numeric"
                value={amount}
                onChange={(event) => setAmount(event.target.value.replace(/[^\d]/g, ''))}
                className="field-input tabular pl-14 text-2xl font-bold"
              />
            </div>
          </div>

          <div className="p-5">
            {quote ? (
              <>
                <QuoteBreakdown m={m} quote={quote} money={money} />
                <p className="mt-4 rounded-lg bg-success-50 p-3 text-center text-sm font-semibold text-success-700">
                  {interpolate(m.calculator.guarantee, {
                    amount: money(quote.payoutAmountMinor, quote.payoutCurrency),
                  })}
                </p>
              </>
            ) : (
              <p className="py-8 text-center text-sm text-navy-400">
                {quoteLoading ? m.calculator.recalculating : m.common.loading}
              </p>
            )}

            {error ? (
              <p className="field-error mt-3" role="alert">
                {error}
              </p>
            ) : null}

            <button
              type="button"
              disabled={!quote || quoteLoading}
              onClick={() => setStep('location')}
              className="btn-primary mt-5 w-full text-lg"
            >
              {m.common.continue}
            </button>
          </div>
        </div>
      ) : null}

      {/* ---------------------------------------------------------- location */}
      {step === 'location' ? (
        <div className="card">
          <div className="border-b border-navy-100 p-5">
            <h2 className="font-semibold text-navy-900">{m.transaction.choosePickup}</h2>
            <p className="mt-1 text-sm text-navy-500">{m.transaction.choosePickupHint}</p>
          </div>

          <ul className="max-h-[420px] divide-y divide-navy-100 overflow-y-auto">
            {locations.map((location) => (
              <li key={location.id}>
                <label className="flex cursor-pointer items-start gap-3 p-4 hover:bg-navy-50">
                  <input
                    type="radio"
                    name="location"
                    value={location.id}
                    checked={locationId === location.id}
                    onChange={() => setLocationId(location.id)}
                    className="mt-1 h-5 w-5 text-larimar-600 focus:ring-larimar-500"
                  />
                  <span className="min-w-0 flex-1">
                    <span className="block font-medium text-navy-900">{location.branchName}</span>
                    <span className="block text-sm text-navy-500">{location.institutionName}</span>
                    <span className="block text-sm text-navy-500">
                      {location.city}, {location.province}
                    </span>
                    {location.isDemo && location.demoNotice ? (
                      <span className="mt-2 block rounded border border-warning-500/40 bg-warning-50 px-2 py-1 text-[11px] font-bold uppercase tracking-wide text-warning-700">
                        {location.demoNotice}
                      </span>
                    ) : null}
                  </span>
                </label>
              </li>
            ))}
          </ul>

          <div className="flex gap-3 border-t border-navy-100 p-5">
            <button type="button" onClick={() => setStep('amount')} className="btn-secondary flex-1">
              {m.common.back}
            </button>
            <button
              type="button"
              disabled={!locationId}
              onClick={() => setStep('review')}
              className="btn-primary flex-1"
            >
              {m.common.continue}
            </button>
          </div>
        </div>
      ) : null}

      {/* ------------------------------------------------------------ review */}
      {step === 'review' && quote ? (
        <div className="space-y-4">
          <div className="card p-5">
            <div className="rounded-xl bg-larimar-50 p-5 text-center">
              <p className="text-xs font-semibold uppercase tracking-wide text-larimar-700">
                {m.calculator.youReceive}
              </p>
              <p className="amount-hero mt-1 text-larimar-900">
                {money(quote.payoutAmountMinor, quote.payoutCurrency)}
              </p>
            </div>

            <div className="mt-4">
              <QuoteBreakdown m={m} quote={quote} money={money} />
            </div>

            {selectedLocation ? (
              <div className="mt-4 rounded-xl border border-navy-100 p-4">
                <p className="text-xs font-medium uppercase tracking-wide text-navy-400">
                  {m.transaction.pickupLocation}
                </p>
                <p className="mt-1 font-medium text-navy-900">{selectedLocation.branchName}</p>
                <p className="text-sm text-navy-500">
                  {selectedLocation.institutionName} · {selectedLocation.city}
                </p>
                {selectedLocation.demoNotice ? (
                  <p className="mt-2 rounded border border-warning-500/40 bg-warning-50 px-2 py-1 text-[11px] font-bold uppercase tracking-wide text-warning-700">
                    {selectedLocation.demoNotice}
                  </p>
                ) : null}
              </div>
            ) : null}
          </div>

          {/* The demo stand-in for a provider's hosted card fields. */}
          <div className="card border-dashed p-5">
            <h3 className="font-semibold text-navy-900">{m.transaction.demoPaymentTitle}</h3>
            <p className="mt-1 text-sm text-navy-500">{m.transaction.demoPaymentBody}</p>
            <select
              value={scenario}
              onChange={(event) => setScenario(event.target.value)}
              className="field-input mt-3"
              aria-label={m.transaction.paymentMethod}
            >
              <option value={MOCK_TOKENS.SUCCESS_DEBIT}>{m.transaction.demoScenarioSuccess}</option>
              <option value={MOCK_TOKENS.SUCCESS_CREDIT}>
                {m.transaction.demoScenarioSuccessCredit}
              </option>
              <option value={MOCK_TOKENS.DECLINE_FUNDS}>{m.transaction.demoScenarioDecline}</option>
              <option value={MOCK_TOKENS.DECLINE_FRAUD}>{m.transaction.demoScenarioFraud}</option>
              <option value={MOCK_TOKENS.DECLINE_EXPIRED}>{m.transaction.demoScenarioExpired}</option>
              <option value={MOCK_TOKENS.REQUIRES_3DS}>{m.transaction.demoScenario3ds}</option>
            </select>
          </div>

          {!kycApproved ? (
            <div className="rounded-xl border border-larimar-200 bg-larimar-50 p-4 text-sm text-larimar-900">
              {m.dashboard.kycBannerBody}
            </div>
          ) : null}

          {error ? (
            <p className="rounded-lg bg-danger-50 p-3 text-sm text-danger-600" role="alert">
              {error}
            </p>
          ) : null}

          <div className="flex gap-3">
            <button
              type="button"
              onClick={() => setStep('location')}
              disabled={pending}
              className="btn-secondary flex-1"
            >
              {m.common.back}
            </button>
            <button
              type="button"
              onClick={() => void submit()}
              disabled={pending}
              className="btn-primary flex-1 text-lg"
            >
              {pending ? m.transaction.processing : m.transaction.confirmAndPay}
            </button>
          </div>
        </div>
      ) : null}
    </div>
  );
}

function StepIndicator({ step }: { step: Step }) {
  const order: Step[] = ['amount', 'location', 'review'];
  const index = order.indexOf(step);
  return (
    <div className="flex items-center gap-2" aria-hidden>
      {order.map((_, i) => (
        <div
          key={i}
          className={`h-1.5 flex-1 rounded-full ${i <= index ? 'bg-larimar-500' : 'bg-navy-100'}`}
        />
      ))}
    </div>
  );
}

function QuoteBreakdown({
  m,
  quote,
  money,
}: {
  m: Messages;
  quote: Quote;
  money: (minor: string, currency: string) => string;
}) {
  return (
    <div className="divide-y divide-navy-100">
      <div className="amount-row text-sm">
        <span>{m.calculator.exchangeRate}</span>
        <span className="amount-row-value">1 USD = {quote.effectiveRate} DOP</span>
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
  );
}

/**
 * The pickup code, shown exactly once.
 *
 * It is not stored in a retrievable form, so this screen is the only place the
 * plaintext ever exists. The copy says so explicitly.
 */
function ResultPanel({
  m,
  locale,
  result,
  payoutLabel,
}: {
  m: Messages;
  locale: Locale;
  result: {
    status: string;
    reference: string;
    pickupCode: string | null;
    pickupSecret: string | null;
    expiresAt: string | null;
    collectableFrom: string | null;
    transactionId: string;
  };
  payoutLabel: string;
}) {
  const [copied, setCopied] = useState(false);

  if (result.status === 'COMPLIANCE_REVIEW') {
    return (
      <div className="mx-auto max-w-xl">
        <div className="card p-6 text-center">
          <h2 className="text-xl font-bold text-navy-900">{m.status.complianceReview}</h2>
          <p className="mt-2 text-navy-600">{m.errors.complianceHold}</p>
          <p className="mt-4 text-sm text-navy-400">{result.reference}</p>
          <Link href={`/transactions/${result.transactionId}`} className="btn-primary mt-6 w-full">
            {m.common.viewDetails}
          </Link>
        </div>
      </div>
    );
  }

  return (
    <div className="mx-auto max-w-xl space-y-4">
      <div className="card overflow-hidden">
        <div className="bg-success-50 px-6 py-4 text-center">
          <p className="font-semibold text-success-700">{m.status.readyForPickup}</p>
        </div>

        <div className="p-6 text-center">
          <p className="text-xs font-semibold uppercase tracking-wide text-navy-400">
            {m.pickup.codeLabel}
          </p>
          <p className="pickup-code mt-2 text-3xl font-bold text-navy-900 sm:text-4xl">
            {result.pickupCode}
          </p>

          <button
            type="button"
            onClick={() => {
              if (result.pickupCode) {
                void navigator.clipboard.writeText(result.pickupCode);
                setCopied(true);
                setTimeout(() => setCopied(false), 2000);
              }
            }}
            className="btn-secondary mt-4 px-6 text-sm"
          >
            {copied ? m.common.copied : m.common.copy}
          </button>

          <div className="mt-6 border-t border-navy-100 pt-5">
            <p className="text-xs uppercase tracking-wide text-navy-400">
              {m.pickup.amountToCollect}
            </p>
            <p className="tabular mt-1 text-2xl font-bold text-navy-900">{payoutLabel}</p>
          </div>

          {result.expiresAt ? (
            <p className="mt-4 text-sm text-navy-500">
              {interpolate(m.pickup.expiresOn, {
                date: new Intl.DateTimeFormat(INTL_LOCALES[locale], { dateStyle: 'long' }).format(
                  new Date(result.expiresAt),
                ),
              })}
            </p>
          ) : null}
        </div>
      </div>

      {result.collectableFrom ? (
        <div className="rounded-xl border border-larimar-300 bg-larimar-50 p-4">
          <p className="text-sm font-semibold text-larimar-900">{m.pickup.securityHoldTitle}</p>
          <p className="mt-1 text-sm text-larimar-800">{m.pickup.securityHoldBody}</p>
          <p className="mt-2 text-sm font-semibold text-larimar-900">
            {interpolate(m.pickup.collectableFrom, {
              date: new Intl.DateTimeFormat(INTL_LOCALES[locale], {
                dateStyle: 'medium',
                timeStyle: 'short',
              }).format(new Date(result.collectableFrom)),
            })}
          </p>
        </div>
      ) : null}

      <div className="rounded-xl border border-warning-500/40 bg-warning-50 p-4">
        <p className="text-sm font-semibold text-warning-700">{m.pickup.securityWarning}</p>
      </div>

      <div className="rounded-xl border border-navy-100 bg-white p-4 text-sm text-navy-600">
        {m.pickup.codeSubtitle}
      </div>

      <div className="flex gap-3">
        <Link href={`/transactions/${result.transactionId}`} className="btn-secondary flex-1">
          {m.common.viewDetails}
        </Link>
        <Link href="/dashboard" className="btn-primary flex-1">
          {m.nav.dashboard}
        </Link>
      </div>
    </div>
  );
}
