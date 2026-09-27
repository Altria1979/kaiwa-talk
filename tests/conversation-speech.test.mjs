import assert from 'node:assert/strict';
import { mock, test } from 'node:test';

const session = { id: 'session', title: '練習', createdAt: '', endedAt: null, review: null };
const assistant = turnId => ({ id: `assistant-${turnId}`, sessionId: session.id, turnId, role: 'assistant', content: 'こんにちは。', spokenContent: '', interrupted: false, delivery: 'voice', translation: null, createdAt: '' });
let rendering;
mock.module('react', { exports: {
  useCallback: callback => callback,
  useState(initial) {
    const owner = rendering, index = owner.cursor++;
    if (!(index in owner.slots)) owner.slots[index] = typeof initial === 'function' ? initial() : initial;
    return [owner.slots[index], value => { owner.slots[index] = typeof value === 'function' ? value(owner.slots[index]) : value; }];
  },
  useRef(initial) {
    const owner = rendering, index = owner.cursor++;
    if (!(index in owner.slots)) owner.slots[index] = { current: initial };
    return owner.slots[index];
  },
  useEffect(effect) {
    const index = rendering.cursor++;
    if (!(index in rendering.slots)) rendering.slots[index] = effect();
  },
} });
mock.module('../src/lib/api.ts', { exports: { ensureBrowserSession: async () => {}, SOCKET_URL: 'ws://example.invalid', api: { suggestionAudio: async () => ({ audio: 'AAABAA==', sampleRate: 24000 }) } } });
class Audio {
  static latest;
  recognitionTime = 0;
  cancelled = [];
  currentTurn = null;
  busy = false;
  constructor(callbacks) { this.callbacks = callbacks; Audio.latest = this; }
  startRecording() {}
  async stopRecording() { return { status: 'empty' }; }
  async prepare() {}
  async startMicrophone() {}
  stopMicrophone() {}
  setVadEnabled() {}
  setMuted(value) { this.muted = value; }
  setRecognitionStream(streamId) { this.streamId = streamId; this.recognitionTime = 0; }
  getRecognitionTime() { return this.recognitionTime; }
  beginTurn(turnId) { this.currentTurn = turnId; }
  cancelTurn(turnId) { this.cancelled.push(turnId); this.currentTurn = null; this.setBusy(false); }
  setBusy(value) { this.busy = value; this.callbacks.onBusy(value); }
  registerSentence() {}
  pushAudio() { this.setBusy(true); }
  finishSentence() {}
  canReplay() { return true; }
  async replay(turnId) { this.currentTurn = turnId; this.setBusy(true); }
  async dispose() {}
}
mock.module('../src/lib/browser-audio.ts', { exports: { BrowserAudio: Audio } });
const { useConversation } = await import('../src/hooks/use-conversation.ts');
class Socket {
  static OPEN = 1;
  static latest;
  readyState = 1;
  bufferedAmount = 0;
  sent = [];
  constructor() { Socket.latest = this; queueMicrotask(() => this.onopen?.()); }
  send(raw) {
    const event = JSON.parse(raw); this.sent.push(event);
    if (event.type === 'start') queueMicrotask(() => this.receive({ type: 'session.started', session, voice: event.voice, asrStreamId: event.voice ? 'stream' : null }));
  }
  receive(event) { this.onmessage?.({ data: JSON.stringify(event) }); }
  close() { this.readyState = 3; this.onclose?.(); }
}
async function conversation(t, { speaking = false, status = 'ready' } = {}) {
  const previous = globalThis.WebSocket; globalThis.WebSocket = Socket;
  const hooks = { slots: [], cursor: 0 };
  const current = function Harness() { rendering = hooks; hooks.cursor = 0; return useConversation(); };
  t.after(() => { for (const slot of hooks.slots) if (typeof slot === 'function') slot(); globalThis.WebSocket = previous; });
  await current().start({ voice: true });
  const audio = Audio.latest, socket = Socket.latest;
  const receive = event => socket.receive(event);
  audio.callbacks.onVadStatus(status);
  if (speaking) receive({ type: 'reply.start', turnId: 'old', message: assistant('old') });
  let now = 0;
  t.mock.method(performance, 'now', () => now);
  t.mock.timers.enable({ apis: ['setTimeout'] });
  const tick = ms => { now += ms; t.mock.timers.tick(ms); };
  const frames = ({ beginMs = audio.recognitionTime, durationMs = 320, probability = 0.99, context = audio.callbacks.getSpeechContext(), streamId = 'stream' } = {}) => {
    for (let startMs = beginMs; startMs < beginMs + durationMs; startMs += 32) {
      audio.recognitionTime = startMs + 32;
      audio.callbacks.onVadFrame({ streamId, startMs, endMs: startMs + 32, probability, context });
    }
  };
  const transcript = (text = 'はい', { final = true, segmentId = 1, beginMs = 0, endMs = audio.recognitionTime, streamId = 'stream' } = {}) => receive({ type: 'transcript', text, final, segmentId, beginMs, endMs: final ? endMs : null, streamId });
  const events = type => socket.sent.filter(event => event.type === type);
  return { current, audio, socket, receive, frames, transcript, tick, events };
}

test('nonempty cloud final without local evidence never displays, submits or interrupts', async t => {
  const h = await conversation(t, { speaking: true });
  h.receive({ type: 'speech.started', streamId: 'stream', segmentId: 1, beginMs: 0, endMs: null, turnId: 'old' });
  h.transcript('是。', { endMs: 320 });
  h.frames({ durationMs: 1024, probability: 0.4 });
  h.tick(2000);
  assert.equal(h.current().transcript, '');
  assert.equal(h.current().pendingTranscript, '');
  assert.equal(h.current().messages.some(message => message.role === 'user'), false);
  assert.deepEqual(h.events('speech.accept'), []);
  assert.deepEqual(h.events('cancel'), []);
  assert.equal(h.audio.currentTurn, 'old');
});

test('ordinary short Japanese answer accepts once in either final/evidence arrival order', async t => {
  for (const finalFirst of [false, true]) await t.test(`finalFirst=${finalFirst}`, async t => {
    const h = await conversation(t);
    if (finalFirst) h.transcript('はい', { endMs: 320 });
    h.frames();
    if (!finalFirst) h.transcript('はい');
    assert.equal(h.current().pendingTranscript, 'はい');
    assert.equal(h.current().transcript, '');
    assert.deepEqual(h.events('speech.accept'), [{ type: 'speech.accept', streamId: 'stream', segmentId: 1 }]);
    h.transcript('はい'); h.frames({ durationMs: 320 }); h.tick(1000);
    assert.equal(h.events('speech.accept').length, 1, 'duplicate final or later frames cannot recommit');
    assert.deepEqual(h.events('cancel'), []);
  });
});

test('unconfirmed partial text becomes a caption only after matching positive frames', async t => {
  const h = await conversation(t);
  h.audio.recognitionTime = 320;
  h.transcript('こんにちは', { final: false });
  assert.equal(h.current().transcript, '');
  h.frames({ beginMs: 0 });
  assert.equal(h.current().transcript, 'こんにちは');
  assert.equal(h.current().pendingTranscript, 'こんにちは');
  h.transcript('こんにちは。');
  assert.equal(h.current().transcript, '');
  assert.equal(h.current().pendingTranscript, 'こんにちは。');
  assert.equal(h.events('speech.accept').length, 1);
});

test('punctuation and short disconnected noise bursts cannot create an admission', async t => {
  const h = await conversation(t);
  for (const beginMs of [0, 480, 960]) h.frames({ beginMs, durationMs: 192 });
  h.transcript('はい', { endMs: 1152 });
  h.tick(1000);
  assert.deepEqual(h.events('speech.accept'), []);
  h.frames({ beginMs: 1600 });
  h.transcript(' …？！ ', { segmentId: 2, beginMs: 1600, endMs: 1920 });
  assert.deepEqual(h.events('speech.accept'), []);
  assert.equal(h.current().pendingTranscript, '');
});

test('brief acknowledgement during AI generation remains ignored after the AI finishes', async t => {
  const h = await conversation(t, { speaking: true });
  h.frames(); h.transcript('はい');
  h.receive({ type: 'turn.done', turnId: 'old' });
  h.audio.setBusy(false);
  h.tick(2000);
  assert.equal(h.current().pendingTranscript, '');
  assert.deepEqual(h.events('speech.accept'), []);
  assert.deepEqual(h.events('cancel'), []);
});

test('one utterance starting over the AI cannot be reclassified when playback ends halfway', async t => {
  const h = await conversation(t, { speaking: true });
  h.frames({ durationMs: 320 });
  h.receive({ type: 'turn.done', turnId: 'old' });
  h.frames({ durationMs: 320 });
  h.transcript('はい、はい', { endMs: 640 });
  h.tick(1000);
  assert.deepEqual(h.events('speech.accept'), []);
  assert.deepEqual(h.events('cancel'), []);
  assert.equal(h.current().pendingTranscript, '');
});

test('sustained interruption needs stable text and cancels only its original turn once', async t => {
  const h = await conversation(t, { speaking: true });
  h.frames({ durationMs: 1024 });
  h.transcript('ちょっと待ってください', { final: false });
  h.tick(299);
  assert.deepEqual(h.events('cancel'), []);
  assert.equal(h.current().pendingTranscript, '');
  h.tick(1);
  assert.deepEqual(h.events('cancel'), [{ type: 'cancel', turnId: 'old' }]);
  assert.deepEqual(h.events('speech.accept'), [{ type: 'speech.accept', streamId: 'stream', segmentId: 1 }]);
  assert.equal(h.current().transcript, 'ちょっと待ってください');
  h.transcript('ちょっと待ってください。'); h.tick(1000);
  assert.equal(h.events('cancel').length, 1);
  assert.equal(h.events('speech.accept').length, 1);
  h.receive({ type: 'reply.start', turnId: 'new', message: assistant('new') });
  h.transcript('古い遅延結果'); h.tick(1000);
  assert.equal(h.audio.currentTurn, 'new');
  assert.equal(h.events('cancel').length, 1);
});

test('changing recognized words restarts the interruption stability timer', async t => {
  const h = await conversation(t, { speaking: true });
  h.frames({ durationMs: 1024 });
  h.transcript('ちょっと', { final: false }); h.tick(200);
  h.transcript('ちょっと待って', { final: false }); h.tick(299);
  assert.deepEqual(h.events('cancel'), []);
  h.tick(1);
  assert.equal(h.events('speech.accept').length, 1);
});

test('VAD loading or unavailable never falls back to cloud-only recognition', async t => {
  for (const status of ['loading', 'unavailable']) await t.test(status, async t => {
    const h = await conversation(t, { speaking: true, status });
    h.frames({ durationMs: 2048 }); h.transcript('長い誤認識です'); h.tick(1000);
    assert.deepEqual(h.events('cancel'), []);
    assert.deepEqual(h.events('speech.accept'), []);
    assert.equal(h.current().pendingTranscript, '');
    if (status === 'unavailable') assert.match(h.current().error, /テキスト/);
  });
});

test('old recognition streams and segments outside their audio ranges cannot borrow new evidence', async t => {
  const h = await conversation(t);
  h.frames({ streamId: 'obsolete' });
  h.transcript('旧接続', { streamId: 'obsolete' });
  h.frames({ beginMs: 1000 });
  h.transcript('遅延結果', { beginMs: 0, endMs: 320 });
  h.tick(1000);
  assert.deepEqual(h.events('speech.accept'), []);
  h.transcript('新しい回答', { segmentId: 2, beginMs: 1000, endMs: 1320 });
  assert.deepEqual(h.events('speech.accept'), [{ type: 'speech.accept', streamId: 'stream', segmentId: 2 }]);
});

test('lifecycle resets discard pending interruption timers and delayed old evidence', async t => {
  for (const action of ['mute', 'typed send', 'manual cancel', 'new reply', 'end', 'disconnect', 'new stream', 'suggestion']) await t.test(action, async t => {
    const h = await conversation(t, { speaking: true });
    h.receive({ type: 'reply.suggestions', turnId: 'old', messageId: 'assistant-old', status: 'ready', suggestions: [{ text: 'はい', reading: 'はい', meaning: '肯定' }] });
    const oldContext = h.audio.callbacks.getSpeechContext();
    h.frames({ durationMs: 1024, context: oldContext });
    h.transcript('ちょっと待って', { final: false });
    h.tick(200);
    switch (action) {
      case 'mute': h.current().toggleMute(); h.current().toggleMute(); break;
      case 'typed send': await h.current().sendText('文字の回答'); break;
      case 'manual cancel': h.current().cancel(); break;
      case 'new reply': h.receive({ type: 'reply.start', turnId: 'new', message: assistant('new') }); break;
      case 'end': await h.current().end(); break;
      case 'disconnect': h.socket.close(); break;
      case 'new stream': h.receive({ type: 'session.started', session, voice: true, asrStreamId: 'new-stream' }); break;
      case 'suggestion': await h.current().listenSuggestion('assistant-old', 0); h.audio.setBusy(false); await Promise.resolve(); break;
    }
    const cancellations = h.events('cancel').length;
    h.frames({ beginMs: 1024, durationMs: 512, context: oldContext });
    h.transcript('ちょっと待ってください', { endMs: 1536 });
    h.tick(1000);
    assert.deepEqual(h.events('speech.accept'), []);
    assert.equal(h.events('cancel').length, cancellations, 'delayed timer cannot cancel after lifecycle reset');
    assert.equal(h.current().pendingTranscript, '');
  });
});

test('ending preserves previously sent acceptance and does not accept an unconfirmed tail', async t => {
  const h = await conversation(t);
  h.frames(); h.transcript('はい', { final: false });
  assert.equal(h.events('speech.accept').length, 1);
  await h.current().end();
  const endIndex = h.socket.sent.findIndex(event => event.type === 'end');
  const acceptanceIndex = h.socket.sent.findIndex(event => event.type === 'speech.accept');
  assert.ok(acceptanceIndex < endIndex);
  h.transcript('はい。');
  h.transcript('未確認の尾句', { segmentId: 2, beginMs: 320, endMs: 640 });
  h.tick(1000);
  assert.equal(h.events('speech.accept').length, 1);
  assert.equal(h.current().pendingTranscript, '');
});

test('ordinary microphone answers resume after an unfinished reply demonstration completes', async t => {
  const h = await conversation(t, { speaking: true });
  h.receive({ type: 'reply.suggestions', turnId: 'old', messageId: 'assistant-old', status: 'ready', suggestions: [{ text: 'はい', reading: 'はい', meaning: '肯定' }] });
  await h.current().listenSuggestion('assistant-old', 0);
  h.audio.setBusy(false); await Promise.resolve();
  assert.equal(h.current().suggestionSpeech, null);
  h.frames(); h.transcript('はい');
  assert.equal(h.current().pendingTranscript, 'はい');
  assert.equal(h.events('speech.accept').length, 1);
});

test('a later ordinary answer after a genuine pause does not inherit the prior interruption context', async t => {
  const h = await conversation(t, { speaking: true });
  h.frames({ durationMs: 320 });
  h.transcript('はい', { segmentId: 1 });
  h.receive({ type: 'turn.done', turnId: 'old' });
  h.frames({ beginMs: 640, durationMs: 320 });
  h.transcript('いいえ', { segmentId: 2, beginMs: 640, endMs: 960 });
  h.tick(1000);
  assert.deepEqual(h.events('speech.accept'), [{ type: 'speech.accept', streamId: 'stream', segmentId: 2 }]);
  assert.deepEqual(h.events('cancel'), []);
  assert.equal(h.current().pendingTranscript, 'いいえ');
});

test('a final interruption arriving before its delayed VAD evidence still targets only the onset reply', async t => {
  const h = await conversation(t, { speaking: true });
  const context = h.audio.callbacks.getSpeechContext();
  h.audio.recognitionTime = 1024;
  h.transcript('ちょっと待ってください', { endMs: 1024 });
  h.tick(300);
  assert.deepEqual(h.events('speech.accept'), []);
  h.frames({ beginMs: 0, durationMs: 1024, context });
  assert.deepEqual(h.events('cancel'), [{ type: 'cancel', turnId: 'old' }]);
  assert.deepEqual(h.events('speech.accept'), [{ type: 'speech.accept', streamId: 'stream', segmentId: 1 }]);
  assert.equal(h.current().pendingTranscript, 'ちょっと待ってください');
});

test('finishing backend generation cannot lower the interruption bar while audio is still playing', async t => {
  const h = await conversation(t, { speaking: true });
  h.audio.setBusy(true);
  h.receive({ type: 'turn.done', turnId: 'old' });
  h.frames({ durationMs: 320 }); h.transcript('はい'); h.tick(1000);
  assert.deepEqual(h.events('speech.accept'), []);
  assert.deepEqual(h.events('cancel'), []);
  assert.equal(h.audio.busy, true);
});

test('conversation errors retain new wire descriptors and recognize legacy events without reconnecting', async t => {
  const { current, receive, socket, audio, events } = await conversation(t);
  receive({ type: 'error', source: 'session', message: 'safe legacy fallback', errorCode: 'fieldPersona', errorParams: { max: 2000 }, recoverable: true });
  assert.equal(current().error, 'safe legacy fallback');
  assert.deepEqual(current().errorDetails, { message: 'safe legacy fallback', errorCode: 'fieldPersona', errorParams: { max: 2000 } });
  receive({ type: 'error', source: 'session', message: '先に会話を開始してください。', recoverable: true });
  assert.equal(current().errorDetails.errorCode, 'sessionRequired');
  assert.equal(Socket.latest, socket);
  assert.equal(Audio.latest, audio);
  assert.equal(events('start').length, 1);
  assert.equal(events('end').length, 0);
  current().clearError();
  assert.equal(current().error, null);
  assert.equal(current().errorDetails, null);
});
