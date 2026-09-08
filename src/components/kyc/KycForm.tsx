'use client';

import { useState } from 'react';
import { useRouter } from 'next/navigation';
import type { Messages } from '@/i18n';
import { idempotencyKey } from '@/lib/client/device';

export function KycForm({
  m,
  transactionId,
  defaults,
}: {
  m: Messages;
  transactionId?: string;
  defaults?: { firstName?: string; lastName?: string };
}) {
  const router = useRouter();
  const [error, setError] = useState<string | null>(null);
  const [pending, setPending] = useState(false);
  const [outcome, setOutcome] = useState<string | null>(null);

  async function handleSubmit(event: React.FormEvent<HTMLFormElement>) {
    event.preventDefault();
    setPending(true);
    setError(null);

    const form = new FormData(event.currentTarget);

    try {
      const response = await fetch('/api/kyc', {
        method: 'POST',
        headers: { 'content-type': 'application/json', 'idempotency-key': idempotencyKey() },
        body: JSON.stringify({
          firstName: form.get('firstName'),
          lastName: form.get('lastName'),
          dateOfBirth: form.get('dateOfBirth'),
          documentType: form.get('documentType'),
          documentNumber: form.get('documentNumber'),
          documentCountry: String(form.get('documentCountry') ?? '').toUpperCase(),
          residenceCountry: String(form.get('residenceCountry') ?? '').toUpperCase(),
          transactionId: transactionId || undefined,
        }),
      });

      const payload = (await response.json()) as
        | { status: string; verificationId: string }
        | { error: { message: string } };

      if (!response.ok) {
        setError('error' in payload ? payload.error.message : m.errors.generic);
        return;
      }

      const status = 'status' in payload ? payload.status : '';
      setOutcome(status);

      if (status === 'APPROVED' && transactionId) {
        router.push(`/transactions/${transactionId}`);
        router.refresh();
      } else {
        router.refresh();
      }
    } catch {
      setError(m.errors.generic);
    } finally {
      setPending(false);
    }
  }

  if (outcome === 'APPROVED') {
    return (
      <div className="rounded-xl bg-success-50 p-5 text-center" role="status">
        <p className="font-semibold text-success-700">{m.kyc.approvedTitle}</p>
      </div>
    );
  }

  if (outcome === 'REJECTED') {
    return (
      <div className="rounded-xl bg-danger-50 p-5" role="status">
        <p className="font-semibold text-danger-600">{m.kyc.rejectedTitle}</p>
        <p className="mt-1 text-sm text-danger-600">{m.kyc.rejectedBody}</p>
      </div>
    );
  }

  if (outcome === 'PENDING' || outcome === 'MANUAL_REVIEW') {
    return (
      <div className="rounded-xl bg-larimar-50 p-5" role="status">
        <p className="font-semibold text-larimar-900">{m.kyc.pendingTitle}</p>
        <p className="mt-1 text-sm text-larimar-800">{m.kyc.pendingBody}</p>
      </div>
    );
  }

  return (
    <form onSubmit={handleSubmit} className="space-y-4">
      <div className="grid gap-4 sm:grid-cols-2">
        <div>
          <label htmlFor="firstName" className="field-label">
            {m.auth.firstName}
          </label>
          <input
            id="firstName"
            name="firstName"
            required
            defaultValue={defaults?.firstName ?? ''}
            className="field-input"
          />
        </div>
        <div>
          <label htmlFor="lastName" className="field-label">
            {m.auth.lastName}
          </label>
          <input
            id="lastName"
            name="lastName"
            required
            defaultValue={defaults?.lastName ?? ''}
            className="field-input"
          />
        </div>
      </div>

      <div>
        <label htmlFor="dateOfBirth" className="field-label">
          {m.kyc.dateOfBirth}
        </label>
        <input id="dateOfBirth" name="dateOfBirth" type="date" required className="field-input" />
      </div>

      <div className="grid gap-4 sm:grid-cols-2">
        <div>
          <label htmlFor="documentType" className="field-label">
            {m.kyc.documentType}
          </label>
          <select id="documentType" name="documentType" required className="field-input" defaultValue="PASSPORT">
            <option value="PASSPORT">{m.kyc.passport}</option>
            <option value="NATIONAL_ID">{m.kyc.nationalId}</option>
            <option value="DRIVERS_LICENSE">{m.kyc.driversLicense}</option>
            <option value="RESIDENCE_PERMIT">{m.kyc.residencePermit}</option>
          </select>
        </div>
        <div>
          <label htmlFor="documentNumber" className="field-label">
            {m.kyc.documentNumber}
          </label>
          <input
            id="documentNumber"
            name="documentNumber"
            required
            minLength={4}
            maxLength={50}
            className="field-input"
            aria-describedby="doc-hint"
          />
          {/* Stated at the point of entry, where it actually reassures. */}
          <p id="doc-hint" className="mt-1 text-xs text-navy-400">
            {m.kyc.subtitle}
          </p>
        </div>
      </div>

      <div className="grid gap-4 sm:grid-cols-2">
        <div>
          <label htmlFor="documentCountry" className="field-label">
            {m.kyc.documentCountry}
          </label>
          <input
            id="documentCountry"
            name="documentCountry"
            required
            maxLength={2}
            minLength={2}
            placeholder="US"
            className="field-input uppercase"
          />
        </div>
        <div>
          <label htmlFor="residenceCountry" className="field-label">
            {m.kyc.residenceCountry}
          </label>
          <input
            id="residenceCountry"
            name="residenceCountry"
            required
            maxLength={2}
            minLength={2}
            placeholder="US"
            className="field-input uppercase"
          />
        </div>
      </div>

      {error ? (
        <p className="field-error" role="alert">
          {error}
        </p>
      ) : null}

      <button type="submit" disabled={pending} className="btn-primary w-full">
        {pending ? m.common.loading : m.kyc.submit}
      </button>
    </form>
  );
}
