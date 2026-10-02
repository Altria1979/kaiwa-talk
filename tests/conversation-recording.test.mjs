import assert from 'node:assert/strict';
import { mock, test } from 'node:test';
import { setImmediate as nextTick } from 'node:timers/promises';

const session = id => ({ id, title: '練習', createdAt: '2026-09-27T10:00:00.000Z', endedAt: null, review: null });
const readyRecording = () => ({ status: 'ready', blob: new Blob(['conversation audio'], { type: 'audio/webm' }), extension: 'webm' });
const deferred = () => {
  let resolve, reject;
  const promise = new Promise((resolvePromise, rejectPromise) => { resolve = resolvePromise; reject = rejectPromise; });
  return { promise, resolve, reject };
};

// Exercise the actual session lifecycle without adding a React renderer dependency.
let rendering;
mock.module('react', { exports: {
  useCallback: callback => callback,
  useState(initial) {
    const owner = rendering, index = owner.cursor++;
    if (!(index in owner.slots)) owner.slots[index] = typeof initial === 'function' ? initial() : initial;
    return [owner.slots[index], value => {
      owner.updates++;
      owner.slots[index] = typeof value === 'function' ? value(owner.slots[index]) : value;
    }];
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
mock.module('../src/lib/api.ts', { exports: { ensureBrowserSession: async () => {}, SOCKET_URL: 'wss://example.invalid/ws', api: {} } });
mock.module('../src/lib/bailian-credentials.ts', { exports: { readBrowserCredentials: () => undefined } });

class Audio {
  static instances = [];
  recordingStarts = 0;
  recordingStops = 0;
  disposed = false;
  events = [];
  result = readyRecording();
  finalization = null;
  constructor(callbacks) { this.callbacks = callbacks; Audio.instances.push(this); }
  async prepare() {}
  async startMicrophone() {}
  stopMicrophone() {}
  setMuted() {}
  setVadEnabled() {}
  setRecognitionStream() {}
  getRecognitionTime() { return 0; }
  cancelTurn() { this.callbacks.onBusy(false); }
  startRecording() { this.recordingStarts++; }
  stopRecording() {
    this.recordingStops++;
    this.events.push('stop recording');
    return this.finalization ?? Promise.resolve(this.result);
  }
  async dispose() { this.events.push('dispose'); this.disposed = true; }
}
mock.module('../src/lib/browser-audio.ts', { exports: { BrowserAudio: Audio } });
const { useConversation } = await import('../src/hooks/use-conversation.ts');

class Socket {
  static OPEN = 1;
  static instances = [];
  static autoStart = true;
  static sessions = 0;
  readyState = 1;
  bufferedAmount = 0;
  sent = [];
  constructor() { Socket.instances.push(this); queueMicrotask(() => this.onopen?.()); }
  send(raw) {
    const event = JSON.parse(raw);
    this.sent.push(event);
    if (event.type === 'start' && Socket.autoStart) queueMicrotask(() => this.receive({
      type: 'session.started',
      session: session(event.sessionId ?? `session-${++Socket.sessions}`),
      voice: event.voice,
      asrStreamId: event.voice ? `stream-${Socket.instances.length}` : null,
      ...(event.resume ? { resumed: true, messages: [] } : {}),
    }));
  }
  receive(event) { this.onmessage?.({ data: JSON.stringify(event) }); }
  close() { this.readyState = 3; this.onclose?.(); }
}

async function harness(t, { voice = true, start = true, autoStart = true } = {}) {
  const previousSocket = globalThis.WebSocket;
  const previousWindow = globalThis.window;
  const previousDocument = globalThis.document;
  const page = new EventTarget();
  const document = Object.assign(new EventTarget(), { visibilityState: 'visible' });
  globalThis.window = page;
  globalThis.document = document;
  globalThis.WebSocket = Socket;
  Audio.instances = [];
  Socket.instances = [];
  Socket.sessions = 0;
  Socket.autoStart = autoStart;
  const hooks = { slots: [], cursor: 0, updates: 0 };
  const current = function Harness() { rendering = hooks; hooks.cursor = 0; return useConversation(); };
  let unmounted = false;
  const unmount = () => {
    if (unmounted) return;
    unmounted = true;
    for (const slot of hooks.slots) if (typeof slot === 'function') slot();
  };
  t.after(() => { unmount(); globalThis.WebSocket = previousSocket; globalThis.window = previousWindow; globalThis.document = previousDocument; });
  if (start) await current().start({ voice });
  const ended = () => Socket.instances.at(-1).receive({ type: 'session.ended', session: { ...current().session, endedAt: '2026-09-27T10:05:00.000Z' } });
  return { current, unmount, ended, hooks, page, document, get audio() { return Audio.instances.at(-1); }, get socket() { return Socket.instances.at(-1); } };
}

test('a page keeps one microphone owner across conversations and releases it on unmount', async t => {
  const h = await harness(t);
  const microphone = h.audio.callbacks.microphone;
  assert.ok(microphone);
  const dispose = t.mock.method(microphone, 'dispose');
  await h.current().end();
  h.ended();
  await nextTick();
  await h.current().start({ voice: true });
  assert.equal(h.audio.callbacks.microphone, microphone);
  assert.equal(dispose.mock.callCount(), 0);
  h.unmount();
  assert.equal(dispose.mock.callCount(), 1);
  h.page.dispatchEvent(new Event('pagehide'));
  assert.equal(dispose.mock.callCount(), 1, 'unmount removes the pagehide listener');
});

test('leaving a page ends capture and releases its reusable microphone', async t => {
  const h = await harness(t);
  assert.ok(h.audio.callbacks.microphone);
  const dispose = t.mock.method(h.audio.callbacks.microphone, 'dispose');
  const audio = h.audio;
  h.page.dispatchEvent(new Event('pagehide'));
  assert.equal(audio.disposed, true);
  assert.equal(dispose.mock.callCount(), 1);
  assert.equal(h.socket.sent.filter(event => event.type === 'end').length, 1);
  h.ended();
  await nextTick();
  assert.equal(h.current().active, false);
});

test('backgrounding an idle page releases its grant without interrupting active voice on visibility alone', async t => {
  const h = await harness(t);
  const dispose = t.mock.method(h.audio.callbacks.microphone, 'dispose');
  h.document.visibilityState = 'hidden';
  h.document.dispatchEvent(new Event('visibilitychange'));
  assert.equal(dispose.mock.callCount(), 0);
  h.document.visibilityState = 'visible';
  await h.current().end();
  h.ended();
  await nextTick();
  h.document.visibilityState = 'hidden';
  h.document.dispatchEvent(new Event('visibilitychange'));
  assert.equal(dispose.mock.callCount(), 1);
  assert.equal(h.current().active, false);
  h.unmount();
  const afterUnmount = dispose.mock.callCount();
  h.document.dispatchEvent(new Event('visibilitychange'));
  assert.equal(dispose.mock.callCount(), afterUnmount, 'unmount removes the visibility listener');
});

test('a conversation ending after the page is hidden releases the retained grant', async t => {
  const h = await harness(t);
  const dispose = t.mock.method(h.audio.callbacks.microphone, 'dispose');
  h.document.visibilityState = 'hidden';
  h.document.dispatchEvent(new Event('visibilitychange'));
  assert.equal(dispose.mock.callCount(), 0);
  h.ended();
  assert.equal(dispose.mock.callCount(), 1);
  await nextTick();
  assert.equal(h.current().active, false);
  assert.equal(h.current().recording.status, 'ready');
});

test('recording begins only after the server confirms the conversation', async t => {
  const h = await harness(t, { start: false, autoStart: false });
  const starting = h.current().start({ voice: true });
  await nextTick();
  assert.equal(h.audio.recordingStarts, 0);
  assert.equal(h.current().recording, null);
  h.socket.receive({ type: 'session.started', session: session('confirmed-session'), voice: true, asrStreamId: 'stream' });
  await starting;
  assert.equal(h.audio.recordingStarts, 1);
  assert.equal(h.current().active, true);
});

test('client end waits for final audio data and preserves it through repeated recaps', async t => {
  const h = await harness(t);
  const finalization = deferred();
  h.audio.finalization = finalization.promise;
  const audio = h.audio;
  await h.current().end();
  assert.equal(h.current().recording.status, 'finalizing');
  assert.equal(h.current().recording.sessionId, 'session-1');
  assert.equal(audio.recordingStops, 1);
  assert.equal(audio.events[0], 'stop recording', 'the recorder must flush before its audio resources are disposed');
  assert.equal(h.socket.sent.filter(event => event.type === 'end').length, 1);
  h.ended();
  h.ended();
  assert.equal(h.current().recording.status, 'finalizing');
  assert.equal(audio.recordingStops, 1);
  const result = readyRecording();
  finalization.resolve(result);
  await nextTick();
  assert.equal(h.current().recording.status, 'ready');
  assert.equal(h.current().recording.blob, result.blob);
  assert.equal(h.current().recording.extension, 'webm');
  assert.equal(h.current().recording.createdAt, session('session-1').createdAt);
  const saved = h.current().recording;
  h.ended();
  await nextTick();
  assert.equal(h.current().recording, saved);
  assert.equal(audio.recordingStops, 1);
  assert.equal(audio.disposed, true);
});

test('server end finalizes audio without requiring a local end action', async t => {
  const h = await harness(t);
  const audio = h.audio;
  h.ended();
  await nextTick();
  assert.equal(h.current().active, false);
  assert.equal(h.current().recording.status, 'ready');
  assert.equal(h.current().recording.blob, audio.result.blob);
  assert.equal(audio.recordingStops, 1);
  assert.equal(audio.disposed, true);
  assert.equal(h.socket.sent.some(event => event.type === 'end'), false);
});

test('restarting before the server acknowledges end cannot replace the completed recording', async t => {
  const h = await harness(t);
  const originalAudio = h.audio;
  await h.current().end();
  await nextTick();
  const completed = h.current().recording;
  assert.equal(completed.blob, originalAudio.result.blob);
  assert.equal(h.current().active, true, 'the server has not acknowledged end yet');
  await h.current().start({ voice: true });
  assert.equal(Audio.instances.length, 1, 'a closing session cannot create a second recorder');
  assert.equal(h.socket.sent.filter(event => event.type === 'start').length, 1);
  h.ended();
  await nextTick();
  assert.equal(h.current().recording, completed);
  assert.equal(originalAudio.recordingStops, 1);
  await h.current().start({ voice: true });
  assert.equal(Audio.instances.length, 2, 'a new conversation can start after acknowledgement');
  assert.equal(h.current().session.id, 'session-2');
  assert.equal(h.current().recording, null);
});

test('a new conversation clears the old export and ignores its pending final data', async t => {
  const h = await harness(t);
  const oldFinalization = deferred();
  h.audio.finalization = oldFinalization.promise;
  await h.current().end();
  h.ended();
  assert.equal(h.current().recording.status, 'finalizing');
  await h.current().start({ voice: true });
  assert.equal(h.current().session.id, 'session-2');
  assert.equal(h.current().recording, null);
  const newAudio = h.audio;
  oldFinalization.resolve(readyRecording());
  await nextTick();
  assert.equal(h.current().recording, null, 'old final data cannot appear as the new conversation export');
  h.ended();
  await nextTick();
  assert.equal(h.current().recording.sessionId, 'session-2');
  assert.equal(h.current().recording.blob, newAudio.result.blob);
});

test('unmount releases the recorder and ignores its late final data', async t => {
  const h = await harness(t);
  const finalization = deferred();
  h.audio.finalization = finalization.promise;
  const audio = h.audio;
  h.unmount();
  const updatesAfterUnmount = h.hooks.updates;
  finalization.resolve(readyRecording());
  await nextTick();
  assert.equal(audio.recordingStops, 1);
  assert.equal(audio.disposed, true);
  assert.equal(h.hooks.updates, updatesAfterUnmount, 'async finalization must not update an unmounted hook');
});

test('socket reconnection keeps the same recording until the conversation ends', async t => {
  const h = await harness(t);
  const audio = h.audio;
  h.socket.close();
  await nextTick();
  assert.equal(Socket.instances.length, 2);
  assert.equal(Audio.instances.length, 1);
  assert.equal(h.audio, audio);
  assert.equal(audio.recordingStops, 0);
  assert.equal(audio.disposed, false);
  assert.equal(h.current().recording, null);
  assert.equal(h.current().active, true);
  assert.equal(h.current().session.id, 'session-1');
  h.ended();
  await nextTick();
  assert.equal(audio.recordingStops, 1);
  assert.equal(h.current().recording.blob, audio.result.blob);
});

test('enabling voice in an active text conversation records the same session', async t => {
  const h = await harness(t, { voice: false });
  assert.equal(Audio.instances.length, 0);
  await h.current().start({ voice: true });
  assert.equal(h.current().session.id, 'session-1');
  assert.ok(h.audio.recordingStarts >= 1);
  h.ended();
  await nextTick();
  assert.equal(h.current().recording.status, 'ready');
  assert.equal(h.current().recording.sessionId, 'session-1');
});

test('ending a text-only conversation produces an empty recording without creating audio', async t => {
  const h = await harness(t, { voice: false });
  await h.current().end();
  h.ended();
  await nextTick();
  assert.equal(Audio.instances.length, 0);
  assert.equal(h.current().recording.status, 'empty');
  assert.equal(h.current().recording.sessionId, 'session-1');
  assert.equal(h.current().active, false);
});

test('microphone failure falls back to text without starting a silent recording', async t => {
  const h = await harness(t, { start: false });
  t.mock.method(Audio.prototype, 'startMicrophone', async () => { throw new Error('Microphone permission denied'); });
  await h.current().start({ voice: true });
  assert.equal(h.current().active, true);
  assert.equal(h.current().voiceEnabled, false);
  assert.equal(h.audio.recordingStarts, 0);
  assert.equal(h.current().recording, null);
  assert.equal(h.socket.sent.find(event => event.type === 'start').voice, false);
  h.audio.result = { status: 'empty' };
  await h.current().end();
  h.ended();
  await nextTick();
  assert.equal(h.current().recording.status, 'empty');
  assert.equal(h.current().active, false);
});

test('denied voice activation in an active text conversation does not start a silent recording', async t => {
  const h = await harness(t, { voice: false });
  t.mock.method(Audio.prototype, 'startMicrophone', async () => { throw new Error('Microphone permission denied'); });
  await h.current().start({ voice: true });
  assert.equal(h.current().active, true);
  assert.equal(h.current().voiceEnabled, false);
  assert.equal(h.audio.recordingStarts, 0);
  assert.equal(h.socket.sent.filter(event => event.type === 'start').length, 1);
  h.audio.result = { status: 'empty' };
  await h.current().end();
  h.ended();
  await nextTick();
  assert.equal(h.current().recording.status, 'empty');
});

test('unavailable and empty recordings preserve the ended conversation', async t => {
  for (const status of ['unavailable', 'empty', 'failed']) await t.test(status, async t => {
    const h = await harness(t);
    h.audio.result = { status };
    h.ended();
    await nextTick();
    assert.equal(h.current().recording.status, status);
    assert.equal(h.current().session.endedAt, '2026-09-27T10:05:00.000Z');
    assert.equal(h.current().active, false);
    assert.equal(h.current().state, 'idle');
  });
});

test('a finalization rejection becomes a failed export without breaking session end', async t => {
  const h = await harness(t);
  const finalization = deferred();
  h.audio.finalization = finalization.promise;
  await h.current().end();
  h.ended();
  finalization.reject(new Error('Recorder failed to flush'));
  await nextTick();
  assert.equal(h.current().recording.status, 'failed');
  assert.equal(h.current().recording.sessionId, 'session-1');
  assert.equal(h.current().active, false);
  assert.equal(h.current().state, 'idle');
  assert.equal(h.audio.disposed, true);
});
