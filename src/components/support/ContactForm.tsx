'use client';

import { useState } from 'react';
import type { Messages } from '@/i18n';
import { interpolate } from '@/i18n/config';

export function ContactForm({ m }: { m: Messages }) {
  const [state, setState] = useState<{ status: 'idle' | 'sending' | 'sent' | 'error'; message?: string }>({
    status: 'idle',
  });

  async function handleSubmit(event: React.FormEvent<HTMLFormElement>) {
    event.preventDefault();
    setState({ status: 'sending' });

    const form = new FormData(event.currentTarget);
    try {
      const response = await fetch('/api/support/tickets', {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({
          subject: form.get('subject'),
          body: form.get('body'),
          category: form.get('category'),
          contactEmail: form.get('contactEmail'),
        }),
      });

      const payload = (await response.json()) as
        | { ticketNumber: string }
        | { error: { message: string } };

      if (!response.ok) {
        setState({
          status: 'error',
          message: 'error' in payload ? payload.error.message : m.errors.generic,
        });
        return;
      }

      setState({
        status: 'sent',
        message: interpolate(m.support.sent, {
          ticket: 'ticketNumber' in payload ? payload.ticketNumber : '',
        }),
      });
      event.currentTarget.reset();
    } catch {
      setState({ status: 'error', message: m.errors.generic });
    }
  }

  if (state.status === 'sent') {
    return (
      <div className="rounded-xl bg-success-50 p-5 text-center" role="status">
        <p className="font-semibold text-success-700">{state.message}</p>
      </div>
    );
  }

  return (
    <form onSubmit={handleSubmit} className="space-y-4">
      <div>
        <label htmlFor="contactEmail" className="field-label">
          {m.auth.email}
        </label>
        <input id="contactEmail" name="contactEmail" type="email" required className="field-input" />
      </div>

      <div>
        <label htmlFor="category" className="field-label">
          {m.support.category}
        </label>
        <select id="category" name="category" required className="field-input" defaultValue="TRANSACTION">
          <option value="TRANSACTION">{m.support.categoryTransaction}</option>
          <option value="PICKUP">{m.support.categoryPickup}</option>
          <option value="ACCOUNT">{m.support.categoryAccount}</option>
          <option value="OTHER">{m.support.categoryOther}</option>
        </select>
      </div>

      <div>
        <label htmlFor="subject" className="field-label">
          {m.support.subject}
        </label>
        <input id="subject" name="subject" type="text" required minLength={3} maxLength={200} className="field-input" />
      </div>

      <div>
        <label htmlFor="body" className="field-label">
          {m.support.message}
        </label>
        <textarea id="body" name="body" required minLength={10} maxLength={5000} rows={6} className="field-input" />
      </div>

      {state.status === 'error' ? (
        <p className="field-error" role="alert">
          {state.message}
        </p>
      ) : null}

      <button type="submit" disabled={state.status === 'sending'} className="btn-primary w-full">
        {state.status === 'sending' ? m.common.loading : m.common.submit}
      </button>
    </form>
  );
}
