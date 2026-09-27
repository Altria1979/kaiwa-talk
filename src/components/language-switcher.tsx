'use client';

import { useId } from 'react';
import { LOCALES, LOCALE_LABELS, isLocale } from '../i18n/locales';
import { useI18n } from '../i18n/provider';

export function LanguageSwitcher() {
  const id = useId();
  const { locale, setLocale, t } = useI18n();
  return <label className="language-switcher" htmlFor={id}>
    <span className="sr-only">{t('common.language')}</span>
    <select id={id} value={locale} onChange={event => { if (isLocale(event.target.value)) setLocale(event.target.value); }}>
      {LOCALES.map(value => <option key={value} value={value} lang={value}>{LOCALE_LABELS[value]}</option>)}
    </select>
  </label>;
}
