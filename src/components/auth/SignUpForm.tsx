'use client';

import { useState } from 'react';
import { useRouter } from 'next/navigation';
import type { Messages } from '@/i18n';
import { deviceFingerprint } from '@/lib/client/device';

export function SignUpForm({ m }: { m: Messages }) {
  const router = useRouter();
  const [error, setError] = useState<string | null>(null);
  const [fieldErrors, setFieldErrors] = useState<Record<string, string>>({});
  const [pending, setPending] = useState(false);

  async function handleSubmit(event: React.FormEvent<HTMLFormElement>) {
    event.preventDefault();
    setError(null);
    setFieldErrors({});

    const form = new FormData(event.currentTarget);
    const password = String(form.get('password') ?? '');

    if (password !== String(form.get('confirmPassword') ?? '')) {
      setFieldErrors({ confirmPassword: m.auth.passwordMismatch });
      return;
    }

    setPending(true);

    try {
      const response = await fetch('/api/auth/register', {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({
          email: form.get('email'),
          password,
          firstName: form.get('firstName'),
          lastName: form.get('lastName'),
          acceptedTerms: form.get('acceptedTerms') === 'on',
          deviceFingerprint: deviceFingerprint(),
        }),
      });

      const payload = (await response.json()) as
        | { created: boolean; userId?: string }
        | { error: { message: string; fields?: { path: string; message: string }[] } };

      if (!response.ok) {
        if ('error' in payload && payload.error.fields) {
          setFieldErrors(
            Object.fromEntries(payload.error.fields.map((f) => [f.path, f.message])),
          );
        }
        setError('error' in payload ? payload.error.message : m.errors.generic);
        return;
      }

      // A response with no userId means the address was already registered. The
      // API deliberately does not say so; we route to sign-in rather than
      // revealing it here.
      if ('created' in payload && !payload.userId) {
        router.push('/signin?existing=1');
        return;
      }

      router.push('/dashboard');
      router.refresh();
    } catch {
      setError(m.errors.generic);
    } finally {
      setPending(false);
    }
  }

  return (
    <form onSubmit={handleSubmit} className="space-y-4">
      <div className="grid gap-4 sm:grid-cols-2">
        <div>
          <label htmlFor="firstName" className="field-label">
            {m.auth.firstName}
          </label>
          <input id="firstName" name="firstName" required autoComplete="given-name" className="field-input" />
        </div>
        <div>
          <label htmlFor="lastName" className="field-label">
            {m.auth.lastName}
          </label>
          <input id="lastName" name="lastName" required autoComplete="family-name" className="field-input" />
        </div>
      </div>

      <div>
        <label htmlFor="email" className="field-label">
          {m.auth.email}
        </label>
        <input id="email" name="email" type="email" required autoComplete="email" className="field-input" />
        {fieldErrors.email ? <p className="field-error">{fieldErrors.email}</p> : null}
      </div>

      <div>
        <label htmlFor="password" className="field-label">
          {m.auth.password}
        </label>
        <input
          id="password"
          name="password"
          type="password"
          required
          minLength={12}
          autoComplete="new-password"
          className="field-input"
          aria-describedby="password-hint"
        />
        <p id="password-hint" className="mt-1 text-xs text-navy-400">
          {m.auth.passwordRequirements}
        </p>
        {fieldErrors.password ? <p className="field-error">{fieldErrors.password}</p> : null}
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
        {fieldErrors.confirmPassword ? (
          <p className="field-error">{fieldErrors.confirmPassword}</p>
        ) : null}
      </div>

      <label className="flex items-start gap-3 text-sm text-navy-600">
        <input
          type="checkbox"
          name="acceptedTerms"
          required
          className="mt-0.5 h-5 w-5 rounded border-navy-300 text-larimar-600 focus:ring-larimar-500"
        />
        <span>{m.auth.acceptTerms}</span>
      </label>

      {error ? (
        <p className="field-error" role="alert">
          {error}
        </p>
      ) : null}

      <button type="submit" disabled={pending} className="btn-primary w-full">
        {pending ? m.common.loading : m.auth.signUpTitle}
      </button>
    </form>
  );
}
