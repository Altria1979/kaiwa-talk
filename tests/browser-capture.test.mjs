import assert from 'node:assert/strict';
import { mock, test } from 'node:test';

let currentModel;
let loadModel = async () => currentModel;
mock.module('@ricky0123/vad-web/dist/models/silero.js', {
  namedExports: { Silero: { new: (...args) => loadModel(...args) } },
});
mock.module('onnxruntime-web/wasm', { namedExports: { env: { wasm: {} } } });
const { BrowserVad } = await import('../src/lib/browser-vad.ts');
const { BrowserAudio } = await import('../src/lib/browser-audio.ts');

const context = { epoch: 1, interrupting: false, turnId: null, replayRequest: 0 };
const pcm = (length = 640, value = 16384) => new Uint8Array(new Int16Array(length).fill(value).buffer);
const tick = async () => { for (let i = 0; i < 8; i++) await new Promise(resolve => setImmediate(resolve)); };
function deferred() {
  let resolve;
  let reject;
  const promise = new Promise((yes, no) => { resolve = yes; reject = no; });
  return { promise, resolve, reject };
}
function detector(t) {
  const frames = [];
  const statuses = [];
  const calls = [];
  const model = {
    resets: 0, released: 0,
    async process(frame) { calls.push(frame); return { isSpeech: 0.95, notSpeech: 0.05 }; },
    reset_state() { this.resets++; },
    async release() { this.released++; },
  };
  currentModel = model;
  loadModel = async () => model;
  const vad = new BrowserVad({ onVadFrame: frame => frames.push(frame), onVadStatus: status => statuses.push(status) }, () => true, false);
  t.after(() => vad.destroy());
  return { vad, frames, statuses, model, calls };
}

test('VAD uses the exact PCM samples and capture timeline across 640-sample chunks', async t => {
  const state = detector(t);
  await tick();
  for (let i = 0; i < 4; i++) state.vad.pushPcm(pcm(), 'stream', i * 40, context);
  await tick();
  assert.equal(state.frames.length, 5);
  assert.deepEqual(state.frames.map(frame => [frame.startMs, frame.endMs]), [[0, 32], [32, 64], [64, 96], [96, 128], [128, 160]]);
  assert.ok(state.calls.every(frame => frame.length === 512 && frame.every(sample => sample === 0.5)));
  assert.ok(state.frames.every(frame => frame.streamId === 'stream' && frame.probability === 0.95));
});

test('VAD snapshots capture context, discards half frames at context changes, and ignores old inference', async t => {
  const state = detector(t);
  await tick();
  const pending = deferred();
  state.model.process = async () => pending.promise;
  const snapshot = { ...context, interrupting: true, turnId: 'reply' };
  state.vad.pushPcm(pcm(), 'old', 0, snapshot);
  snapshot.turnId = 'changed-after-capture';
  state.vad.reset();
  pending.resolve({ isSpeech: 1 });
  await tick();
  assert.equal(state.frames.length, 0);
  state.model.process = async () => ({ isSpeech: 1 });
  const next = { ...context, epoch: 2 };
  state.vad.pushPcm(pcm(), 'new', 40, next);
  next.epoch = 9;
  await tick();
  assert.deepEqual(state.frames.map(frame => [frame.streamId, frame.startMs, frame.context.epoch]), [['new', 40, 2]]);
  state.vad.pushPcm(pcm(), 'new', 80, { ...context, epoch: 3 });
  await tick();
  assert.equal(state.frames.at(-1).startMs, 80, 'the previous 128-sample remainder must be discarded');
  assert.ok(state.model.resets >= 2);
});

test('VAD serializes model inference and fails closed if its bounded queue overflows', async t => {
  const state = detector(t);
  await tick();
  const pending = deferred();
  let calls = 0;
  state.model.process = async () => { calls++; return pending.promise; };
  for (let i = 0; i < 30; i++) state.vad.pushPcm(pcm(), 'stream', i * 40, context);
  assert.equal(calls, 1);
  assert.equal(state.statuses.at(-1), 'unavailable');
  pending.resolve({ isSpeech: 1 });
  await tick();
  assert.equal(state.frames.length, 0);
  assert.equal(state.model.released, 1);
});

test('playback ending mid-frame preserves the onset context and model continuity', async t => {
  const state = detector(t);
  await tick();
  const duringReply = { ...context, interrupting: true, turnId: 'reply' };
  state.vad.pushPcm(pcm(), 'stream', 0, duringReply);
  duringReply.turnId = 'mutated';
  state.vad.pushPcm(pcm(), 'stream', 40, context);
  state.vad.pushPcm(pcm(), 'stream', 80, context);
  await tick();
  assert.deepEqual(state.frames.slice(0, 3).map(frame => [frame.startMs, frame.context.interrupting, frame.context.turnId]),
    [[0, true, 'reply'], [32, true, 'reply'], [64, false, null]]);
  assert.equal(state.model.resets, 1, 'the same utterance must keep the same model state');
});

test('pause and destroy suppress in-flight results and release only after inference finishes', async t => {
  const state = detector(t);
  await tick();
  const pending = deferred();
  state.model.process = async () => pending.promise;
  state.vad.pushPcm(pcm(), 'stream', 0, context);
  state.vad.setPaused(true);
  state.vad.pushPcm(pcm(), 'stream', 40, context);
  const destroyed = state.vad.destroy();
  assert.equal(state.model.released, 0);
  pending.resolve({ isSpeech: 1 });
  await destroyed;
  assert.equal(state.frames.length, 0);
  assert.equal(state.model.released, 1);
});

test('model loading never buffers old capture audio or publishes frames after teardown', async t => {
  const pending = deferred();
  const state = detector(t);
  loadModel = () => pending.promise;
  await tick();
  state.vad.pushPcm(pcm(), 'stream', 0, context);
  const destroyed = state.vad.destroy();
  pending.resolve(state.model);
  await destroyed;
  assert.equal(state.frames.length, 0);
  assert.equal(state.model.released, 1);
  assert.deepEqual(state.statuses, ['loading']);
});

test('inference errors report unavailable once without leaking stale evidence', async t => {
  const state = detector(t);
  await tick();
  state.model.process = async () => { throw new Error('inference failed'); };
  state.vad.pushPcm(pcm(), 'stream', 0, context);
  await tick();
  assert.deepEqual(state.statuses, ['loading', 'ready', 'unavailable']);
  assert.equal(state.model.released, 1);
  assert.equal(state.frames.length, 0);
});

function capture(t) {
  let audio;
  t.after(() => audio?.dispose());
  const nodes = [];
  const sent = [];
  const frames = [];
  const track = { enabled: true, stop() {} };
  class AudioNode {
    connect() {}
    disconnect() {}
  }
  class Context {
    state = 'running';
    destination = new AudioNode();
    audioWorklet = { async addModule() {} };
    createAnalyser() { return new AudioNode(); }
    createGain() { return Object.assign(new AudioNode(), { gain: { value: 1 } }); }
    createMediaStreamSource() { return new AudioNode(); }
    async close() {}
  }
  class Worklet extends AudioNode {
    port = { postMessage() {}, close() {} };
    constructor() { super(); nodes.push(this); }
  }
  const replacements = {
    AudioContext: Context,
    AudioWorkletNode: Worklet,
    navigator: { mediaDevices: { async getUserMedia() { return { getAudioTracks: () => [track], getTracks: () => [track] }; } } },
    cancelAnimationFrame() {},
  };
  for (const [name, value] of Object.entries(replacements)) {
    const descriptor = Object.getOwnPropertyDescriptor(globalThis, name);
    Object.defineProperty(globalThis, name, { configurable: true, value });
    t.after(() => { if (descriptor) Object.defineProperty(globalThis, name, descriptor); else delete globalThis[name]; });
  }
  currentModel = { async process() { return { isSpeech: 1 }; }, reset_state() {}, async release() {} };
  loadModel = async () => currentModel;
  audio = new BrowserAudio({
    levelRef: { current: 0 }, onPcm: (bytes, streamId) => sent.push({ bytes: Buffer.from(bytes, 'base64'), streamId }),
    getSpeechContext: () => context, onVadFrame: frame => frames.push(frame),
    onPlayed() {}, onBusy() {}, onError: error => assert.fail(error),
  });
  return { audio, sent, frames, track, emit: () => nodes.at(-1).port.onmessage({ data: pcm().buffer }) };
}

test('capture only uploads with an enabled recognition stream and resets time on stream replacement', async t => {
  const state = capture(t);
  await state.audio.startMicrophone();
  await tick();
  state.emit();
  state.audio.setVadEnabled(true);
  state.emit();
  assert.equal(state.sent.length, 0);
  state.audio.setRecognitionStream('one');
  state.emit();
  state.emit();
  await tick();
  assert.equal(state.audio.getRecognitionTime(), 80);
  assert.equal(state.sent.length, 2);
  assert.equal(state.sent[0].streamId, 'one');
  assert.equal(state.frames[0].startMs, 0);
  state.audio.setRecognitionStream('two');
  state.emit();
  assert.equal(state.audio.getRecognitionTime(), 40);
  assert.equal(state.sent.at(-1).streamId, 'two');
  state.audio.setVadEnabled(false);
  state.emit();
  assert.equal(state.audio.getRecognitionTime(), 40);
  state.audio.setRecognitionStream(null);
  assert.equal(state.audio.getRecognitionTime(), 0);
});

test('muted capture uploads silence on the same clock but never emits voice evidence', async t => {
  const state = capture(t);
  await state.audio.startMicrophone();
  await tick();
  state.audio.setRecognitionStream('one');
  state.audio.setVadEnabled(true);
  state.emit();
  await tick();
  const count = state.frames.length;
  state.audio.setMuted(true);
  state.emit();
  state.emit();
  await tick();
  assert.equal(state.audio.getRecognitionTime(), 120);
  assert.equal(state.frames.length, count);
  assert.ok(state.sent.at(-1).bytes.every(byte => byte === 0));
  assert.equal(state.track.enabled, false);
  state.audio.setMuted(false);
  state.emit();
  await tick();
  assert.equal(state.frames.at(-1).startMs, 120);
  assert.equal(state.track.enabled, true);
});
