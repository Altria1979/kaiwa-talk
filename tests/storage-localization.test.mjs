import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { after, beforeEach, mock, test } from 'node:test';
import Database from 'better-sqlite3';
import { DEFAULT_SETTINGS } from '../shared/protocol.ts';

const dataDir = mkdtempSync(join(tmpdir(), 'koharu-locale-'));
const config = { dataDir };
mock.module('../server/config.ts', { exports: { config } });
const { store: persistence } = await import('../server/storage.ts');
const ownerId = randomUUID();
const store = persistence.forOwner(ownerId);
await store.getSettings();
const db = new Database(join(dataDir, 'companion.sqlite'));

after(async () => {
  db.close();
  await persistence.close();
  rmSync(dataDir, { recursive: true, force: true });
});

function saveSettings(settings) {
  db.prepare('INSERT INTO browser_settings (owner_id, data) VALUES (?, ?) ON CONFLICT(owner_id) DO UPDATE SET data = excluded.data').run(ownerId, JSON.stringify(settings));
}

beforeEach(() => {
  db.exec('DELETE FROM browser_messages; DELETE FROM browser_sessions; DELETE FROM browser_memories;');
  saveSettings(DEFAULT_SETTINGS);
});

test('default cloned voice is used for new browsers and settings without a saved voice', async () => {
  assert.equal((await persistence.forOwner(randomUUID()).getSettings()).voice, DEFAULT_SETTINGS.voice);
  const { voice, ...settings } = DEFAULT_SETTINGS;
  assert.equal(voice, 'qwen-tts-vc-violet-voice-20261001184926083-8183');
  saveSettings(settings);
  assert.deepEqual(await store.getSettings(), DEFAULT_SETTINGS);
});

test('previous built-in voices migrate to Violet and persist on the next settings update', async () => {
  for (const voice of ['Cherry', 'qwen-tts-vc-kaiwa-voice-20261001155111507-6512']) {
    saveSettings({ ...DEFAULT_SETTINGS, voice });
    assert.equal((await store.getSettings()).voice, DEFAULT_SETTINGS.voice);
    const updated = await store.updateSettings({ vadSilenceMs: 1800 });
    assert.equal(updated.voice, DEFAULT_SETTINGS.voice);
    assert.equal(JSON.parse(db.prepare('SELECT data FROM browser_settings WHERE owner_id = ?').get(ownerId).data).voice, DEFAULT_SETTINGS.voice);
    assert.equal((await store.getSettings()).voice, updated.voice);
  }
});

test('the previous default character name follows the replacement default model', async () => {
  saveSettings({ ...DEFAULT_SETTINGS, characterName: 'VRoid Avatar A' });
  assert.equal((await store.getSettings()).characterName, DEFAULT_SETTINGS.characterName);
  assert.equal((await store.updateSettings({ vadSilenceMs: 1800 })).characterName, DEFAULT_SETTINGS.characterName);
});

test('default cloned voice preserves custom voices and their saved settings', async () => {
  for (const voice of ['Serena', 'qwen-tts-vc-custom-user']) {
    saveSettings({ ...DEFAULT_SETTINGS, voice });
    assert.equal((await store.getSettings()).voice, voice);
    assert.equal((await store.updateSettings({ vadSilenceMs: 1800 })).voice, voice);
    assert.equal(JSON.parse(db.prepare('SELECT data FROM browser_settings WHERE owner_id = ?').get(ownerId).data).voice, voice);
  }
});

test('Japanese defaults and legacy built-in settings share the same public values', async () => {
  assert.equal((await store.getSettings()).characterName, 'ヴァイオレット');
  assert.equal((await store.getSettings()).learningLanguage, '日本語');
  assert.equal((await store.getSettings()).supportLanguage, '日本語');
  saveSettings({
    ...DEFAULT_SETTINGS,
    characterName: '小春',
    persona: '温柔、耐心、有好奇心的日语聊天伙伴。像朋友一样自然交流。',
    learningLanguage: '日语',
    supportLanguage: '中文',
  });
  assert.deepEqual((await store.getSettings()), DEFAULT_SETTINGS);
});

test('legacy built-in personas migrate and persist only for their browser without changing history', async () => {
  const otherOwnerId = randomUUID();
  const otherStore = persistence.forOwner(otherOwnerId);
  const otherSettings = { ...DEFAULT_SETTINGS, persona: '別のブラウザーの人物設定です。' };
  await otherStore.updateSettings(otherSettings);
  for (const scopedStore of [store, otherStore]) {
    const session = await scopedStore.createSession();
    await scopedStore.addMessage({ sessionId: session.id, turnId: 'old', role: 'user', content: '以前の会話です。', delivery: 'text' });
    await scopedStore.endSession(session.id, { topic: '保存した話題', expressions: [], improvement: '保存した助言', memorySuggestions: [] });
    await scopedStore.addMemory('手紙を書くことが好きです。');
  }
  const history = () => ['browser_sessions', 'browser_messages', 'browser_memories'].map(table => db.prepare(`SELECT owner_id, data FROM ${table} ORDER BY rowid`).all());
  const before = history();

  for (const persona of [
    '温柔、耐心、有好奇心的日语聊天伙伴。像朋友一样自然交流。',
    '優しく、辛抱強く、好奇心旺盛な日本語の会話パートナー。友達のように自然に話します。',
  ]) {
    const settings = { ...DEFAULT_SETTINGS, persona, characterName: '私の相手', voice: 'Serena', avatarUrl: '/api/avatars/custom.vrm' };
    saveSettings(settings);
    assert.deepEqual(await store.getSettings(), { ...settings, persona: DEFAULT_SETTINGS.persona });
    assert.equal(JSON.parse(db.prepare('SELECT data FROM browser_settings WHERE owner_id = ?').get(ownerId).data).persona, persona);
    const expected = { ...settings, persona: DEFAULT_SETTINGS.persona, vadSilenceMs: 1800 };
    assert.deepEqual(await store.updateSettings({ vadSilenceMs: 1800 }), expected);
    assert.deepEqual(JSON.parse(db.prepare('SELECT data FROM browser_settings WHERE owner_id = ?').get(ownerId).data), expected);
    assert.deepEqual(await otherStore.getSettings(), otherSettings);
    assert.deepEqual(JSON.parse(db.prepare('SELECT data FROM browser_settings WHERE owner_id = ?').get(otherOwnerId).data), otherSettings);
    assert.deepEqual(history(), before);
  }
});

test('persona migration preserves custom text and extended legacy personas exactly', async () => {
  for (const persona of [
    '请记住我喜欢料理。这是我自己写的人物设定。',
    '温柔、耐心、有好奇心的日语聊天伙伴。像朋友一样自然交流。喜欢讨论料理。',
    '優しく、辛抱強く、好奇心旺盛な日本語の会話パートナー。友達のように自然に話します。料理が好きです。',
  ]) {
    const settings = { ...DEFAULT_SETTINGS, persona };
    saveSettings(settings);
    assert.deepEqual(await store.getSettings(), settings);
    const expected = { ...settings, vadSilenceMs: 1800 };
    assert.deepEqual(await store.updateSettings({ vadSilenceMs: 1800 }), expected);
    assert.deepEqual(JSON.parse(db.prepare('SELECT data FROM browser_settings WHERE owner_id = ?').get(ownerId).data), expected);
  }
});

test('legacy character name migrates without changing the imported avatar or saved history', async () => {
  const avatarUrl = '/api/avatars/existing-avatar-a.vrm';
  saveSettings({ ...DEFAULT_SETTINGS, characterName: '小春', avatarUrl });
  const session = (await store.createSession());
  const message = (await store.addMessage({ sessionId: session.id, turnId: 'old', role: 'user', content: '小春と話したことを覚えています。', delivery: 'text' }));
  (await store.updateMessage(message.id, { translation: '以前保存した説明', replySuggestions: [{ text: 'そうですね。', reading: 'そうですね。', meaning: '小春との会話' }] }));
  (await store.endSession(session.id, { topic: '小春との練習', expressions: [], improvement: '次回の練習', memorySuggestions: ['小春との思い出'] }));
  (await store.addMemory('小春と京都について話した。'));
  const history = () => ['browser_sessions', 'browser_messages', 'browser_memories'].map(table => db.prepare(`SELECT data FROM ${table} WHERE owner_id = ? ORDER BY rowid`).all(ownerId));
  const before = history();

  assert.deepEqual((await store.getSettings()), { ...DEFAULT_SETTINGS, avatarUrl });
  const updated = (await store.updateSettings({ voice: 'Serena' }));
  assert.equal(updated.characterName, 'ヴァイオレット');
  assert.equal(updated.avatarUrl, avatarUrl);
  assert.equal(JSON.parse(db.prepare('SELECT data FROM browser_settings WHERE owner_id = ?').get(ownerId).data).characterName, 'ヴァイオレット');
  assert.deepEqual(history(), before);
});

test('character migration preserves custom names and model selections exactly', async () => {
  for (const characterName of ['小春ちゃん', 'Koharu', '私の会話パートナー', 'VRoid Avatar A']) {
    const settings = { ...DEFAULT_SETTINGS, characterName, avatarUrl: '/api/avatars/my-avatar.vrm' };
    saveSettings(settings);
    assert.deepEqual((await store.getSettings()), settings);
    assert.deepEqual((await store.updateSettings({ vadSilenceMs: 1800 })), { ...settings, vadSilenceMs: 1800 });
  }
});

test('saved and patched languages are fixed to Japanese without changing custom settings or history', async () => {
  const customSettings = {
    ...DEFAULT_SETTINGS,
    persona: '请记住我喜欢料理。这是我自己写的人物设定。',
    characterName: '私の会話パートナー',
    voice: 'Serena',
    avatarUrl: '/api/avatars/my-avatar.vrm',
  };
  const session = await store.createSession();
  await store.addMessage({ sessionId: session.id, turnId: 'old', role: 'user', content: '以前の会話です。', delivery: 'text' });
  await store.endSession(session.id, { topic: '保存した話題', expressions: [], improvement: '保存した助言', memorySuggestions: [] });
  await store.addMemory('手紙を書くことが好きです。');
  const history = () => ['browser_sessions', 'browser_messages', 'browser_memories'].map(table => db.prepare(`SELECT data FROM ${table} WHERE owner_id = ? ORDER BY rowid`).all(ownerId));
  const before = history();

  for (const language of ['英语', '英語', '中文', '我定义的语言', 'toString', '__proto__']) {
    const legacySettings = { ...customSettings, learningLanguage: language, supportLanguage: language };
    saveSettings(legacySettings);
    assert.deepEqual(await store.getSettings(), customSettings);
    assert.deepEqual(JSON.parse(db.prepare('SELECT data FROM browser_settings WHERE owner_id = ?').get(ownerId).data), legacySettings);

    const expected = { ...customSettings, vadSilenceMs: 1800 };
    assert.deepEqual(await store.updateSettings({ vadSilenceMs: 1800 }), expected);
    assert.deepEqual(JSON.parse(db.prepare('SELECT data FROM browser_settings WHERE owner_id = ?').get(ownerId).data), expected);
    assert.deepEqual(await store.updateSettings({ learningLanguage: language, supportLanguage: language }), expected);
    assert.deepEqual(await store.getSettings(), expected);
    assert.deepEqual(JSON.parse(db.prepare('SELECT data FROM browser_settings WHERE owner_id = ?').get(ownerId).data), expected);
    assert.deepEqual(history(), before);
  }
});

test('new and legacy default titles localize and still become the first user message', async () => {
  const session = (await store.createSession());
  assert.equal(session.title, '新しい会話');
  db.prepare('UPDATE browser_sessions SET data = ? WHERE owner_id = ? AND id = ?').run(JSON.stringify({ ...session, title: '新的日语对话' }), ownerId, session.id);
  assert.equal((await store.getSession(session.id)).title, '新しい会話');
  assert.equal((await store.listSessions())[0].title, '新しい会話');
  (await store.addMessage({ sessionId: session.id, turnId: 'first', role: 'user', content: '今日は何をしましたか？', delivery: 'text' }));
  assert.equal((await store.getSession(session.id)).title, '今日は何をしましたか？');
});

test('localization preserves saved messages, custom titles, memories and legacy generated helpers', async () => {
  const session = (await store.createSession());
  const title = '我写的聊天标题';
  const review = { topic: '旧回顾', expressions: [], improvement: '旧建议', memorySuggestions: [] };
  db.prepare('UPDATE browser_sessions SET data = ? WHERE owner_id = ? AND id = ?').run(JSON.stringify({ ...session, title, review }), ownerId, session.id);
  const message = (await store.addMessage({ sessionId: session.id, turnId: 'old', role: 'user', content: '这是我的内容。', delivery: 'text' }));
  (await store.updateMessage(message.id, { translation: '保存的解释', replySuggestions: [{ text: 'はい。', reading: 'はい。', meaning: '是' }] }));
  const memory = (await store.addMemory('我喜欢咖啡。'));
  assert.equal((await store.getSession(session.id)).title, title);
  assert.deepEqual((await store.getSession(session.id)).review, review);
  assert.equal((await store.getMessage(message.id)).content, message.content);
  assert.equal((await store.getMessage(message.id)).translation, '保存的解释');
  assert.equal((await store.getMessage(message.id)).translationLanguage, undefined);
  assert.equal((await store.getMessage(message.id)).replySuggestionsLanguage, undefined);
  assert.equal((await store.listMemories())[0].content, memory.content);
});
