import { browserCookie } from '../shared/cloud-access.ts';
import { ProviderError } from '../server/providers/errors.ts';
import assert from 'node:assert/strict';
import { EventEmitter } from 'node:events';
import { setImmediate } from 'node:timers/promises';
import { after, beforeEach, mock, test } from 'node:test';

const { DEFAULT_SETTINGS } = await import('../shared/protocol.ts');
const { resolveBailianConfig, config } = await import('../server/config.ts');
const { resolveTtsLanguage } = await import('../server/providers/tts.ts');
const runtime = resolveBailianConfig({ apiKey: 'test-only', apiHost: 'dashscope-intl.aliyuncs.com' });
const messageId = '11111111-1111-4111-8111-111111111111';
const options = [
  { text: 'はい、ゆっくりします。', reading: 'はい、ゆっくりします。', meaning: 'はい、おうちでゆっくりします。' },
  { text: 'いいえ、本を読みます。', reading: 'いいえ、ほんをよみます。', meaning: 'いいえ、ゆっくりしません。本を読みます。' },
  { text: 'まだ、わかりません。', reading: 'まだ、わかりません。', meaning: 'まだ予定がありません。' },
];
let message;
let settings;
let calls;
let synthesize;

mock.module('../server/providers/tts.ts', {
  exports: {
    resolveTtsLanguage,
    TtsClient: class {
      constructor(runtime) { this.runtime = runtime; }
      async synthesize(text, voice, language, signal, onAudio) {
        const call = { runtime: this.runtime, text, voice, language, signal, onAudio };
        calls.push(call);
        await synthesize(call);
      }
    },
  },
});
const { synthesizeSuggestionAudio } = await import('../server/suggestion-audio.ts');

beforeEach(() => {
  message = { id: messageId, role: 'assistant', replySuggestions: structuredClone(options) };
  settings = { ...DEFAULT_SETTINGS };
  calls = [];
  synthesize = async ({ onAudio }) => {
    onAudio(Buffer.from([1, 2, 3, 4]).toString('base64'));
    onAudio(Buffer.from([5, 6]).toString('base64'));
  };
});

const audio = (index = 0, signal = new AbortController().signal) => synthesizeSuggestionAudio(message, index, settings, runtime, signal);

test('reads only the selected saved sentence and joins PCM chunks without padding gaps', async () => {
  const result = await audio(1);
  assert.deepEqual(result, { audio: Buffer.from([1, 2, 3, 4, 5, 6]).toString('base64'), sampleRate: 24000 });
  assert.equal(calls.length, 1);
  assert.equal(calls[0].text, options[1].text);
  assert.equal(calls[0].voice, DEFAULT_SETTINGS.voice);
  assert.equal(calls[0].language, 'Japanese');
  assert.equal(calls[0].runtime, runtime);
});

test('snapshots the configured voice and learning language for each request', async () => {
  settings.voice = 'Serena';
  settings.learningLanguage = '英語';
  synthesize = async ({ onAudio }) => {
    settings.voice = 'Cherry';
    settings.learningLanguage = '韓国語';
    onAudio('AAA=');
  };
  await audio();
  await audio();
  assert.deepEqual(calls.map(({ voice, language }) => ({ voice, language })), [
    { voice: 'Serena', language: 'English' }, { voice: 'Cherry', language: 'Korean' },
  ]);
});

test('rejects missing, non-assistant, malformed and oversized saved suggestions before provider work', async t => {
  for (const [label, source, index, status] of [
    ['missing message', null, 0, 404],
    ['user message', { ...message, role: 'user' }, 0, 404],
    ['missing options', { ...message, replySuggestions: undefined }, 0, 404],
    ['empty text', { ...message, replySuggestions: [{ text: ' ' }] }, 0, 404],
    ['negative option', message, -1, 404],
    ['fourth option', message, 3, 404],
    ['fractional option', message, 0.5, 404],
    ['long text', { ...message, replySuggestions: [{ text: 'あ'.repeat(161) }] }, 0, 400],
    ['multiline text', { ...message, replySuggestions: [{ text: 'はい\nいいえ' }] }, 0, 400],
  ]) {
    await t.test(label, async () => {
      await assert.rejects(synthesizeSuggestionAudio(source, index, settings, runtime, new AbortController().signal), { status });
    });
  }
  assert.equal(calls.length, 0);
});

test('missing speech configuration is reported without starting synthesis', async () => {
  for (const patch of [{ apiKey: '' }, { realtimeUrl: '' }]) {
    await assert.rejects(synthesizeSuggestionAudio(message, 0, settings, { ...runtime, ...patch }, new AbortController().signal), { status: 503 });
  }
  assert.equal(calls.length, 0);
});

test('provider errors never disclose upstream messages or credentials', async () => {
  synthesize = async () => { throw new Error(`upstream debug Authorization: Bearer ${runtime.apiKey}`); };
  await assert.rejects(audio(), error => {
    assert.equal(error.status, 502);
    assert.doesNotMatch(error.message, /test-only|Authorization|upstream debug/);
    return true;
  });
});

test('invalid, empty, misaligned and oversized PCM responses fail safely and cancel oversized synthesis', async t => {
  for (const [label, chunks, cancels] of [
    ['empty', [], false],
    ['invalid base64', ['@@@='], true],
    ['unaligned sample', ['AA=='], true],
    ['large single chunk', [Buffer.alloc(1_152_002).toString('base64')], true],
    ['large stream', [Buffer.alloc(576_000).toString('base64'), Buffer.alloc(576_002).toString('base64')], true],
  ]) {
    await t.test(label, async () => {
      synthesize = async ({ onAudio }) => { for (const chunk of chunks) onAudio(chunk); };
      await assert.rejects(audio(), { status: 502 });
      assert.equal(calls.at(-1).signal.aborted, cancels);
    });
  }
  synthesize = async ({ onAudio }) => { onAudio(Buffer.alloc(1_152_000).toString('base64')); };
  assert.equal(Buffer.from((await audio()).audio, 'base64').length, 1_152_000);
});

test('cancellation reaches the provider and suppresses late audio', async () => {
  const controller = new AbortController();
  let release;
  synthesize = () => new Promise(resolve => { release = resolve; });
  const task = audio(0, controller.signal);
  const rejected = assert.rejects(task, { name: 'AbortError' });
  controller.abort();
  assert.equal(calls[0].signal.aborted, true);
  calls[0].onAudio('AAA=');
  release();
  await rejected;
  const count = calls.length;
  await assert.rejects(audio(0, AbortSignal.abort()), { name: 'AbortError' });
  assert.equal(calls.length, count);
});

test('limits simultaneous synthesis and releases capacity after completion', async () => {
  const releases = [];
  synthesize = ({ onAudio }) => new Promise(resolve => {
    releases.push(() => { onAudio('AAA='); resolve(); });
  });
  const pending = [audio(), audio(1), audio(2)];
  await assert.rejects(audio(), { status: 429 });
  assert.equal(calls.length, 3);
  releases.forEach(release => release());
  await Promise.all(pending);
  synthesize = async ({ onAudio }) => { onAudio('AAA='); };
  await audio();
});

// Capture the real HTTP handler without binding a port or opening provider sockets.
let requestHandler;
mock.module('node:http', {
  exports: {
    createServer(handler) {
      requestHandler = handler;
      const server = new EventEmitter();
      server.listen = () => server;
      return server;
    },
  },
});
mock.module('ws', {
  exports: { WebSocket: class {}, WebSocketServer: class extends EventEmitter { clients = new Set(); } },
});
mock.module('../server/storage.ts', {
  exports: { store: { forOwner: () => ({ getMessage: id => id === messageId ? message : null, getSettings: () => settings }) } },
});
mock.module('../server/session.ts', {
  exports: { RealtimeSession: class {}, getActiveSessionId: () => null },
});
const previousSignals = new Map(['SIGINT', 'SIGTERM'].map(signal => [signal, new Set(process.listeners(signal))]));
await import('../server/index.ts');
after(() => {
  for (const [signal, listeners] of previousSignals) {
    for (const listener of process.listeners(signal)) if (!listeners.has(listener)) process.removeListener(signal, listener);
  }
});

function request(path = `/api/messages/${messageId}/suggestions/1/audio`, headers = {}) {
  const req = new EventEmitter();
  Object.assign(req, {
    method: 'POST', url: path, aborted: false,
    headers: {
      cookie: browserCookie('22222222-2222-4222-8222-222222222222', config.browserSecret, false).split(';')[0],
      host: `127.0.0.1:${config.servicePort}`, origin: `http://127.0.0.1:${config.webPort}`,
      'x-bailian-api-key': runtime.apiKey, 'x-bailian-api-host': 'dashscope-intl.aliyuncs.com', ...headers,
    },
    headersDistinct: { 'x-bailian-api-key': [runtime.apiKey], 'x-bailian-api-host': ['dashscope-intl.aliyuncs.com'] },
  });
  const res = new EventEmitter();
  res.destroyed = false;
  res.writableEnded = false;
  res.setHeader = () => {};
  res.writeHead = status => { res.status = status; };
  const completed = new Promise(resolve => {
    res.end = body => { res.writableEnded = true; res.body = JSON.parse(body); resolve(res); };
  });
  requestHandler(req, res);
  return { req, res, completed };
}

test('HTTP route uses the stored option and browser credentials without a request body', async () => {
  const { completed, req, res } = request();
  await completed;
  assert.equal(res.status, 200);
  assert.equal(res.body.sampleRate, 24000);
  assert.equal(calls[0].text, options[1].text);
  assert.equal(calls[0].runtime.apiKey, runtime.apiKey);
  assert.equal(calls[0].runtime.realtimeUrl, runtime.realtimeUrl);
  assert.equal(req.listenerCount('aborted'), 0);
  assert.equal(res.listenerCount('close'), 0);
});

test('HTTP route maps missing options and provider failures to safe error responses', async () => {
  const missing = request(`/api/messages/${messageId}/suggestions/9/audio`);
  assert.equal((await missing.completed).status, 404);
  assert.equal(missing.res.body.errorCode, 'apiNotFound');
  synthesize = async () => { throw new Error('sensitive-account-secret'); };
  const failed = await request().completed;
  assert.equal(failed.status, 502);
  assert.doesNotMatch(failed.body.error, /sensitive-account-secret/);
  assert.equal(failed.body.errorCode, 'suggestionAudioFailed');
});

test('HTTP disconnect aborts provider work and releases request listeners', async t => {
  for (const event of ['aborted', 'close']) {
    await t.test(event, async () => {
      synthesize = ({ signal }) => new Promise((resolve, reject) => {
        signal.addEventListener('abort', () => reject(new DOMException('cancelled', 'AbortError')), { once: true });
      });
      const { req, res } = request();
      await setImmediate();
      if (event === 'aborted') { req.aborted = true; req.emit('aborted'); }
      else { res.destroyed = true; res.emit('close'); }
      assert.equal(calls.at(-1).signal.aborted, true);
      await setImmediate();
      assert.equal(res.writableEnded, false);
      assert.equal(req.listenerCount('aborted'), 0);
      assert.equal(res.listenerCount('close'), 0);
    });
  }
});


test('HTTP suggestion wrapper preserves provider codes and params alongside the legacy error', async () => {
  synthesize = async () => { throw new ProviderError('safe provider fallback', { errorCode: 'quotaExceeded', errorParams: { retryAfter: 10 } }); };
  const failed = await request().completed;
  assert.equal(failed.status, 502);
  assert.equal(failed.body.error, 'お手本の音声を生成できませんでした。Bailian の設定を確認して、もう一度お試しください。');
  assert.equal(failed.body.errorCode, 'quotaExceeded');
  assert.deepEqual(failed.body.errorParams, { retryAfter: 10 });
});
