'use client';

import { useState } from 'react';
import { useRouter } from 'next/navigation';
import { idempotencyKey } from '@/lib/client/device';

type Action = 'ISSUE' | 'RECONCILE' | 'PAY' | 'CANCEL';

/**
 * Settlement lifecycle controls.
 *
 * Which buttons render depends on the batch's current status, mirroring the
 * server-side transition graph. That is presentation only — every action is
 * re-checked server-side for both the legal transition and the caller's
 * permission, and `PAY` is reachable only from `RECONCILED` because money must
 * never leave before both sides agree the figure.
 */
export function SettlementActions({
  batchId,
  status,
  grossPayoutMinor,
  canGenerate,
  canReconcile,
  canPay,
}: {
  batchId: string;
  status: string;
  grossPayoutMinor: string;
  canGenerate: boolean;
  canReconcile: boolean;
  canPay: boolean;
}) {
  const router = useRouter();
  const [pending, setPending] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [notice, setNotice] = useState<string | null>(null);

  async function act(action: Action, extra: Record<string, string> = {}) {
    setPending(true);
    setError(null);
    setNotice(null);

    try {
      const response = await fetch('/api/admin/settlement', {
        method: 'PUT',
        headers: { 'content-type': 'application/json', 'idempotency-key': idempotencyKey() },
        body: JSON.stringify({ batchId, action, ...extra }),
      });

      const payload = (await response.json()) as {
        status?: string;
        matched?: boolean;
        summary?: string;
        error?: { message: string };
      };

      if (!response.ok) {
        setError(payload.error?.message ?? 'Something went wrong.');
        return;
      }

      if (action === 'RECONCILE' && payload.summary) {
        setNotice(payload.summary);
      }
      router.refresh();
    } catch {
      setError('Something went wrong.');
    } finally {
      setPending(false);
    }
  }

  function reconcile() {
    const reported = window.prompt(
      `Partner's reported total, in integer minor units.\nOurs: ${grossPayoutMinor}`,
      grossPayoutMinor,
    );
    if (!reported) return;
    if (!/^\d+$/.test(reported.trim())) {
      setError('Enter a whole number of minor units.');
      return;
    }

    const extra: Record<string, string> = { partnerReportedMinor: reported.trim() };

    // A variance is never waved through silently — accepting one requires an
    // explicit written reason, recorded in the audit log.
    if (reported.trim() !== grossPayoutMinor) {
      const note = window.prompt(
        'Figures differ. Explain why you are accepting this variance, or cancel to raise a dispute.',
      );
      if (!note) {
        void act('RECONCILE', extra); // no note -> the batch moves to DISPUTED
        return;
      }
      extra.varianceNote = note;
    }

    void act('RECONCILE', extra);
  }

  function pay() {
    const reference = window.prompt('Bank transfer reference for this settlement:');
    if (!reference) return;
    if (!window.confirm('Confirm the funds have actually been transferred to the partner.')) return;
    void act('PAY', { paymentReference: reference });
  }

  function cancel() {
    const reason = window.prompt('Why is this batch being cancelled?');
    if (!reason) return;
    void act('CANCEL', { reason });
  }

  return (
    <div>
      <div className="flex flex-wrap gap-2">
        {status === 'DRAFT' && canGenerate ? (
          <button
            type="button"
            onClick={() => void act('ISSUE')}
            disabled={pending}
            className="btn-secondary px-4 py-2 text-sm"
          >
            Issue to partner
          </button>
        ) : null}

        {(status === 'ISSUED' || status === 'DISPUTED') && canReconcile ? (
          <button
            type="button"
            onClick={reconcile}
            disabled={pending}
            className="btn-secondary px-4 py-2 text-sm"
          >
            Reconcile
          </button>
        ) : null}

        {status === 'RECONCILED' && canPay ? (
          <button
            type="button"
            onClick={pay}
            disabled={pending}
            className="btn-success px-4 py-2 text-sm"
          >
            Mark paid
          </button>
        ) : null}

        {(status === 'DRAFT' || status === 'ISSUED' || status === 'DISPUTED') && canGenerate ? (
          <button
            type="button"
            onClick={cancel}
            disabled={pending}
            className="btn-ghost px-3 py-2 text-sm text-danger-600"
          >
            Cancel
          </button>
        ) : null}

        <a
          href={`/api/admin/settlement/${batchId}?format=csv`}
          className="btn-ghost px-3 py-2 text-sm"
        >
          CSV
        </a>
      </div>

      {notice ? <p className="mt-2 text-xs text-navy-500">{notice}</p> : null}
      {error ? (
        <p className="mt-2 text-xs text-danger-600" role="alert">
          {error}
        </p>
      ) : null}
    </div>
  );
}

/** Generate a batch for an institution's previous settlement day. */
export function GenerateSettlementButton({
  institutions,
}: {
  institutions: { id: string; name: string }[];
}) {
  const router = useRouter();
  const [institutionId, setInstitutionId] = useState(institutions[0]?.id ?? '');
  const [pending, setPending] = useState(false);
  const [result, setResult] = useState<string | null>(null);

  async function generate() {
    setPending(true);
    setResult(null);
    try {
      const response = await fetch('/api/admin/settlement', {
        method: 'POST',
        headers: { 'content-type': 'application/json', 'idempotency-key': idempotencyKey() },
        body: JSON.stringify({ institutionId }),
      });
      const payload = (await response.json()) as {
        reference?: string;
        payoutCount?: number;
        alreadyExisted?: boolean;
        error?: { message: string };
      };

      setResult(
        response.ok
          ? payload.alreadyExisted
            ? `${payload.reference} already existed (${payload.payoutCount} payouts)`
            : `Generated ${payload.reference} — ${payload.payoutCount} payouts`
          : (payload.error?.message ?? 'Failed'),
      );
      if (response.ok) router.refresh();
    } catch {
      setResult('Failed');
    } finally {
      setPending(false);
    }
  }

  if (institutions.length === 0) return null;

  return (
    <div className="flex flex-wrap items-center gap-2">
      <select
        value={institutionId}
        onChange={(event) => setInstitutionId(event.target.value)}
        className="field-input w-auto"
        aria-label="Institution"
      >
        {institutions.map((institution) => (
          <option key={institution.id} value={institution.id}>
            {institution.name}
          </option>
        ))}
      </select>
      <button
        type="button"
        onClick={() => void generate()}
        disabled={pending || !institutionId}
        className="btn-primary px-4 py-2 text-sm"
      >
        {pending ? 'Generating…' : 'Generate previous day'}
      </button>
      {result ? <span className="text-xs text-navy-500">{result}</span> : null}
    </div>
  );
}
