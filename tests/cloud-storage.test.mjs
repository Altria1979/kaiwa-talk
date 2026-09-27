import assert from 'node:assert/strict';
import { existsSync, mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { test } from 'node:test';
import { createClient } from '@libsql/client';
import { createStore, SessionLeaseLostError } from '../server/storage.ts';
import { DEFAULT_SETTINGS } from '../shared/protocol.ts';

function setup(t, driver = 'libsql') {
  const dir = mkdtempSync(join(tmpdir(), 'virtualmaid-cloud-store-'));
  const url = `file:${join(dir, 'remote.sqlite')}`;
  const stores = [];
  const options = { dataDir: join(dir, 'local'), ...(driver === 'libsql' ? { databaseUrl: url } : {}) };
  const client = driver === 'libsql' ? createClient({ url }) : null;
  const open = () => {
    const store = createStore(options);
    stores.push(store);
    return store;
  };
  t.after(async () => {
    for (const store of stores) await store.close();
    client?.close();
    rmSync(dir, { recursive: true, force: true });
  });
  return { open, client, options };
}
const review = { topic: '旅行', expressions: [], improvement: 'もう一度話しましょう', memorySuggestions: [] };
const input = (sessionId, content = '京都に行きたいです。') => ({ sessionId, turnId: 'turn', role: 'user', content, delivery: 'text' });

test('Turso adapter persists settings, conversation, auxiliary results and memories across fresh clients', async t => {
  const { open } = setup(t);
  const first = open();
  await first.updateSettings({ voice: 'Serena', persona: 'ユーザーが書いた設定' });
  const session = await first.createSession();
  const message = await first.addMessage(input(session.id));
  await first.updateMessage(message.id, { translation: '我想去京都。', interrupted: true });
  const memory = await first.addMemory('京都が好き');
  await first.endSession(session.id, review);
  await first.close();

  const second = open();
  assert.equal((await second.getSettings()).voice, 'Serena');
  assert.equal((await second.getSettings()).persona, 'ユーザーが書いた設定');
  assert.equal((await second.getSession(session.id)).title, message.content);
  assert.deepEqual(await second.recentReviews(3), [review]);
  assert.equal((await second.listMessages(session.id))[0].translation, '我想去京都。');
  assert.equal((await second.getMessage(message.id)).interrupted, true);
  assert.equal((await second.updateMemory(memory.id, '東京も好き')).content, '東京も好き');
  assert.equal((await second.listMemories()).length, 1);
  assert.equal(await second.deleteMemory(memory.id), true);
  assert.equal(await second.deleteMemory(memory.id), false);
  assert.deepEqual(await second.listMemories(), []);
});

test('database initialization is lazy and Vercel fails closed without complete remote credentials', async t => {
  const dir = mkdtempSync(join(tmpdir(), 'virtualmaid-build-store-'));
  t.after(() => rmSync(dir, { recursive: true, force: true }));
  for (const extra of [{}, { databaseUrl: 'libsql://example.turso.io' }, { authToken: 'token' }, { databaseUrl: 'file:temp.db', authToken: 'token' }]) {
    const dataDir = join(dir, 'must-not-create');
    const store = createStore({ dataDir, deployment: 'vercel', ...extra });
    assert.equal(existsSync(dataDir), false);
    await assert.rejects(store.getSettings(), /Vercel requires/);
    assert.equal(existsSync(dataDir), false);
    await store.close();
  }
});

test('remote transactions roll back failed message writes and leave the connection usable', async t => {
  const { open, client } = setup(t);
  const store = open();
  await store.getSettings();
  const session = await store.createSession();
  // Simulate a failed second statement: the message INSERT must also be rolled back.
  await client.execute("CREATE TRIGGER reject_title BEFORE UPDATE ON sessions BEGIN SELECT RAISE(ABORT, 'test write failure'); END");
  await assert.rejects(store.addMessage(input(session.id)), /test write failure/);
  assert.deepEqual(await store.listMessages(session.id), []);
  assert.equal((await store.getSession(session.id)).title, '新しい会話');
  await client.execute('DROP TRIGGER reject_title');
  await store.addMessage(input(session.id));
  assert.equal((await store.listMessages(session.id)).length, 1);
});

test('remote foreign keys reject orphan messages', async t => {
  const store = setup(t).open();
  await assert.rejects(store.addMessage(input('missing-session')), /FOREIGN KEY/i);
  assert.deepEqual(await store.listMessages('missing-session'), []);
});

test('independent cloud clients compete atomically for one conversation and cannot renew or release another owner', async t => {
  const { open } = setup(t);
  const first = open();
  const second = open();
  await first.getSettings();
  await second.getSettings();
  const results = await Promise.all([
    first.acquireSessionLease('session-a', 'owner-a', 60_000),
    second.acquireSessionLease('session-b', 'owner-b', 60_000),
  ]);
  assert.equal(results.filter(Boolean).length, 1);
  const sessionId = results[0] ? 'session-a' : 'session-b';
  const ownerId = results[0] ? 'owner-a' : 'owner-b';
  assert.equal(await first.getActiveSessionId(), sessionId);
  assert.equal(await second.getActiveSessionId(), sessionId);
  assert.equal(await second.renewSessionLease(sessionId, 'outsider', 60_000), false);
  await second.releaseSessionLease(sessionId, 'outsider');
  assert.equal(await first.getActiveSessionId(), sessionId);
  assert.equal(await first.renewSessionLease(sessionId, ownerId, 60_000), true);
  await first.releaseSessionLease(sessionId, ownerId);
  assert.equal(await second.getActiveSessionId(), null);
  assert.equal(await second.acquireSessionLease('session-c', 'owner-c', 60_000), true);
});

test('expired leases cannot be resurrected and stale owners cannot mutate after transfer', async t => {
  const { open, client } = setup(t);
  const first = open();
  const second = open();
  const session = await first.createSession();
  const oldGuard = { sessionId: session.id, ownerId: 'old-owner' };
  const nextGuard = { sessionId: session.id, ownerId: 'next-owner' };
  await first.acquireSessionLease(session.id, oldGuard.ownerId, 60_000);
  const message = await first.addMessage(input(session.id), oldGuard);
  await client.execute('UPDATE session_lease SET expires_at = 0');
  assert.equal(await first.getActiveSessionId(), null);
  assert.equal(await first.renewSessionLease(session.id, oldGuard.ownerId, 60_000), false);
  await assert.rejects(first.addMessage(input(session.id), oldGuard), SessionLeaseLostError);
  assert.equal(await second.acquireSessionLease(session.id, nextGuard.ownerId, 60_000), true);
  await assert.rejects(first.addMessage(input(session.id), oldGuard), SessionLeaseLostError);
  await assert.rejects(first.updateMessage(message.id, { content: 'stale' }, oldGuard), SessionLeaseLostError);
  await assert.rejects(first.reopenSession(session.id, oldGuard), SessionLeaseLostError);
  await assert.rejects(first.endSession(session.id, undefined, oldGuard), SessionLeaseLostError);
  await assert.rejects(first.saveReview(session.id, review, oldGuard), SessionLeaseLostError);
  await first.releaseSessionLease(session.id, oldGuard.ownerId);
  assert.equal(await second.getActiveSessionId(), session.id);
  assert.equal((await second.getMessage(message.id)).content, message.content);
  assert.equal((await second.getSession(session.id)).endedAt, null);
  await second.updateMessage(message.id, { translation: '新的解释' }, nextGuard);
  assert.equal((await first.getMessage(message.id)).translation, '新的解释');
});

test('review completion cannot overwrite a conversation resumed after review generation began', async t => {
  const { open } = setup(t);
  const store = open();
  const session = await store.createSession();
  const ended = await store.endSession(session.id);
  await store.saveReview(session.id, review, ended.endedAt);
  assert.deepEqual((await store.getSession(session.id)).review, review);
  await store.reopenSession(session.id);
  await assert.rejects(store.saveReview(session.id, review, ended.endedAt), SessionLeaseLostError);
  assert.equal((await store.getSession(session.id)).review, null);
  assert.equal((await store.getSession(session.id)).endedAt, null);
});

test('local async transactions serialize concurrent mutations without dropping independent settings or message fields', async t => {
  const store = setup(t, 'local').open();
  await Promise.all([store.updateSettings({ voice: 'Serena' }), store.updateSettings({ characterName: 'Custom' })]);
  assert.deepEqual(await store.getSettings(), { ...DEFAULT_SETTINGS, voice: 'Serena', characterName: 'Custom' });
  const session = await store.createSession();
  const message = await store.addMessage(input(session.id));
  await Promise.all([store.updateMessage(message.id, { translation: '解释' }), store.updateMessage(message.id, { interrupted: true })]);
  assert.equal((await store.getMessage(message.id)).translation, '解释');
  assert.equal((await store.getMessage(message.id)).interrupted, true);
});

test('invalid lease durations reject without creating an active lease', async t => {
  const store = setup(t).open();
  for (const ttl of [0, -1, Number.NaN, Number.POSITIVE_INFINITY, 1.5]) {
    await assert.rejects(store.acquireSessionLease('session', 'owner', ttl), /Invalid session lease/);
  }
  assert.equal(await store.getActiveSessionId(), null);
});

test('new sessions are created only by the lease owner without orphaning rows when ownership fails', async t => {
  const store = setup(t).open();
  const guard = { sessionId: 'new-session', ownerId: 'owner' };
  await assert.rejects(store.createSession(guard), SessionLeaseLostError);
  assert.deepEqual(await store.listSessions(), []);
  assert.equal(await store.acquireSessionLease(guard.sessionId, guard.ownerId, 60_000), true);
  await assert.rejects(store.createSession({ ...guard, ownerId: 'other' }), SessionLeaseLostError);
  assert.deepEqual(await store.listSessions(), []);
  assert.equal((await store.createSession(guard)).id, guard.sessionId);
});
