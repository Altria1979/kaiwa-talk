import assert from 'node:assert/strict';
import { test } from 'node:test';
import { AppError, APP_ERROR_MESSAGES, describeError } from '../shared/app-errors.ts';
import { errorsMessages } from '../src/i18n/messages/errors.ts';
import { formatError } from '../src/i18n/errors.ts';
import { ProviderError, providerError, upstreamError } from '../server/providers/errors.ts';
import { SuggestionAudioError } from '../server/suggestion-audio.ts';
import { api, ApiError } from '../src/lib/api.ts';
import { parseBrowserCredentials, saveBrowserCredentials, clearBrowserCredentials } from '../src/lib/bailian-credentials.ts';

const placeholders = message => [...message.matchAll(/\{([a-zA-Z0-9]+)\}/g)].map(match => match[1]).sort();

test('every application error has matching Japanese, Chinese, English keys and parameters', () => {
  const keys = Object.keys(APP_ERROR_MESSAGES).map(code => `errors.${code}`).sort();
  for (const locale of ['ja', 'zh-CN', 'en']) {
    assert.deepEqual(Object.keys(errorsMessages[locale]).sort(), keys);
    for (const key of keys) {
      assert.ok(errorsMessages[locale][key].trim());
      assert.deepEqual(placeholders(errorsMessages[locale][key]), placeholders(errorsMessages.ja[key]), key);
    }
  }
});

test('known legacy messages, optional punctuation and field limits remain translatable', () => {
  for (const [code, message] of Object.entries(APP_ERROR_MESSAGES)) {
    if (message.includes('{max}')) continue;
    assert.equal(describeError(message).errorCode, code);
    assert.equal(describeError(new Error(message)).errorCode, code);
  }
  assert.equal(describeError('まず会話を開始してください。').errorCode, 'sessionRequired');
  assert.equal(describeError('練習設定に Bailian API キーを入力し、接続先ドメインを確認してください').errorCode, 'credentialsRequired');
  for (const [field, code] of [['名前', 'fieldCharacterName'], ['性格', 'fieldPersona'], ['メモ', 'fieldMemory']]) {
    const message = `${field}は必須です。40 文字以内で入力してください`;
    assert.deepEqual(describeError(message), { message, errorCode: code, errorParams: { max: 40 } });
    for (const locale of ['ja', 'zh-CN', 'en']) assert.ok(formatError(locale, message).includes('40'));
    assert.doesNotMatch(formatError('en', message), /[\u3040-\u30ff]/u);
  }
});

test('descriptors retain custom codes, safe scalar parameters and unknown legacy messages', () => {
  const cause = new AppError('legacy safe message', { errorCode: 'controls.avatarError', errorParams: { max: 30 } });
  assert.deepEqual(describeError(cause), { message: 'legacy safe message', errorCode: 'controls.avatarError', errorParams: { max: 30 } });
  assert.deepEqual(describeError({ error: 'old safe response' }), { message: 'old safe response' });
  assert.deepEqual(describeError({ message: 'safe', errorCode: 'extension', errorParams: { count: 3, name: 'x', nested: { secret: 'no' }, bad: Infinity } }), {
    message: 'safe', errorCode: 'extension', errorParams: { count: 3, name: 'x' },
  });
  assert.equal(formatError('en', 'safe older service message'), 'safe older service message');
});

test('a saved error descriptor renders in the current language without mutating its message', () => {
  const descriptor = describeError(new AppError(APP_ERROR_MESSAGES.microphoneDenied));
  for (const locale of ['ja', 'zh-CN', 'en']) assert.equal(formatError(locale, descriptor), errorsMessages[locale]['errors.microphoneDenied']);
  assert.equal(descriptor.message, APP_ERROR_MESSAGES.microphoneDenied);
});

test('provider boundaries preserve controlled error codes and discard arbitrary upstream details', () => {
  const fallback = APP_ERROR_MESSAGES.replyFailed;
  const untrusted = Object.assign(new Error('Authorization: Bearer private-upstream-secret'), { errorCode: 'authenticationFailed', errorParams: { token: 'secret' } });
  assert.deepEqual(providerError(untrusted, fallback), { message: fallback, errorCode: 'replyFailed' });
  assert.deepEqual(providerError(new ProviderError('safe', { errorCode: 'quotaExceeded', errorParams: { count: 2 } }), fallback), {
    message: 'safe', errorCode: 'quotaExceeded', errorParams: { count: 2 },
  });
  for (const [status, code] of [[401, 'authenticationFailed'], [403, 'modelAccessDenied'], [429, 'quotaExceeded'], [404, 'modelUnavailable'], [400, 'providerRequestInvalid'], [500, 'providerUnavailable']]) {
    assert.equal(upstreamError(undefined, status).errorCode, code);
  }
  const wrapped = new SuggestionAudioError(502, APP_ERROR_MESSAGES.suggestionAudioFailed, providerError(upstreamError(undefined, 401), fallback));
  assert.equal(wrapped.message, APP_ERROR_MESSAGES.suggestionAudioFailed);
  assert.equal(wrapped.errorCode, 'authenticationFailed');
});

test('HTTP client accepts old and new error responses and sanitizes transport failures', async t => {
  for (const body of [
    { error: APP_ERROR_MESSAGES.modelTooLarge },
    { error: APP_ERROR_MESSAGES.modelTooLarge, errorCode: 'modelTooLarge' },
    { error: 'old fallback', errorCode: 'fieldPersona', errorParams: { max: 2000 } },
  ]) {
    t.mock.method(globalThis, 'fetch', async url => String(url).endsWith('/api/browser')
      ? new Response(JSON.stringify({ ok: true }), { status: 200 })
      : new Response(JSON.stringify(body), { status: 400 }));
    await assert.rejects(api.settings(), error => {
      assert.ok(error instanceof ApiError);
      assert.equal(error.message, body.error);
      assert.equal(error.errorCode, body.errorCode ?? 'modelTooLarge');
      if (body.errorParams) assert.deepEqual(error.errorParams, body.errorParams);
      return true;
    });
    t.mock.restoreAll();
  }
  t.mock.method(globalThis, 'fetch', async () => { throw new Error('Authorization: Bearer secret'); });
  await assert.rejects(api.settings(), { errorCode: 'serviceUnavailable', message: APP_ERROR_MESSAGES.serviceUnavailable });
  await assert.rejects(api.uploadAvatar({ size: 31 * 1024 * 1024 }), { errorCode: 'modelTooLarge' });
});

test('blocked and corrupt browser credential storage carries localized descriptors', () => {
  assert.throws(() => parseBrowserCredentials('storage-unavailable'), { errorCode: 'storageUnavailable' });
  assert.throws(() => parseBrowserCredentials('{'), { errorCode: 'credentialsUnreadable' });
  const previous = Object.getOwnPropertyDescriptor(globalThis, 'window');
  Object.defineProperty(globalThis, 'window', { configurable: true, value: { localStorage: {
    setItem() { throw new Error('blocked'); }, removeItem() { throw new Error('blocked'); },
  } } });
  try {
    assert.throws(() => saveBrowserCredentials({ apiKey: 'test' }), { errorCode: 'credentialsSaveFailed' });
    assert.throws(() => clearBrowserCredentials(), { errorCode: 'credentialsDeleteFailed' });
  } finally {
    if (previous) Object.defineProperty(globalThis, 'window', previous); else delete globalThis.window;
  }
});
