import assert from 'node:assert/strict';
import { test } from 'node:test';
import { ConversationRecorder } from '../src/lib/conversation-recorder.ts';

function recording(t, options = {}) {
  const events = [];
  const recorders = [];
  class Node {
    targets = new Set();
    connect(target) { this.targets.add(target); }
    disconnect(target) { if (target) this.targets.delete(target); else this.targets.clear(); }
  }
  const track = { stop() { events.push('track stopped'); } };
  const destination = Object.assign(new Node(), { stream: { getTracks: () => [track] } });
  const microphoneGain = Object.assign(new Node(), { gain: { value: 1 } });
  const speaker = new Node();
  const playback = new Node();
  playback.connect(speaker);
  const context = {
    createMediaStreamDestination() { return destination; },
    createGain() { return microphoneGain; },
  };
  class Recorder {
    static isTypeSupported(type) { return (options.supported ?? ['audio/webm;codecs=opus']).includes(type); }
    state = 'inactive';
    stops = 0;
    constructor(stream, settings) {
      if (options.constructorError) throw new Error('unsupported encoder');
      this.stream = stream;
      this.settings = settings;
      this.mimeType = options.actualMime ?? settings?.mimeType ?? '';
      recorders.push(this);
    }
    start(timeslice) {
      if (options.startError) throw new Error('encoder resources unavailable');
      this.timeslice = timeslice;
      this.state = 'recording';
    }
    stop() {
      this.stops++;
      if (options.stopError) throw new Error('recorder failed');
      this.state = 'inactive';
      events.push('stop requested');
    }
    chunk(text, type = this.mimeType) { this.ondataavailable?.({ data: new Blob([text], { type }) }); }
    finish(text = '') {
      this.state = 'inactive';
      this.chunk(text);
      events.push('final data');
      this.onstop?.();
      events.push('stop event');
    }
  }
  const descriptor = Object.getOwnPropertyDescriptor(globalThis, 'MediaRecorder');
  Object.defineProperty(globalThis, 'MediaRecorder', { configurable: true, value: options.unavailable ? undefined : Recorder });
  t.after(() => { if (descriptor) Object.defineProperty(globalThis, 'MediaRecorder', descriptor); else delete globalThis.MediaRecorder; });
  if (options.noDestination) delete context.createMediaStreamDestination;
  const recording = new ConversationRecorder(context, playback);
  return { recording, events, recorders, destination, microphoneGain, speaker, playback, Node, get recorder() { return recorders.at(-1); } };
}

test('recording mixes playback and microphone without routing microphone to the speaker', async t => {
  const state = recording(t);
  const microphone = new state.Node();
  state.recording.setMicrophone(microphone);
  assert.equal(state.recorder.stream, state.destination.stream);
  assert.equal(state.recorder.timeslice, 1000);
  assert.deepEqual([...state.playback.targets], [state.speaker, state.destination]);
  assert.deepEqual([...microphone.targets], [state.microphoneGain]);
  assert.deepEqual([...state.microphoneGain.targets], [state.destination]);
  state.recording.setMuted(true);
  assert.equal(state.microphoneGain.gain.value, 0);
  state.recording.setMuted(false);
  assert.equal(state.microphoneGain.gain.value, 1);
  const pending = state.recording.stop();
  state.recorder.finish('mixed sound');
  assert.equal((await pending).status, 'ready');
  assert.deepEqual([...state.playback.targets], [state.speaker], 'cleanup retains the audible playback route');
  assert.equal(microphone.targets.size, 0);
});

test('microphone replacement and temporary disconnection keep the same recording stream', async t => {
  const state = recording(t);
  const first = new state.Node();
  const capture = new state.Node();
  first.connect(capture);
  state.recording.setMicrophone(first);
  state.recording.setMuted(true);
  state.recording.setMicrophone(null);
  assert.deepEqual([...first.targets], [capture]);
  const second = new state.Node();
  state.recording.setMicrophone(second);
  state.recording.setMicrophone(second);
  assert.deepEqual([...second.targets], [state.microphoneGain]);
  assert.equal(state.microphoneGain.gain.value, 0, 'a replacement microphone keeps the mute state');
  assert.equal(state.recorders.length, 1);
  const pending = state.recording.stop();
  state.recorder.finish('before and after reconnect');
  assert.equal(await (await pending).blob.text(), 'before and after reconnect');
});

test('stop is idempotent and resolves only after the last chunk and stop event', async t => {
  const state = recording(t);
  state.recorder.chunk('first');
  const pending = state.recording.stop();
  assert.equal(state.recording.stop(), pending);
  assert.equal(state.recorder.stops, 1);
  let settled = false;
  pending.then(() => { settled = true; });
  await Promise.resolve();
  assert.equal(settled, false);
  assert.deepEqual(state.events, ['stop requested']);
  state.recorder.chunk('last');
  await Promise.resolve();
  assert.equal(settled, false, 'dataavailable alone does not finalize the recording');
  state.recorder.finish();
  const result = await pending;
  assert.equal(result.status, 'ready');
  assert.equal(result.extension, 'webm');
  assert.equal(result.blob.type, 'audio/webm;codecs=opus');
  assert.equal(await result.blob.text(), 'firstlast');
  assert.equal(await state.recording.stop(), result);
  assert.ok(state.events.indexOf('track stopped') > state.events.indexOf('final data'));
});

test('supported and browser-selected containers receive matching file extensions', async t => {
  for (const [supported, actualMime, chunkMime, extension] of [
    [['audio/mp4', 'audio/ogg;codecs=opus'], '', '', 'm4a'],
    [['audio/ogg;codecs=opus'], '', '', 'ogg'],
    [[], 'audio/mp4;codecs=mp4a.40.2', '', 'm4a'],
    [[], '', 'audio/ogg;codecs=opus', 'ogg'],
  ]) {
    await t.test(extension + actualMime + chunkMime, async t => {
      const state = recording(t, { supported, ...(actualMime ? { actualMime } : {}) });
      assert.equal(state.recorder.settings?.mimeType, supported[0]);
      const pending = state.recording.stop();
      state.recorder.chunk('audio', chunkMime || state.recorder.mimeType);
      state.recorder.finish();
      assert.equal((await pending).extension, extension);
    });
  }
});

test('missing recording APIs remain unavailable without changing playback', async t => {
  for (const options of [{ unavailable: true }, { noDestination: true }]) {
    await t.test(JSON.stringify(options), async t => {
      const state = recording(t, options);
      assert.deepEqual(await state.recording.stop(), { status: 'unavailable' });
      assert.deepEqual([...state.playback.targets], [state.speaker]);
    });
  }
});

test('constructor, start, stop and encoder failures resolve as failed and release the mixing graph', async t => {
  for (const failure of ['constructorError', 'startError', 'stopError', 'encoderError']) {
    await t.test(failure, async t => {
      const state = recording(t, { [failure]: true });
      if (failure === 'encoderError') {
        state.recorder.state = 'inactive';
        state.recorder.onerror();
        state.recorder.finish('partial audio');
      }
      assert.deepEqual(await state.recording.stop(), { status: 'failed' });
      assert.deepEqual([...state.playback.targets], [state.speaker]);
      assert.ok(state.events.includes('track stopped'));
    });
  }
});

test('empty data and unknown default containers never create a misleading download', async t => {
  for (const [text, expected] of [['', 'empty'], ['audio', 'unavailable']]) {
    await t.test(expected, async t => {
      const state = recording(t, { supported: [] });
      const pending = state.recording.stop();
      state.recorder.finish(text);
      assert.deepEqual(await pending, { status: expected });
    });
  }
});

test('spontaneous recorder completion retains the final result for a later stop call', async t => {
  const state = recording(t);
  state.recorder.finish('completed');
  const result = await state.recording.stop();
  assert.equal(result.status, 'ready');
  assert.equal(await result.blob.text(), 'completed');
});

test('an encoder that never finishes cannot block audio session teardown', async t => {
  t.mock.timers.enable({ apis: ['setTimeout'] });
  const state = recording(t);
  const pending = state.recording.stop();
  t.mock.timers.tick(5000);
  assert.deepEqual(await pending, { status: 'failed' });
  assert.ok(state.events.includes('track stopped'));
  assert.deepEqual([...state.playback.targets], [state.speaker]);
  state.recorder.finish('late data');
  assert.deepEqual(await state.recording.stop(), { status: 'failed' });
});
