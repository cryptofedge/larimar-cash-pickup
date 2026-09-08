'use client';

import { useState } from 'react';
import { useRouter, useSearchParams } from 'next/navigation';
import type { Messages } from '@/i18n';
import { deviceFingerprint } from '@/lib/client/device';

export function SignInForm({ m }: { m: Messages }) {
  const router = useRouter();
  const params = useSearchParams();
  const [error, setError] = useState<string | null>(null);
  const [needsTotp, setNeedsTotp] = useState(false);
  const [pending, setPending] = useState(false);

  async function handleSubmit(event: React.FormEvent<HTMLFormElement>) {
    event.preventDefault();
    setPending(true);
    setError(null);

    const form = new FormData(event.currentTarget);

    try {
      const response = await fetch('/api/auth/login', {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({
          email: form.get('email'),
          password: form.get('password'),
          totpCode: form.get('totpCode') || undefined,
          deviceFingerprint: deviceFingerprint(),
        }),
      });

      const payload = (await response.json()) as
        | { userId: string; roles: string[] }
        | { error: { code: string; message: string } };

      if (!response.ok) {
        const code = 'error' in payload ? payload.error.code : '';
        if (code === 'MFA_REQUIRED') {
          setNeedsTotp(true);
          setError(m.auth.mfaSubtitle);
        } else if (code === 'ACCOUNT_LOCKED') {
          setError(m.auth.accountLocked);
        } else {
          setError(m.auth.invalidCredentials);
        }
        return;
      }

      // Staff land in their own console; travelers land in the dashboard.
      const roles = 'roles' in payload ? payload.roles : [];
      const next =
        params.get('next') ??
        (roles.some((r) => ['PICKUP_AGENT', 'PICKUP_MANAGER'].includes(r))
          ? '/agent'
          : roles.some((r) =>
                ['SYSTEM_ADMIN', 'COMPLIANCE_ANALYST', 'FINANCE_ADMIN', 'SUPPORT_AGENT'].includes(r),
              )
            ? '/admin'
            : '/dashboard');

      router.push(next);
      router.refresh();
    } catch {
      setError(m.errors.generic);
    } finally {
      setPending(false);
    }
  }

  return (
    <form onSubmit={handleSubmit} className="space-y-4">
      <div>
        <label htmlFor="email" className="field-label">
          {m.auth.email}
        </label>
        <input
          id="email"
          name="email"
          type="email"
          autoComplete="email"
          required
          className="field-input"
        />
      </div>

      <div>
        <label htmlFor="password" className="field-label">
          {m.auth.password}
        </label>
        <input
          id="password"
          name="password"
          type="password"
          autoComplete="current-password"
          required
          className="field-input"
        />
      </div>

      {needsTotp ? (
        <div>
          <label htmlFor="totpCode" className="field-label">
            {m.auth.mfaCode}
          </label>
          <input
            id="totpCode"
            name="totpCode"
            type="text"
            inputMode="numeric"
            pattern="\d{6}"
            maxLength={6}
            autoComplete="one-time-code"
            className="field-input tabular tracking-[0.3em]"
          />
        </div>
      ) : null}

      {error ? (
        <p className="field-error" role="alert">
          {error}
        </p>
      ) : null}

      <button type="submit" disabled={pending} className="btn-primary w-full">
        {pending ? m.common.loading : m.auth.signInTitle}
      </button>
    </form>
  );
}
