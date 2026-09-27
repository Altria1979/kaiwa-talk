import assert from 'node:assert/strict';
import { mock, test } from 'node:test';

const session = { id: 'practice-session', title: '練習', createdAt: '', endedAt: null, review: null };
const suggestions = [
  { text: 'はい、ゆっくりします。', reading: 'はい、ゆっくりします。', meaning: '家で休みます。' },
  { text: 'いいえ、本を読みます。', reading: 'いいえ、ほんをよみます。', meaning: '読書をします。' },
];
const assistant = {
  id: 'assistant-message', sessionId: session.id, turnId: 'reply-turn', role: 'assistant',
  content: 'おうちでゆっくりしますか？', spokenContent: '', interrupted: false,
  delivery: 'text', translation: null, createdAt: '', replySuggestions: suggestions,
  replySuggestionsLanguage: 'ja',
};
const pcm = { audio: 'AAABAA==', sampleRate: 24000 };
const nextTick = () => new Promise(resolve => setImmediate(resolve));
const deferred = () => {
  let resolve;
  let reject;
  const promise = new Promise((done, fail) => { resolve = done; reject = fail; });
  return { promise, resolve, reject };
};

// Exercise the real hook through the same dependency-free harness as the caption tests.
let rendering;
mock.module('react', { exports: {
  useCallback: callback => callback,
  useState(initial) {
    const owner = rendering;
    const index = owner.cursor++;
    if (!(index in owner.slots)) owner.slots[index] = typeof initial === 'function' ? initial() : initial;
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

const requests = [];
let respond;
mock.module('../src/lib/api.ts', { exports: {
  SOCKET_URL: 'ws://example.invalid',
  api: {
    suggestionAudio(messageId, index, signal) {
      const request = { messageId, index, signal };
      requests.push(request);
      return respond(request);
    },
  },
} });

class FakeAudio {
  static latest;
  recognitionTime = 0;
  setRecognitionStream(streamId) { this.streamId = streamId; this.recognitionTime = 0; }
  getRecognitionTime() { return this.recognitionTime; }
  prepared = 0;
  microphoneStarts = 0;
  muted = false;
  muteChanges = [];
  busy = false;
  currentTurn = null;
  sentence = null;
  registrations = [];
  pushes = [];
  replays = [];
  completed = new Set();
  disposed = false;
  constructor(callbacks) { this.callbacks = callbacks; FakeAudio.latest = this; }
  async prepare() { this.prepared++; }
  async startMicrophone() { this.microphoneStarts++; }
  stopMicrophone() {}
  setVadEnabled() {}
  setMuted(value) { this.muted = value; this.muteChanges.push(value); }
  setBusy(value) {
    if (this.busy === value) return;
    this.busy = value;
    this.callbacks.onBusy(value);
  }
  beginTurn(turnId) { this.cancelTurn(); this.currentTurn = turnId; }
  registerSentence(turnId, sentenceId, text) { this.registrations.push({ turnId, sentenceId, text }); }
  caption(status = 'playing') {
    const sentence = this.registrations.findLast(item => item.turnId === this.currentTurn && item.sentenceId === this.sentence);
    if (sentence) this.callbacks.onCaption?.({ ...sentence, visibleCharacters: status === 'ended' ? Array.from(sentence.text).length : 1, status });
  }
  pushAudio(turnId, sentenceId, audio) {
    if (turnId !== this.currentTurn) return;
    assert.ok(this.registrations.some(item => item.turnId === turnId && item.sentenceId === sentenceId), 'register sentence text before its first audio');
    this.pushes.push({ turnId, sentenceId, audio });
    this.sentence = sentenceId;
    this.caption();
    this.setBusy(true);
  }
  finishSentence(turnId) { this.completed.add(turnId); }
  complete() {
    if (this.currentTurn && this.sentence) this.callbacks.onPlayed(this.currentTurn, this.sentence);
    this.caption('ended');
    this.setBusy(false);
  }
  cancelTurn(turnId) {
    if (turnId && turnId !== this.currentTurn) return;
    this.currentTurn = null;
    this.sentence = null;
    this.callbacks.onCaption?.(null);
    this.setBusy(false);
  }
  canReplay(turnId) { return this.completed.has(turnId); }
  async replay(turnId, slow = false) {
    assert.equal(this.canReplay(turnId), true, 'only complete cached audio may be replayed');
    this.replays.push({ turnId, slow });
    await this.prepare();
    this.cancelTurn();
    this.currentTurn = turnId;
    this.sentence = this.registrations.findLast(item => item.turnId === turnId)?.sentenceId ?? null;
    this.caption();
    this.setBusy(true);
  }
  async dispose() { this.cancelTurn(); this.disposed = true; }
}
mock.module('../src/lib/browser-audio.ts', { exports: { BrowserAudio: FakeAudio } });
const { useConversation } = await import('../src/hooks/use-conversation.ts');

class Socket {
  static OPEN = 1;
  static latest;
  readyState = 1;
  bufferedAmount = 0;
  sent = [];
  listeners = new Set();
  acknowledgeCancellation = true;
  constructor() { Socket.latest = this; queueMicrotask(() => this.onopen?.()); }
  send(raw) {
    const event = JSON.parse(raw);
    this.sent.push(event);
    if (event.type === 'start') queueMicrotask(() => this.receive({ type: 'session.started', session, voice: event.voice, asrStreamId: event.voice ? 'stream' : null }));
    if (event.type === 'cancel' && event.turnId && this.acknowledgeCancellation) queueMicrotask(() => this.receive({ type: 'turn.cancelled', turnId: event.turnId }));
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

async function conversation(t, { voice = false, muted = false, replyComplete = true } = {}) {
  const previousSocket = globalThis.WebSocket;
  globalThis.WebSocket = Socket;
  FakeAudio.latest = null;
  requests.length = 0;
  respond = async () => pcm;
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
  await current().start({ voice });
  const socket = Socket.latest;
  const receive = event => socket.receive(event);
  receive({ type: 'reply.start', turnId: assistant.turnId, message: assistant });
  receive({ type: 'reply.suggestions', turnId: assistant.turnId, messageId: assistant.id, status: 'ready', suggestions });
  if (replyComplete) {
    receive({ type: 'reply.done', turnId: assistant.turnId, message: assistant });
    receive({ type: 'turn.done', turnId: assistant.turnId });
    receive({ type: 'state', state: 'listening' });
  }
  if (muted) current().toggleMute();
  if (voice) FakeAudio.latest.callbacks.onVadStatus('ready');
  const admit = (text, { final = false, segmentId = 1, beginMs = 0 } = {}) => {
    const audio = FakeAudio.latest;
    const context = audio.callbacks.getSpeechContext();
    for (let startMs = beginMs; startMs < beginMs + 320; startMs += 32) {
      audio.recognitionTime = startMs + 32;
      audio.callbacks.onVadFrame({ streamId: 'stream', startMs, endMs: startMs + 32, probability: 0.99, context });
    }
    receive({ type: 'transcript', streamId: 'stream', segmentId, beginMs, endMs: final ? beginMs + 320 : null, text, final });
  };
  return { current, socket, receive, admit };
}

test('listening to a suggested reply prepares playback without microphone access or sending a message', async t => {
  const { current, socket } = await conversation(t);
  const before = structuredClone(current().messages);
  const response = deferred();
  respond = () => response.promise;
  const playback = current().listenSuggestion(assistant.id, 1);
  await nextTick();
  assert.deepEqual(current().suggestionSpeech, { messageId: assistant.id, index: 1, status: 'loading' });
  assert.equal(requests.length, 1);
  assert.equal(requests[0].messageId, assistant.id);
  assert.equal(requests[0].index, 1);
  assert.ok(requests[0].signal instanceof AbortSignal);
  response.resolve(pcm);
  await playback;
  const audio = FakeAudio.latest;
  assert.ok(audio.prepared > 0);
  assert.equal(audio.microphoneStarts, 0);
  assert.equal(current().voiceEnabled, false);
  assert.deepEqual(current().suggestionSpeech, { messageId: assistant.id, index: 1, status: 'playing' });
  assert.equal(audio.pushes.at(-1).audio, pcm.audio);
  assert.deepEqual(audio.registrations.at(-1), { turnId: `suggestion:${assistant.id}:1`, sentenceId: 'example', text: suggestions[1].text });
  assert.equal(current().playbackCaption.text, suggestions[1].text);
  assert.equal(current().playbackCaption.visibleCharacters, 1);
  assert.equal(current().state, 'speaking');
  audio.complete();
  await nextTick();
  assert.equal(current().suggestionSpeech, null);
  assert.equal(current().state, 'listening');
  assert.equal(current().playbackCaption.status, 'ended', 'natural suggestion completion keeps the caption for its fade');
  assert.equal(current().playbackCaption.text, suggestions[1].text);
  assert.deepEqual(current().messages, before);
  assert.equal(socket.sent.some(event => event.type === 'text' || event.type === 'played'), false);
});

test('read-aloud suggestions survive recognition until the user message is committed', async t => {
  const { current, receive, admit } = await conversation(t, { voice: true });
  const reference = current().replySuggestions;
  for (const final of [false, true]) {
    if (!final) admit(suggestions[1].text);
    else receive({ type: 'transcript', streamId: 'stream', segmentId: 1, beginMs: 0, endMs: 320, text: suggestions[1].text, final });
    assert.equal(current().pendingTranscript, suggestions[1].text);
    assert.equal(current().replySuggestions, reference, 'recognition must not discard the reading reference');
  }
  receive({ type: 'message', message: { ...assistant, id: 'practiced-user', turnId: 'practiced-turn', role: 'user', content: suggestions[1].text } });
  assert.equal(current().pendingTranscript, '');
  assert.equal(current().replySuggestions, null, 'committing a new utterance retires the previous suggestions');
});

test('empty or failed recognition leaves the same suggestions available for another attempt', async t => {
  const { current, receive, admit } = await conversation(t, { voice: true });
  const reference = current().replySuggestions;
  for (const outcome of [
    { type: 'transcript', streamId: 'stream', segmentId: 1, beginMs: 0, endMs: 320, text: '', final: true },
    { type: 'error', source: 'asr', message: 'もう一度お試しください。', recoverable: true },
  ]) {
    admit('いいえ');
    receive(outcome);
    assert.equal(current().pendingTranscript, '');
    assert.equal(current().replySuggestions, reference);
  }
});

test('voice playback temporarily mutes capture and restores the existing microphone choice', async t => {
  for (const muted of [false, true]) await t.test(`initial muted=${muted}`, async t => {
    const { current } = await conversation(t, { voice: true, muted });
    const audio = FakeAudio.latest;
    await current().listenSuggestion(assistant.id, 0);
    assert.equal(FakeAudio.latest, audio, 'playback shares the existing audio session');
    assert.equal(audio.microphoneStarts, 1);
    assert.equal(audio.muted, true);
    assert.equal(current().muted, muted, 'temporary capture suspension must preserve the user preference');
    audio.complete();
    await nextTick();
    assert.equal(audio.muted, muted);
    assert.equal(current().muted, muted);
    assert.equal(current().suggestionSpeech, null);
  });
});

test('a demonstration cancels an unfinished reply without letting its late audio or cancellation stop the example', async t => {
  const { current, receive, socket } = await conversation(t, { voice: true, replyComplete: false });
  const audio = FakeAudio.latest;
  socket.acknowledgeCancellation = false;
  receive({ type: 'state', state: 'speaking' });
  receive({ type: 'audio.sentence', turnId: assistant.turnId, sentenceId: 'original', text: assistant.content });
  receive({ type: 'audio.sentence', turnId: assistant.turnId, sentenceId: 'original', text: assistant.content });
  receive({ type: 'audio', turnId: assistant.turnId, sentenceId: 'original', ...pcm });
  assert.equal(audio.busy, true);
  assert.equal(audio.pushes.length, 1);
  const readySuggestions = structuredClone(current().replySuggestions);
  await current().listenSuggestion(assistant.id, 0);
  const exampleTurn = audio.currentTurn;
  assert.notEqual(exampleTurn, assistant.turnId);
  assert.deepEqual(socket.sent.filter(event => event.type === 'cancel'), [{ type: 'cancel', turnId: assistant.turnId }]);
  assert.deepEqual(current().replySuggestions, readySuggestions);
  assert.deepEqual(current().suggestionSpeech, { messageId: assistant.id, index: 0, status: 'playing' });

  receive({ type: 'audio', turnId: assistant.turnId, sentenceId: 'late-original', ...pcm });
  receive({ type: 'audio.end', turnId: assistant.turnId, sentenceId: 'late-original', text: assistant.content });
  receive({ type: 'turn.cancelled', turnId: assistant.turnId });
  receive({ type: 'state', state: 'listening' });
  await nextTick();
  assert.equal(audio.currentTurn, exampleTurn);
  assert.equal(audio.pushes.length, 2, 'only the original chunk and independent demonstration reach playback');
  assert.equal(audio.busy, true);
  assert.equal(current().suggestionSpeech.status, 'playing');
  assert.deepEqual(current().replySuggestions, readySuggestions);

  audio.complete();
  await nextTick();
  assert.equal(current().state, 'listening');
  receive({ type: 'audio', turnId: assistant.turnId, sentenceId: 'after-example', ...pcm });
  assert.equal(audio.pushes.length, 2);
  assert.equal(audio.busy, false);
  await current().listenSuggestion(assistant.id, 0);
  assert.equal(audio.replays.length, 1);
  assert.equal(audio.replays[0].turnId, exampleTurn);
  assert.equal(requests.length, 1);
  assert.deepEqual(socket.sent.filter(event => event.type === 'cancel'), [{ type: 'cancel', turnId: assistant.turnId }]);
  assert.equal(socket.sent.some(event => event.type === 'text' || event.type === 'played'), false);
});

test('clicking the same loading suggestion again aborts it and ignores a late response', async t => {
  const { current } = await conversation(t, { voice: true });
  const response = deferred();
  respond = () => response.promise;
  const first = current().listenSuggestion(assistant.id, 0);
  await nextTick();
  await current().listenSuggestion(assistant.id, 0);
  assert.equal(requests.length, 1);
  assert.equal(requests[0].signal.aborted, true);
  assert.equal(current().suggestionSpeech, null);
  assert.equal(FakeAudio.latest.muted, false);
  response.resolve(pcm);
  await first;
  assert.equal(FakeAudio.latest.pushes.length, 0);
  assert.equal(current().suggestionSpeech, null);
});

test('clicking a playing suggestion again stops it without a second synthesis request', async t => {
  const { current } = await conversation(t, { voice: true });
  await current().listenSuggestion(assistant.id, 0);
  const audio = FakeAudio.latest;
  assert.equal(audio.busy, true);
  await current().listenSuggestion(assistant.id, 0);
  assert.equal(audio.busy, false);
  assert.equal(audio.muted, false);
  assert.equal(current().suggestionSpeech, null);
  assert.equal(current().playbackCaption, null);
  assert.equal(requests.length, 1);
});

test('switching suggestions ignores the previous request even when its result arrives last', async t => {
  const { current } = await conversation(t, { voice: true });
  const firstResult = deferred();
  const secondResult = deferred();
  respond = request => request.index === 0 ? firstResult.promise : secondResult.promise;
  const first = current().listenSuggestion(assistant.id, 0);
  await nextTick();
  const second = current().listenSuggestion(assistant.id, 1);
  await nextTick();
  assert.equal(requests[0].signal.aborted, true);
  assert.equal(requests[1].signal.aborted, false);
  secondResult.resolve({ ...pcm, audio: 'AgADAA==' });
  await second;
  firstResult.resolve(pcm);
  await first;
  assert.deepEqual(current().suggestionSpeech, { messageId: assistant.id, index: 1, status: 'playing' });
  assert.equal(FakeAudio.latest.pushes.length, 1);
  assert.equal(FakeAudio.latest.pushes[0].audio, 'AgADAA==');
  assert.equal(FakeAudio.latest.muted, true);
});

test('conversation lifecycle changes cancel demonstrations during synthesis or playback', async t => {
  for (const phase of ['loading', 'playing']) {
    for (const scenario of ['user message', 'new reply', 'typed send', 'end', 'server end', 'disconnect']) {
      await t.test(`${scenario} during ${phase}`, async t => {
        const { current, receive, socket } = await conversation(t, { voice: true });
        const response = deferred();
        respond = () => response.promise;
        const playback = current().listenSuggestion(assistant.id, 0);
        await nextTick();
        const audio = FakeAudio.latest;
        if (phase === 'playing') { response.resolve(pcm); await playback; }
        switch (scenario) {
          case 'user message': receive({ type: 'message', message: { ...assistant, id: 'next-user', turnId: 'next-turn', role: 'user', content: 'はい' } }); break;
          case 'new reply': receive({ type: 'reply.start', turnId: 'next-turn', message: { ...assistant, id: 'next-assistant', turnId: 'next-turn' } }); break;
          case 'typed send': await current().sendText('はい'); break;
          case 'end': await current().end(); break;
          case 'server end': receive({ type: 'session.ended', session: { ...session, endedAt: 'now' } }); break;
          case 'disconnect': socket.close(); break;
        }
        assert.equal(requests[0].signal.aborted, true);
        assert.equal(current().suggestionSpeech, null);
        response.resolve(pcm);
        await playback;
        assert.equal(audio.pushes.length, phase === 'playing' ? 1 : 0);
        assert.equal(audio.busy, false);
        assert.equal(current().suggestionSpeech, null);
      });
    }
  }
});

test('synthesis failure restores capture and leaves the recommendation available for retry', async t => {
  const { current } = await conversation(t, { voice: true });
  respond = async () => { throw new Error('音声の生成に失敗しました'); };
  for (let attempt = 0; attempt < 2; attempt++) {
    await current().listenSuggestion(assistant.id, 0).catch(() => undefined);
    assert.equal(current().suggestionSpeech, null);
    assert.equal(FakeAudio.latest.muted, false);
    assert.match(current().error, /音声の生成に失敗/);
    assert.equal(current().replySuggestions.status, 'ready');
  }
  respond = async () => pcm;
  await current().listenSuggestion(assistant.id, 0);
  assert.equal(requests.length, 3);
  assert.equal(current().suggestionSpeech.status, 'playing');
  assert.equal(current().error, null);
});

test('playback failures retain recommendations and allow another attempt', async t => {
  const { current } = await conversation(t, { voice: true });
  await current().listenSuggestion(assistant.id, 0);
  const audio = FakeAudio.latest;
  audio.callbacks.onError('音声を再生できませんでした', 'playback');
  assert.equal(current().suggestionSpeech, null);
  assert.equal(audio.busy, false);
  assert.equal(audio.muted, false);
  assert.equal(current().replySuggestions.status, 'ready');
  assert.match(current().error, /音声を再生/);
  await current().listenSuggestion(assistant.id, 0);
  assert.equal(current().suggestionSpeech.status, 'playing');
  assert.equal(current().error, null);
});

test('cached playback reporting idle before its error preserves recommendations for retry', async t => {
  const { current, socket } = await conversation(t, { voice: true });
  await current().listenSuggestion(assistant.id, 0);
  const audio = FakeAudio.latest;
  audio.complete();
  await nextTick();
  await current().listenSuggestion(assistant.id, 0);
  assert.equal(audio.replays.length, 1);
  const cancellationsBeforeError = socket.sent.filter(event => event.type === 'cancel').length;
  // HTMLAudioElement.onerror in BrowserAudio stops replay and reports idle first.
  audio.setBusy(false);
  audio.callbacks.onError('音声をもう一度再生できませんでした');
  await nextTick();
  assert.equal(current().suggestionSpeech, null);
  assert.equal(audio.muted, false);
  assert.equal(current().replySuggestions.status, 'ready');
  assert.match(current().error, /もう一度再生/);
  assert.equal(socket.sent.filter(event => event.type === 'cancel').length, cancellationsBeforeError);
  await current().listenSuggestion(assistant.id, 0);
  assert.equal(current().suggestionSpeech.status, 'playing');
  assert.equal(current().error, null);
  assert.equal(audio.replays.length, 2);
  assert.equal(requests.length, 1);
});

test('a queued playback completion cannot stop a newly selected suggestion', async t => {
  const { current } = await conversation(t, { voice: true });
  await current().listenSuggestion(assistant.id, 0);
  const audio = FakeAudio.latest;
  audio.complete();
  await current().listenSuggestion(assistant.id, 1);
  await nextTick();
  assert.deepEqual(current().suggestionSpeech, { messageId: assistant.id, index: 1, status: 'playing' });
  assert.equal(audio.muted, true);
  assert.equal(audio.busy, true);
});

test('late synthesis and playback callbacks cannot update an ended conversation', async t => {
  for (const phase of ['loading', 'playing']) await t.test(phase, async t => {
    const { current, receive } = await conversation(t, { voice: true });
    const response = deferred();
    respond = () => response.promise;
    const playback = current().listenSuggestion(assistant.id, 0);
    await nextTick();
    const audio = FakeAudio.latest;
    if (phase === 'playing') {
      response.resolve(pcm);
      await playback;
      audio.complete();
    }
    await current().end();
    receive({ type: 'session.ended', session: { ...session, endedAt: 'now' } });
    assert.equal(current().state, 'idle');
    assert.equal(current().active, false);
    assert.equal(current().suggestionSpeech, null);
    const before = current();
    audio.callbacks.onBusy(true);
    audio.callbacks.onError('終了後に到着した再生エラー');
    audio.callbacks.onBusy(false);
    if (phase === 'loading') response.reject(new Error('終了後に到着した生成エラー'));
    await playback;
    await nextTick();
    const after = current();
    for (const key of ['state', 'active', 'voiceEnabled', 'muted', 'error', 'suggestionSpeech', 'replySuggestions', 'userSpeaking']) {
      assert.deepEqual(after[key], before[key], `${key} must stay unchanged after session end`);
    }
  });
});

test('muting or unmuting during demonstration cannot reopen the physical microphone', async t => {
  const { current } = await conversation(t, { voice: true, muted: true });
  await current().listenSuggestion(assistant.id, 0);
  const audio = FakeAudio.latest;
  current().toggleMute();
  assert.equal(current().muted, false);
  assert.equal(audio.muted, true);
  current().toggleMute();
  assert.equal(current().muted, true);
  assert.equal(audio.muted, true);
  current().toggleMute();
  audio.complete();
  await nextTick();
  assert.equal(audio.muted, false, 'the final user choice takes effect when the demonstration ends');
});

test('a completed demonstration reuses cached audio without synthesizing the same sentence again', async t => {
  const { current } = await conversation(t, { voice: true });
  await current().listenSuggestion(assistant.id, 0);
  const audio = FakeAudio.latest;
  const cachedTurn = audio.pushes[0].turnId;
  audio.complete();
  await nextTick();
  await current().listenSuggestion(assistant.id, 0);
  assert.equal(requests.length, 1);
  assert.equal(audio.pushes.length, 1);
  assert.equal(audio.replays.length, 1);
  assert.equal(audio.replays[0].turnId, cachedTurn);
  assert.equal(current().playbackCaption.turnId, cachedTurn);
  assert.equal(current().playbackCaption.text, suggestions[0].text);
  assert.equal(current().suggestionSpeech.status, 'playing');
  assert.equal(audio.muted, true);
  current().stopSuggestionSpeech();
  assert.equal(current().playbackCaption, null);
  assert.equal(current().suggestionSpeech, null);
  assert.equal(audio.busy, false);
  assert.equal(audio.muted, false);
});
