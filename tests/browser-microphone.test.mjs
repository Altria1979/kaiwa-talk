import assert from 'node:assert/strict';
import { test } from 'node:test';
import { BrowserMicrophone } from '../src/lib/browser-microphone.ts';

function mediaStream(audioCount = 1) {
  const tracks = Array.from({ length: audioCount }, () => ({
    enabled: true,
    readyState: 'live',
    stops: 0,
    stop() { this.stops++; this.readyState = 'ended'; },
  }));
  return { getAudioTracks: () => tracks, getTracks: () => tracks };
}

function microphone(t, getUserMedia) {
  const original = Object.getOwnPropertyDescriptor(globalThis, 'navigator');
  const calls = [];
  Object.defineProperty(globalThis, 'navigator', {
    configurable: true,
    value: { mediaDevices: { getUserMedia: options => { calls.push(options); return getUserMedia(); } } },
  });
  const holder = new BrowserMicrophone();
  t.after(() => {
    holder.dispose();
    if (original) Object.defineProperty(globalThis, 'navigator', original);
    else delete globalThis.navigator;
  });
  return { holder, calls };
}

test('consecutive conversations reuse one grant and keep idle microphone tracks disabled', async t => {
  const stream = mediaStream();
  const track = stream.getAudioTracks()[0];
  const { holder, calls } = microphone(t, async () => stream);
  const firstOwner = {};
  assert.equal(await holder.acquire(firstOwner), stream);
  assert.equal(track.enabled, false, 'capture is enabled only after the audio graph is ready');
  assert.deepEqual(calls, [{ audio: { channelCount: 1, echoCancellation: true, noiseSuppression: true, autoGainControl: true } }]);
  track.enabled = true;
  holder.release(firstOwner);
  assert.equal(track.enabled, false);
  assert.equal(track.stops, 0);
  assert.equal(await holder.acquire({}), stream);
  assert.equal(track.enabled, false);
  assert.equal(calls.length, 1);
});

test('a former conversation cannot release the current conversation microphone', async t => {
  const stream = mediaStream();
  const { holder } = microphone(t, async () => stream);
  const formerOwner = {};
  const currentOwner = {};
  await holder.acquire(formerOwner);
  stream.getAudioTracks()[0].enabled = true;
  await holder.acquire(currentOwner);
  assert.equal(stream.getAudioTracks()[0].enabled, false, 'handoff waits for the new audio graph');
  stream.getAudioTracks()[0].enabled = true;
  holder.release(formerOwner);
  assert.equal(stream.getAudioTracks()[0].enabled, true);
  holder.release(currentOwner);
  assert.equal(stream.getAudioTracks()[0].enabled, false);
});

test('simultaneous owners share the pending permission request and only the latest receives it', async t => {
  const request = Promise.withResolvers();
  const stream = mediaStream();
  const { holder, calls } = microphone(t, () => request.promise);
  const first = holder.acquire({});
  const latest = holder.acquire({});
  assert.equal(calls.length, 1);
  request.resolve(stream);
  assert.equal(await first, null);
  assert.equal(await latest, stream);
  assert.equal(stream.getAudioTracks()[0].enabled, false);
});

test('simultaneous cached acquisitions also return audio only to the current owner', async t => {
  const stream = mediaStream();
  const { holder, calls } = microphone(t, async () => stream);
  await holder.acquire({});
  const former = holder.acquire({});
  const current = holder.acquire({});
  assert.equal(await former, null);
  assert.equal(await current, stream);
  assert.equal(calls.length, 1);
});

test('release invalidates a pending acquisition even when the same owner acquires again', async t => {
  const request = Promise.withResolvers();
  const stream = mediaStream();
  const { holder, calls } = microphone(t, () => request.promise);
  const owner = {};
  const previous = holder.acquire(owner);
  holder.release(owner);
  const current = holder.acquire(owner);
  request.resolve(stream);
  assert.equal(await previous, null);
  assert.equal(await current, stream);
  assert.equal(calls.length, 1);
});

test('a cancelled pending acquisition remains disabled and can be reused without another grant', async t => {
  const request = Promise.withResolvers();
  const stream = mediaStream();
  const { holder, calls } = microphone(t, () => request.promise);
  const owner = {};
  const pending = holder.acquire(owner);
  holder.release(owner);
  request.resolve(stream);
  assert.equal(await pending, null);
  assert.equal(stream.getAudioTracks()[0].enabled, false);
  assert.equal(await holder.acquire({}), stream);
  assert.equal(calls.length, 1);
});

for (const name of ['NotAllowedError', 'SecurityError', 'NotReadableError']) {
  test(`${name} retains the application error and permits a later retry`, async t => {
    const stream = mediaStream();
    let attempts = 0;
    const { holder, calls } = microphone(t, async () => {
      if (++attempts === 1) throw new DOMException('native detail', name);
      return stream;
    });
    await assert.rejects(holder.acquire({}), {
      name: 'AppError',
      errorCode: name === 'NotReadableError' ? 'microphoneStartFailed' : 'microphoneDenied',
    });
    assert.equal(await holder.acquire({}), stream);
    assert.equal(calls.length, 2);
  });
}

test('a superseded owner does not receive another owner’s permission failure', async t => {
  const request = Promise.withResolvers();
  const { holder } = microphone(t, () => request.promise);
  const former = holder.acquire({});
  const current = holder.acquire({});
  const rejected = assert.rejects(current, { errorCode: 'microphoneDenied' });
  request.reject(new DOMException('denied', 'NotAllowedError'));
  assert.equal(await former, null);
  await rejected;
});

test('ended cached tracks are stopped and replaced', async t => {
  const oldStream = mediaStream(2);
  const newStream = mediaStream();
  let current = oldStream;
  const { holder, calls } = microphone(t, async () => current);
  await holder.acquire({});
  oldStream.getAudioTracks()[0].readyState = 'ended';
  current = newStream;
  assert.equal(await holder.acquire({}), newStream);
  assert.deepEqual(oldStream.getTracks().map(track => track.stops), [1, 1]);
  assert.equal(newStream.getAudioTracks()[0].enabled, false);
  assert.equal(calls.length, 2);
});

test('a stream with no live audio tracks fails without poisoning a later acquisition', async t => {
  const invalid = mediaStream();
  invalid.getAudioTracks()[0].readyState = 'ended';
  let current = invalid;
  const { holder } = microphone(t, async () => current);
  await assert.rejects(holder.acquire({}), { errorCode: 'microphoneStartFailed' });
  assert.equal(invalid.getTracks()[0].stops, 1);
  current = mediaStream();
  assert.equal(await holder.acquire({}), current);
});

test('dispose stops retained tracks and allows a fresh page lifecycle', async t => {
  const oldStream = mediaStream();
  const newStream = mediaStream();
  let current = oldStream;
  const { holder, calls } = microphone(t, async () => current);
  const owner = {};
  await holder.acquire(owner);
  holder.release(owner);
  holder.dispose();
  assert.equal(oldStream.getTracks()[0].stops, 1);
  current = newStream;
  assert.equal(await holder.acquire({}), newStream);
  assert.equal(calls.length, 2);
  holder.dispose();
  holder.dispose();
  assert.equal(newStream.getTracks()[0].stops, 1);
});

for (const outcome of ['resolve', 'reject']) {
  test(`a disposed request’s late ${outcome} cannot overwrite or clear a newer request`, async t => {
    const staleRequest = Promise.withResolvers();
    const freshRequest = Promise.withResolvers();
    const staleStream = mediaStream();
    const freshStream = mediaStream();
    let request = staleRequest;
    const { holder, calls } = microphone(t, () => request.promise);
    const stale = holder.acquire({});
    holder.dispose();
    request = freshRequest;
    const firstFresh = holder.acquire({});
    if (outcome === 'resolve') staleRequest.resolve(staleStream);
    else staleRequest.reject(new DOMException('denied', 'NotAllowedError'));
    assert.equal(await stale, null);
    if (outcome === 'resolve') assert.equal(staleStream.getTracks()[0].stops, 1);
    const latestFresh = holder.acquire({});
    assert.equal(calls.length, 2, 'stale finalizers must preserve the newer pending request');
    freshRequest.resolve(freshStream);
    assert.equal(await firstFresh, null);
    assert.equal(await latestFresh, freshStream);
    assert.equal(freshStream.getAudioTracks()[0].enabled, false);
    assert.equal(freshStream.getTracks()[0].stops, 0);
  });
}

for (const navigatorValue of [undefined, {}, { mediaDevices: {} }]) {
  test(`missing microphone API reports microphoneUnsupported (${JSON.stringify(navigatorValue)})`, async t => {
    const { holder } = microphone(t, () => assert.fail('unsupported browsers must not request audio'));
    Object.defineProperty(globalThis, 'navigator', { configurable: true, value: navigatorValue });
    await assert.rejects(holder.acquire({}), { name: 'AppError', errorCode: 'microphoneUnsupported' });
  });
}
