import assert from 'node:assert/strict';
import { mock, test } from 'node:test';

// Exercise the real hook lifecycle using the repository's renderer-free harness pattern.
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

const session = { id: 'session', title: '会話', createdAt: '', endedAt: null, review: null };
const message = (turnId = 'turn', extra = {}) => ({
  id: `${turnId}-assistant`, sessionId: session.id, turnId, role: 'assistant', content: '',
  spokenContent: '', interrupted: false, delivery: 'text', translation: null, createdAt: '', ...extra,
});
const emotion = (value = 'happy', turnId = 'turn', extra = {}) => ({ type: 'avatar.emotion', turnId, messageId: `${turnId}-assistant`, emotion: value, ...extra });

mock.module('../src/lib/api.ts', { exports: {
  api: { session: async id => ({ session: { ...session, id, endedAt: 'yesterday' }, messages: [] }) },
  SOCKET_URL: 'ws://example.invalid',
} });
mock.module('../src/lib/bailian-credentials.ts', { exports: { readBrowserCredentials: () => undefined } });
mock.module('../src/lib/browser-audio.ts', { exports: { BrowserAudio: class {
  static latest;
  cancelCount = 0;
  constructor(callbacks) { this.callbacks = callbacks; this.constructor.latest = this; }
  async prepare() {}
  async startMicrophone() {}
  async dispose() {}
  stopMicrophone() {}
  setVadEnabled() {}
  getRecognitionTime() { return 0; }
  setRecognitionStream() {}
  setMuted() {}
  beginTurn() {}
  cancelTurn() { this.cancelCount++; }
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
    if (event.type === 'start') queueMicrotask(() => this.receive({ type: 'session.started', session, voice: event.voice, ...(event.voice ? { asrStreamId: 'stream' } : {}) }));
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
  t.after(() => {
    for (const slot of hooks.slots) if (typeof slot === 'function') slot();
    globalThis.WebSocket = previousSocket;
  });
  await current().start({ voice: false });
  const receive = event => Socket.latest.receive(event);
  receive({ type: 'reply.start', turnId: 'turn', message: message() });
  return { current, receive };
}

test('emotion requires an active matching reply, message, and runtime whitelist value', async t => {
  const { current, receive } = await conversation(t);
  assert.equal(current().avatarEmotion, 'neutral');
  for (const invalid of [emotion('happy', 'old'), emotion('happy', 'turn', { messageId: 'wrong' }), emotion('unknown'), emotion(null)]) {
    receive(invalid);
    assert.equal(current().avatarEmotion, 'neutral');
  }
  receive(emotion());
  assert.equal(current().avatarEmotion, 'happy');
  receive(emotion('relaxed'));
  assert.equal(current().avatarEmotion, 'relaxed', 'latest automatic emotion remains available independently of manual UI mode');
});

test('automatic emotion persists through generation completion and same-session voice enable', async t => {
  const { current, receive } = await conversation(t);
  receive(emotion());
  receive({ type: 'reply.done', turnId: 'turn', message: message('turn', { content: 'こんにちは。' }) });
  receive({ type: 'turn.done', turnId: 'turn' });
  receive({ type: 'state', state: 'listening' });
  assert.equal(current().avatarEmotion, 'happy');
  await current().start({ voice: true });
  assert.equal(current().voiceEnabled, true);
  assert.equal(current().avatarEmotion, 'happy');
  receive(emotion('surprised'));
  assert.equal(current().avatarEmotion, 'surprised', 'voice enable preserves the current reply identity');
});

test('new replies and explicit lifecycle transitions clear automatic emotion', async t => {
  for (const scenario of ['new user', 'new reply', 'cancel', 'server cancel', 'typed send', 'end', 'server end', 'disconnect', 'new session']) {
    await t.test(scenario, async t => {
      const { current, receive } = await conversation(t);
      receive(emotion());
      assert.equal(current().avatarEmotion, 'happy');
      switch (scenario) {
        case 'new user': receive({ type: 'message', message: message('next', { id: 'user', role: 'user' }) }); break;
        case 'new reply': receive({ type: 'reply.start', turnId: 'next', message: message('next') }); break;
        case 'cancel': current().cancel(); break;
        case 'server cancel': receive({ type: 'turn.cancelled', turnId: 'turn' }); break;
        case 'typed send': await current().sendText('こんにちは'); break;
        case 'end': await current().end(); break;
        case 'server end': receive({ type: 'session.ended', session: { ...session, endedAt: 'now' } }); break;
        case 'disconnect': Socket.latest.close(); break;
        case 'new session': receive({ type: 'session.started', session: { ...session, id: 'next-session' }, voice: false }); break;
      }
      assert.equal(current().avatarEmotion, 'neutral');
      receive(emotion('angry'));
      assert.equal(current().avatarEmotion, 'neutral', 'late emotion cannot restore the retired reply');
    });
  }
});

test('late cancelled events never clear or replace the newer reply emotion', async t => {
  const { current, receive } = await conversation(t);
  receive(emotion());
  current().cancel();
  receive({ type: 'reply.start', turnId: 'next', message: message('next') });
  receive(emotion('relaxed', 'next'));
  receive(emotion('angry'));
  receive({ type: 'turn.cancelled', turnId: 'turn' });
  receive({ type: 'turn.cancelled', turnId: 'unknown' });
  receive({ type: 'reply.start', turnId: 'turn', message: message() });
  assert.equal(current().avatarEmotion, 'relaxed');
});

test('history selection and inactive replies cannot revive an automatic emotion', async t => {
  const { current, receive } = await conversation(t);
  receive(emotion());
  await current().end();
  receive({ type: 'session.ended', session: { ...session, endedAt: 'now' } });
  await current().loadHistory('history');
  receive({ type: 'reply.start', turnId: 'late', message: message('late', { sessionId: 'history' }) });
  receive(emotion('angry', 'late'));
  assert.equal(current().session.id, 'history');
  assert.equal(current().avatarEmotion, 'neutral');
});

test('a reply from another session cannot replace the current emotion target', async t => {
  const { current, receive } = await conversation(t);
  receive(emotion());
  receive({ type: 'reply.start', turnId: 'foreign', message: message('foreign', { sessionId: 'other-session' }) });
  receive(emotion('angry', 'foreign'));
  assert.equal(current().avatarEmotion, 'happy');
});

test('clearing emotion retires its message identity without interrupting active chat or audio', async t => {
  const { current, receive } = await conversation(t);
  await current().start({ voice: true });
  receive(emotion());
  const audio = BrowserAudio.latest;
  audio.callbacks.onBusy(true);
  const before = { messages: current().messages, sent: [...Socket.latest.sent], cancels: audio.cancelCount };
  current().clearAvatarEmotion();
  assert.equal(current().avatarEmotion, 'neutral');
  assert.equal(current().active, true);
  assert.equal(current().voiceEnabled, true);
  assert.equal(current().state, 'speaking');
  assert.deepEqual(current().messages, before.messages);
  assert.deepEqual(Socket.latest.sent, before.sent);
  assert.equal(audio.cancelCount, before.cancels);
  receive(emotion('angry'));
  assert.equal(current().avatarEmotion, 'neutral', 'same-turn late metadata cannot restore an expression after history selection');
  receive({ type: 'reply.delta', turnId: 'turn', delta: '会話は続きます。' });
  assert.equal(current().messages.at(-1).content, '会話は続きます。');
  receive({ type: 'reply.start', turnId: 'next', message: message('next') });
  receive(emotion('relaxed', 'next'));
  assert.equal(current().avatarEmotion, 'relaxed', 'the next reply gets a fresh emotion target');
});
