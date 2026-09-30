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
  startRecording() {}
  async stopRecording() { return { status: 'empty' }; }
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
  static opening = 'success';
  static acknowledge = true;
  static acknowledgeEnd = true;
  static startError = null;
  readyState = 1;
  bufferedAmount = 0;
  sent = [];
  constructor() {
    Socket.instances.push(this);
    if (Socket.opening !== 'success') this.readyState = 0;
    queueMicrotask(() => {
      if (Socket.opening === 'success') this.onopen?.();
      if (Socket.opening === 'error') this.onerror?.();
    });
  }
  send(raw) {
    const event = JSON.parse(raw); this.sent.push(event);
    if (event.type === 'start' && Socket.acknowledge) queueMicrotask(() => {
      if (Socket.startError) this.receive(Socket.startError);
      else if (event.resume && Socket.busy) this.receive({ type: 'error', source: 'session', errorCode: 'sessionOtherPage', message: '別のページで会話中です。そのページの会話を終了してください。', recoverable: true });
      else this.receive({ type: 'session.started', session, voice: event.voice, asrStreamId: `stream-${Socket.instances.indexOf(this)}`, ...(event.resume ? { resumed: true, messages: [stored] } : {}) });
    });
    if (event.type === 'end' && Socket.acknowledgeEnd) queueMicrotask(() => this.receive({ type: 'session.ended', session: { ...session, endedAt: 'ended' } }));
    if (event.type === 'voice.stop') queueMicrotask(() => this.receive({ type: 'session.started', session, voice: false }));
  }
  receive(event) { this.onmessage?.({ data: JSON.stringify(event) }); }
  close() { this.readyState = 3; this.onclose?.(); }
}
function setup(t) {
  const previous = globalThis.WebSocket; globalThis.WebSocket = Socket;
  Socket.instances = []; Socket.busy = false; Socket.opening = 'success'; Socket.acknowledge = true; Socket.acknowledgeEnd = true; Socket.startError = null; Audio.instances = [];
  const hooks = { slots: [], cursor: 0 };
  const current = function Harness() { rendering = hooks; hooks.cursor = 0; return useConversation(); };
  const unmount = () => { for (const slot of hooks.slots) if (typeof slot === 'function') slot(); };
  t.after(() => { unmount(); globalThis.WebSocket = previous; });
  return { current, unmount };
}
async function harness(t, voice = true) {
  const { current, unmount } = setup(t);
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
  for (let attempt = 0; attempt < 25; attempt++) { await nextTick(); t.mock.timers.tick(5000); }
  await nextTick();
  assert.equal(Socket.instances.length, 21);
  assert.equal(h.current().active, false);
  assert.equal(h.current().state, 'error');
  assert.equal(h.current().session.id, session.id);
  assert.equal(h.current().errorDetails.errorCode, 'sessionOtherPage');
});

test('failed handshakes close the abandoned socket and ignore a late open or session acknowledgement', async t => {
  const h = setup(t);
  Socket.opening = 'error';
  await assert.rejects(h.current().start({ voice: false }), { errorCode: 'serviceUnavailable' });
  const failed = Socket.instances[0];
  assert.equal(failed.readyState, 3);
  assert.equal(h.current().connected, false);
  failed.onopen?.();
  failed.receive({ type: 'session.started', session, voice: true });
  assert.equal(h.current().active, false);
  assert.equal(h.current().connected, false);
  assert.equal(h.current().state, 'error');
  Socket.opening = 'success';
  await h.current().start({ voice: false });
  assert.equal(Socket.instances.length, 2);
  assert.equal(h.current().active, true);
});

test('connection and start timeouts remain visible and release their sockets before retry', async t => {
  for (const phase of ['handshake', 'start']) await t.test(phase, async t => {
    const h = setup(t);
    t.mock.timers.enable({ apis: ['setTimeout'] });
    Socket.opening = phase === 'handshake' ? 'pending' : 'success';
    Socket.acknowledge = false;
    const starting = h.current().start({ voice: false });
    const failed = assert.rejects(starting, { errorCode: phase === 'handshake' ? 'socketTimeout' : 'sessionStartTimeout' });
    await nextTick();
    t.mock.timers.tick(phase === 'handshake' ? 10_000 : 20_000);
    await failed;
    assert.equal(h.current().state, 'error');
    assert.equal(h.current().errorDetails.errorCode, phase === 'handshake' ? 'socketTimeout' : 'sessionStartTimeout');
    assert.equal(Socket.instances[0].readyState, 3);
    assert.equal(h.current().connected, false);
    Socket.opening = 'success'; Socket.acknowledge = true;
    await h.current().start({ voice: false });
    assert.equal(h.current().active, true);
  });
});

test('end and unmount cancel an in-flight handshake immediately without opening another session', async t => {
  for (const action of ['end', 'unmount']) await t.test(action, async t => {
    const h = setup(t);
    Socket.opening = 'pending';
    const starting = h.current().start({ voice: false });
    const cancelled = assert.rejects(starting, { errorCode: 'connectionCancelled' });
    await nextTick();
    const socket = Socket.instances[0];
    if (action === 'end') await h.current().end(); else h.unmount();
    assert.equal(socket.readyState, 3);
    await cancelled;
    socket.onopen?.();
    assert.equal(socket.sent.length, 0);
    assert.equal(h.current().active, false);
  });
});

test('resume survives a lease held for a full heartbeat window without flashing a false other-page error', async t => {
  const h = await harness(t, false);
  t.mock.timers.enable({ apis: ['setTimeout'] });
  Socket.busy = true;
  h.socket.close();
  for (let attempt = 0; attempt < 13; attempt++) {
    await nextTick();
    assert.equal(h.current().active, true);
    assert.equal(h.current().errorDetails, null);
    assert.equal(h.current().state, 'connecting');
    t.mock.timers.tick(5000);
  }
  Socket.busy = false;
  await nextTick();
  assert.equal(h.current().active, true);
  assert.equal(h.current().state, 'listening');
  assert.equal(h.current().session.id, session.id);
});

test('a real other-page owner still refuses a fresh start and closes the refused socket', async t => {
  const h = setup(t);
  Socket.startError = { type: 'error', source: 'session', errorCode: 'sessionOtherPage', message: '別のページで会話中です。そのページの会話を終了してください。', recoverable: true };
  await assert.rejects(h.current().start({ voice: false }), { errorCode: 'sessionOtherPage' });
  assert.equal(Socket.instances.length, 1);
  assert.equal(Socket.instances[0].readyState, 3);
  assert.equal(h.current().active, false);
  assert.equal(h.current().errorDetails.errorCode, 'sessionOtherPage');
});

test('ending while resume awaits its acknowledgement cannot leave the page active or connecting', async t => {
  const h = await harness(t, false);
  Socket.acknowledge = false; Socket.acknowledgeEnd = false;
  h.socket.close();
  await nextTick();
  const resumed = Socket.instances[1];
  assert.equal(resumed.sent[0].resume, true);
  await h.current().end();
  await nextTick();
  assert.equal(resumed.readyState, 3);
  assert.equal(h.current().active, false);
  assert.equal(h.current().state, 'idle');
  assert.equal(Socket.instances.length, 2);
});

test('timed-out voice activation stops capture and cancels upstream startup while text stays active', async t => {
  const h = await harness(t, false);
  t.mock.timers.enable({ apis: ['setTimeout'] });
  Socket.acknowledge = false;
  const starting = h.current().start({ voice: true });
  const failed = assert.rejects(starting, { errorCode: 'sessionStartTimeout' });
  await nextTick();
  const audio = Audio.instances[0];
  assert.equal(audio.starts, 1);
  t.mock.timers.tick(20_000);
  await failed;
  await nextTick();
  assert.ok(audio.stops >= 1);
  assert.equal(h.socket.sent.filter(event => event.type === 'voice.stop').length, 1);
  assert.equal(h.current().active, true);
  assert.equal(h.current().voiceEnabled, false);
  assert.equal(h.current().state, 'listening');
  assert.equal(h.current().errorDetails.errorCode, 'sessionStartTimeout');
  assert.equal(Socket.instances.length, 1);
});

test('end during resume audio preparation closes the unowned socket without restarting the microphone', async t => {
  for (const result of ['resolve', 'reject']) await t.test(result, async t => {
    const h = await harness(t);
    let prepared;
    h.audio.prepare = () => new Promise((resolve, reject) => {
      prepared = () => result === 'resolve' ? resolve() : reject(new Error('Audio session disposed'));
    });
    Socket.acknowledgeEnd = false;
    h.socket.close();
    await nextTick();
    const resumed = Socket.instances[1];
    assert.equal(resumed.sent.length, 0);
    await h.current().end();
    assert.equal(resumed.readyState, 3);
    assert.equal(h.current().active, false);
    assert.equal(h.current().state, 'idle');
    prepared();
    await nextTick();
    assert.equal(h.audio.starts, 1);
    assert.equal(Socket.instances.length, 2);
    assert.equal(resumed.sent.some(event => event.type === 'start'), false);
    assert.equal(h.current().errorDetails, null);
  });
});

test('a cancelled resume only stops its own microphone after a new voice session has started', async t => {
  const h = await harness(t);
  let microphoneReady;
  h.audio.startMicrophone = () => new Promise(resolve => { microphoneReady = resolve; });
  Socket.acknowledgeEnd = false;
  h.socket.close();
  await nextTick();
  assert.equal(typeof microphoneReady, 'function');
  await h.current().end();
  await h.current().start({ voice: true });
  const newAudio = Audio.instances[1];
  const stops = newAudio.stops;
  microphoneReady();
  await nextTick();
  assert.equal(h.current().active, true);
  assert.equal(h.current().voiceEnabled, true);
  assert.equal(h.current().errorDetails, null);
  assert.equal(newAudio.stops, stops);
  assert.equal(Socket.instances.length, 3);
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
