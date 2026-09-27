import { commonMessages } from './messages/common';
import { companionMessages } from './messages/companion';
import { controlsMessages } from './messages/controls';
import { errorsMessages } from './messages/errors';
import type { Locale } from './locales';

function forLocale(locale: Locale) {
  return { ...commonMessages[locale], ...companionMessages[locale], ...controlsMessages[locale], ...errorsMessages[locale] };
}

export const messages = { ja: forLocale('ja'), 'zh-CN': forLocale('zh-CN'), en: forLocale('en') };
export type MessageKey = keyof typeof messages.ja;
export type MessageParams = Record<string, string | number>;

export function hasMessage(key: string): key is MessageKey {
  return Object.hasOwn(messages.ja, key);
}

export function translate(locale: Locale, key: MessageKey, params: MessageParams = {}): string {
  return messages[locale][key].replace(/\{(\w+)\}/g, (placeholder, name: string) => (
    Object.hasOwn(params, name) ? String(params[name]) : placeholder
  ));
}

export function formatDate(locale: Locale, value: string, options: Intl.DateTimeFormatOptions = { month: 'short', day: 'numeric', hour: '2-digit', minute: '2-digit' }): string {
  return new Intl.DateTimeFormat(locale, options).format(new Date(value));
}

export function formatNumber(locale: Locale, value: number, options?: Intl.NumberFormatOptions): string {
  return new Intl.NumberFormat(locale, options).format(value);
}
