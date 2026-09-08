'use client';

import { useState } from 'react';
import { useRouter } from 'next/navigation';

/**
 * Compliance decision buttons.
 *
 * Every action here calls the same endpoint, which re-checks the analyst's
 * permission server-side. Rendering these buttons is a convenience, not an
 * authorisation — a user who forged their way to this component still gets a 403.
 */
export function ComplianceActions({
  transactionId,
  status,
  labels,
}: {
  transactionId: string;
  status: string;
  labels: { release: string; reject: string; hold: string; reason: string; error: string };
}) {
  const router = useRouter();
  const [pending, setPending] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function act(action: 'HOLD' | 'RELEASE' | 'REJECT') {
    const reason = window.prompt(labels.reason);
    if (!reason) return;

    setPending(true);
    setError(null);
    try {
      const response = await fetch('/api/compliance/review', {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ transactionId, action, reason }),
      });

      if (!response.ok) {
        const payload = (await response.json()) as { error?: { message: string } };
        setError(payload.error?.message ?? labels.error);
        return;
      }
      router.refresh();
    } catch {
      setError(labels.error);
    } finally {
      setPending(false);
    }
  }

  const underReview = status === 'COMPLIANCE_REVIEW';

  return (
    <div className="shrink-0">
      <div className="flex flex-wrap gap-2">
        {underReview ? (
          <>
            <button
              type="button"
              onClick={() => void act('RELEASE')}
              disabled={pending}
              className="btn-success px-4 py-2 text-sm"
            >
              {labels.release}
            </button>
            <button
              type="button"
              onClick={() => void act('REJECT')}
              disabled={pending}
              className="btn-secondary px-4 py-2 text-sm text-danger-600"
            >
              {labels.reject}
            </button>
          </>
        ) : (
          <button
            type="button"
            onClick={() => void act('HOLD')}
            disabled={pending}
            className="btn-secondary px-4 py-2 text-sm text-warning-700"
          >
            {labels.hold}
          </button>
        )}
      </div>
      {error ? (
        <p className="mt-2 text-xs text-danger-600" role="alert">
          {error}
        </p>
      ) : null}
    </div>
  );
}
