import assert from 'node:assert/strict';
import { test } from 'node:test';
import { createElement } from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import { DEFAULT_LOCALE, LOCALES, LOCALE_COOKIE, LOCALE_LABELS, LOCALE_MAX_AGE, isLocale, parseLocale, localeCookie, persistLocale } from '../src/i18n/locales.ts';
import { messages, translate, formatDate, formatNumber, hasMessage } from '../src/i18n/messages.ts';
import { commonMessages } from '../src/i18n/messages/common.ts';
import { companionMessages } from '../src/i18n/messages/companion.ts';
import { controlsMessages } from '../src/i18n/messages/controls.ts';
import { errorsMessages } from '../src/i18n/messages/errors.ts';
import { I18nProvider, useI18n } from '../src/i18n/provider.tsx';
import { LanguageSwitcher } from '../src/components/language-switcher.tsx';
import { formatError } from '../src/i18n/errors.ts';
import ErrorPage from '../src/app/error.tsx';
import NotFound from '../src/app/not-found.tsx';
import { BailianSettings } from '../src/components/bailian-settings.tsx';

const parameters = message => [...message.matchAll(/\{(\w+)\}/g)].map(match => match[1]).sort();

test('only the supported locales are accepted, with Japanese as the first-visit default', () => {
  assert.equal(DEFAULT_LOCALE, 'ja');
  for (const locale of LOCALES) { assert.equal(isLocale(locale), true); assert.equal(parseLocale(locale), locale); }
  for (const value of [null, undefined, '', 'zh', 'zh-TW', 'en-US', 'JA', {}, '__proto__']) {
    assert.equal(isLocale(value), false);
    assert.equal(parseLocale(value), 'ja');
  }
});

test('language cookies persist independently and blocked writes do not prevent switching', () => {
  const target = { cookie: '' };
  for (const locale of LOCALES) {
    persistLocale(locale, target);
    assert.equal(target.cookie, `${LOCALE_COOKIE}=${locale}; Path=/; Max-Age=${LOCALE_MAX_AGE}; SameSite=Lax`);
    assert.equal(localeCookie(locale), target.cookie);
  }
  assert.doesNotThrow(() => persistLocale('en', { set cookie(_) { throw new Error('Cookies are disabled'); } }));
});

test('every language has exactly the same nonempty messages and interpolation parameters', () => {
  const keys = Object.keys(messages.ja).sort();
  assert.ok(keys.length > 150, 'covers the application rather than just the selector');
  const namespaces = [commonMessages, companionMessages, controlsMessages, errorsMessages];
  assert.equal(namespaces.flatMap(group => Object.keys(group.ja)).length, keys.length, 'no namespace overwrites');
  for (const locale of LOCALES) {
    assert.deepEqual(Object.keys(messages[locale]).sort(), keys);
    for (const key of keys) {
      const value = messages[locale][key];
      assert.ok(typeof value === 'string' && value.trim(), `${locale}:${key} is translated`);
      assert.deepEqual(parameters(value), parameters(messages.ja[key]), `${locale}:${key} parameters`);
      const params = Object.fromEntries(parameters(value).map(name => [name, '<sample>']));
      assert.equal(/\{\w+\}/.test(translate(locale, key, params)), false, `${locale}:${key} formats fully`);
    }
  }
  assert.equal(hasMessage('__proto__'), false);
  assert.equal(hasMessage('unknown.message'), false);
});

test('dates and numbers follow the UI locale without changing stored values', () => {
  const value = '2026-09-27T01:05:00.000Z';
  const options = { dateStyle: 'long', timeZone: 'UTC' };
  for (const locale of LOCALES) {
    assert.equal(formatDate(locale, value, options), new Intl.DateTimeFormat(locale, options).format(new Date(value)));
    assert.equal(formatNumber(locale, 1234.5), new Intl.NumberFormat(locale).format(1234.5));
  }
  assert.notEqual(formatDate('en', value, options), formatDate('ja', value, options));
});

test('SSR uses the supplied preference and exposes all three native language labels', () => {
  function Content() { const { t } = useI18n(); return createElement('h1', null, t('common.title')); }
  for (const locale of LOCALES) {
    const html = renderToStaticMarkup(createElement(I18nProvider, { initialLocale: locale }, createElement(Content), createElement(LanguageSwitcher)));
    assert.ok(html.includes(translate(locale, 'common.title')));
    assert.ok(html.includes(`value="${locale}" lang="${locale}" selected=""`));
    for (const label of Object.values(LOCALE_LABELS)) assert.ok(html.includes(label));
  }
});

test('presentation translates explicit descriptors, safely falls back for old responses and escapes parameter text', () => {
  const codeKey = Object.keys(errorsMessages.ja).find(key => parameters(errorsMessages.ja[key]).length === 0);
  const error = Object.assign(new Error('legacy fallback'), { errorCode: codeKey.replace(/^errors\./, '') });
  for (const locale of LOCALES) assert.equal(formatError(locale, error), messages[locale][codeKey]);
  assert.equal(formatError('en', 'Legacy safe response', { errorCode: 'newerUnknownCode' }), 'Legacy safe response');
  const parameterKey = Object.keys(messages.ja).find(key => parameters(messages.ja[key]).length > 0);
  function Content() {
    const { t } = useI18n();
    return createElement('p', null, t(parameterKey, Object.fromEntries(parameters(messages.ja[parameterKey]).map(key => [key, '<script>bad</script>']))));
  }
  const html = renderToStaticMarkup(createElement(I18nProvider, { initialLocale: 'en' }, createElement(Content)));
  assert.ok(!html.includes('<script>'));
  assert.ok(html.includes('&lt;script&gt;'));
});

test('error and not-found pages use the request language and retain their recovery controls', () => {
  for (const locale of LOCALES) {
    const error = renderToStaticMarkup(createElement(I18nProvider, { initialLocale: locale }, createElement(ErrorPage, { retry() {} })));
    assert.ok(error.includes(translate(locale, 'common.errorTitle')));
    assert.ok(error.includes(translate(locale, 'common.retry')));
    const missing = renderToStaticMarkup(createElement(I18nProvider, { initialLocale: locale }, createElement(NotFound)));
    assert.ok(missing.includes(translate(locale, 'common.notFoundTitle')));
    assert.ok(missing.includes(translate(locale, 'common.home')));
    assert.ok(missing.includes('href="/"'));
  }
});

test('connection details explain the missing API key and preserve model identifiers', () => {
  const status = { ready: false, missing: ['BAILIAN_API_KEY', '有効な会話エンドポイント', '有効な ASR inference エンドポイント', '有効な TTS realtime エンドポイント'], credentialSource: 'none', region: null, models: { chat: 'chat-model', asr: 'asr-model', tts: 'tts-model' }, asrLanguage: 'ja', activeSessionId: null };
  for (const locale of LOCALES) {
    const markup = renderToStaticMarkup(createElement(I18nProvider, { initialLocale: locale }, createElement(BailianSettings, { status, active: false, onRefresh: async () => {} })));
    for (const key of ['validChatEndpoint', 'validAsrEndpoint', 'validTtsEndpoint']) assert.ok(markup.includes(translate(locale, `controls.${key}`)));
    assert.ok(markup.includes(`<b>${translate(locale, 'controls.apiKey')}`));
    assert.equal(markup.includes('BAILIAN_API_KEY'), false);
    assert.ok(markup.includes('chat-model'));
  }
});
