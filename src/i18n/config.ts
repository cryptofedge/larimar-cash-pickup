/**
 * Locale configuration.
 *
 * English is the default because the primary customer is a foreign traveler.
 * Spanish is a first-class peer, not an afterthought: Dominican customers,
 * payout-window agents, and compliance staff work in Spanish, and a payout screen
 * that only speaks English is unusable at a bank counter in Santiago.
 */

export const LOCALES = ['en', 'es'] as const;
export type Locale = (typeof LOCALES)[number];

export const DEFAULT_LOCALE: Locale = 'en';
export const LOCALE_COOKIE = 'larimar_locale';

export const LOCALE_LABELS: Readonly<Record<Locale, string>> = Object.freeze({
  en: 'English',
  es: 'Español',
});

/** BCP-47 tags for Intl formatting. */
export const INTL_LOCALES: Readonly<Record<Locale, string>> = Object.freeze({
  en: 'en-US',
  es: 'es-DO',
});

export function isLocale(value: unknown): value is Locale {
  return typeof value === 'string' && (LOCALES as readonly string[]).includes(value);
}

/** Parse an Accept-Language header, falling back to the default. */
export function negotiateLocale(acceptLanguage: string | null | undefined): Locale {
  if (!acceptLanguage) return DEFAULT_LOCALE;

  const ranked = acceptLanguage
    .split(',')
    .map((part) => {
      const [tag, ...params] = part.trim().split(';');
      const qParam = params.find((p) => p.trim().startsWith('q='));
      const quality = qParam ? Number.parseFloat(qParam.split('=')[1] ?? '0') : 1;
      return { tag: (tag ?? '').trim().toLowerCase(), quality: Number.isFinite(quality) ? quality : 0 };
    })
    .filter((entry) => entry.tag.length > 0)
    .sort((a, b) => b.quality - a.quality);

  for (const { tag } of ranked) {
    const primary = tag.split('-')[0];
    if (isLocale(primary)) return primary;
  }

  return DEFAULT_LOCALE;
}

/** Interpolate {placeholders}. Values are inserted as text and never as markup. */
export function interpolate(template: string, variables: Record<string, string>): string {
  return template.replace(/\{(\w+)\}/g, (match, key: string) => variables[key] ?? match);
}
