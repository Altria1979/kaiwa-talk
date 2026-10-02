import { ProviderError } from '../server/providers/errors.ts';
import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';
import { beforeEach, mock, test } from 'node:test';
import { setImmediate as nextTick } from 'node:timers/promises';
import { DEFAULT_SETTINGS } from '../shared/protocol.ts';

let settings;
let messages;
let sessions;
let prompts;
let syntheses;
let asrCallbacks;
let asrInstances;
let finishAsr;
let connectAsrReply;
let streamReply;
let synthesizeReply;
let completionPrompts;
let completeReply;
let lease;
const runtimeConfig = { cloud: false };

const copy = (value) => structuredClone(value);
function createMockStore(data) {
  const assertGuard = (guard, sessionId) => {
    if (guard && (!data.lease || guard.sessionId !== sessionId || data.lease.sessionId !== sessionId || data.lease.ownerId !== guard.ownerId || data.lease.expiresAt <= Date.now())) throw new Error('SessionLeaseLostError');
  };
  return {
    async acquireSessionLease(sessionId, ownerId, ttlMs) {
      if (data.lease && data.lease.expiresAt > Date.now() && data.lease.ownerId !== ownerId) return false;
      data.lease = { sessionId, ownerId, expiresAt: Date.now() + ttlMs }; return true;
    },
    async renewSessionLease(sessionId, ownerId, ttlMs) {
      if (!data.lease || data.lease.sessionId !== sessionId || data.lease.ownerId !== ownerId || data.lease.expiresAt <= Date.now()) return false;
      data.lease.expiresAt = Date.now() + ttlMs; return true;
    },
    async releaseSessionLease(sessionId, ownerId) { if (data.lease?.sessionId === sessionId && data.lease.ownerId === ownerId) data.lease = null; },
    async getActiveSessionId() { return data.lease && data.lease.expiresAt > Date.now() ? data.lease.sessionId : null; },
    async reopenSession(id, guard) { assertGuard(guard, id); const value = data.sessions.get(id); value.endedAt = null; value.review = null; return copy(value); },
    getSettings: async () => copy(data.settings),
    listMemories: async () => copy(data.memories ?? []),
    recentReviews: async () => copy(data.reviews ?? []),
    listMessages: async (sessionId) => data.messages.filter(message => message.sessionId === sessionId).map(copy),
    async createSession(guard) {
      assertGuard(guard, guard?.sessionId);
      const session = { id: guard?.sessionId ?? randomUUID(), title: 'テスト', createdAt: new Date().toISOString(), endedAt: null, review: null };
      data.sessions.set(session.id, session);
      return copy(session);
    },
    getSession: async (id) => copy(data.sessions.get(id)),
    async endSession(id, review, guard) { assertGuard(guard, id); data.sessions.get(id).endedAt = new Date().toISOString(); },
    async saveReview(id, review, endedAt) { assert.equal(data.sessions.get(id).endedAt, endedAt); data.sessions.get(id).review = copy(review); },
    async addMessage(input, guard) {
      assertGuard(guard, input.sessionId);
      const message = { ...input, id: randomUUID(), spokenContent: '', interrupted: false, translation: null, createdAt: new Date().toISOString() };
      data.messages.push(copy(message));
      return message;
    },
    async updateMessage(id, patch, guard) {
      assertGuard(guard, data.messages.find(message => message.id === id)?.sessionId);
      const index = data.messages.findIndex(message => message.id === id);
      assert.notEqual(index, -1);
      data.messages[index] = { ...data.messages[index], ...copy(patch) };
      return copy(data.messages[index]);
    },
  };
}

const store = createMockStore({
  get settings() { return settings; },
  get messages() { return messages; },
  get sessions() { return sessions; },
  get lease() { return lease; },
  set lease(value) { lease = value; },
});

function browserStore(label) {
  const data = {
    settings: { ...DEFAULT_SETTINGS, characterName: `${label}-character`, persona: `${label}-persona` },
    messages: [], sessions: new Map(), lease: null,
    memories: [{ content: `${label}-memory` }],
    reviews: [{ topic: `${label}-review` }],
  };
  return { data, store: createMockStore(data) };
}

mock.module('../server/config.ts', {
  exports: {
    config: runtimeConfig,
    CredentialError: class extends Error {},
    resolveBailianConfig: () => Object.freeze({}),
    getStatus: () => ({ ready: true }),
  },
});
mock.module('../server/providers/asr.ts', {
  exports: {
    AsrClient: class {
      constructor(callbacks) {
        this.streamId = randomUUID();
        this.time = 0;
        this.callbacks = callbacks;
        asrCallbacks = callbacks;
        asrInstances.push(this);
      }
      async connect(silenceMs, timeoutMs) { await connectAsrReply(this, silenceMs, timeoutMs); }
      append(audio) { this.time += Buffer.from(audio, 'base64').length / 32; }
      close() { this.closed = true; }
      async finish() { await finishAsr(this); }
    },
  },
});
mock.module('../server/providers/qwen.ts', {
  exports: {
    QwenClient: class {
      async *stream(prompt, signal) {
        prompts.push(copy(prompt));
        yield* streamReply(signal);
      }
      async complete(prompt) {
        completionPrompts.push(copy(prompt));
        return completeReply(prompt);
      }
    },
  },
});
const { resolveTtsLanguage } = await import('../server/providers/tts.ts');
mock.module('../server/providers/tts.ts', {
  exports: {
    resolveTtsLanguage,
    TtsClient: class {
      async synthesize(text, voice, language, signal, onAudio) {
        const call = { text, voice, language, signal, onAudio };
        syntheses.push(call);
        await synthesizeReply(call);
      }
    },
  },
});
const { RealtimeSession, getActiveSessionId } = await import('../server/session.ts');

beforeEach(() => {
  lease = null;
  runtimeConfig.cloud = false;
  settings = { ...DEFAULT_SETTINGS };
  messages = [];
  sessions = new Map();
  prompts = [];
  syntheses = [];
  asrCallbacks = undefined;
  asrInstances = [];
  finishAsr = async () => {};
  connectAsrReply = async () => {};
  streamReply = async function* () { yield '大丈夫です。'; };
  synthesizeReply = async ({ onAudio }) => { onAudio('AAA='); };
  completionPrompts = [];
  completeReply = () => '{}';
});

async function waitFor(predicate) {
  for (let attempt = 0; attempt < 100; attempt++) {
    if (predicate()) return;
    await nextTick();
  }
  assert.fail('The expected session event did not arrive');
}

async function startSession(t, voice, scopedStore = store) {
  const events = [];
  const session = new RealtimeSession({ readyState: 1, bufferedAmount: 0, send: raw => events.push(JSON.parse(raw)), close() {} }, scopedStore);
  t.after(() => session.dispose());
  await session.handle({ type: 'start', voice });
  assert.ok(session.sessionId);
  return { session, events };
}

const last = (events, type) => events.filter(event => event.type === type).at(-1);
const japaneseHelpRule = '用户用辅助语言求助时，先用日语简短解释';

for (const voice of [false, true]) {
  test(`Violet persona reaches ${voice ? 'voice' : 'text'} turns without overriding language rules or later custom settings`, async t => {
    settings.learningLanguage = '英語';
    const { session, events } = await startSession(t, voice);
    await session.handle({ type: 'text', text: '今日は疲れました。' });
    await waitFor(() => events.filter(event => event.type === 'turn.done').length === 1);

    const system = prompts[0][0].content;
    // The full profile, including examples at the end, must fit the settings editor and reach Qwen.
    assert.ok(DEFAULT_SETTINGS.persona.length <= 1000);
    assert.ok(system.includes(`你是${DEFAULT_SETTINGS.characterName}，${DEFAULT_SETTINGS.persona}`));
    assert.match(system, /人物设定和例句.*不能覆盖本轮的语种、句数、朗读和输出格式规则/);
    assert.match(system, /不要编造设定之外的个人经历、与用户共同发生过的事情或用户信息/);
    assert.match(system, /回复第一行必须是内部情绪标记/);
    assert.match(system, /一至两句短句，一次最多追问一个问题/);
    assert.match(system, /练习英語/);
    if (voice) {
      assert.match(system, /正文必须全部使用英語/);
      assert.ok(!system.includes(japaneseHelpRule));
    } else {
      assert.ok(system.includes(japaneseHelpRule));
      assert.ok(!system.includes('当前回复将直接朗读'));
    }

    settings.characterName = '私の先生';
    settings.persona = '落ち着いた英語の先生。';
    await session.handle({ type: 'text', text: 'Please help me practice.' });
    await waitFor(() => events.filter(event => event.type === 'turn.done').length === 2);
    const nextSystem = prompts[1][0].content;
    assert.ok(nextSystem.includes(`你是${settings.characterName}，${settings.persona}`));
    assert.ok(!nextSystem.includes(DEFAULT_SETTINGS.persona));
  });
}

test('reply emotion precedes body and cannot reach history, captions, speech, or suggestions', async t => {
  const { session, events } = await startSession(t, true);
  streamReply = async function* () {
    for (const chunk of ['\uFEFF ', '\r\n', '[[emo', 'tion:happy]]\r', '\nこんに', 'ちは。元気ですか？']) yield chunk;
  };
  await session.handle({ type: 'text', text: 'こんにちは' });
  await waitFor(() => last(events, 'turn.done'));
  const reply = last(events, 'reply.done').message;
  const emotions = events.filter(event => event.type === 'avatar.emotion');
  assert.deepEqual(emotions, [{ type: 'avatar.emotion', turnId: reply.turnId, messageId: reply.id, emotion: 'happy' }]);
  assert.ok(events.indexOf(last(events, 'reply.start')) < events.indexOf(emotions[0]));
  assert.ok(events.indexOf(emotions[0]) < events.findIndex(event => event.type === 'reply.delta'));
  assert.equal(reply.content, 'こんにちは。元気ですか？');
  assert.equal(messages.find(message => message.id === reply.id).content, reply.content);
  assert.equal(events.filter(event => event.type === 'reply.delta').map(event => event.delta).join(''), reply.content);
  assert.equal(syntheses.map(call => call.text).join(''), reply.content);
  assert.equal(events.filter(event => event.type === 'audio.sentence').map(event => event.text).join(''), reply.content);
  assert.equal(JSON.parse(completionPrompts[0][1].content).latestCompanionReply, reply.content);
  assert.ok(!JSON.stringify(events).includes('[[emotion'));
  assert.match(prompts[0][0].content, /回复第一行必须是内部情绪标记/);
  assert.match(prompts[0][0].content, /所有语种、句数、朗读和格式限制只作用于换行后的正文/);
});

test('missing or invalid emotion headers keep replies usable with neutral emotion', async t => {
  const { session, events } = await startSession(t, false);
  for (const response of ['こんにちは。', '[[emotion:unknown]]\nこんにちは。', '[[emotion happy]]\nこんにちは。', `[[emotion:${'x'.repeat(200)}]]\nこんにちは。`]) {
    streamReply = async function* () { for (const character of response) yield character; };
    const completed = events.filter(event => event.type === 'turn.done').length;
    await session.handle({ type: 'text', text: 'こんにちは' });
    await waitFor(() => events.filter(event => event.type === 'turn.done').length > completed);
    const reply = last(events, 'reply.done').message;
    assert.equal(reply.content, 'こんにちは。');
    assert.deepEqual(last(events, 'avatar.emotion'), { type: 'avatar.emotion', turnId: reply.turnId, messageId: reply.id, emotion: 'neutral' });
  }
});

test('control-only replies are recoverable chat failures with no speech or suggestion request', async t => {
  const { session, events } = await startSession(t, true);
  for (const response of ['[[emo', '[[emotion:happy]]', '[[emotion:happy]]\r\n', '[[emotion:unknown]]\n  ', `${' '.repeat(129)}[[emotion:happy]]\nこんにちは。`]) {
    streamReply = async function* () { yield response; };
    const errors = events.filter(event => event.type === 'error').length;
    await session.handle({ type: 'text', text: 'こんにちは' });
    await waitFor(() => events.filter(event => event.type === 'error').length > errors);
    assert.equal(last(events, 'error').source, 'chat');
    assert.equal(last(events, 'error').recoverable, true);
    assert.equal(last(events, 'reply.done').message.content.trim(), '');
    assert.equal(last(events, 'reply.done').message.interrupted, true);
  }
  assert.equal(syntheses.length, 0);
  assert.equal(completionPrompts.length, 0);
  assert.equal(events.some(event => event.type === 'turn.done'), false);
  assert.ok(messages.every(message => !message.content.includes('[[emotion')));
});

test('a cancelled header cannot emit a late emotion or body into a newer turn', async t => {
  const { session, events } = await startSession(t, false);
  const continuation = Promise.withResolvers();
  t.after(() => continuation.resolve());
  streamReply = async function* () {
    yield '[[emotion:';
    await continuation.promise;
    yield 'angry]]\n遅延した返信。';
  };
  await session.handle({ type: 'text', text: '古い質問' });
  const oldTurn = last(events, 'reply.start').turnId;
  await nextTick();
  streamReply = async function* () { yield '[[emotion:happy]]\n新しい返信。'; };
  await session.handle({ type: 'text', text: '新しい質問' });
  await waitFor(() => last(events, 'turn.done'));
  continuation.resolve();
  await nextTick();
  assert.equal(events.filter(event => event.type === 'avatar.emotion').length, 1);
  assert.equal(last(events, 'avatar.emotion').emotion, 'happy');
  assert.equal(events.some(event => event.turnId === oldTurn && (event.type === 'reply.delta' || event.type === 'avatar.emotion')), false);
});

test('voice replies to typed help use Japanese, while Chinese history and translations stay separate', async (t) => {
  const { session, events } = await startSession(t, true);
  const oldMessage = await store.addMessage({ sessionId: session.sessionId, turnId: 'old', role: 'assistant', content: '这句话表示没关系。', delivery: 'text' });
  await store.updateMessage(oldMessage.id, { translation: '独立的中文翻译，不应进入正文' });
  streamReply = async function* () { yield '大丈夫です。神戸に行きます。東京。'; };

  await session.handle({ type: 'text', text: '神戸怎么说？请用中文解释。' });
  await waitFor(() => last(events, 'turn.done'));
  const system = prompts[0][0].content;
  assert.match(system, /^当前回复将直接朗读。正文必须全部使用日本語/);
  assert.match(system, /明确要求“用中文解释”“翻译成中文”/);
  assert.match(system, /仍只用日本語给出简短解释或示例/);
  assert.match(system, /历史消息含辅助语言解释/);
  assert.match(system, /学校は勉強するところです。学校に行きます。/);
  assert.ok(!system.includes('默认用学习语言'));
  assert.ok(!system.includes('辅助语言是中文'));
  assert.ok(!system.includes(japaneseHelpRule));
  assert.ok(prompts[0].some(message => message.content === oldMessage.content));
  assert.ok(!JSON.stringify(prompts[0]).includes('独立的中文翻译'));
  assert.equal(messages.find(message => message.role === 'user').delivery, 'text');
  const reply = last(events, 'reply.done').message;
  assert.equal(reply.delivery, 'voice');
  assert.equal(reply.content, '大丈夫です。神戸に行きます。東京。');
  assert.deepEqual(syntheses.map(({ text, voice, language }) => ({ text, voice, language })), [
    { text: '大丈夫です。', voice: DEFAULT_SETTINGS.voice, language: 'Japanese' },
    { text: '神戸に行きます。', voice: DEFAULT_SETTINGS.voice, language: 'Japanese' },
    { text: '東京。', voice: DEFAULT_SETTINGS.voice, language: 'Japanese' },
  ]);

  // The translation endpoint stores this field independently, including during playback.
  await store.updateMessage(reply.id, { translation: '没关系。我要去神户。东京。' });
  for (const sentence of events.filter(event => event.type === 'audio.end')) {
    await session.handle({ type: 'played', turnId: sentence.turnId, sentenceId: sentence.sentenceId });
  }
  const saved = messages.find(message => message.id === reply.id);
  assert.equal(saved.content, reply.content);
  assert.equal(saved.spokenContent, reply.content);
  assert.equal(saved.translation, '没关系。我要去神户。东京。');
  assert.equal(syntheses.length, 3);
});

test('text chat explains in Japanese even with legacy Chinese support settings and does not synthesize', async (t) => {
  settings.supportLanguage = '中文';
  const { session, events } = await startSession(t, false);
  streamReply = async function* () { yield '「大丈夫です」と言えます。'; };
  await session.handle({ type: 'text', text: '没关系用日语怎么说？' });
  await waitFor(() => last(events, 'turn.done'));
  assert.ok(prompts[0][0].content.includes(japaneseHelpRule));
  assert.ok(prompts[0][0].content.includes('辅助语言是日本語'));
  assert.ok(prompts[0][0].content.includes('即使用户明确要求用中文或其他语言解释，也必须用日语解释'));
  assert.ok(!prompts[0][0].content.includes('辅助语言是中文'));
  assert.ok(prompts[0][0].content.includes('默认用学习语言'));
  assert.ok(!prompts[0][0].content.includes('当前回复将直接朗读'));
  assert.ok(!prompts[0][0].content.includes('语音回复示例'));
  assert.equal(last(events, 'reply.done').message.delivery, 'text');
  assert.equal(syntheses.length, 0);
  assert.equal(events.some(event => event.type === 'audio.sentence'), false);
});

test('sentence metadata precedes synthesis and every audio chunk without waiting for a complete reply', async t => {
  const { session, events } = await startSession(t, true);
  const continuation = Promise.withResolvers();
  t.after(() => continuation.resolve());
  streamReply = async function* () {
    yield '神戸。';
    await continuation.promise;
    yield '東京。';
  };
  synthesizeReply = async ({ text, onAudio }) => {
    const metadata = last(events, 'audio.sentence');
    assert.equal(metadata.text, text, 'metadata must be sent before invoking the synthesizer');
    onAudio('AAA=');
    onAudio('AAA=');
  };
  await session.handle({ type: 'text', text: 'どこですか？' });
  await waitFor(() => last(events, 'audio.end'));
  assert.equal(last(events, 'reply.done'), undefined, 'first sentence is playable before generation ends');
  continuation.resolve();
  await waitFor(() => last(events, 'turn.done'));
  const metadata = events.filter(event => event.type === 'audio.sentence');
  assert.deepEqual(metadata.map(event => event.text), ['神戸。', '東京。']);
  for (const sentence of metadata) {
    const related = events.filter(event => event.turnId === sentence.turnId && event.sentenceId === sentence.sentenceId);
    assert.deepEqual(related.map(event => event.type), ['audio.sentence', 'audio', 'audio', 'audio.end']);
    assert.equal(related.at(-1).text, sentence.text);
  }
});

test('all sentences retain the turn language and voice; the next turn uses updated settings', async (t) => {
  const { session, events } = await startSession(t, true);
  const firstSentence = Promise.withResolvers();
  t.after(() => firstSentence.resolve());
  synthesizeReply = async ({ onAudio }) => {
    if (syntheses.length === 1) await firstSentence.promise;
    onAudio('AAA=');
  };
  streamReply = async function* () { yield '神戸。東京。'; };
  await session.handle({ type: 'text', text: 'どこですか？' });
  await waitFor(() => syntheses.length === 1);
  settings.learningLanguage = '英語';
  settings.voice = 'Serena';
  firstSentence.resolve();
  await waitFor(() => last(events, 'turn.done'));
  assert.deepEqual(syntheses.map(({ voice, language }) => ({ voice, language })), [
    { voice: DEFAULT_SETTINGS.voice, language: 'Japanese' },
    { voice: DEFAULT_SETTINGS.voice, language: 'Japanese' },
  ]);
  assert.match(prompts[0][0].content, /正文必须全部使用日本語/);

  streamReply = async function* () { yield 'Hello!'; };
  await session.handle({ type: 'text', text: 'Hello' });
  await waitFor(() => events.filter(event => event.type === 'turn.done').length === 2);
  assert.match(prompts[1][0].content, /正文必须全部使用英語/);
  assert.ok(!prompts[1][0].content.includes('学校は勉強するところです'));
  assert.equal(syntheses[2].language, 'English');
  assert.equal(syntheses[2].voice, 'Serena');
});

test('enabling voice mid-reply leaves the current text turn intact and applies to the next turn', async (t) => {
  const { session, events } = await startSession(t, false);
  const continuation = Promise.withResolvers();
  t.after(() => continuation.resolve());
  streamReply = async function* () {
    yield 'こう言えます：';
    await continuation.promise;
    yield '「大丈夫です」。';
  };
  await session.handle({ type: 'text', text: '请解释' });
  await waitFor(() => last(events, 'reply.delta'));
  await session.handle({ type: 'start', sessionId: session.sessionId, voice: true });
  continuation.resolve();
  await waitFor(() => last(events, 'turn.done'));
  assert.equal(last(events, 'reply.done').message.delivery, 'text');
  assert.ok(prompts[0][0].content.includes(japaneseHelpRule));
  assert.equal(syntheses.length, 0);

  streamReply = async function* () { yield '大丈夫です。'; };
  await session.handle({ type: 'text', text: '再说一次' });
  await waitFor(() => events.filter(event => event.type === 'turn.done').length === 2);
  assert.match(prompts[1][0].content, /正文必须全部使用日本語/);
  assert.equal(last(events, 'reply.done').message.delivery, 'voice');
  assert.equal(syntheses[0].language, 'Japanese');
});

test('ASR fallback stops speech without changing the in-flight reply language or delivery', async (t) => {
  const { session, events } = await startSession(t, true);
  const continuation = Promise.withResolvers();
  t.after(() => continuation.resolve());
  streamReply = async function* () {
    yield '神戸。';
    await continuation.promise;
    yield '東京。';
  };
  await session.handle({ type: 'text', text: 'こんにちは' });
  await waitFor(() => last(events, 'audio.end'));
  asrCallbacks.onError(new Error('ASR disconnected'));
  assert.equal(asrInstances.length, 1, 'an established audio stream is not silently restarted');
  continuation.resolve();
  await waitFor(() => last(events, 'turn.done'));
  assert.equal(last(events, 'reply.done').message.delivery, 'voice');
  assert.equal(last(events, 'reply.done').message.content, '神戸。東京。');
  assert.match(prompts[0][0].content, /正文必须全部使用日本語/);
  assert.equal(syntheses.length, 1);
  assert.ok(syntheses[0].signal.aborted);

  streamReply = async function* () { yield '「こんにちは」と言えます。'; };
  await session.handle({ type: 'text', text: '请解释' });
  await waitFor(() => events.filter(event => event.type === 'turn.done').length === 2);
  assert.equal(last(events, 'reply.done').message.delivery, 'text');
  assert.ok(prompts[1][0].content.includes(japaneseHelpRule));
  assert.equal(syntheses.length, 1);
});

test('a transient ASR startup failure retries with a new stream and ignores late old callbacks', async t => {
  let calls = 0;
  connectAsrReply = async () => {
    if (++calls === 1) throw new ProviderError('temporary connection failure', { errorCode: 'asrUnavailable' });
  };
  const { session, events } = await startSession(t, true);
  assert.equal(asrInstances.length, 2);
  assert.equal(asrInstances[0].closed, true);
  assert.notEqual(asrInstances[0].streamId, asrInstances[1].streamId);
  assert.equal(last(events, 'session.started').voice, true);
  assert.equal(last(events, 'session.started').asrStreamId, asrInstances[1].streamId);
  assert.equal(events.filter(event => event.type === 'error').length, 0);
  asrInstances[0].callbacks.onError(new ProviderError('late old error', { errorCode: 'asrUnavailable' }));
  assert.equal(events.filter(event => event.type === 'error').length, 0);
  assert.equal(session.sessionId, lease.sessionId);
});

test('ASR startup retries share one twelve-second connection budget', async t => {
  t.mock.timers.enable({ apis: ['Date'], now: 1_000_000 });
  const budgets = [];
  connectAsrReply = async (asr, silenceMs, timeoutMs) => {
    budgets.push(timeoutMs);
    if (budgets.length === 1) {
      t.mock.timers.tick(5000);
      throw new ProviderError('temporary connection failure', { errorCode: 'asrUnavailable' });
    }
  };
  const { events } = await startSession(t, true);
  assert.deepEqual(budgets, [12_000, 7000]);
  assert.equal(last(events, 'session.started').voice, true);
});

test('ASR connection failure near its deadline does not start another handshake', async t => {
  t.mock.timers.enable({ apis: ['Date'], now: 1_000_000 });
  let calls = 0;
  connectAsrReply = async () => {
    calls++;
    t.mock.timers.tick(11_500);
    throw new ProviderError('temporary connection failure', { errorCode: 'asrUnavailable' });
  };
  const { events } = await startSession(t, true);
  assert.equal(calls, 1);
  assert.equal(last(events, 'session.started').voice, false);
});

test('ASR authentication, quota, timeout and cancelled starts fall back without retrying', async t => {
  for (const errorCode of ['authenticationFailed', 'modelAccessDenied', 'quotaExceeded', 'asrTimeout', 'asrCancelled']) {
    let calls = 0;
    connectAsrReply = async () => { calls++; throw new ProviderError('startup failed', { errorCode }); };
    const { session, events } = await startSession(t, true);
    assert.equal(calls, 1, errorCode);
    assert.equal(last(events, 'session.started').voice, false, errorCode);
    assert.equal(last(events, 'error').errorCode, errorCode);
    await session.dispose();
  }
});

test('repeated ASR connection failures retry once and keep the same text session usable', async t => {
  let calls = 0;
  connectAsrReply = async () => { calls++; throw new ProviderError('startup failed', { errorCode: 'asrUnavailable' }); };
  const { session, events } = await startSession(t, true);
  assert.equal(calls, 2);
  assert.equal(last(events, 'session.started').voice, false);
  assert.equal(events.filter(event => event.type === 'error').length, 1);
  assert.equal(last(events, 'error').source, 'asr');
  await session.handle({ type: 'text', text: '文字で続けます' });
  await waitFor(() => last(events, 'turn.done'));
  assert.equal(messages.at(-1).delivery, 'text');
  assert.equal(session.sessionId, lease.sessionId);
});

test('disposing an ASR start prevents a late unavailable failure from creating another stream', async t => {
  let rejectConnection;
  connectAsrReply = () => new Promise((resolve, reject) => { rejectConnection = reject; });
  const session = new RealtimeSession({ readyState: 1, bufferedAmount: 0, send() {}, close() {} }, store);
  t.after(() => session.dispose());
  const starting = session.handle({ type: 'start', voice: true });
  await waitFor(() => rejectConnection);
  await session.dispose();
  rejectConnection(new ProviderError('late connection failure', { errorCode: 'asrUnavailable' }));
  await starting;
  assert.equal(asrInstances.length, 1);
  assert.equal(lease, null);
});

test('cancelling a voice turn aborts active synthesis and skips queued sentences', async (t) => {
  const { session, events } = await startSession(t, true);
  synthesizeReply = ({ signal }) => new Promise((resolve, reject) => {
    signal.addEventListener('abort', () => reject(signal.reason), { once: true });
  });
  streamReply = async function* () { yield '神戸。東京。'; };
  await session.handle({ type: 'text', text: 'こんにちは' });
  await waitFor(() => syntheses.length === 1);
  const turnId = last(events, 'reply.start').turnId;
  await session.handle({ type: 'cancel', turnId });
  syntheses[0].onAudio('late audio');
  await nextTick();
  assert.ok(syntheses[0].signal.aborted);
  assert.equal(syntheses.length, 1);
  assert.equal(events.filter(event => event.type === 'audio').length, 0);
  assert.deepEqual(events.filter(event => event.type === 'audio.sentence').map(event => event.text), ['神戸。']);
  assert.equal(events.filter(event => event.type === 'turn.done').length, 0);
  assert.equal(last(events, 'turn.cancelled').turnId, turnId);
});

test('suggestions persist two Chinese translations while reviews keep Japanese explanations', async (t) => {
  settings.supportLanguage = '中文';
  const suggestions = [
    { text: '好きです。', reading: 'すきです。', meaning: '我喜欢。' },
    { text: '苦手です。', reading: 'にがてです。', meaning: '我不太喜欢。' },
  ];
  const review = {
    topic: '好きな食べ物について話しました。',
    expressions: [
      { text: '好きです。', meaning: '好みを伝える表現です。' },
      { text: '苦手です。', meaning: 'あまり好きではないと伝えます。' },
      { text: 'まだわかりません。', meaning: 'まだ判断できないと伝えます。' },
    ],
    improvement: '好きな理由を一言添えてみましょう。',
    memorySuggestions: [],
  };
  completeReply = prompt => JSON.stringify(prompt[0].content.includes('回复选项生成器') ? { suggestions } : review);
  const { session, events } = await startSession(t, false);
  const sessionId = session.sessionId;
  await session.handle({ type: 'text', text: 'りんごが好きです。' });
  await waitFor(() => last(events, 'reply.suggestions')?.status === 'ready');
  const suggestionPrompt = completionPrompts[0][0].content;
  assert.match(suggestionPrompt, /meaning 始终使用简体中文/);
  assert.match(suggestionPrompt, /suggestions 必须恰好两项/);
  const assistant = messages.find(message => message.role === 'assistant');
  assert.equal(assistant.replySuggestionsLanguage, 'zh-CN');
  assert.deepEqual(assistant.replySuggestions, suggestions);
  assert.equal(last(events, 'reply.suggestions').meaningLanguage, 'zh-CN');
  assert.deepEqual(last(events, 'reply.suggestions').suggestions, suggestions);

  await session.handle({ type: 'end' });
  await waitFor(() => sessions.get(sessionId).review);
  assert.match(completionPrompts[1][0].content, /topic、meaning、improvement 和 memorySuggestions 始终使用日语/);
  assert.deepEqual(sessions.get(sessionId).review, { language: 'ja', ...review });
});

const users = () => messages.filter(message => message.role === 'user');
const asrSegment = (segmentId, beginMs = 0, endMs = 400) => ({ streamId: asrInstances.at(-1).streamId, segmentId, beginMs, endMs });
async function upload(session, milliseconds = 2000) {
  for (let offset = 0; offset < milliseconds; offset += 500) await session.handle({ type: 'audio', streamId: asrInstances.at(-1).streamId, audio: Buffer.alloc(Math.min(500, milliseconds - offset) * 32).toString('base64') });
}
const accept = (session, segment) => session.handle({ type: 'speech.accept', streamId: segment.streamId, segmentId: segment.segmentId });

test('cloud final noise is never saved or allowed to interrupt without local acceptance', async t => {
  const { session, events } = await startSession(t, true);
  await session.handle({ type: 'text', text: '話してください' });
  await waitFor(() => last(events, 'audio.end'));
  await upload(session);
  const segment = asrSegment(1);
  asrCallbacks.onSpeechStarted({ ...segment, endMs: null });
  asrCallbacks.onTranscript('是。', true, segment);
  await nextTick();
  await nextTick();
  assert.deepEqual(users().map(message => message.content), ['話してください']);
  assert.equal(events.filter(event => event.type === 'turn.cancelled').length, 0);
  assert.equal(last(events, 'transcript').segmentId, 1);
});

test('known segments accept before or after final exactly once and retain short Japanese responses', async t => {
  const { session, events } = await startSession(t, true);
  assert.equal(last(events, 'session.started').asrStreamId, asrInstances.at(-1).streamId);
  await upload(session);
  const first = asrSegment(1);
  asrCallbacks.onTranscript('はい', false, { ...first, endMs: null });
  await accept(session, first);
  assert.equal(users().length, 0);
  asrCallbacks.onTranscript('はい', true, first);
  await nextTick();
  await accept(session, first);
  asrCallbacks.onTranscript('はい', true, first);
  await nextTick();
  assert.deepEqual(users().map(message => message.content), ['はい']);
  await upload(session);
  const second = asrSegment(2, 2100, 2500);
  asrCallbacks.onTranscript('うん', true, second);
  await nextTick();
  assert.equal(users().length, 1);
  await accept(session, second);
  assert.deepEqual(users().map(message => message.content), ['はい', 'うん']);
});

test('unknown, stale connection, punctuation, and invalid time candidates fail closed', async t => {
  const { session } = await startSession(t, true);
  await upload(session);
  const segment = asrSegment(1);
  await accept(session, segment);
  asrCallbacks.onTranscript('はい', true, segment);
  await nextTick();
  assert.equal(users().length, 0, 'an unknown acceptance must not be remembered');
  await accept(session, { ...segment, streamId: randomUUID() });
  assert.equal(users().length, 0);
  for (const [id, text] of [[2, ' 。！？ … '], [3, '   ']]) {
    const invalid = asrSegment(id);
    asrCallbacks.onTranscript(text, true, invalid);
  await nextTick();
    await accept(session, invalid);
  }
  for (const invalid of [asrSegment(4, -1, 100), asrSegment(5, 0, 2500), asrSegment(6, 300, 100), { ...asrSegment(7), streamId: randomUUID() }]) {
    asrCallbacks.onTranscript('はい', true, invalid);
  await nextTick();
    await accept(session, invalid);
  }
  assert.equal(users().length, 0);
});

test('reset retires pending and unseen old audio while clamping its cutoff to uploaded audio', async t => {
  const { session } = await startSession(t, true);
  await upload(session);
  const first = asrSegment(1);
  asrCallbacks.onTranscript('はい', false, { ...first, endMs: null });
  await accept(session, first);
  await session.handle({ type: 'speech.reset', streamId: first.streamId, beforeMs: 999999 });
  asrCallbacks.onTranscript('はい', true, first);
  await nextTick();
  const delayed = asrSegment(2, 1000, 1500);
  asrCallbacks.onTranscript('遅い結果', true, delayed);
  await nextTick();
  await accept(session, delayed);
  assert.equal(users().length, 0);
  await upload(session);
  const next = asrSegment(3, 2000, 2400);
  asrCallbacks.onTranscript('次です', true, next);
  await nextTick();
  await accept(session, next);
  assert.deepEqual(users().map(message => message.content), ['次です']);
});

test('targeted cancellation preserves the interrupting candidate but typed and generic cancel clear candidates', async t => {
  const { session, events } = await startSession(t, true);
  await session.handle({ type: 'text', text: '最初です' });
  await upload(session);
  const first = asrSegment(1);
  asrCallbacks.onTranscript('待ってください', false, { ...first, endMs: null });
  await accept(session, first);
  await session.handle({ type: 'cancel', turnId: last(events, 'reply.start').turnId });
  asrCallbacks.onTranscript('待ってください', true, first);
  await nextTick();
  assert.deepEqual(users().map(message => message.content), ['最初です', '待ってください']);
  await upload(session);
  const second = asrSegment(2, 2200, 2600);
  asrCallbacks.onTranscript('古い', false, { ...second, endMs: null });
  await accept(session, second);
  await session.handle({ type: 'text', text: '文字です' });
  asrCallbacks.onTranscript('古い', true, second);
  await nextTick();
  await upload(session);
  const third = asrSegment(3, 4200, 4600);
  asrCallbacks.onTranscript('無効', false, { ...third, endMs: null });
  await accept(session, third);
  await session.handle({ type: 'cancel' });
  asrCallbacks.onTranscript('無効', true, third);
  await nextTick();
  assert.deepEqual(users().map(message => message.content), ['最初です', '待ってください', '文字です']);
});

test('voice stop and reconnection reject old callbacks, stream audio and pending acceptance', async t => {
  const { session } = await startSession(t, true);
  await upload(session);
  const previous = asrInstances.at(-1);
  const old = asrSegment(1);
  previous.callbacks.onTranscript('古い', false, { ...old, endMs: null });
  await accept(session, old);
  await session.handle({ type: 'voice.stop' });
  await session.handle({ type: 'start', voice: true, sessionId: session.sessionId });
  previous.callbacks.onTranscript('古い', true, old);
  await session.handle({ type: 'audio', streamId: previous.streamId, audio: Buffer.alloc(3200).toString('base64') });
  assert.equal(asrInstances.at(-1).time, 0);
  await accept(session, old);
  assert.equal(users().length, 0);
  await upload(session);
  const current = asrSegment(1);
  asrCallbacks.onTranscript('今です', true, current);
  await nextTick();
  await accept(session, current);
  assert.deepEqual(users().map(message => message.content), ['今です']);
});

test('end drains only already confirmed tail speech and never launches a reply', async t => {
  const { session, events } = await startSession(t, true);
  await upload(session);
  const accepted = asrSegment(1);
  const unaccepted = asrSegment(2, 500, 900);
  asrCallbacks.onTranscript('また', false, { ...accepted, endMs: null });
  await accept(session, accepted);
  asrCallbacks.onTranscript('雑音', false, { ...unaccepted, endMs: null });
  finishAsr = async asr => {
    await accept(session, unaccepted);
    asr.callbacks.onTranscript('またね', true, accepted);
    asr.callbacks.onTranscript('雑音', true, unaccepted);
  };
  await session.handle({ type: 'end' });
  assert.deepEqual(users().map(message => message.content), ['またね']);
  assert.equal(events.filter(event => event.type === 'reply.start').length, 0);
});

test('ASR failure and socket disposal discard even confirmed pending transcripts', async t => {
  const { session } = await startSession(t, true);
  await upload(session);
  const segment = asrSegment(1);
  asrCallbacks.onTranscript('古い', false, { ...segment, endMs: null });
  await accept(session, segment);
  const previous = asrCallbacks;
  previous.onError(new Error('ASR unavailable'));
  previous.onTranscript('古い', true, segment);
  await session.handle({ type: 'start', voice: true, sessionId: session.sessionId });
  await upload(session);
  const next = asrSegment(1);
  asrCallbacks.onTranscript('切断', false, { ...next, endMs: null });
  await accept(session, next);
  const current = asrCallbacks;
  await session.dispose();
  current.onTranscript('切断', true, next);
  assert.equal(users().length, 0);
});

test('pending speech storage remains bounded and evicted segments cannot revive', async t => {
  const { session } = await startSession(t, true);
  await upload(session);
  for (let id = 1; id <= 40; id++) asrCallbacks.onTranscript('候補', false, asrSegment(id, 0, null));
  const evicted = asrSegment(1);
  asrCallbacks.onTranscript('古い', true, evicted);
  await nextTick();
  await accept(session, evicted);
  assert.equal(users().length, 0);
  const current = asrSegment(40);
  asrCallbacks.onTranscript('最後', true, current);
  await nextTick();
  await accept(session, current);
  assert.deepEqual(users().map(message => message.content), ['最後']);
});

test('Fun-ASR onset timing may refine from zero to the actual final utterance start', async t => {
  const { session, events } = await startSession(t, true);
  await upload(session);
  const onset = asrSegment(1, 0, null);
  asrCallbacks.onSpeechStarted(onset);
  asrCallbacks.onTranscript('はい', false, onset);
  await accept(session, onset);
  const final = asrSegment(1, 170, 920);
  asrCallbacks.onTranscript('はい。', true, final);
  await nextTick();
  assert.deepEqual(users().map(message => message.content), ['はい。']);
  assert.deepEqual(last(events, 'transcript'), { type: 'transcript', text: 'はい。', final: true, ...final });
});

test('refined final timing remains valid during the accepted tail drain', async t => {
  const { session } = await startSession(t, true);
  await upload(session);
  const onset = asrSegment(1, 0, null);
  asrCallbacks.onTranscript('また', false, onset);
  await accept(session, onset);
  finishAsr = async asr => asr.callbacks.onTranscript('またね', true, asrSegment(1, 170, 920));
  await session.handle({ type: 'end' });
  assert.deepEqual(users().map(message => message.content), ['またね']);
});

test('timestamp refinements cannot move confirmed speech across the reset boundary or beyond uploaded audio', async t => {
  const { session } = await startSession(t, true);
  await upload(session);
  await session.handle({ type: 'speech.reset', streamId: asrInstances.at(-1).streamId, beforeMs: 500 });
  const onset = asrSegment(1, 600, null);
  asrCallbacks.onTranscript('はい', false, onset);
  await accept(session, onset);
  for (const invalid of [asrSegment(1, 170, 920), asrSegment(1, 600, 2500)]) asrCallbacks.onTranscript('はい。', true, invalid);
  assert.equal(users().length, 0);
  asrCallbacks.onTranscript('はい。', true, asrSegment(1, 650, 920));
  await nextTick();
  assert.deepEqual(users().map(message => message.content), ['はい。']);
});


test('session forwards safe provider descriptors and sanitizes unknown failures', async t => {
  const { session, events } = await startSession(t, false);
  streamReply = async function* () {
    yield '';
    throw new ProviderError('safe provider fallback', { errorCode: 'quotaExceeded', errorParams: { retryAfter: 10 } });
  };
  await session.handle({ type: 'text', text: 'こんにちは' });
  await waitFor(() => last(events, 'error'));
  assert.deepEqual(last(events, 'error'), {
    type: 'error', source: 'chat', message: 'safe provider fallback', errorCode: 'quotaExceeded', errorParams: { retryAfter: 10 }, recoverable: true,
  });
  events.length = 0;
  streamReply = async function* () { yield ''; throw Object.assign(new Error('secret provider token'), { errorCode: 'fakeCode' }); };
  await session.handle({ type: 'text', text: 'もう一度' });
  await waitFor(() => last(events, 'error'));
  assert.equal(last(events, 'error').errorCode, 'replyFailed');
  assert.doesNotMatch(JSON.stringify(last(events, 'error')), /secret provider token|fakeCode/);
});

test('socket loss suspends and resumes the same session without a review or duplicate turn', async t => {
  const { session: first, events } = await startSession(t, false);
  await first.handle({ type: 'text', text: '保存してください' });
  await waitFor(() => last(events, 'turn.done'));
  const id = first.sessionId;
  const before = copy(messages);
  await first.dispose();
  assert.equal(sessions.get(id).endedAt, null);
  assert.equal(sessions.get(id).review, null);
  assert.equal(completionPrompts.some(prompt => prompt[0].content.includes('聊天回顾')), false);
  const resumedEvents = [];
  const resumed = new RealtimeSession({ readyState: 1, bufferedAmount: 0, send: raw => resumedEvents.push(JSON.parse(raw)), close() {} }, store);
  t.after(() => resumed.dispose());
  await resumed.handle({ type: 'start', sessionId: id, resume: true, voice: false });
  assert.equal(resumed.sessionId, id);
  const ack = last(resumedEvents, 'session.started');
  assert.equal(ack.resumed, true);
  assert.deepEqual(ack.messages, before);
  assert.deepEqual(messages, before);
  assert.equal(sessions.size, 1);
  assert.equal(resumedEvents.some(event => event.type === 'reply.start'), false);
  await resumed.handle({ type: 'end' });
  assert.ok(sessions.get(id).endedAt);
  await waitFor(() => completionPrompts.some(prompt => prompt[0].content.includes('聊天回顾')));
});

test('socket disposal stops renewal but releases its lease only after saving the interrupted reply', async t => {
  t.mock.timers.enable({ apis: ['setTimeout', 'Date'], now: 1_000_000 });
  const { session: first } = await startSession(t, false);
  let finishGeneration;
  streamReply = async function* () { yield '保存する途中の返信'; await new Promise(resolve => { finishGeneration = resolve; }); };
  await first.handle({ type: 'text', text: '話してください' });
  await waitFor(() => finishGeneration);
  const id = first.sessionId;
  const updateMessage = store.updateMessage.bind(store);
  let finishPersistence;
  t.mock.method(store, 'updateMessage', async (...args) => {
    await new Promise(resolve => { finishPersistence = resolve; });
    return updateMessage(...args);
  }, { times: 1 });
  const renewal = t.mock.method(store, 'renewSessionLease');
  t.after(() => { finishPersistence?.(); finishGeneration?.(); });
  const disposing = first.dispose();
  await waitFor(() => finishPersistence);
  t.mock.timers.tick(10_000);
  await nextTick();
  assert.equal(renewal.mock.callCount(), 0);
  assert.equal(await store.getActiveSessionId(), id);
  const events = [];
  const second = new RealtimeSession({ readyState: 1, bufferedAmount: 0, send: raw => events.push(JSON.parse(raw)), close() {} }, store);
  t.after(() => second.dispose());
  await second.handle({ type: 'start', sessionId: id, resume: true, voice: false });
  assert.equal(last(events, 'error').errorCode, 'sessionOtherPage');
  finishPersistence();
  await disposing;
  assert.equal(lease, null);
  assert.equal(messages.at(-1).content, '保存する途中の返信');
  assert.equal(messages.at(-1).interrupted, true);
  await second.handle({ type: 'start', sessionId: id, resume: true, voice: false });
  assert.equal(second.sessionId, id);
  assert.equal(last(events, 'session.started').messages.at(-1).content, '保存する途中の返信');
  finishGeneration();
});

test('an expired owner cannot mutate messages, renew, or release its replacement lease', async t => {
  const { session: first, events } = await startSession(t, false);
  let finish;
  streamReply = async function* () { yield '途中'; await new Promise(resolve => { finish = resolve; }); yield '古い返信'; };
  await first.handle({ type: 'text', text: '初めて' });
  await waitFor(() => finish);
  const id = first.sessionId;
  const oldLease = { ...lease };
  lease.expiresAt = Date.now() - 1;
  const resumedEvents = [];
  const resumed = new RealtimeSession({ readyState: 1, bufferedAmount: 0, send: raw => resumedEvents.push(JSON.parse(raw)), close() {} }, store);
  t.after(() => resumed.dispose());
  await resumed.handle({ type: 'start', sessionId: id, resume: true, voice: false });
  const replacementOwner = lease.ownerId;
  assert.notEqual(replacementOwner, oldLease.ownerId);
  const persisted = copy(messages);
  finish();
  await first.dispose();
  await nextTick();
  assert.equal(lease.ownerId, replacementOwner);
  assert.deepEqual(messages, persisted);
  assert.equal(await store.renewSessionLease(id, oldLease.ownerId, 30_000), false);
  assert.equal(last(events, 'reply.delta').delta, '途中');
  assert.equal(last(resumedEvents, 'session.started').messages.at(-1).interrupted, true);
});

test('resume cannot reopen an explicitly ended conversation or bypass a live owner', async t => {
  const { session: first } = await startSession(t, false);
  const id = first.sessionId;
  const events = [];
  const second = new RealtimeSession({ readyState: 1, bufferedAmount: 0, send: raw => events.push(JSON.parse(raw)), close() {} }, store);
  t.after(() => second.dispose());
  await second.handle({ type: 'start', sessionId: id, resume: true, voice: false });
  assert.equal(last(events, 'error').errorCode, 'sessionOtherPage');
  assert.equal(second.sessionId, null);
  await second.handle({ type: 'start', voice: false });
  assert.equal(sessions.size, 1, 'a refused new conversation must not create empty history');
  await first.handle({ type: 'end' });
  const endedAt = sessions.get(id).endedAt;
  await second.handle({ type: 'start', sessionId: id, resume: true, voice: false });
  assert.equal(last(events, 'error').errorCode, 'sessionNotFound');
  assert.equal(sessions.get(id).endedAt, endedAt);
});

test('cloud rotation persists an interrupted turn before the function connection limit', async t => {
  runtimeConfig.cloud = true;
  t.mock.timers.enable({ apis: ['setTimeout', 'Date'], now: 1_000_000 });
  const events = [], closes = [];
  const session = new RealtimeSession({ readyState: 1, bufferedAmount: 0, send: raw => events.push(JSON.parse(raw)), close: (...args) => closes.push(args) }, store);
  t.after(() => session.dispose());
  await session.handle({ type: 'start', voice: false });
  const id = session.sessionId;
  let finish;
  streamReply = async function* () { yield '保存する途中の返信'; await new Promise(resolve => { finish = resolve; }); yield '遅延'; };
  await session.handle({ type: 'text', text: '話してください' });
  await waitFor(() => finish);
  for (let step = 0; step < 24; step++) { t.mock.timers.tick(10_000); await nextTick(); }
  assert.equal(closes.length, 0, 'an active turn receives a short drain window');
  for (let step = 0; step < 6; step++) { t.mock.timers.tick(5000); await nextTick(); }
  assert.deepEqual(closes, [[1012, 'Session connection rotation']]);
  assert.equal(sessions.get(id).endedAt, null);
  assert.equal(sessions.get(id).review, null);
  assert.equal(lease, null);
  assert.equal(messages.at(-1).content, '保存する途中の返信');
  assert.equal(messages.at(-1).interrupted, true);
  finish();
  await nextTick();
  assert.equal(messages.at(-1).content, '保存する途中の返信');
});


test('a failed explicit end releases ownership and closes instead of wedging the conversation', async t => {
  const events = [], closes = [];
  const session = new RealtimeSession({ readyState: 1, bufferedAmount: 0, send: raw => events.push(JSON.parse(raw)), close: (...args) => closes.push(args) }, store);
  t.after(() => session.dispose());
  await session.handle({ type: 'start', voice: false });
  const id = session.sessionId;
  t.mock.method(store, 'endSession', async () => { throw new Error('private database outage details'); }, { times: 1 });
  await session.handle({ type: 'end' });
  assert.equal(session.sessionId, null);
  assert.equal(lease, null);
  assert.equal(sessions.get(id).endedAt, null);
  assert.deepEqual(closes, [[1012, 'Session end could not be saved']]);
  assert.equal(last(events, 'error').errorCode, 'sessionFailure');
  assert.equal(JSON.stringify(events).includes('private database'), false);
  const next = new RealtimeSession({ readyState: 1, bufferedAmount: 0, send() {}, close() {} }, store);
  t.after(() => next.dispose());
  await next.handle({ type: 'start', sessionId: id, resume: true, voice: false });
  assert.equal(next.sessionId, id);
  await next.handle({ type: 'end' });
  assert.ok(sessions.get(id).endedAt);
});

test('an old renewal rejection cannot dispose a new session on the same socket', async t => {
  t.mock.timers.enable({ apis: ['setTimeout'] });
  const closes = [];
  const session = new RealtimeSession({ readyState: 1, bufferedAmount: 0, send() {}, close: (...args) => closes.push(args) }, store);
  t.after(() => session.dispose());
  let rejectRenewal;
  t.mock.method(store, 'renewSessionLease', () => new Promise((resolve, reject) => { rejectRenewal = reject; }), { times: 1 });
  await session.handle({ type: 'start', voice: false });
  const oldOwner = lease.ownerId;
  t.mock.timers.tick(10_000);
  assert.ok(rejectRenewal);
  await session.handle({ type: 'end' });
  await session.handle({ type: 'start', voice: false });
  const nextId = session.sessionId;
  assert.notEqual(lease.ownerId, oldOwner);
  rejectRenewal(new Error('late database timeout'));
  await nextTick();
  assert.deepEqual(closes, []);
  assert.equal(session.sessionId, nextId);
  assert.equal(lease.sessionId, nextId);
});

test('browser-scoped sessions run concurrently while one browser still has a single lease', async t => {
  const firstBrowser = browserStore('first');
  const secondBrowser = browserStore('second');
  const first = await startSession(t, false, firstBrowser.store);
  const second = await startSession(t, false, secondBrowser.store);
  assert.notEqual(first.session.sessionId, second.session.sessionId);
  assert.equal(await getActiveSessionId(firstBrowser.store), first.session.sessionId);
  assert.equal(await getActiveSessionId(secondBrowser.store), second.session.sessionId);

  const refusedEvents = [];
  const sameBrowser = new RealtimeSession({ readyState: 1, bufferedAmount: 0, send: raw => refusedEvents.push(JSON.parse(raw)), close() {} }, firstBrowser.store);
  t.after(() => sameBrowser.dispose());
  await sameBrowser.handle({ type: 'start', voice: false });
  assert.equal(last(refusedEvents, 'error').errorCode, 'sessionOtherPage');
  assert.equal(firstBrowser.data.sessions.size, 1);

  const originalId = first.session.sessionId;
  await first.session.dispose();
  assert.equal(await getActiveSessionId(firstBrowser.store), null);
  assert.equal(await getActiveSessionId(secondBrowser.store), second.session.sessionId);
  await sameBrowser.handle({ type: 'start', sessionId: originalId, resume: true, voice: false });
  assert.equal(sameBrowser.sessionId, originalId);
  assert.equal(secondBrowser.data.sessions.size, 1);
});

test('another browser cannot resume or reopen a known foreign session ID', async t => {
  const firstBrowser = browserStore('first');
  const secondBrowser = browserStore('second');
  const first = await startSession(t, false, firstBrowser.store);
  const id = first.session.sessionId;
  await first.session.dispose();
  const events = [];
  const foreign = new RealtimeSession({ readyState: 1, bufferedAmount: 0, send: raw => events.push(JSON.parse(raw)), close() {} }, secondBrowser.store);
  t.after(() => foreign.dispose());
  for (const resume of [true, false]) {
    await foreign.handle({ type: 'start', sessionId: id, resume, voice: false });
    assert.equal(last(events, 'error').errorCode, 'sessionNotFound');
    assert.equal(foreign.sessionId, null);
  }
  assert.equal(secondBrowser.data.sessions.size, 0);
  assert.equal(secondBrowser.data.lease, null);
  assert.equal(firstBrowser.data.sessions.get(id).endedAt, null);
});

test('prompts, settings, history and asynchronous reviews stay inside the injected browser store', async t => {
  const firstBrowser = browserStore('first');
  const secondBrowser = browserStore('second');
  const first = await startSession(t, false, firstBrowser.store);
  const second = await startSession(t, false, secondBrowser.store);
  for (const [browser, current, label] of [[firstBrowser, first, 'first'], [secondBrowser, second, 'second']]) {
    await browser.store.addMessage({ sessionId: current.session.sessionId, turnId: randomUUID(), role: 'user', content: `${label}-history`, delivery: 'text' });
    await current.session.handle({ type: 'text', text: `${label}-question` });
    await waitFor(() => last(current.events, 'turn.done'));
    const prompt = JSON.stringify(prompts.at(-1));
    for (const part of ['character', 'persona', 'memory', 'review', 'history', 'question']) assert.ok(prompt.includes(`${label}-${part}`));
    assert.ok(!prompt.includes(`${label === 'first' ? 'second' : 'first'}-`));
    assert.equal(browser.data.messages.filter(message => message.role === 'assistant').length, 1);
  }
  const review = {
    topic: '最初の会話', improvement: '次回も話しましょう。', memorySuggestions: [],
    expressions: [1, 2, 3].map(index => ({ text: `表現${index}`, meaning: `意味${index}` })),
  };
  completeReply = () => JSON.stringify(review);
  const firstId = first.session.sessionId;
  const secondId = second.session.sessionId;
  await first.session.handle({ type: 'end' });
  await waitFor(() => firstBrowser.data.sessions.get(firstId).review);
  const reviewPrompt = completionPrompts.findLast(prompt => prompt[0].content.includes('聊天回顾'));
  assert.ok(JSON.stringify(reviewPrompt).includes('first-question'));
  assert.ok(!JSON.stringify(reviewPrompt).includes('second-'));
  assert.deepEqual(firstBrowser.data.sessions.get(firstId).review, { language: 'ja', ...review });
  assert.equal(secondBrowser.data.sessions.get(secondId).review, null);
  assert.equal(secondBrowser.data.sessions.get(secondId).endedAt, null);
  assert.equal(await getActiveSessionId(secondBrowser.store), secondId);
  assert.equal(messages.length, 0, 'the old shared mock must remain unused');
  assert.equal(sessions.size, 0);
});

test('unstarted and refused-start sockets expire without extending the idle deadline', async t => {
  for (const failedStart of [false, true]) await t.test(`failedStart=${failedStart}`, async t => {
    t.mock.timers.enable({ apis: ['setTimeout'] });
    const closes = [];
    const session = new RealtimeSession({ readyState: 1, bufferedAmount: 0, send() {}, close: (...args) => closes.push(args) }, store);
    t.after(() => session.dispose());
    t.mock.timers.tick(10_000);
    if (failedStart) await session.handle({ type: 'start', sessionId: 'foreign-or-missing', resume: true, voice: false });
    t.mock.timers.tick(4999);
    assert.deepEqual(closes, []);
    t.mock.timers.tick(1);
    await nextTick();
    assert.deepEqual(closes, [[1008, 'Session idle timeout']]);
    assert.equal(lease, null);
    await session.handle({ type: 'start', voice: false });
    assert.equal(session.sessionId, null);
  });
});

test('a started session clears the idle deadline and ending re-arms it', async t => {
  t.mock.timers.enable({ apis: ['setTimeout'] });
  const closes = [];
  const session = new RealtimeSession({ readyState: 1, bufferedAmount: 0, send() {}, close: (...args) => closes.push(args) }, store);
  t.after(() => session.dispose());
  await session.handle({ type: 'start', voice: false });
  t.mock.timers.tick(15_000);
  await nextTick();
  assert.deepEqual(closes, []);
  assert.ok(session.sessionId);
  await session.handle({ type: 'end' });
  t.mock.timers.tick(14_999);
  assert.deepEqual(closes, []);
  t.mock.timers.tick(1);
  await nextTick();
  assert.deepEqual(closes, [[1008, 'Session idle timeout']]);
});

test('disposing an unstarted socket cancels its deadline', async t => {
  t.mock.timers.enable({ apis: ['setTimeout'] });
  const closes = [];
  const session = new RealtimeSession({ readyState: 1, bufferedAmount: 0, send() {}, close: (...args) => closes.push(args) }, store);
  await session.dispose();
  t.mock.timers.tick(60_000);
  assert.deepEqual(closes, []);
});

test('a slow session lookup cannot create or renew ownership after the idle timeout', async t => {
  t.mock.timers.enable({ apis: ['setTimeout'] });
  const closes = [];
  const session = new RealtimeSession({ readyState: 1, bufferedAmount: 0, send() {}, close: (...args) => closes.push(args) }, store);
  t.after(() => session.dispose());
  let resolveCreation;
  t.mock.method(store, 'createSession', guard => new Promise(resolve => {
    resolveCreation = () => resolve({ id: guard.sessionId, createdAt: '', title: '', endedAt: null, review: null });
  }));
  const starting = session.handle({ type: 'start', voice: false });
  await waitFor(() => resolveCreation);
  t.mock.timers.tick(15_000);
  await nextTick();
  assert.deepEqual(closes, [[1008, 'Session idle timeout']]);
  resolveCreation();
  await starting;
  assert.equal(session.sessionId, null);
  assert.equal(lease, null);
  t.mock.timers.tick(30_000);
  assert.equal(closes.length, 1);
});

test('an ended conversation gets one bounded grace period to persist its pending recap', async t => {
  t.mock.timers.enable({ apis: ['setTimeout'] });
  const closes = [], events = [];
  const session = new RealtimeSession({ readyState: 1, bufferedAmount: 0, send: raw => events.push(JSON.parse(raw)), close: (...args) => closes.push(args) }, store);
  t.after(() => session.dispose());
  await session.handle({ type: 'start', voice: false });
  const id = session.sessionId;
  await session.handle({ type: 'text', text: '回顧を保存してください。' });
  await waitFor(() => last(events, 'turn.done'));
  let finishReview;
  completeReply = () => new Promise(resolve => { finishReview = () => resolve(JSON.stringify({
    topic: '会話の振り返り', improvement: '次回も話しましょう。', memorySuggestions: [],
    expressions: [1, 2, 3].map(index => ({ text: `表現${index}`, meaning: `意味${index}` })),
  })); });
  await session.handle({ type: 'end' });
  await waitFor(() => finishReview);
  t.mock.timers.tick(15_000);
  await nextTick();
  assert.deepEqual(closes, []);
  t.mock.timers.tick(5000);
  finishReview();
  await waitFor(() => sessions.get(id).review);
  t.mock.timers.tick(10_000);
  await nextTick();
  assert.deepEqual(closes, [[1008, 'Session idle timeout']]);
  assert.equal(sessions.get(id).review.topic, '会話の振り返り');
});
