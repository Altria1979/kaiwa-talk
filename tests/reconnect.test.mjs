import assert from 'node:assert/strict';
import { mock, test } from 'node:test';
import { setImmediate as nextTick } from 'node:timers/promises';

const session = { id: 'persisted-session', title: '練習', createdAt: '', endedAt: null, review: null };
const stored = { id: 'stored-reply', sessionId: session.id, turnId: 'turn', role: 'assistant', content: '保存済み', spokenContent: '', interrupted: true, delivery: 'voice', translation: null, createdAt: '' };
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
let bootstrap = async () => {};
mock.module('../src/lib/api.ts', { exports: { ensureBrowserSession: () => bootstrap(), SOCKET_URL: 'wss://example.invalid/ws', api: {} } });
mock.module('../src/lib/bailian-credentials.ts', { exports: { readBrowserCredentials: () => ({ apiKey: 'test-private-key' }) } });
class Audio {
  static instances = [];
  starts = 0;
  stops = 0;
  cancellations = 0;
  disposed = false;
  constructor(callbacks) { this.callbacks = callbacks; Audio.instances.push(this); }
  async prepare() {}
  async startMicrophone() { this.starts++; }
  stopMicrophone() { this.stops++; }
  setVadEnabled() {}
  setMuted(muted) { this.muted = muted; }
  setRecognitionStream(id) { this.streamId = id; }
  getRecognitionTime() { return 0; }
  cancelTurn() { this.cancellations++; this.callbacks.onBusy(false); }
  async dispose() { this.disposed = true; }
}
mock.module('../src/lib/browser-audio.ts', { exports: { BrowserAudio: Audio } });
const { useConversation } = await import('../src/hooks/use-conversation.ts');
class Socket {
  static OPEN = 1;
  static instances = [];
  static busy = false;
  readyState = 1;
  bufferedAmount = 0;
  sent = [];
  constructor() { Socket.instances.push(this); queueMicrotask(() => this.onopen?.()); }
  send(raw) {
    const event = JSON.parse(raw); this.sent.push(event);
    if (event.type === 'start') queueMicrotask(() => {
      if (event.resume && Socket.busy) this.receive({ type: 'error', source: 'session', errorCode: 'sessionOtherPage', message: '別のページで会話中です。そのページの会話を終了してください。', recoverable: true });
      else this.receive({ type: 'session.started', session, voice: event.voice, asrStreamId: `stream-${Socket.instances.indexOf(this)}`, ...(event.resume ? { resumed: true, messages: [stored] } : {}) });
    });
    if (event.type === 'end') queueMicrotask(() => this.receive({ type: 'session.ended', session: { ...session, endedAt: 'ended' } }));
  }
  receive(event) { this.onmessage?.({ data: JSON.stringify(event) }); }
  close() { this.readyState = 3; this.onclose?.(); }
}
async function harness(t, voice = true) {
  const previous = globalThis.WebSocket; globalThis.WebSocket = Socket;
  Socket.instances = []; Socket.busy = false; Audio.instances = [];
  const hooks = { slots: [], cursor: 0 };
  const current = function Harness() { rendering = hooks; hooks.cursor = 0; return useConversation(); };
  const unmount = () => { for (const slot of hooks.slots) if (typeof slot === 'function') slot(); };
  t.after(() => { unmount(); globalThis.WebSocket = previous; });
  await current().start({ voice });
  return { current, unmount, socket: Socket.instances[0], audio: Audio.instances[0] };
}

test('forced socket rotation restores one session, history, credentials, voice and mute without replaying a turn', async t => {
  const h = await harness(t);
  h.current().toggleMute();
  h.socket.receive({ type: 'message', message: { ...stored, content: '未保存の途中テキスト' } });
  h.socket.close();
  assert.equal(h.current().state, 'connecting');
  assert.equal(h.current().active, true);
  await nextTick();
  const resumed = Socket.instances[1];
  assert.equal(Socket.instances.length, 2);
  assert.deepEqual(resumed.sent.filter(event => event.type === 'start'), [{ type: 'start', sessionId: session.id, resume: true, voice: true, credentials: { apiKey: 'test-private-key' } }]);
  assert.equal(resumed.sent.some(event => ['text', 'end', 'audio'].includes(event.type)), false);
  assert.equal(h.current().session.id, session.id);
  assert.deepEqual(h.current().messages, [stored]);
  assert.equal(h.current().muted, true);
  assert.equal(h.current().voiceEnabled, true);
  assert.equal(h.current().state, 'listening');
  assert.equal(Audio.instances.length, 1);
  assert.equal(h.audio.muted, true);
  assert.equal(h.audio.disposed, false);
  assert.equal(h.audio.starts, 2);
  assert.ok(h.audio.stops >= 1);
  assert.ok(h.audio.cancellations >= 1);
  assert.equal(h.audio.streamId, 'stream-1');
  h.socket.receive({ type: 'message', message: { ...stored, content: '古いソケット' } });
  assert.deepEqual(h.current().messages, [stored]);
});

test('resume waits through the previous instance lease and succeeds without creating a session', async t => {
  const h = await harness(t, false);
  t.mock.timers.enable({ apis: ['setTimeout'] });
  Socket.busy = true;
  h.socket.close();
  await nextTick();
  assert.equal(Socket.instances.length, 2);
  Socket.busy = false;
  t.mock.timers.tick(500);
  await nextTick();
  assert.equal(Socket.instances.length, 3);
  assert.equal(h.current().active, true);
  assert.equal(h.current().state, 'listening');
  assert.ok(Socket.instances.slice(1).every(socket => socket.sent.find(event => event.type === 'start')?.sessionId === session.id));
});

test('explicit end and unmount cancel pending reconnect backoff', async t => {
  for (const action of ['end', 'unmount']) await t.test(action, async t => {
    const h = await harness(t, false);
    t.mock.timers.enable({ apis: ['setTimeout'] });
    Socket.busy = true;
    h.socket.close();
    await nextTick();
    const before = Socket.instances.length;
    if (action === 'end') await h.current().end(); else h.unmount();
    t.mock.timers.tick(120_000);
    await nextTick();
    assert.equal(Socket.instances.length, before);
    if (action === 'end') assert.equal(h.current().active, false);
  });
});

test('ending an online conversation sends exactly one end and does not resume after its socket closes', async t => {
  const h = await harness(t, false);
  await h.current().end();
  await nextTick();
  h.socket.close();
  await nextTick();
  assert.equal(h.socket.sent.filter(event => event.type === 'end').length, 1);
  assert.equal(Socket.instances.length, 1);
  assert.equal(h.current().session.endedAt, 'ended');
});

test('resume retries are bounded and leave saved history available when ownership never clears', async t => {
  const h = await harness(t, false);
  t.mock.timers.enable({ apis: ['setTimeout'] });
  Socket.busy = true;
  h.socket.close();
  for (let attempt = 0; attempt < 15; attempt++) { await nextTick(); t.mock.timers.tick(5000); }
  await nextTick();
  assert.equal(Socket.instances.length, 13);
  assert.equal(h.current().active, false);
  assert.equal(h.current().state, 'error');
  assert.equal(h.current().session.id, session.id);
  assert.equal(h.current().errorDetails.errorCode, 'sessionOtherPage');
});

test('initial WebSocket waits until the anonymous browser cookie bootstrap finishes', async t => {
  let release;
  bootstrap = () => new Promise(resolve => { release = resolve; });
  t.after(() => { bootstrap = async () => {}; });
  const starting = harness(t, false);
  await nextTick();
  assert.equal(Socket.instances.length, 0);
  release();
  const h = await starting;
  assert.equal(Socket.instances.length, 1);
  assert.equal(h.current().active, true);
});
