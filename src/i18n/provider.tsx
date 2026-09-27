'use client';

import { createContext, useCallback, useContext, useEffect, useMemo, useState, type ReactNode } from 'react';
import { formatError, type ErrorDetails } from './errors';
import { isLocale, persistLocale, type Locale } from './locales';
import { formatDate, formatNumber, translate, type MessageKey, type MessageParams } from './messages';

interface I18nContextValue {
  locale: Locale;
  setLocale: (locale: Locale) => void;
  t: (key: MessageKey, params?: MessageParams) => string;
  formatError: (cause: unknown, details?: ErrorDetails | null) => string;
  formatDate: (value: string, options?: Intl.DateTimeFormatOptions) => string;
  formatNumber: (value: number, options?: Intl.NumberFormatOptions) => string;
}

const I18nContext = createContext<I18nContextValue | null>(null);

export function I18nProvider({ initialLocale, children }: { initialLocale: Locale; children: ReactNode }) {
  const [locale, updateLocale] = useState(initialLocale);
  const setLocale = useCallback((next: Locale) => {
    if (!isLocale(next)) return;
    persistLocale(next);
    updateLocale(next);
  }, []);

  useEffect(() => {
    document.documentElement.lang = locale;
    document.title = translate(locale, 'common.title');
    document.querySelector('meta[name="description"]')?.setAttribute('content', translate(locale, 'common.description'));
  }, [locale]);

  const value = useMemo<I18nContextValue>(() => ({
    locale,
    setLocale,
    t: (key, params) => translate(locale, key, params),
    formatDate: (date, options) => formatDate(locale, date, options),
    formatNumber: (number, options) => formatNumber(locale, number, options),
    formatError: (cause, details) => formatError(locale, cause, details),
  }), [locale, setLocale]);

  return <I18nContext.Provider value={value}>{children}</I18nContext.Provider>;
}

export function useI18n(): I18nContextValue {
  const value = useContext(I18nContext);
  if (!value) throw new Error('useI18n must be used within I18nProvider');
  return value;
}
