'use client';

import { useState } from 'react';
import type { Messages } from '@/i18n';
import { INTL_LOCALES, interpolate, type Locale } from '@/i18n/config';
import { formatMoney, fromMinor } from '@/lib/domain/money';
import { idempotencyKey } from '@/lib/client/device';

interface AgentView {
  reference: string;
  status: string;
  payoutAmountMinor: string;
  payoutCurrency: string;
  alreadyPaidMinor: string;
  remainingMinor: string;
  createdAt: string;
  expiresAt: string;
  collectableFrom: string | null;
  acceptedDocuments: string[];
  complianceCleared: boolean;
  complianceNote: string | null;
  locationName: string | null;
  institutionName: string | null;
  isDemoLocation: boolean;
}

type Phase = 'entry' | 'verified' | 'done';

/**
 * The payout window terminal.
 *
 * Designed for someone standing at a counter with a customer waiting: one large
 * input, one large action, and a result that is unambiguous at a glance. The
 * amount to hand over is the biggest thing on the screen.
 *
 * Note what this screen never displays: the customer's name, email, phone, card,
 * funding amount, or history. The agent needs the payout figure and the document
 * requirement, and nothing else.
 */
export function PayoutTerminal({
  m,
  locale,
  locations,
}: {
  m: Messages;
  locale: Locale;
  locations: { id: string; branchName: string; city: string }[];
}) {
  const intl = INTL_LOCALES[locale];
  const [phase, setPhase] = useState<Phase>('entry');
  const [code, setCode] = useState('');
  const [locationId, setLocationId] = useState(locations[0]?.id ?? '');
  const [view, setView] = useState<AgentView | null>(null);
  const [transactionId, setTransactionId] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [pending, setPending] = useState(false);
  const [identityConfirmed, setIdentityConfirmed] = useState(false);
  const [documentType, setDocumentType] = useState('PASSPORT');
  const [documentLast4, setDocumentLast4] = useState('');
  const [outcome, setOutcome] = useState<{ kind: 'paid' | 'rejected' | 'escalated'; detail: string } | null>(null);

  const money = (minor: string, currency: string) =>
    formatMoney(fromMinor(BigInt(minor), currency), intl);

  function reset() {
    setPhase('entry');
    setCode('');
    setView(null);
    setTransactionId(null);
    setError(null);
    setIdentityConfirmed(false);
    setDocumentLast4('');
    setOutcome(null);
  }

  async function verify(event: React.FormEvent<HTMLFormElement>) {
    event.preventDefault();
    setPending(true);
    setError(null);

    try {
      const response = await fetch('/api/pickup/verify', {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ code, locationId }),
      });

      const payload = (await response.json()) as
        | { transactionId: string; transaction: AgentView }
        | { error: { code: string; message: string } };

      if (!response.ok) {
        const errorCode = 'error' in payload ? payload.error.code : '';
        setError(
          errorCode === 'PICKUP_CODE_EXPIRED'
            ? m.agent.expiredCode
            : errorCode === 'PICKUP_CODE_LOCKED' || errorCode === 'PICKUP_CODE_ATTEMPTS_EXCEEDED'
              ? m.agent.lockedCode
              : errorCode === 'PICKUP_CODE_ALREADY_REDEEMED'
                ? m.agent.alreadyRedeemed
                : errorCode === 'PICKUP_CODE_NOT_YET_COLLECTABLE'
              ? m.agent.notYetCollectable
            : errorCode === 'PICKUP_NOT_READY'
                  ? m.agent.notReady
                  : errorCode === 'FORBIDDEN'
                    ? m.agent.wrongLocation
                    : m.agent.invalidCode,
        );
        return;
      }

      if ('transaction' in payload) {
        setView(payload.transaction);
        setTransactionId(payload.transactionId);
        setPhase('verified');
      }
    } catch {
      setError(m.errors.generic);
    } finally {
      setPending(false);
    }
  }

  async function approve() {
    if (!view || !identityConfirmed) return;
    setPending(true);
    setError(null);

    try {
      const response = await fetch('/api/pickup/redeem', {
        method: 'POST',
        headers: { 'content-type': 'application/json', 'idempotency-key': idempotencyKey() },
        body: JSON.stringify({
          code,
          locationId,
          documentType,
          documentLast4: documentLast4 || '****',
          amountMinor: view.remainingMinor,
          identityConfirmed: true,
        }),
      });

      const payload = (await response.json()) as
        | { reference: string; paidMinor: string; fullyPaid: boolean }
        | { error: { message: string } };

      if (!response.ok) {
        setError('error' in payload ? payload.error.message : m.errors.generic);
        return;
      }

      setOutcome({
        kind: 'paid',
        detail: money(view.remainingMinor, view.payoutCurrency),
      });
      setPhase('done');
    } catch {
      setError(m.errors.generic);
    } finally {
      setPending(false);
    }
  }

  async function act(action: 'reject' | 'escalate') {
    if (!transactionId) return;
    const reason = window.prompt(
      action === 'reject' ? m.agent.rejectReason : m.agent.escalateReason,
    );
    if (!reason) return;

    setPending(true);
    setError(null);

    try {
      const response = await fetch(`/api/pickup/${action}`, {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ transactionId, locationId, reason }),
      });

      if (!response.ok) {
        const payload = (await response.json()) as { error?: { message: string } };
        setError(payload.error?.message ?? m.errors.generic);
        return;
      }

      setOutcome({
        kind: action === 'reject' ? 'rejected' : 'escalated',
        detail: reason,
      });
      setPhase('done');
    } catch {
      setError(m.errors.generic);
    } finally {
      setPending(false);
    }
  }

  // ------------------------------------------------------------------- done
  if (phase === 'done' && outcome) {
    const tone =
      outcome.kind === 'paid'
        ? 'bg-success-50 text-success-700'
        : outcome.kind === 'escalated'
          ? 'bg-warning-50 text-warning-700'
          : 'bg-danger-50 text-danger-600';

    return (
      <div className="mx-auto max-w-lg">
        <div className={`rounded-2xl p-8 text-center ${tone}`}>
          <p className="text-2xl font-bold">
            {outcome.kind === 'paid'
              ? m.agent.approved
              : outcome.kind === 'escalated'
                ? m.agent.escalated
                : m.agent.rejected}
          </p>
          <p className="tabular mt-3 text-3xl font-bold">{outcome.detail}</p>
        </div>
        <button type="button" onClick={reset} className="btn-primary mt-6 w-full text-lg">
          {m.agent.enterCode}
        </button>
      </div>
    );
  }

  // --------------------------------------------------------------- verified
  if (phase === 'verified' && view) {
    return (
      <div className="mx-auto max-w-lg space-y-4">
        <div className="card overflow-hidden">
          <div className="bg-navy-900 px-6 py-3 text-center">
            <p className="text-xs font-semibold uppercase tracking-wide text-larimar-200">
              {m.agent.transactionFound}
            </p>
            <p className="font-mono text-sm text-white">{view.reference}</p>
          </div>

          <div className="p-6 text-center">
            <p className="text-xs font-semibold uppercase tracking-wide text-navy-400">
              {m.agent.amountToPay}
            </p>
            <p className="amount-hero mt-1">{money(view.remainingMinor, view.payoutCurrency)}</p>
            {view.alreadyPaidMinor !== '0' ? (
              <p className="tabular mt-1 text-sm text-navy-500">
                {money(view.alreadyPaidMinor, view.payoutCurrency)} /{' '}
                {money(view.payoutAmountMinor, view.payoutCurrency)}
              </p>
            ) : null}
          </div>

          <div className="border-t border-navy-100 px-6 py-4">
            <p className="text-xs font-semibold uppercase tracking-wide text-navy-400">
              {m.agent.complianceStatus}
            </p>
            <p
              className={`mt-1 font-semibold ${view.complianceCleared ? 'text-success-700' : 'text-danger-600'}`}
            >
              {view.complianceCleared ? m.agent.complianceClear : m.agent.complianceHold}
            </p>
          </div>

          {view.collectableFrom && new Date(view.collectableFrom) > new Date() ? (
            <div className="border-t border-larimar-200 bg-larimar-50 px-6 py-4">
              <p className="text-xs font-semibold uppercase tracking-wide text-larimar-700">
                {m.pickup.securityHoldTitle}
              </p>
              <p className="mt-1 text-sm font-semibold text-larimar-900">
                {interpolate(m.agent.collectableAt, {
                  date: new Date(view.collectableFrom).toLocaleString(intl),
                })}
              </p>
            </div>
          ) : null}

          <div className="border-t border-navy-100 px-6 py-4">
            <p className="text-xs font-semibold uppercase tracking-wide text-navy-400">
              {m.agent.idRequirements}
            </p>
            <p className="mt-1 text-sm text-navy-700">{view.acceptedDocuments.join(' · ')}</p>
          </div>

          <div className="grid grid-cols-2 gap-px border-t border-navy-100 bg-navy-100 text-sm">
            <div className="bg-white px-6 py-3">
              <p className="text-xs text-navy-400">{m.agent.createdAt}</p>
              <p className="text-navy-700">{new Date(view.createdAt).toLocaleDateString(intl)}</p>
            </div>
            <div className="bg-white px-6 py-3">
              <p className="text-xs text-navy-400">{m.agent.expiresAt}</p>
              <p className="text-navy-700">{new Date(view.expiresAt).toLocaleDateString(intl)}</p>
            </div>
          </div>

          {view.isDemoLocation ? (
            <div className="border-t border-warning-500/40 bg-warning-50 px-6 py-2">
              <p className="text-[11px] font-bold uppercase tracking-wide text-warning-700">
                {m.pickup.demoLocationBanner}
              </p>
            </div>
          ) : null}
        </div>

        {/* ------------------------------------------- identity confirmation */}
        <div className="card p-5">
          <h3 className="font-semibold text-navy-900">{m.agent.verifyCustomer}</h3>

          <div className="mt-3 grid gap-3 sm:grid-cols-2">
            <div>
              <label htmlFor="documentType" className="field-label">
                {m.agent.documentPresented}
              </label>
              <select
                id="documentType"
                value={documentType}
                onChange={(event) => setDocumentType(event.target.value)}
                className="field-input"
              >
                {view.acceptedDocuments.map((doc) => (
                  <option key={doc} value={doc}>
                    {doc === 'PASSPORT'
                      ? m.kyc.passport
                      : doc === 'NATIONAL_ID'
                        ? m.kyc.nationalId
                        : doc === 'DRIVERS_LICENSE'
                          ? m.kyc.driversLicense
                          : m.kyc.residencePermit}
                  </option>
                ))}
              </select>
            </div>
            <div>
              <label htmlFor="documentLast4" className="field-label">
                {m.agent.documentLast4}
              </label>
              <input
                id="documentLast4"
                value={documentLast4}
                onChange={(event) => setDocumentLast4(event.target.value.replace(/[^\dA-Za-z*]/g, '').slice(0, 4))}
                maxLength={4}
                className="field-input tabular"
              />
            </div>
          </div>

          <label className="mt-4 flex items-start gap-3 text-sm text-navy-700">
            <input
              type="checkbox"
              checked={identityConfirmed}
              onChange={(event) => setIdentityConfirmed(event.target.checked)}
              className="mt-0.5 h-5 w-5 rounded border-navy-300 text-larimar-600 focus:ring-larimar-500"
            />
            <span>{m.agent.confirmIdentity}</span>
          </label>
        </div>

        {error ? (
          <p className="rounded-lg bg-danger-50 p-3 text-sm text-danger-600" role="alert">
            {error}
          </p>
        ) : null}

        <div className="space-y-3">
          <button
            type="button"
            onClick={() => {
              if (window.confirm(interpolate(m.agent.approveConfirm, { amount: money(view.remainingMinor, view.payoutCurrency) }))) {
                void approve();
              }
            }}
            disabled={
              pending ||
              !identityConfirmed ||
              !view.complianceCleared ||
              (view.collectableFrom !== null && new Date(view.collectableFrom) > new Date())
            }
            className="btn-success w-full text-lg"
          >
            {m.agent.approvePickup}
          </button>

          <div className="grid grid-cols-2 gap-3">
            <button
              type="button"
              onClick={() => void act('reject')}
              disabled={pending}
              className="btn-secondary text-danger-600"
            >
              {m.agent.rejectPickup}
            </button>
            <button
              type="button"
              onClick={() => void act('escalate')}
              disabled={pending}
              className="btn-secondary text-warning-700"
            >
              {m.agent.escalate}
            </button>
          </div>

          <button type="button" onClick={reset} className="btn-ghost w-full text-sm">
            {m.common.cancel}
          </button>
        </div>
      </div>
    );
  }

  // ------------------------------------------------------------------ entry
  return (
    <div className="mx-auto max-w-lg">
      <form onSubmit={verify} className="card p-6">
        <h2 className="text-lg font-semibold text-navy-900">{m.agent.enterCode}</h2>

        {locations.length > 1 ? (
          <div className="mt-4">
            <label htmlFor="locationId" className="field-label">
              {m.common.location}
            </label>
            <select
              id="locationId"
              value={locationId}
              onChange={(event) => setLocationId(event.target.value)}
              className="field-input"
            >
              {locations.map((location) => (
                <option key={location.id} value={location.id}>
                  {location.branchName} — {location.city}
                </option>
              ))}
            </select>
          </div>
        ) : null}

        <div className="mt-4">
          <label htmlFor="code" className="field-label">
            {m.pickup.codeLabel}
          </label>
          <input
            id="code"
            value={code}
            onChange={(event) => setCode(event.target.value.toUpperCase())}
            placeholder="DR-XXXX-XXXX"
            autoComplete="off"
            autoFocus
            required
            className="field-input pickup-code text-center text-2xl font-bold uppercase"
          />
        </div>

        {error ? (
          <p className="field-error mt-3" role="alert">
            {error}
          </p>
        ) : null}

        <button type="submit" disabled={pending || !code || !locationId} className="btn-primary mt-5 w-full text-lg">
          {pending ? m.agent.verifying : m.agent.verify}
        </button>

        <p className="mt-4 text-center text-xs text-navy-400">{m.agent.privacyNote}</p>
      </form>
    </div>
  );
}
