import assert from 'node:assert/strict';
import { test } from 'node:test';
import { BrowserAudio } from '../src/lib/browser-audio.ts';
import { formatError } from '../src/i18n/errors.ts';
import { errorsMessages } from '../src/i18n/messages/errors.ts';
import { captionCharacters } from '../src/lib/playback-captions.ts';

const pcm = Buffer.from(new Int16Array(2400).fill(3200).buffer).toString('base64');
const pcmSeconds = seconds => Buffer.from(new Int16Array(Math.round(24000 * seconds)).fill(3200).buffer).toString('base64');

function playback(t) {
  const frames = new Map();
  let frameId = 0;
  const contexts = [];
  const elements = [];
  class AudioNode {
    targets = new Set();
    connect(target) { this.target = target; this.targets.add(target); }
    disconnect(target) { if (target) this.targets.delete(target); else { this.disconnected = true; this.targets.clear(); } }
  }
  class BufferSource extends AudioNode {
    start(time) { this.startTime = time; }
    stop() { this.stopped = true; }
    finish() { this.onended?.(); }
  }
  class AudioContextMock {
    state = 'running';
    currentTime = 0;
    destination = new AudioNode();
    sources = [];
    analyser = Object.assign(new AudioNode(), {
      level: 0.1,
      getFloatTimeDomainData(samples) { samples.fill(this.level); },
    });
    constructor() { contexts.push(this); }
    createAnalyser() { return this.analyser; }
    createGain() { return Object.assign(new AudioNode(), { gain: { value: 1 } }); }
    createMediaStreamDestination() {
      this.recordingDestination = Object.assign(new AudioNode(), { stream: { getTracks: () => [] } });
      return this.recordingDestination;
    }
    createBuffer(_channels, length, sampleRate) {
      return { duration: length / sampleRate, getChannelData: () => new Float32Array(length) };
    }
    createBufferSource() {
      const source = new BufferSource();
      this.sources.push(source);
      return source;
    }
    createMediaElementSource(audio) {
      this.mediaSource = Object.assign(new AudioNode(), { element: audio });
      return this.mediaSource;
    }
    async resume() { this.state = 'running'; }
    async close() { this.state = 'closed'; }
  }
  class AudioMock {
    paused = true;
    currentTime = 0;
    constructor() { elements.push(this); }
    async play() { if (this.rejectPlay) throw new Error('play blocked'); this.paused = false; }
    pause() { this.paused = true; }
    removeAttribute(name) { delete this[name]; }
    load() {}
    finish() { this.onended?.(); }
    fail() { this.onerror?.(); }
  }
  const replacements = {
    AudioContext: AudioContextMock,
    Audio: AudioMock,
    requestAnimationFrame: callback => { frames.set(++frameId, callback); return frameId; },
    cancelAnimationFrame: id => frames.delete(id),
  };
  for (const [name, replacement] of Object.entries(replacements)) {
    const descriptor = Object.getOwnPropertyDescriptor(globalThis, name);
    Object.defineProperty(globalThis, name, { configurable: true, writable: true, value: replacement });
    t.after(() => {
      if (descriptor) Object.defineProperty(globalThis, name, descriptor);
      else delete globalThis[name];
    });
  }
  const levelRef = { current: 0 };
  const busy = [];
  const played = [];
  const errors = [];
  const captions = [];
  const audio = new BrowserAudio({
    levelRef,
    onPcm: () => assert.fail('playback must not start capture'),
    onPlayed: (...sentence) => played.push(sentence),
    onBusy: value => busy.push(value),
    onError: (...error) => errors.push(error),
    onCaption: caption => captions.push(caption),
  });
  return {
    audio, levelRef, busy, played, errors, captions, frames,
    get context() { return contexts.at(-1); },
    get element() { return elements.at(-1); },
    tick() {
      const scheduled = [...frames.values()];
      frames.clear();
      for (const callback of scheduled) callback();
    },
    async stream() {
      await audio.prepare();
      audio.beginTurn('turn');
      audio.pushAudio('turn', 'sentence', pcm);
      audio.finishSentence('turn', 'sentence', 'こんにちは。');
      this.tick();
    },
    assertClosed() {
      assert.equal(levelRef.current, 0, 'playback level resets immediately');
      assert.equal(frames.size, 0, 'no analyser animation frame survives playback');
      assert.equal(busy.at(-1), false);
    },
  };
}

test('streamed playback follows audible sources and resets when the final source ends', async t => {
  const state = playback(t);
  await state.stream();
  state.audio.pushAudio('turn', 'second', pcm);
  state.audio.finishSentence('turn', 'second', '元気ですか。');
  assert.ok(state.levelRef.current > 0);
  assert.equal(state.context.sources[0].target, state.context.analyser);
  state.context.sources[0].finish();
  assert.equal(state.busy.at(-1), true, 'another scheduled source is still active');
  assert.deepEqual(state.played, [['turn', 'sentence']]);
  state.context.sources[1].finish();
  state.assertClosed();
  assert.deepEqual(state.played, [['turn', 'sentence'], ['turn', 'second']]);
});

test('captions wait for actual audio and use grapheme clusters for visible characters', async t => {
  const state = playback(t);
  await state.audio.prepare();
  state.audio.beginTurn('turn');
  const text = 'か\u3099👨‍👩‍👧‍👦🇯🇵こんにちは';
  assert.deepEqual(captionCharacters(text), ['か\u3099', '👨‍👩‍👧‍👦', '🇯🇵', 'こ', 'ん', 'に', 'ち', 'は']);
  state.audio.registerSentence('turn', 'sentence', text);
  state.tick();
  assert.deepEqual(state.captions, [], 'sentence metadata alone is silent');
  state.audio.pushAudio('turn', 'sentence', pcmSeconds(2));
  state.tick();
  state.context.currentTime = state.context.sources[0].startTime - 0.001;
  state.tick();
  assert.deepEqual(state.captions, [], 'queued playback must not reveal text');
  state.context.currentTime = state.context.sources[0].startTime + 0.51;
  state.tick();
  assert.deepEqual(state.captions.at(-1), { turnId: 'turn', sentenceId: 'sentence', text, visibleCharacters: 3, status: 'playing' });
  const count = state.captions.length;
  state.tick();
  assert.equal(state.captions.length, count, 'unchanged progress does not emit another callback');
  state.audio.finishSentence('turn', 'sentence', '');
  state.context.sources[0].finish();
  assert.equal(state.captions.at(-1).visibleCharacters, 8);
  assert.equal(state.captions.at(-1).status, 'ended');
});

test('live captions accumulate audible duration and pause across network gaps', async t => {
  const state = playback(t);
  await state.audio.prepare();
  state.audio.beginTurn('turn');
  state.audio.registerSentence('turn', 'sentence', 'abcdefghijklmnopqrst');
  state.audio.pushAudio('turn', 'sentence', pcmSeconds(0.5));
  state.context.currentTime = state.context.sources[0].startTime + 0.5;
  state.context.sources[0].finish();
  assert.equal(state.captions.at(-1).visibleCharacters, 3);
  assert.equal(state.captions.at(-1).status, 'playing', 'a drained chunk is not a completed sentence');
  const beforeGap = state.captions.length;
  state.context.currentTime = 10;
  state.tick();
  assert.equal(state.captions.length, beforeGap);
  state.audio.pushAudio('turn', 'sentence', pcmSeconds(1));
  state.tick();
  assert.equal(state.captions.length, beforeGap, 'a future scheduled chunk does not include the preceding gap');
  state.context.currentTime = state.context.sources[1].startTime + 0.51;
  state.tick();
  assert.equal(state.captions.at(-1).visibleCharacters, 6);
  state.audio.finishSentence('turn', 'sentence', 'abcdefghijklmnopqrst');
  state.context.currentTime = state.context.sources[1].startTime + 0.76;
  state.tick();
  assert.equal(state.captions.at(-1).visibleCharacters, 13, 'remaining letters spread over the actual remaining sound');
  state.context.sources[1].finish();
  assert.equal(state.captions.at(-1).visibleCharacters, 20);
  assert.equal(state.captions.at(-1).status, 'ended');
  assert.deepEqual(state.played, [['turn', 'sentence']]);
});

test('synthesis completion adjusts remaining progress without taking back visible text', async t => {
  const state = playback(t);
  await state.audio.prepare();
  state.audio.beginTurn('turn');
  state.audio.registerSentence('turn', 'sentence', 'abcdefghijklmnopqrst');
  state.audio.pushAudio('turn', 'sentence', pcmSeconds(10));
  const start = state.context.sources[0].startTime;
  state.context.currentTime = start + 1.01;
  state.tick();
  assert.equal(state.captions.at(-1).visibleCharacters, 6);
  state.audio.finishSentence('turn', 'sentence', 'abcdefghijklmnopqrst');
  state.context.currentTime = start + 1.1;
  state.tick();
  assert.equal(state.captions.at(-1).visibleCharacters, 6, 'a longer final duration cannot rewind the caption');
  state.context.currentTime = start + 5.51;
  state.tick();
  assert.equal(state.captions.at(-1).visibleCharacters, 13);
  state.context.sources[0].finish();
  const counts = state.captions.filter(Boolean).map(caption => caption.visibleCharacters);
  assert.deepEqual(counts, [...counts].sort((a, b) => a - b));
});

test('known sentence duration does not reveal text before sound and audio.end retains a text fallback', async t => {
  const state = playback(t);
  await state.audio.prepare();
  state.audio.beginTurn('turn');
  state.audio.pushAudio('turn', 'sentence', pcmSeconds(2));
  state.audio.finishSentence('turn', 'sentence', 'abcdefghijklmnopqrst');
  state.tick();
  assert.deepEqual(state.captions, []);
  state.context.currentTime = state.context.sources[0].startTime + 0.5;
  state.tick();
  assert.equal(state.captions.at(-1).visibleCharacters, 5);
  state.context.sources[0].finish();
  assert.equal(state.captions.at(-1).status, 'ended');
  assert.equal(state.captions.at(-1).visibleCharacters, 20);
});

test('natural sentence boundaries complete the old caption and start the next only when audible', async t => {
  const state = playback(t);
  await state.audio.prepare();
  state.audio.beginTurn('turn');
  for (const [id, text] of [['one', 'abcdefghij'], ['two', 'klmnopqrst']]) {
    state.audio.registerSentence('turn', id, text);
    state.audio.pushAudio('turn', id, pcmSeconds(1));
    state.audio.finishSentence('turn', id, text);
  }
  state.context.currentTime = state.context.sources[0].startTime + 0.5;
  state.tick();
  assert.equal(state.captions.at(-1).sentenceId, 'one');
  assert.equal(state.captions.at(-1).visibleCharacters, 5);
  state.context.sources[0].finish();
  assert.equal(state.captions.at(-1).status, 'ended');
  assert.equal(state.captions.at(-1).sentenceId, 'one');
  state.context.currentTime = state.context.sources[1].startTime + 0.51;
  state.tick();
  assert.equal(state.captions.at(-1).sentenceId, 'two');
  assert.equal(state.captions.at(-1).visibleCharacters, 5);
  state.context.sources[1].finish();
  assert.equal(state.captions.at(-1).status, 'ended');
  assert.equal(state.captions.at(-1).sentenceId, 'two');
  assert.deepEqual(state.played, [['turn', 'one'], ['turn', 'two']]);
  state.assertClosed();
});

test('cancellation discards late metadata, chunks, sentence completion, and stale source callbacks', async t => {
  const state = playback(t);
  await state.audio.prepare();
  state.audio.beginTurn('old');
  state.audio.registerSentence('old', 'one', 'こんにちは。');
  state.audio.pushAudio('old', 'one', pcmSeconds(1));
  state.context.currentTime = state.context.sources[0].startTime + 0.5;
  state.tick();
  const oldCallback = state.context.sources[0].onended;
  state.audio.cancelTurn('old');
  assert.equal(state.captions.at(-1), null);
  state.audio.beginTurn('new');
  state.audio.registerSentence('new', 'two', 'お元気ですか。');
  state.audio.pushAudio('new', 'two', pcmSeconds(1));
  const count = state.captions.length;
  state.audio.registerSentence('old', 'one', 'stale');
  state.audio.pushAudio('old', 'one', pcm);
  state.audio.finishSentence('old', 'one', 'stale');
  oldCallback();
  assert.equal(state.captions.length, count);
  assert.deepEqual(state.played, []);
  assert.equal(state.busy.at(-1), true);
  state.context.currentTime = state.context.sources[1].startTime + 0.5;
  state.tick();
  assert.equal(state.captions.at(-1).turnId, 'new');
});

test('failed first audio can restart the same turn and sentence with fresh captions', async t => {
  for (const failure of ['invalid PCM', 'inactive context']) {
    await t.test(failure, async t => {
      const state = playback(t);
      await state.audio.prepare();
      state.audio.beginTurn('suggestion');
      state.audio.registerSentence('suggestion', 'example', 'old metadata');
      if (failure === 'inactive context') state.context.state = 'suspended';
      state.audio.pushAudio('suggestion', 'example', failure === 'invalid PCM' ? '!bad' : pcm);
      assert.equal(state.errors.length, 1);
      assert.equal(state.context.sources.length, 0);

      await state.audio.prepare();
      state.audio.beginTurn('suggestion');
      state.audio.registerSentence('suggestion', 'example', 'abcdefghij');
      state.audio.pushAudio('suggestion', 'example', pcmSeconds(1));
      state.audio.finishSentence('suggestion', 'example', 'abcdefghij');
      assert.equal(state.context.sources.length, 1, 'the same IDs can schedule audio after an explicit retry');
      state.context.currentTime = state.context.sources[0].startTime + 0.51;
      state.tick();
      assert.deepEqual(state.captions.at(-1), {
        turnId: 'suggestion', sentenceId: 'example', text: 'abcdefghij', visibleCharacters: 5, status: 'playing',
      });
      state.context.sources[0].finish();
      assert.equal(state.captions.at(-1).status, 'ended');
      assert.deepEqual(state.played, [['suggestion', 'example']]);
      state.assertClosed();
    });
  }
});

test('restarting an incomplete sentence retains completed replay cache and rejects old source callbacks', async t => {
  const state = playback(t);
  await state.stream();
  state.context.sources[0].finish();
  state.audio.registerSentence('turn', 'example', 'old metadata');
  state.audio.pushAudio('turn', 'example', pcmSeconds(1));
  const staleEnded = state.context.sources[1].onended;
  state.audio.cancelTurn('turn');
  state.audio.beginTurn('turn');
  assert.equal(state.audio.canReplay('turn'), true, 'a restart preserves already completed cached audio');
  state.audio.registerSentence('turn', 'example', 'abcdefghij');
  state.audio.pushAudio('turn', 'example', pcmSeconds(1));
  state.audio.finishSentence('turn', 'example', 'abcdefghij');
  assert.equal(state.context.sources.length, 3);
  state.context.currentTime = state.context.sources[2].startTime + 0.51;
  state.tick();
  const caption = state.captions.at(-1);
  assert.equal(caption.text, 'abcdefghij');
  assert.equal(caption.visibleCharacters, 5);
  staleEnded();
  assert.equal(state.captions.at(-1), caption);
  assert.deepEqual(state.played, [['turn', 'sentence']]);
  assert.equal(state.busy.at(-1), true);
  state.context.sources[2].finish();
  assert.deepEqual(state.played, [['turn', 'sentence'], ['turn', 'example']]);
});

test('normal and slow replay use media position, cross sentence boundaries, and restart from zero', async t => {
  const state = playback(t);
  await state.audio.prepare();
  state.audio.beginTurn('turn');
  for (const [id, text] of [['one', 'abcdefghij'], ['two', 'klmnopqrst']]) {
    state.audio.registerSentence('turn', id, text);
    state.audio.pushAudio('turn', id, pcmSeconds(1));
    state.audio.finishSentence('turn', id, text);
  }
  state.context.sources.forEach(source => source.finish());
  state.audio.cancelTurn('turn');
  for (const slow of [false, true]) {
    await state.audio.replay('turn', slow);
    assert.equal(state.element.currentTime, 0);
    state.tick();
    assert.equal(state.captions.at(-1), null, 'cached cancellation and prior progress do not leak into a replay');
    state.element.currentTime = 0.5;
    state.tick();
    assert.equal(state.captions.at(-1).sentenceId, 'one');
    assert.equal(state.captions.at(-1).visibleCharacters, 5);
    const count = state.captions.length;
    state.context.currentTime += 20;
    state.tick();
    assert.equal(state.captions.length, count, 'media buffering must not use wall-clock time');
    state.element.currentTime = 1.5;
    state.tick();
    assert.equal(state.captions.at(-2).status, 'ended');
    assert.equal(state.captions.at(-2).sentenceId, 'one');
    assert.equal(state.captions.at(-1).sentenceId, 'two');
    assert.equal(state.captions.at(-1).visibleCharacters, 5);
    state.element.finish();
    assert.equal(state.captions.at(-1).status, 'ended');
    assert.equal(state.captions.at(-1).sentenceId, 'two');
    assert.equal(state.captions.at(-1).visibleCharacters, 10);
    assert.deepEqual(state.played, [['turn', 'one'], ['turn', 'two']], 'replay does not repeat live acknowledgements');
  }
});

test('replay cancellation and stale media callbacks cannot disturb a newer replay', async t => {
  const state = playback(t);
  await state.stream();
  state.context.sources[0].finish();
  await state.audio.replay('turn');
  state.element.currentTime = 0.05;
  state.tick();
  const staleEnded = state.element.onended;
  const staleError = state.element.onerror;
  state.audio.cancelTurn('turn');
  assert.equal(state.captions.at(-1), null);
  await state.audio.replay('turn', true);
  state.element.currentTime = 0.03;
  state.tick();
  const caption = state.captions.at(-1);
  staleEnded();
  staleError();
  assert.equal(state.captions.at(-1), caption);
  assert.equal(state.busy.at(-1), true);
  assert.deepEqual(state.errors, []);
});

test('playback errors and disposal clear live and replay captions immediately', async t => {
  for (const failure of ['invalid PCM', 'replay error', 'dispose']) {
    await t.test(failure, async t => {
      const state = playback(t);
      await state.stream();
      state.context.currentTime = 0.065;
      state.tick();
      assert.ok(state.captions.at(-1));
      if (failure === 'invalid PCM') state.audio.pushAudio('turn', 'bad', '!bad');
      else if (failure === 'replay error') {
        await state.audio.replay('turn');
        state.element.currentTime = 0.05;
        state.tick();
        assert.ok(state.captions.at(-1));
        state.element.fail();
      } else await state.audio.dispose();
      assert.equal(state.captions.at(-1), null);
      state.assertClosed();
    });
  }
});

test('cancellation and disposal clear the mouth level and stop pending sources', async t => {
  for (const operation of ['cancel', 'dispose']) {
    await t.test(operation, async t => {
      const state = playback(t);
      await state.stream();
      if (operation === 'cancel') state.audio.cancelTurn('turn');
      else await state.audio.dispose();
      state.assertClosed();
      assert.ok(state.context.sources.every(source => source.stopped && source.disconnected));
      state.context.sources[0].finish();
      assert.deepEqual(state.played, [], 'cancelled sources cannot acknowledge a sentence');
      if (operation === 'dispose') assert.equal(state.context.state, 'closed');
    });
  }
});

test('normal and slow replay use the same output analyser and reset on completion', async t => {
  const state = playback(t);
  await state.stream();
  state.context.sources[0].finish();
  for (const slow of [false, true]) {
    await state.audio.replay('turn', slow);
    state.tick();
    assert.equal(state.element.playbackRate, slow ? 0.8 : 1);
    assert.equal(state.element.preservesPitch, true);
    assert.equal(state.context.mediaSource.target, state.context.analyser);
    assert.equal(state.context.mediaSource.element, state.element);
    assert.ok(state.levelRef.current > 0);
    state.element.finish();
    state.assertClosed();
    assert.equal(state.element.src, undefined);
  }
});

test('output level is the current raw RMS, including silent gaps, for streaming and both replay speeds', async t => {
  const state = playback(t);
  await state.stream();
  for (const mode of ['stream', 'normal', 'slow']) {
    if (mode !== 'stream') await state.audio.replay('turn', mode === 'slow');
    for (const amplitude of [0.05, 0.2, 0.003, 0]) {
      state.context.analyser.level = amplitude;
      state.tick();
      assert.ok(Math.abs(state.levelRef.current - amplitude) < 1e-8, `${mode}: raw amplitude ${amplitude}`);
    }
  }
  state.audio.cancelTurn();
});


function assertLocalizedAudioError(error, code) {
  assert.equal(error.errorCode, code);
  const rendered = ['ja', 'zh-CN', 'en'].map(locale => {
    const message = formatError(locale, error);
    assert.equal(message, errorsMessages[locale][`errors.${code}`]);
    assert.doesNotMatch(message, /native-device-detail|resume blocked/);
    return message;
  });
  assert.equal(new Set(rendered).size, 3);
  return true;
}

test('native AudioContext construction failure is localized and a later attempt can succeed', async t => {
  const state = playback(t);
  const original = globalThis.AudioContext;
  globalThis.AudioContext = class {
    constructor() { throw new Error('native-device-detail'); }
  };
  await assert.rejects(state.audio.prepare(), error => assertLocalizedAudioError(error, 'audioNotRunning'));
  assert.equal(state.context, undefined);
  globalThis.AudioContext = original;
  await state.audio.prepare();
  assert.equal(state.context.state, 'running');
  await state.audio.dispose();
  assert.equal(state.context.state, 'closed');
  assert.equal(state.frames.size, 0);
  assert.equal(state.levelRef.current, 0);
});

test('disposing while audio resume rejects retains the ended session error', async t => {
  const state = playback(t);
  await state.audio.prepare();
  state.context.state = 'suspended';
  let rejectResume;
  state.context.resume = () => new Promise((_resolve, reject) => { rejectResume = reject; });
  const result = assert.rejects(state.audio.prepare(), error => assertLocalizedAudioError(error, 'audioSessionEnded'));
  await state.audio.dispose();
  rejectResume(new Error('native-device-detail'));
  await result;
  assert.equal(state.context.state, 'closed');
  assert.equal(state.frames.size, 0);
  assert.equal(state.levelRef.current, 0);
  await assert.rejects(state.audio.prepare(), error => assertLocalizedAudioError(error, 'audioSessionEnded'));
});

test('failure to resume audio during replay resets an existing playback level', async t => {
  const state = playback(t);
  await state.stream();
  state.context.state = 'suspended';
  state.context.resume = async () => { throw new Error('resume blocked'); };
  await assert.rejects(state.audio.replay('turn'), error => assertLocalizedAudioError(error, 'audioNotRunning'));
  state.assertClosed();
});

test('stream failures and replay failures clear the level and pending animation frames', async t => {
  for (const failure of ['invalid PCM', 'replay error', 'replay blocked', 'replay cancelled', 'replay disposed']) {
    await t.test(failure, async t => {
      const state = playback(t);
      await state.stream();
      if (failure === 'invalid PCM') {
        state.audio.pushAudio('turn', 'bad', '!bad');
        assert.equal(state.errors.length, 1);
      } else {
        await state.audio.replay('turn');
        state.tick();
        if (failure === 'replay error') {
          state.element.fail();
          assert.equal(state.errors.length, 1);
        } else if (failure === 'replay blocked') {
          state.element.rejectPlay = true;
          await assert.rejects(state.audio.replay('turn'), /ブロック/);
        } else if (failure === 'replay cancelled') state.audio.cancelTurn('turn');
        else await state.audio.dispose();
      }
      state.assertClosed();
    });
  }
});

function enableRecording(t) {
  const instances = [];
  class Recorder {
    static isTypeSupported(type) { return type === 'audio/webm;codecs=opus'; }
    state = 'inactive';
    stops = 0;
    constructor(stream, options) { this.stream = stream; this.mimeType = options.mimeType; instances.push(this); }
    start() { this.state = 'recording'; }
    stop() { this.stops++; this.state = 'inactive'; }
    finish(text = 'conversation') {
      this.ondataavailable?.({ data: new Blob([text], { type: this.mimeType }) });
      this.onstop?.();
    }
  }
  const descriptor = Object.getOwnPropertyDescriptor(globalThis, 'MediaRecorder');
  Object.defineProperty(globalThis, 'MediaRecorder', { configurable: true, value: Recorder });
  t.after(() => { if (descriptor) Object.defineProperty(globalThis, 'MediaRecorder', descriptor); else delete globalThis.MediaRecorder; });
  return instances;
}

test('audio preparation does not record until the confirmed conversation explicitly starts recording', async t => {
  const recorders = enableRecording(t);
  const state = playback(t);
  await state.audio.prepare();
  assert.equal(recorders.length, 0);
  state.audio.startRecording();
  state.audio.startRecording();
  await state.audio.prepare();
  assert.equal(recorders.length, 1);
  assert.equal(recorders[0].stream, state.context.recordingDestination.stream);
  const pending = state.audio.stopRecording();
  assert.equal(state.audio.stopRecording(), pending);
  assert.equal(recorders[0].stops, 1);
  recorders[0].finish();
  const result = await pending;
  assert.equal(result.status, 'ready');
  state.audio.startRecording();
  await state.audio.prepare();
  assert.equal(recorders.length, 1, 'a finished recording cannot restart on the same audio session');
  await state.audio.dispose();
  assert.equal(await result.blob.text(), 'conversation');
  assert.equal(await state.audio.stopRecording(), result);
});

test('a recording request before prepare starts once, unless the session was already ended', async t => {
  for (const stopBeforePrepare of [false, true]) {
    await t.test(String(stopBeforePrepare), async t => {
      const recorders = enableRecording(t);
      const state = playback(t);
      state.audio.startRecording();
      assert.equal(recorders.length, 0);
      if (stopBeforePrepare) assert.deepEqual(await state.audio.stopRecording(), { status: 'empty' });
      await state.audio.prepare();
      assert.equal(recorders.length, stopBeforePrepare ? 0 : 1);
      const disposal = state.audio.dispose();
      recorders[0]?.finish();
      await disposal;
    });
  }
});

test('dispose stops playback immediately but closes the context only after final recording data', async t => {
  const recorders = enableRecording(t);
  const state = playback(t);
  await state.stream();
  state.audio.startRecording();
  const disposal = state.audio.dispose();
  assert.equal(state.audio.dispose(), disposal);
  assert.equal(recorders[0].stops, 1);
  assert.ok(state.context.sources[0].stopped);
  assert.equal(state.context.state, 'running');
  const pending = state.audio.stopRecording();
  recorders[0].finish('last syllable');
  await disposal;
  assert.equal(state.context.state, 'closed');
  assert.equal(await (await pending).blob.text(), 'last syllable');
});

test('live playback, replay and suggestion playback use the same recorded output and cancellation stops queued audio', async t => {
  const recorders = enableRecording(t);
  const state = playback(t);
  await state.audio.prepare();
  state.audio.startRecording();
  await state.stream();
  assert.ok(state.context.analyser.targets.has(state.context.recordingDestination));
  assert.ok(state.context.sources[0].targets.has(state.context.analyser));
  state.context.sources[0].finish();
  await state.audio.replay('turn');
  assert.ok(state.context.mediaSource.targets.has(state.context.analyser));
  state.audio.beginTurn('suggestion');
  assert.equal(state.element.paused, true);
  state.audio.pushAudio('suggestion', 'example', pcm);
  const suggestion = state.context.sources.at(-1);
  assert.ok(suggestion.targets.has(state.context.analyser));
  state.audio.cancelTurn();
  assert.equal(suggestion.stopped, true, 'unplayed cached or queued audio is not added to the recording');
  assert.equal(suggestion.targets.size, 0);
  assert.equal(recorders.length, 1);
  const disposal = state.audio.dispose();
  recorders[0].finish();
  await disposal;
});
