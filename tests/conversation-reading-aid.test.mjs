import assert from 'node:assert/strict';
import { mock, test } from 'node:test';

// Use the existing renderer-free hook harness to exercise actual socket events.
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

const session = { id: 'session', title: '練習', createdAt: '', endedAt: null, review: null };
const assistant = (turnId = 'turn', extra = {}) => ({
  id: `assistant-${turnId}`, sessionId: session.id, turnId, role: 'assistant', content: '',
  spokenContent: '', interrupted: false, delivery: 'voice', translation: null, createdAt: '', ...extra,
});
mock.module('../src/lib/api.ts', { exports: {
  ensureBrowserSession: async () => {}, SOCKET_URL: 'ws://example.invalid',
  api: { session: async id => ({ session: { ...session, id, endedAt: 'ended' }, messages: [assistant('history', { sessionId: id, content: '保存済みです。' })] }) },
} });
mock.module('../src/lib/bailian-credentials.ts', { exports: { readBrowserCredentials: () => undefined } });
class Audio {
  static latest;
  currentTurn = null;
  cancelled = [];
  constructor(callbacks) { this.callbacks = callbacks; Audio.latest = this; }
  startRecording() {}
  async stopRecording() { return { status: 'empty' }; }
  async prepare() {}
  async startMicrophone() {}
  async dispose() {}
  stopMicrophone() {}
  setVadEnabled() {}
  setMuted() {}
  setRecognitionStream() {}
  getRecognitionTime() { return 0; }
  beginTurn(turnId) { this.currentTurn = turnId; }
  cancelTurn(turnId) { this.cancelled.push(turnId); this.currentTurn = null; this.callbacks.onBusy(false); }
  canReplay() { return true; }
  async replay(turnId) { this.currentTurn = turnId; this.callbacks.onBusy(true); }
}
mock.module('../src/lib/browser-audio.ts', { exports: { BrowserAudio: Audio } });
const { useConversation } = await import('../src/hooks/use-conversation.ts');

class Socket {
  static OPEN = 1;
  static latest;
  readyState = 1;
  bufferedAmount = 0;
  sent = [];
  listeners = new Set();
  constructor() { Socket.latest = this; queueMicrotask(() => this.onopen?.()); }
  send(raw) {
    const event = JSON.parse(raw);
    this.sent.push(event);
    if (event.type === 'start') queueMicrotask(() => this.receive({ type: 'session.started', session, voice: event.voice }));
    if (event.type === 'cancel' && event.turnId) queueMicrotask(() => this.receive({ type: 'turn.cancelled', turnId: event.turnId }));
  }
  receive(event) {
    const message = { data: JSON.stringify(event) };
    this.onmessage?.(message);
    for (const listener of this.listeners) listener(message);
  }
  addEventListener(type, listener) { if (type === 'message') this.listeners.add(listener); }
  removeEventListener(type, listener) { if (type === 'message') this.listeners.delete(listener); }
  close() { this.readyState = 3; this.onclose?.(); }
}

async function conversation(t) {
  const previousSocket = globalThis.WebSocket;
  globalThis.WebSocket = Socket;
  const hooks = { slots: [], cursor: 0 };
  const current = function ConversationHarness() { rendering = hooks; hooks.cursor = 0; return useConversation(); };
  t.after(() => {
    for (const slot of hooks.slots) if (typeof slot === 'function') slot();
    globalThis.WebSocket = previousSocket;
  });
  assert.equal(current().streamingMessageId, null);
  await current().start({ voice: true });
  const socket = Socket.latest, audio = Audio.latest;
  return { current, socket, audio, receive: event => socket.receive(event) };
}

test('reading aids become eligible when text completes while reply audio still plays', async t => {
  const { current, receive, audio, socket } = await conversation(t);
  receive({ type: 'reply.start', turnId: 'turn', message: assistant() });
  assert.equal(current().streamingMessageId, 'assistant-turn');
  receive({ type: 'reply.delta', turnId: 'turn', delta: '新年は何をしたいですか？' });
  audio.callbacks.onBusy(true);
  const cancellations = audio.cancelled.length;
  const sent = [...socket.sent];
  receive({ type: 'reply.done', turnId: 'turn', message: assistant('turn', { content: '新年は何をしたいですか？' }) });
  assert.equal(current().streamingMessageId, null);
  assert.equal(current().state, 'speaking');
  assert.equal(audio.currentTurn, 'turn');
  assert.equal(audio.callbacks.getSpeechContext().interrupting, true);
  assert.equal(audio.cancelled.length, cancellations);
  assert.deepEqual(socket.sent, sent);
  assert.equal(current().messages.at(-1).content, '新年は何をしたいですか？');
});

test('only a valid assistant start and its matching completion change the streaming message', async t => {
  const { current, receive } = await conversation(t);
  for (const invalid of [assistant('foreign', { sessionId: 'other' }), assistant('wrong', { turnId: 'different' }), assistant('user', { role: 'user' })]) {
    receive({ type: 'reply.start', turnId: invalid.id.replace('assistant-', ''), message: invalid });
    assert.equal(current().streamingMessageId, null);
  }
  receive({ type: 'reply.start', turnId: 'turn', message: assistant() });
  for (const invalid of [
    { turnId: 'other', message: assistant() },
    { turnId: 'turn', message: assistant('turn', { id: 'other-message' }) },
    { turnId: 'turn', message: assistant('turn', { sessionId: 'other-session' }) },
    { turnId: 'turn', message: assistant('turn', { turnId: 'other-turn' }) },
    { turnId: 'turn', message: assistant('turn', { role: 'user' }) },
  ]) {
    receive({ type: 'reply.done', ...invalid });
    assert.equal(current().streamingMessageId, 'assistant-turn');
  }
  receive({ type: 'reply.done', turnId: 'turn', message: assistant() });
  assert.equal(current().streamingMessageId, null);
});

test('late completions and cancellations cannot clear a newer streaming reply', async t => {
  const { current, receive } = await conversation(t);
  receive({ type: 'reply.start', turnId: 'prior', message: assistant('prior') });
  receive({ type: 'reply.start', turnId: 'old', message: assistant('old') });
  receive({ type: 'reply.done', turnId: 'prior', message: assistant('prior') });
  assert.equal(current().streamingMessageId, 'assistant-old');
  current().cancel();
  receive({ type: 'reply.start', turnId: 'turn', message: assistant() });
  receive({ type: 'reply.done', turnId: 'old', message: assistant('old') });
  receive({ type: 'turn.done', turnId: 'old' });
  receive({ type: 'turn.cancelled', turnId: 'old' });
  receive({ type: 'turn.cancelled', turnId: 'unknown' });
  receive({ type: 'reply.start', turnId: 'old', message: assistant('old') });
  receive({ type: 'session.ended', session: { ...session, id: 'old-session', endedAt: 'ended' } });
  assert.equal(current().streamingMessageId, 'assistant-turn');
});

test('lifecycle transitions retire the streaming reply', async t => {
  for (const action of ['cancel', 'server cancel', 'typed send', 'end', 'server end', 'disconnect', 'new session', 'suggestion', 'replay']) await t.test(action, async t => {
    const { current, receive, socket } = await conversation(t);
    receive({ type: 'reply.start', turnId: 'turn', message: assistant() });
    switch (action) {
      case 'cancel': current().cancel(); break;
      case 'server cancel': receive({ type: 'turn.cancelled', turnId: 'turn' }); break;
      case 'typed send': await current().sendText('こんにちは'); break;
      case 'end': await current().end(); break;
      case 'server end': receive({ type: 'session.ended', session: { ...session, endedAt: 'ended' } }); break;
      case 'disconnect': socket.close(); break;
      case 'new session': receive({ type: 'session.started', session: { ...session, id: 'next' }, voice: false }); break;
      case 'suggestion':
        receive({ type: 'reply.suggestions', turnId: 'turn', messageId: 'assistant-turn', status: 'ready', suggestions: [{ text: 'はい', reading: 'はい', meaning: '是的' }] });
        await current().listenSuggestion('assistant-turn', 0);
        break;
      case 'replay': await current().replay('turn'); break;
    }
    assert.equal(current().streamingMessageId, null);
  });
});

test('voice, playback, and avatar presentation changes do not mark unfinished text complete', async t => {
  const { current, receive, audio } = await conversation(t);
  receive({ type: 'reply.start', turnId: 'turn', message: assistant() });
  current().clearAvatarEmotion();
  current().toggleMute();
  audio.callbacks.onBusy(true);
  audio.callbacks.onBusy(false);
  receive({ type: 'session.started', session, voice: true });
  receive({ type: 'error', source: 'tts', message: '音声エラー', recoverable: true });
  assert.equal(current().streamingMessageId, 'assistant-turn');
  receive({ type: 'reply.done', turnId: 'turn', message: assistant('turn', { content: 'テキストは読み続けられます。' }) });
  assert.equal(current().streamingMessageId, null);
});

test('history and inactive late replies are never treated as streaming', async t => {
  const { current, receive } = await conversation(t);
  receive({ type: 'reply.start', turnId: 'turn', message: assistant() });
  await current().end();
  receive({ type: 'session.ended', session: { ...session, endedAt: 'ended' } });
  await current().loadHistory('history');
  receive({ type: 'reply.start', turnId: 'late', message: assistant('late', { sessionId: 'history' }) });
  assert.equal(current().streamingMessageId, null);
  assert.equal(current().messages[0].content, '保存済みです。');
});

test('loaded reading aids are stored only on the requested message and exact text', async t => {
  const { current, receive } = await conversation(t);
  const content = '今年もよろしくお願いします。';
  const aid = { translation: '今年也请多多关照。', reading: 'ことしもよろしくおねがいします。' };
  receive({ type: 'message', message: assistant('first', { content }) });
  receive({ type: 'message', message: assistant('second', { content }) });
  current().setMessageReadingAid('assistant-first', content, aid);
  assert.deepEqual(current().messages[0].readingAid, aid);
  assert.equal(current().messages[1].readingAid, undefined);
  current().setMessageReadingAid('assistant-second', '古いテキスト', aid);
  current().setMessageReadingAid('missing', content, aid);
  assert.equal(current().messages[1].readingAid, undefined);
  assert.equal(current().messages.length, 2);
});

test('late audio message acknowledgements retain the reading aid for unchanged text', async t => {
  const { current, receive } = await conversation(t);
  const content = '今年もよろしくお願いします。';
  const aid = { translation: '今年也请多多关照。', reading: 'ことしもよろしくおねがいします。' };
  receive({ type: 'reply.start', turnId: 'turn', message: assistant() });
  receive({ type: 'reply.done', turnId: 'turn', message: assistant('turn', { content }) });
  current().setMessageReadingAid('assistant-turn', content, aid);
  receive({ type: 'message', message: assistant('turn', { content, spokenContent: content }) });
  assert.deepEqual(current().messages[0].readingAid, aid);
  assert.equal(current().messages[0].spokenContent, content);
  const updatedAid = { translation: '今年也请您多多关照。', reading: aid.reading };
  receive({ type: 'message', message: assistant('turn', { content, readingAid: updatedAid }) });
  assert.deepEqual(current().messages[0].readingAid, updatedAid, 'explicit server reading aids take precedence');
});

test('changed message text discards stale reading aids and ignores its late request result', async t => {
  const { current, receive } = await conversation(t);
  const content = 'こんにちは。';
  const aid = { translation: '你好。', reading: 'こんにちは。' };
  receive({ type: 'message', message: assistant('turn', { content }) });
  current().setMessageReadingAid('assistant-turn', content, aid);
  receive({ type: 'message', message: assistant('turn', { content: 'こんばんは。' }) });
  assert.equal(current().messages[0].readingAid, undefined);
  current().setMessageReadingAid('assistant-turn', content, aid);
  assert.equal(current().messages[0].readingAid, undefined);
});
