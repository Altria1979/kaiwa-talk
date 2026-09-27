import assert from 'node:assert/strict';
import { EventEmitter } from 'node:events';
import { setImmediate } from 'node:timers/promises';
import { mock, test } from 'node:test';

class Socket extends EventEmitter {
  static OPEN = 1;
  static instances = [];
  readyState = Socket.OPEN;
  sent = [];
  terminated = false;

  constructor() {
    super();
    Socket.instances.push(this);
    queueMicrotask(() => this.emit('open'));
  }

  send(raw) { this.sent.push(JSON.parse(raw)); }
  receive(event) { this.emit('message', Buffer.from(JSON.stringify(event))); }
  terminate() { this.terminated = true; this.readyState = 3; this.emit('close'); }
}

mock.module('ws', { exports: { default: Socket } });
const providerConfig = Object.freeze({ realtimeUrl: 'wss://example.invalid/realtime', ttsModel: 'test-model', apiKey: 'test-only' });
mock.module(new URL('../server/config.ts', import.meta.url).href, {
  exports: { config: providerConfig, resolveBailianConfig: () => providerConfig },
});
const { TtsClient, resolveTtsLanguage } = await import('../server/providers/tts.ts');

async function synthesize(text, language = 'Japanese', signal = new AbortController().signal) {
  const audio = [];
  const completed = new TtsClient().synthesize(text, 'Cherry', language, signal, chunk => audio.push(chunk));
  const socket = Socket.instances.at(-1);
  await setImmediate();
  return { socket, completed, audio };
}

test('every configured learning language is sent explicitly to the provider', async t => {
  const languages = [
    ['日本語', 'Japanese'], ['英語', 'English'], ['韓国語', 'Korean'],
    ['フランス語', 'French'], ['ドイツ語', 'German'], ['スペイン語', 'Spanish'],
    ['日语', 'Japanese'], ['英语', 'English'], ['韩语', 'Korean'],
    ['法语', 'French'], ['德语', 'German'], ['西班牙语', 'Spanish'], ['自定义语言', 'Auto'],
  ];
  for (const [setting, expected] of languages) {
    await t.test(setting, async () => {
      const { socket, completed } = await synthesize('test', resolveTtsLanguage(setting));
      assert.deepEqual(socket.sent[0].session, {
        voice: 'Cherry', mode: 'server_commit', language_type: expected, response_format: 'pcm', sample_rate: 24000,
      });
      socket.receive({ type: 'session.updated' });
      socket.receive({ type: 'response.audio.delta', delta: 'AAABAA==' });
      socket.receive({ type: 'session.finished' });
      await completed;
    });
  }
  assert.equal(resolveTtsLanguage(' 日本語 '), 'Japanese');
  assert.equal(resolveTtsLanguage(' 日语 '), 'Japanese');
});

test('Japanese kanji and kana stay unchanged and use Japanese in every sentence', async t => {
  for (const text of ['大丈夫です。', '神戸に行きます。', '東京。', '神戸。', '「コベイ」は「神戸（こうべ）」のことですか？']) {
    await t.test(text, async () => {
      const { socket, completed, audio } = await synthesize(text, resolveTtsLanguage('日本語'));
      assert.equal(socket.sent[0].type, 'session.update');
      assert.equal(socket.sent[0].session.language_type, 'Japanese');
      assert.equal(socket.sent.length, 1, 'text waits for the configured session');
      socket.receive({ type: 'session.updated' });
      assert.deepEqual(socket.sent.slice(1).map(({ event_id, ...event }) => {
        assert.equal(typeof event_id, 'string');
        return event;
      }), [
        { type: 'input_text_buffer.append', text }, { type: 'session.finish' },
      ]);
      assert.equal(new Set(socket.sent.map(event => event.event_id)).size, 3);
      socket.receive({ type: 'response.audio.delta', delta: 'AAABAA==' });
      socket.receive({ type: 'response.audio.delta', delta: 'AgADAA==' });
      socket.receive({ type: 'session.finished' });
      await completed;
      assert.deepEqual(audio, ['AAABAA==', 'AgADAA==']);
      assert.equal(socket.terminated, true);
    });
  }
});

test('cancellation closes the sentence socket and ignores late audio', async () => {
  const controller = new AbortController();
  const { socket, completed, audio } = await synthesize('東京。', 'Japanese', controller.signal);
  const rejected = assert.rejects(completed, { name: 'AbortError' });
  controller.abort();
  socket.receive({ type: 'response.audio.delta', delta: 'AAABAA==' });
  await rejected;
  assert.equal(socket.terminated, true);
  assert.deepEqual(audio, []);
});

test('an already cancelled request opens no connection', async () => {
  const count = Socket.instances.length;
  await assert.rejects(new TtsClient().synthesize('東京。', 'Cherry', 'Japanese', AbortSignal.abort(), () => {}), { name: 'AbortError' });
  assert.equal(Socket.instances.length, count);
});

test('provider failures reject and release the socket', async t => {
  for (const event of [
    { type: 'error', error: { code: 'InvalidParameter' } },
    { type: 'response.done', response: { status: 'failed' } },
    { type: 'session.finished' },
  ]) {
    await t.test(event.type, async () => {
      const { socket, completed } = await synthesize('東京。');
      const rejected = assert.rejects(completed, { name: 'ProviderError' });
      socket.receive(event);
      await rejected;
      assert.equal(socket.terminated, true);
    });
  }
});
