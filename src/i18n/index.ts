/**
 * Locale resolution and message access.
 *
 * Resolution order: explicit user preference (persisted on the account), then the
 * locale cookie, then Accept-Language, then English. English is the default
 * because the primary customer is a foreign traveler.
 */

import { cookies, headers } from 'next/headers';
import {
  DEFAULT_LOCALE,
  INTL_LOCALES,
  LOCALE_COOKIE,
  type Locale,
  interpolate,
  isLocale,
  negotiateLocale,
} from './config';
import { en, type Messages } from './messages/en';
import { es } from './messages/es';

const CATALOGUES: Readonly<Record<Locale, Messages>> = Object.freeze({ en, es });

export function getMessages(locale: Locale): Messages {
  return CATALOGUES[locale] ?? CATALOGUES[DEFAULT_LOCALE];
}

/** Resolve the locale for the current server request. */
export async function resolveLocale(): Promise<Locale> {
  const cookieStore = await cookies();
  const fromCookie = cookieStore.get(LOCALE_COOKIE)?.value;
  if (isLocale(fromCookie)) return fromCookie;

  const headerStore = await headers();
  return negotiateLocale(headerStore.get('accept-language'));
}

/** The pair almost every server component needs. */
export async function getTranslations(): Promise<{ locale: Locale; m: Messages; intl: string }> {
  const locale = await resolveLocale();
  return { locale, m: getMessages(locale), intl: INTL_LOCALES[locale] };
}

export function formatDate(date: Date, locale: Locale, style: 'short' | 'long' = 'short'): string {
  return new Intl.DateTimeFormat(
    INTL_LOCALES[locale],
    style === 'long'
      ? { dateStyle: 'long', timeStyle: 'short' }
      : { dateStyle: 'medium', timeStyle: 'short' },
  ).format(date);
}

export function formatDateOnly(date: Date, locale: Locale): string {
  return new Intl.DateTimeFormat(INTL_LOCALES[locale], { dateStyle: 'long' }).format(date);
}

/** Render basis points as a percentage string: 150 -> "1.5%". */
export function formatBps(bps: number, locale: Locale): string {
  return new Intl.NumberFormat(INTL_LOCALES[locale], {
    style: 'percent',
    minimumFractionDigits: 0,
    maximumFractionDigits: 2,
  }).format(bps / 10_000);
}

export { interpolate, INTL_LOCALES, DEFAULT_LOCALE, LOCALE_COOKIE };
export type { Locale, Messages };
