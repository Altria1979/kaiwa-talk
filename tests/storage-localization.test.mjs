import assert from 'node:assert/strict';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { after, beforeEach, mock, test } from 'node:test';
import Database from 'better-sqlite3';
import { DEFAULT_SETTINGS } from '../shared/protocol.ts';

const dataDir = mkdtempSync(join(tmpdir(), 'koharu-locale-'));
mock.module('../server/config.ts', { exports: { config: { dataDir } } });
const { store } = await import('../server/storage.ts');
await store.getSettings();
const db = new Database(join(dataDir, 'companion.sqlite'));

after(async () => {
  db.close();
  (await store.close());
  rmSync(dataDir, { recursive: true, force: true });
});

beforeEach(() => {
  db.exec('DELETE FROM messages; DELETE FROM sessions; DELETE FROM memories;');
  db.prepare('UPDATE settings SET data = ? WHERE id = 1').run(JSON.stringify(DEFAULT_SETTINGS));
});

test('Japanese defaults and legacy built-in settings share the same public values', async () => {
  assert.equal((await store.getSettings()).characterName, 'VRoid Avatar A');
  assert.equal((await store.getSettings()).learningLanguage, '日本語');
  assert.equal((await store.getSettings()).supportLanguage, '日本語');
  db.prepare('UPDATE settings SET data = ? WHERE id = 1').run(JSON.stringify({
    ...DEFAULT_SETTINGS,
    characterName: '小春',
    persona: '温柔、耐心、有好奇心的日语聊天伙伴。像朋友一样自然交流。',
    learningLanguage: '日语',
    supportLanguage: '中文',
  }));
  assert.deepEqual((await store.getSettings()), DEFAULT_SETTINGS);
});

test('legacy character name migrates without changing the imported avatar or saved history', async () => {
  const avatarUrl = '/api/avatars/existing-avatar-a.vrm';
  db.prepare('UPDATE settings SET data = ? WHERE id = 1').run(JSON.stringify({ ...DEFAULT_SETTINGS, characterName: '小春', avatarUrl }));
  const session = (await store.createSession());
  const message = (await store.addMessage({ sessionId: session.id, turnId: 'old', role: 'user', content: '小春と話したことを覚えています。', delivery: 'text' }));
  (await store.updateMessage(message.id, { translation: '以前保存した説明', replySuggestions: [{ text: 'そうですね。', reading: 'そうですね。', meaning: '小春との会話' }] }));
  (await store.endSession(session.id, { topic: '小春との練習', expressions: [], improvement: '次回の練習', memorySuggestions: ['小春との思い出'] }));
  (await store.addMemory('小春と京都について話した。'));
  const history = () => ['sessions', 'messages', 'memories'].map(table => db.prepare(`SELECT data FROM ${table} ORDER BY rowid`).all());
  const before = history();

  assert.deepEqual((await store.getSettings()), { ...DEFAULT_SETTINGS, avatarUrl });
  const updated = (await store.updateSettings({ voice: 'Serena' }));
  assert.equal(updated.characterName, 'VRoid Avatar A');
  assert.equal(updated.avatarUrl, avatarUrl);
  assert.equal(JSON.parse(db.prepare('SELECT data FROM settings WHERE id = 1').get().data).characterName, 'VRoid Avatar A');
  assert.deepEqual(history(), before);
});

test('character migration preserves custom names and model selections exactly', async () => {
  for (const characterName of ['小春ちゃん', 'Koharu', '私の会話パートナー', 'VRoid Avatar A']) {
    const settings = { ...DEFAULT_SETTINGS, characterName, avatarUrl: '/api/avatars/my-avatar.vrm' };
    db.prepare('UPDATE settings SET data = ? WHERE id = 1').run(JSON.stringify(settings));
    assert.deepEqual((await store.getSettings()), settings);
    assert.deepEqual((await store.updateSettings({ vadSilenceMs: 1800 })), { ...settings, vadSilenceMs: 1800 });
  }
});

test('language aliases migrate while custom user-authored settings remain unchanged', async () => {
  const persona = '请记住我喜欢料理。这是我自己写的人物设定。';
  (await store.updateSettings({ persona, learningLanguage: '英语', voice: 'Serena' }));
  assert.equal((await store.getSettings()).learningLanguage, '英語');
  assert.equal((await store.getSettings()).persona, persona);
  assert.equal((await store.getSettings()).voice, 'Serena');
  for (const learningLanguage of ['我定义的语言', 'toString', '__proto__']) {
    (await store.updateSettings({ learningLanguage }));
    assert.equal((await store.getSettings()).learningLanguage, learningLanguage);
  }
});

test('new and legacy default titles localize and still become the first user message', async () => {
  const session = (await store.createSession());
  assert.equal(session.title, '新しい会話');
  db.prepare('UPDATE sessions SET data = ? WHERE id = ?').run(JSON.stringify({ ...session, title: '新的日语对话' }), session.id);
  assert.equal((await store.getSession(session.id)).title, '新しい会話');
  assert.equal((await store.listSessions())[0].title, '新しい会話');
  (await store.addMessage({ sessionId: session.id, turnId: 'first', role: 'user', content: '今日は何をしましたか？', delivery: 'text' }));
  assert.equal((await store.getSession(session.id)).title, '今日は何をしましたか？');
});

test('localization preserves saved messages, custom titles, memories and legacy generated helpers', async () => {
  const session = (await store.createSession());
  const title = '我写的聊天标题';
  const review = { topic: '旧回顾', expressions: [], improvement: '旧建议', memorySuggestions: [] };
  db.prepare('UPDATE sessions SET data = ? WHERE id = ?').run(JSON.stringify({ ...session, title, review }), session.id);
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
