export const LOCALES = ['ja', 'zh-CN', 'en'] as const;
export type Locale = (typeof LOCALES)[number];
export const DEFAULT_LOCALE: Locale = 'ja';
export const LOCALE_COOKIE = 'virtualmaid-locale';
export const LOCALE_MAX_AGE = 60 * 60 * 24 * 365;
export const LOCALE_LABELS: Record<Locale, string> = { ja: '日本語', 'zh-CN': '简体中文', en: 'English' };

export function isLocale(value: unknown): value is Locale {
  return typeof value === 'string' && LOCALES.some(locale => locale === value);
}

export function parseLocale(value: unknown): Locale {
  return isLocale(value) ? value : DEFAULT_LOCALE;
}

export function localeCookie(locale: Locale): string {
  return `${LOCALE_COOKIE}=${locale}; Path=/; Max-Age=${LOCALE_MAX_AGE}; SameSite=Lax`;
}

/** Storage is optional: the current page always keeps the selected language. */
export function persistLocale(locale: Locale, target: { cookie: string } = document): void {
  try { target.cookie = localeCookie(locale); } catch { /* Continue with the in-memory preference. */ }
}
