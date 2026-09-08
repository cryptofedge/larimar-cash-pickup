'use client';

import { useState } from 'react';
import { useRouter } from 'next/navigation';

export function CancelTransactionButton({
  transactionId,
  label,
  confirmLabel,
  errorLabel,
}: {
  transactionId: string;
  label: string;
  confirmLabel: string;
  errorLabel: string;
}) {
  const router = useRouter();
  const [pending, setPending] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function cancel() {
    if (!window.confirm(confirmLabel)) return;

    setPending(true);
    setError(null);
    try {
      const response = await fetch(`/api/transactions/${transactionId}/cancel`, {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ reason: 'Cancelled by customer' }),
      });
      if (!response.ok) {
        const payload = (await response.json()) as { error?: { message: string } };
        setError(payload.error?.message ?? errorLabel);
        return;
      }
      router.refresh();
    } catch {
      setError(errorLabel);
    } finally {
      setPending(false);
    }
  }

  return (
    <div>
      <button type="button" onClick={() => void cancel()} disabled={pending} className="btn-ghost text-sm text-danger-600">
        {label}
      </button>
      {error ? (
        <p className="field-error" role="alert">
          {error}
        </p>
      ) : null}
    </div>
  );
}
