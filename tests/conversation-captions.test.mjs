import assert from 'node:assert/strict';
import { mock, test } from 'node:test';
import { selectCurrentCaptions } from '../src/lib/conversation-captions.ts';

const session = { id: 'session', title: '练习', createdAt: '', endedAt: null, review: null };
const message = (role, turnId, content, extra = {}) => ({
  id: `${turnId}-${role}`, sessionId: session.id, turnId, role, content,
  spokenContent: '', interrupted: false, delivery: 'voice', translation: null, createdAt: '', ...extra,
});

test('captions select the latest user and only the assistant in that session and turn', () => {
  const oldUser = message('user', 'old', 'こんにちは');
  const oldReply = message('assistant', 'old', 'こんにちは。');
  const user = message('user', 'new', '今日は');
  assert.deepEqual(selectCurrentCaptions([], ''), { user: null, assistant: null, userText: '', pending: false });
  assert.deepEqual(selectCurrentCaptions([oldReply], ''), { user: null, assistant: null, userText: '', pending: false });
  assert.deepEqual(selectCurrentCaptions([oldUser, oldReply, user], ''), { user, assistant: null, userText: user.content, pending: false });
  const assistant = message('assistant', 'new', 'いい天気です。', { interrupted: true });
  const messages = [oldUser, oldReply, user, assistant, message('assistant', 'new', '別の会話', { sessionId: 'other' })];
  assert.deepEqual(selectCurrentCaptions(messages, ''), { user, assistant, userText: user.content, pending: false });
  assert.equal(selectCurrentCaptions(messages, '').assistant.interrupted, true);
});

test('a new transcript hides both messages from the previous turn', () => {
  const messages = [message('user', 'old', 'こんにちは'), message('assistant', 'old', 'こんにちは。')];
  assert.deepEqual(selectCurrentCaptions(messages, '今日は'), { user: null, assistant: null, userText: '今日は', pending: true });
});

// Run the actual hook event handlers without a DOM or added renderer dependency.
let rendering;
mock.module('react', { exports: {
  useCallback: callback => callback,
  useState(initial) {
    const owner = rendering;
    const index = owner.cursor++;
    if (!(index in owner.slots)) owner.slots[index] = initial;
    return [owner.slots[index], value => { owner.slots[index] = typeof value === 'function' ? value(owner.slots[index]) : value; }];
  },
  useRef(initial) {
    const owner = rendering;
    const index = owner.cursor++;
    if (!(index in owner.slots)) owner.slots[index] = { current: initial };
    return owner.slots[index];
  },
  useEffect(effect) {
    const index = rendering.cursor++;
    if (!(index in rendering.slots)) rendering.slots[index] = effect();
  },
} });
mock.module('../src/lib/api.ts', { exports: { ensureBrowserSession: async () => {}, api: {}, SOCKET_URL: 'ws://example.invalid' } });
mock.module('../src/lib/browser-audio.ts', { exports: { BrowserAudio: class {
  static latest;
  recognitionTime = 0;
  setRecognitionStream(streamId) { this.streamId = streamId; this.recognitionTime = 0; }
  getRecognitionTime() { return this.recognitionTime; }
  registrations = [];
  audioEvents = [];
  constructor(callbacks) { this.callbacks = callbacks; this.constructor.latest = this; }
  async prepare() {}
  async startMicrophone() {}
  async dispose() {}
  stopMicrophone() {}
  setVadEnabled() {}
  setMuted() {}
  beginTurn() {}
  cancelTurn() {}
  registerSentence(turnId, sentenceId, text) { this.registrations.push({ turnId, sentenceId, text }); }
  pushAudio(turnId, sentenceId, audio) { this.audioEvents.push({ turnId, sentenceId, audio }); }
  finishSentence() {}
} } });
const { useConversation } = await import('../src/hooks/use-conversation.ts');
const { BrowserAudio } = await import('../src/lib/browser-audio.ts');

class Socket {
  static OPEN = 1;
  static latest;
  readyState = 1;
  bufferedAmount = 0;
  sent = [];
  constructor() { Socket.latest = this; queueMicrotask(() => this.onopen?.()); }
  send(raw) {
    const event = JSON.parse(raw);
    this.sent.push(event);
    if (event.type === 'start') queueMicrotask(() => this.receive({ type: 'session.started', session, voice: event.voice, asrStreamId: event.voice ? 'stream' : null }));
  }
  receive(event) { this.onmessage?.({ data: JSON.stringify(event) }); }
  close() { this.readyState = 3; this.onclose?.(); }
}

async function conversation(t) {
  const previousSocket = globalThis.WebSocket;
  globalThis.WebSocket = Socket;
  const hooks = { slots: [], cursor: 0 };
  const current = function ConversationHarness() {
    rendering = hooks;
    hooks.cursor = 0;
    return useConversation();
  };
  const unmount = () => {
    for (const slot of hooks.slots) if (typeof slot === 'function') slot();
    globalThis.WebSocket = previousSocket;
  };
  t.after(unmount);
  await current().start({ voice: true });
  const receive = event => Socket.latest.receive(event);
  receive({ type: 'message', message: message('user', 'old', 'こんにちは') });
  receive({ type: 'reply.start', turnId: 'old', message: message('assistant', 'old', 'こんにちは。') });
  BrowserAudio.latest.callbacks.onVadStatus('ready');
  const admit = (text, { final = false, segmentId = 1, beginMs = 0, endMs = beginMs + 320 } = {}) => {
    const audio = BrowserAudio.latest;
    const context = audio.callbacks.getSpeechContext();
    for (let startMs = beginMs; startMs < endMs; startMs += 32) {
      audio.recognitionTime = startMs + 32;
      audio.callbacks.onVadFrame({ streamId: 'stream', startMs, endMs: startMs + 32, probability: 0.99, context });
    }
    receive({ type: 'transcript', streamId: 'stream', segmentId, beginMs, endMs: final ? endMs : null, text, final });
  };
  return { current, receive, unmount, admit, captions: () => selectCurrentCaptions(current().messages, current().pendingTranscript) };
}

test('final ASR stays visible until its user message and never restores the previous reply', async t => {
  const { current, receive, captions, admit } = await conversation(t);
  receive({ type: 'turn.done', turnId: 'old' });
  admit('今日');
  assert.equal(current().transcript, '今日');
  assert.equal(captions().assistant, null);
  receive({ type: 'transcript', streamId: 'stream', segmentId: 1, beginMs: 0, endMs: 320, text: '今日は', final: true });
  assert.equal(current().transcript, '');
  assert.equal(current().pendingTranscript, '今日は');
  assert.deepEqual(captions(), { user: null, assistant: null, userText: '今日は', pending: true });
  receive({ type: 'message', message: message('assistant', 'old', 'こんにちは。', { interrupted: true }) });
  assert.equal(captions().pending, true, 'an old reply update cannot finish the ASR handoff');
  receive({ type: 'message', message: message('user', 'new', '今日は') });
  assert.equal(current().pendingTranscript, '');
  assert.equal(captions().user.turnId, 'new');
  assert.equal(captions().assistant, null);
  receive({ type: 'reply.start', turnId: 'new', message: message('assistant', 'new', '') });
  receive({ type: 'reply.delta', turnId: 'new', delta: 'いい天気です。' });
  receive({ type: 'state', state: 'listening' });
  assert.equal(captions().assistant.content, 'いい天気です。');
  receive({ type: 'turn.done', turnId: 'new' });
  admit('明日は', { segmentId: 2, beginMs: 640 });
  assert.equal(captions().assistant, null, 'the next utterance hides the completed reply');
});

test('stopping a reply preserves its generated text and the server interruption marker', async t => {
  const { current, receive, captions } = await conversation(t);
  current().cancel();
  receive({ type: 'message', message: message('assistant', 'old', 'こんにちは。', { interrupted: true }) });
  receive({ type: 'turn.cancelled', turnId: 'old' });
  assert.equal(captions().assistant.content, 'こんにちは。');
  assert.equal(captions().assistant.interrupted, true);
});

test('typing after a completed session starts fresh instead of reopening and clearing its recap', async t => {
  const { current, receive } = await conversation(t);
  await current().end();
  receive({ type: 'session.ended', session: { ...session, endedAt: 'now', review: { topic: 'Completed recap', expressions: [], improvement: '', memorySuggestions: [] } } });
  assert.equal(current().session.review.topic, 'Completed recap');
  await current().sendText('新しい会話です');
  assert.deepEqual(Socket.latest.sent.filter(event => event.type === 'start').at(-1), { type: 'start', voice: false });
  assert.deepEqual(Socket.latest.sent.at(-1), { type: 'text', text: '新しい会話です' });
});

test('input lifecycle changes clear temporary captions while preserving stored messages', async t => {
  for (const scenario of ['empty final', 'ASR failure', 'capture failure', 'disconnect', 'end', 'server end', 'typed send', 'new session']) {
    await t.test(scenario, async t => {
      const { current, receive, captions, admit } = await conversation(t);
      receive({ type: 'turn.done', turnId: 'old' });
      admit('途中');
      assert.equal(current().pendingTranscript, '途中');
      switch (scenario) {
        case 'empty final': receive({ type: 'transcript', streamId: 'stream', segmentId: 1, beginMs: 0, endMs: 320, text: '', final: true }); break;
        case 'ASR failure': receive({ type: 'error', source: 'asr', message: '認識失敗', recoverable: true }); break;
        case 'capture failure': BrowserAudio.latest.callbacks.onError('マイク失敗', 'capture'); break;
        case 'disconnect': Socket.latest.close(); break;
        case 'end':
          await current().end();
          receive({ type: 'transcript', streamId: 'stream', segmentId: 1, beginMs: 0, endMs: 320, text: '遅延した最終結果', final: true });
          break;
        case 'server end': receive({ type: 'session.ended', session: { ...session, endedAt: 'now' } }); break;
        case 'typed send': await current().sendText('東京に行きます'); break;
        case 'new session': receive({ type: 'session.started', session: { ...session, id: 'new-session' }, voice: true, asrStreamId: 'new-stream' }); break;
      }
      assert.equal(current().transcript, '');
      assert.equal(current().pendingTranscript, '');
      if (scenario === 'new session') assert.equal(current().messages.length, 0);
      else assert.equal(captions().assistant.content, 'こんにちは。');
    });
  }
});

const playbackCaption = (overrides = {}) => ({
  turnId: 'old', sentenceId: 'sentence', text: 'こんにちは。', visibleCharacters: 2, status: 'playing', ...overrides,
});

test('sentence metadata registers text before audio but never displays it before playback', async t => {
  const { current, receive } = await conversation(t);
  const audio = BrowserAudio.latest;
  receive({ type: 'audio.sentence', turnId: 'old', sentenceId: 'sentence', text: 'こんにちは。' });
  assert.deepEqual(audio.registrations, [{ turnId: 'old', sentenceId: 'sentence', text: 'こんにちは。' }]);
  assert.equal(current().playbackCaption, null);
  receive({ type: 'audio', turnId: 'old', sentenceId: 'sentence', audio: 'AAA=', sampleRate: 24000 });
  assert.equal(audio.audioEvents.length, 1);
  assert.equal(current().playbackCaption, null);
  const caption = playbackCaption();
  audio.callbacks.onCaption(caption);
  assert.deepEqual(current().playbackCaption, caption);
  const ended = playbackCaption({ visibleCharacters: 6, status: 'ended' });
  audio.callbacks.onCaption(ended);
  audio.callbacks.onBusy(false);
  assert.deepEqual(current().playbackCaption, ended, 'natural completion is retained for the overlay fade');
});

test('cancelled and replaced replies cannot register late caption text or audio', async t => {
  const { current, receive } = await conversation(t);
  const audio = BrowserAudio.latest;
  audio.callbacks.onCaption(playbackCaption());
  current().cancel();
  assert.equal(current().playbackCaption, null);
  for (const turnId of ['old', 'unknown']) {
    receive({ type: 'audio.sentence', turnId, sentenceId: 'late', text: '遅延した音声' });
    receive({ type: 'audio', turnId, sentenceId: 'late', audio: 'AAA=', sampleRate: 24000 });
  }
  receive({ type: 'reply.start', turnId: 'new', message: message('assistant', 'new', '') });
  receive({ type: 'audio.sentence', turnId: 'new', sentenceId: 'new-sentence', text: '次の文。' });
  receive({ type: 'audio.sentence', turnId: 'old', sentenceId: 'late', text: '遅延した音声' });
  assert.deepEqual(audio.registrations, [{ turnId: 'new', sentenceId: 'new-sentence', text: '次の文。' }]);
  assert.equal(audio.audioEvents.length, 0);
  const caption = playbackCaption({ turnId: 'new', sentenceId: 'new-sentence', text: '次の文。' });
  audio.callbacks.onCaption(caption);
  receive({ type: 'turn.cancelled', turnId: 'old' });
  assert.deepEqual(current().playbackCaption, caption, 'late cancellation does not clear a newer caption');
});

test('replay captions are accepted even when their turn differs from the current reply', async t => {
  const { current } = await conversation(t);
  const caption = playbackCaption({ turnId: 'earlier-replayed-turn' });
  BrowserAudio.latest.callbacks.onCaption(caption);
  assert.deepEqual(current().playbackCaption, caption);
});

test('playback caption lifecycle clears interruptions, failures, and new sessions', async t => {
  for (const scenario of ['confirmed interruption', 'server cancellation', 'ASR failure', 'playback failure', 'capture failure', 'disconnect', 'end', 'server end', 'typed send', 'new reply', 'new session']) {
    await t.test(scenario, async t => {
      const { current, receive } = await conversation(t);
      const audio = BrowserAudio.latest;
      audio.callbacks.onCaption(playbackCaption());
      switch (scenario) {
        case 'confirmed interruption':
          audio.callbacks.onVadStatus('ready');
          t.mock.timers.enable({ apis: ['setTimeout'] });
          let now = 0;
          t.mock.method(performance, 'now', () => now);
          const context = audio.callbacks.getSpeechContext();
          for (let startMs = 0; startMs < 1024; startMs += 32) {
            audio.recognitionTime = startMs + 32;
            audio.callbacks.onVadFrame({ streamId: 'stream', startMs, endMs: startMs + 32, probability: 0.99, context });
          }
          receive({ type: 'speech.started', turnId: 'old', streamId: 'stream', segmentId: 1, beginMs: 0, endMs: null });
          assert.notEqual(current().playbackCaption, null, 'onset alone cannot interrupt captions');
          receive({ type: 'transcript', streamId: 'stream', segmentId: 1, beginMs: 0, endMs: null, text: 'ちょっと待ってください', final: false });
          assert.notEqual(current().playbackCaption, null, 'text must remain stable before interrupting');
          now = 300;
          t.mock.timers.tick(300);
          break;
        case 'server cancellation': receive({ type: 'turn.cancelled', turnId: 'old' }); break;
        case 'ASR failure': receive({ type: 'error', source: 'asr', message: '認識失敗', recoverable: true }); break;
        case 'playback failure': audio.callbacks.onError('音声失敗', 'playback'); break;
        case 'capture failure': audio.callbacks.onError('マイク失敗', 'capture'); break;
        case 'disconnect': Socket.latest.close(); break;
        case 'end': await current().end(); break;
        case 'server end': receive({ type: 'session.ended', session: { ...session, endedAt: 'now' } }); break;
        case 'typed send': await current().sendText('はい'); break;
        case 'new reply': receive({ type: 'reply.start', turnId: 'new', message: message('assistant', 'new', '') }); break;
        case 'new session': receive({ type: 'session.started', session: { ...session, id: 'new-session' }, voice: true, asrStreamId: 'new-stream' }); break;
      }
      assert.equal(current().playbackCaption, null);
    });
  }
});

test('old audio callbacks cannot restore captions after release, replacement, or unmount', async t => {
  const { current, receive, unmount } = await conversation(t);
  const oldAudio = BrowserAudio.latest;
  oldAudio.callbacks.onCaption(playbackCaption());
  await current().end();
  oldAudio.callbacks.onCaption(playbackCaption({ status: 'ended' }));
  assert.equal(current().playbackCaption, null);
  receive({ type: 'session.ended', session: { ...session, endedAt: 'now' } });
  await current().start({ voice: true });
  assert.notEqual(BrowserAudio.latest, oldAudio);
  const currentCaption = playbackCaption({ turnId: 'new', text: '新しい音声' });
  BrowserAudio.latest.callbacks.onCaption(currentCaption);
  oldAudio.callbacks.onCaption(playbackCaption());
  oldAudio.callbacks.onCaption(null);
  assert.deepEqual(current().playbackCaption, currentCaption);
  unmount();
  BrowserAudio.latest.callbacks.onCaption(playbackCaption());
  assert.deepEqual(current().playbackCaption, currentCaption, 'unmounted callbacks must not write hook state');
});
