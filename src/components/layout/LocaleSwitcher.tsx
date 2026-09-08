'use client';

import { useRouter } from 'next/navigation';
import { useTransition } from 'react';
import { LOCALES, LOCALE_LABELS, type Locale } from '@/i18n/config';

/**
 * Locale switcher.
 *
 * Writes the preference cookie and refreshes so the server re-renders in the new
 * language. Deliberately a native <select>: it is keyboard accessible, works on
 * every mobile browser, and needs no popover code.
 */
export function LocaleSwitcher({ locale, label }: { locale: Locale; label: string }) {
  const router = useRouter();
  const [pending, startTransition] = useTransition();

  function change(next: string) {
    // 1 year, Lax, path=/. Not sensitive; readable by the client on purpose.
    document.cookie = `larimar_locale=${next}; path=/; max-age=31536000; samesite=lax`;
    startTransition(() => router.refresh());
  }

  return (
    <label className="relative">
      <span className="sr-only">{label}</span>
      <select
        value={locale}
        onChange={(event) => change(event.target.value)}
        disabled={pending}
        className="min-h-[44px] cursor-pointer rounded-lg border border-navy-200 bg-white px-2 py-2 text-sm text-navy-700 hover:bg-navy-50 focus:outline-none focus:ring-2 focus:ring-larimar-500/40"
      >
        {LOCALES.map((code) => (
          <option key={code} value={code}>
            {LOCALE_LABELS[code]}
          </option>
        ))}
      </select>
    </label>
  );
}
