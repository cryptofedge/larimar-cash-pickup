'use client';

import { useState } from 'react';
import { useRouter } from 'next/navigation';
import type { Messages } from '@/i18n';

/** Request a reset. Always reports success — no account enumeration. */
export function RequestResetForm({ m }: { m: Messages }) {
  const [sent, setSent] = useState(false);
  const [pending, setPending] = useState(false);

  async function handleSubmit(event: React.FormEvent<HTMLFormElement>) {
    event.preventDefault();
    setPending(true);
    const form = new FormData(event.currentTarget);

    try {
      await fetch('/api/auth/password-reset', {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ email: form.get('email') }),
      });
    } finally {
      // Success is reported regardless of the outcome, by design.
      setSent(true);
      setPending(false);
    }
  }

  if (sent) {
    return (
      <div className="rounded-xl bg-larimar-50 p-5" role="status">
        <p className="text-larimar-900">{m.auth.resetPasswordSent}</p>
      </div>
    );
  }

  return (
    <form onSubmit={handleSubmit} className="space-y-4">
      <div>
        <label htmlFor="email" className="field-label">
          {m.auth.email}
        </label>
        <input id="email" name="email" type="email" required autoComplete="email" className="field-input" />
      </div>
      <button type="submit" disabled={pending} className="btn-primary w-full">
        {pending ? m.common.loading : m.common.submit}
      </button>
    </form>
  );
}

/** Complete a reset with a token. Revokes every existing session on success. */
export function CompleteResetForm({ m, token }: { m: Messages; token: string }) {
  const router = useRouter();
  const [error, setError] = useState<string | null>(null);
  const [pending, setPending] = useState(false);

  async function handleSubmit(event: React.FormEvent<HTMLFormElement>) {
    event.preventDefault();
    setError(null);

    const form = new FormData(event.currentTarget);
    const password = String(form.get('password') ?? '');

    if (password !== String(form.get('confirmPassword') ?? '')) {
      setError(m.auth.passwordMismatch);
      return;
    }

    setPending(true);
    try {
      const response = await fetch('/api/auth/password-reset', {
        method: 'PUT',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ token, password }),
      });

      if (!response.ok) {
        const payload = (await response.json()) as { error?: { message: string } };
        setError(payload.error?.message ?? m.errors.generic);
        return;
      }

      router.push('/signin?reset=1');
    } catch {
      setError(m.errors.generic);
    } finally {
      setPending(false);
    }
  }

  return (
    <form onSubmit={handleSubmit} className="space-y-4">
      <div>
        <label htmlFor="password" className="field-label">
          {m.auth.newPassword}
        </label>
        <input
          id="password"
          name="password"
          type="password"
          required
          minLength={12}
          autoComplete="new-password"
          className="field-input"
        />
        <p className="mt-1 text-xs text-navy-400">{m.auth.passwordRequirements}</p>
      </div>

      <div>
        <label htmlFor="confirmPassword" className="field-label">
          {m.auth.confirmPassword}
        </label>
        <input
          id="confirmPassword"
          name="confirmPassword"
          type="password"
          required
          autoComplete="new-password"
          className="field-input"
        />
      </div>

      {error ? (
        <p className="field-error" role="alert">
          {error}
        </p>
      ) : null}

      <button type="submit" disabled={pending} className="btn-primary w-full">
        {pending ? m.common.loading : m.common.save}
      </button>
    </form>
  );
}
