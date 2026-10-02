import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { mock, test } from 'node:test';
import Database from 'better-sqlite3';
import { openDatabase } from '../server/database.ts';
import { DEFAULT_SETTINGS } from '../shared/protocol.ts';

let connections = 0;
let closedConnections = 0;
mock.module('../server/database.ts', { exports: {
  async openDatabase(options) {
    connections++;
    const adapter = await openDatabase(options);
    return { ...adapter, async close() { closedConnections++; await adapter.close(); } };
  },
} });
const { createStore, SessionLeaseLostError } = await import('../server/storage.ts');
const review = { topic: '旅行', expressions: [], improvement: 'もう一度話しましょう', memorySuggestions: [] };
const input = sessionId => ({ sessionId, turnId: 'turn', role: 'user', content: '私だけの会話', delivery: 'text' });

function setup(t, driver) {
  const dir = mkdtempSync(join(tmpdir(), 'kaiwa-browser-store-'));
  const filename = join(dir, driver === 'local' ? 'companion.sqlite' : 'remote.sqlite');
  const options = { dataDir: dir, ...(driver === 'libsql' ? { databaseUrl: `file:${filename}` } : {}) };
  const managers = [];
  const open = () => { const manager = createStore(options); managers.push(manager); return manager; };
  t.after(async () => {
    for (const manager of managers) await manager.close();
    rmSync(dir, { recursive: true, force: true });
  });
  return { open, filename };
}

for (const driver of ['local', 'libsql']) {
  test(`${driver}: saved and patched avatars always resolve to the bundled model without changing other preferences`, async t => {
    const { open, filename } = setup(t, driver);
    const ownerId = randomUUID();
    const store = open().forOwner(ownerId);
    assert.equal((await store.getSettings()).avatarUrl, DEFAULT_SETTINGS.avatarUrl);
    const db = new Database(filename);
    t.after(() => db.close());
    const saved = { ...DEFAULT_SETTINGS, characterName: 'My companion', voice: 'Serena', persona: 'My persona', avatarUrl: '/api/avatars/legacy.vrm' };
    db.prepare('INSERT INTO browser_settings (owner_id, data) VALUES (?, ?)').run(ownerId, JSON.stringify(saved));
    const expected = { ...saved, avatarUrl: DEFAULT_SETTINGS.avatarUrl };
    assert.deepEqual(await store.getSettings(), expected);
    assert.deepEqual(JSON.parse(db.prepare('SELECT data FROM browser_settings WHERE owner_id = ?').get(ownerId).data), saved);
    for (const avatarUrl of ['/api/avatars/replacement.vrm', 'https://example.com/custom.vrm', null]) {
      assert.deepEqual(await store.updateSettings({ avatarUrl, vadSilenceMs: 1800 }), { ...expected, vadSilenceMs: 1800 });
      assert.deepEqual(await open().forOwner(ownerId).getSettings(), { ...expected, vadSilenceMs: 1800 });
      assert.equal(JSON.parse(db.prepare('SELECT data FROM browser_settings WHERE owner_id = ?').get(ownerId).data).avatarUrl, DEFAULT_SETTINGS.avatarUrl);
    }
  });

  test(`${driver}: browser identities cannot read or mutate each other's records, even with known IDs`, async t => {
    const { open } = setup(t, driver);
    const manager = open();
    const ownerA = randomUUID();
    const ownerB = randomUUID();
    const a = manager.forOwner(ownerA);
    const b = manager.forOwner(ownerB);
    await a.updateSettings({ persona: 'private persona', avatarUrl: '/api/avatars/private.vrm' });
    const session = await a.createSession();
    const message = await a.addMessage(input(session.id));
    const memory = await a.addMemory('private memory');
    const ended = await a.endSession(session.id, review);

    assert.deepEqual(await b.getSettings(), DEFAULT_SETTINGS);
    assert.deepEqual(await b.listSessions(), []);
    assert.equal(await b.getSession(session.id), null);
    assert.deepEqual(await b.listMessages(session.id), []);
    assert.equal(await b.getMessage(message.id), null);
    assert.deepEqual(await b.listMemories(), []);
    assert.deepEqual(await b.recentReviews(10), []);
    await assert.rejects(b.reopenSession(session.id));
    await assert.rejects(b.endSession(session.id));
    await assert.rejects(b.saveReview(session.id, review, ended.endedAt), SessionLeaseLostError);
    await assert.rejects(b.addMessage(input(session.id)), /FOREIGN KEY/i);
    await assert.rejects(b.updateMessage(message.id, { content: 'stolen' }));
    assert.equal(await b.updateMemory(memory.id, 'stolen'), null);
    assert.equal(await b.deleteMemory(memory.id), false);
    await b.updateSettings({ persona: 'independent persona' });
    const memoryB = await b.addMemory('B only');
    assert.equal(await a.deleteMemory(memoryB.id), false);

    const resumed = open().forOwner(ownerA);
    assert.equal((await resumed.getSettings()).persona, 'private persona');
    assert.equal((await resumed.getMessage(message.id)).content, '私だけの会話');
    assert.deepEqual(await resumed.recentReviews(10), [review]);
    assert.equal((await resumed.listMemories())[0].content, 'private memory');
    assert.equal((await a.getSession(session.id)).endedAt, ended.endedAt);
  });

  test(`${driver}: browser leases are independent and a copied holder cannot change another browser's session`, async t => {
    const manager = setup(t, driver).open();
    const a = manager.forOwner(randomUUID());
    const b = manager.forOwner(randomUUID());
    const guard = { sessionId: 'known-session', ownerId: 'known-holder' };
    assert.equal(await a.acquireSessionLease(guard.sessionId, guard.ownerId, 60_000), true);
    const session = await a.createSession(guard);
    assert.equal(await b.getActiveSessionId(), null);
    assert.equal(await b.renewSessionLease(guard.sessionId, guard.ownerId, 60_000), false);
    await b.releaseSessionLease(guard.sessionId, guard.ownerId);
    await assert.rejects(b.createSession(guard), SessionLeaseLostError);
    assert.equal(await b.acquireSessionLease(guard.sessionId, guard.ownerId, 60_000), true);
    await assert.rejects(b.reopenSession(session.id, guard));
    await assert.rejects(b.addMessage(input(session.id), guard), /FOREIGN KEY/i);
    await b.createSession(guard);
    await b.addMessage(input(session.id), guard);
    assert.deepEqual(await a.listMessages(session.id), []);
    assert.equal((await b.listMessages(session.id)).length, 1);
    await b.releaseSessionLease(guard.sessionId, guard.ownerId);
    assert.equal(await a.getActiveSessionId(), guard.sessionId);
    assert.equal(await b.getActiveSessionId(), null);
  });

  test(`${driver}: legacy private tables remain unchanged and are never assigned to a browser`, async t => {
    const { open, filename } = setup(t, driver);
    const db = new Database(filename);
    t.after(() => db.close());
    db.exec(`
      CREATE TABLE settings (id INTEGER PRIMARY KEY CHECK(id = 1), data TEXT NOT NULL);
      CREATE TABLE sessions (id TEXT PRIMARY KEY, created_at TEXT NOT NULL, data TEXT NOT NULL);
      CREATE TABLE messages (id TEXT PRIMARY KEY, session_id TEXT NOT NULL REFERENCES sessions(id), created_at TEXT NOT NULL, data TEXT NOT NULL);
      CREATE TABLE memories (id TEXT PRIMARY KEY, created_at TEXT NOT NULL, data TEXT NOT NULL);
      CREATE TABLE session_lease (id INTEGER PRIMARY KEY CHECK(id = 1), session_id TEXT NOT NULL, owner_id TEXT NOT NULL, expires_at INTEGER NOT NULL);
    `);
    const legacySession = { id: 'old-session', title: 'private history', createdAt: '2026-01-01', endedAt: null, review: null };
    db.prepare('INSERT INTO settings VALUES (1, ?)').run(JSON.stringify({ ...DEFAULT_SETTINGS, persona: 'legacy secret', avatarUrl: '/api/avatars/legacy.vrm' }));
    db.prepare('INSERT INTO sessions VALUES (?, ?, ?)').run(legacySession.id, legacySession.createdAt, JSON.stringify(legacySession));
    db.prepare('INSERT INTO messages VALUES (?, ?, ?, ?)').run('old-message', legacySession.id, legacySession.createdAt, JSON.stringify({ id: 'old-message', ...input(legacySession.id) }));
    db.prepare('INSERT INTO memories VALUES (?, ?, ?)').run('old-memory', legacySession.createdAt, JSON.stringify({ id: 'old-memory', content: 'legacy memory' }));
    db.prepare('INSERT INTO session_lease VALUES (1, ?, ?, ?)').run(legacySession.id, 'old-holder', Date.now() + 60_000);
    const snapshot = () => ['settings', 'sessions', 'messages', 'memories', 'session_lease'].map(table => db.prepare(`SELECT * FROM ${table} ORDER BY rowid`).all());
    const before = snapshot();
    const store = open().forOwner(randomUUID());
    assert.deepEqual(await store.getSettings(), DEFAULT_SETTINGS);
    assert.deepEqual(await store.listSessions(), []);
    assert.equal(await store.getSession('old-session'), null);
    assert.deepEqual(await store.listMessages('old-session'), []);
    assert.equal(await store.getMessage('old-message'), null);
    assert.deepEqual(await store.listMemories(), []);
    assert.equal(await store.getActiveSessionId(), null);
    await store.updateSettings({ persona: 'new visitor' });
    await store.createSession();
    await store.addMemory('new memory');
    assert.deepEqual(snapshot(), before);
  });
}

test('many browser views share one lazy adapter and only the root closes it', async t => {
  const manager = setup(t, 'local').open();
  const opensBefore = connections;
  const closesBefore = closedConnections;
  const views = Array.from({ length: 100 }, () => manager.forOwner(randomUUID()));
  assert.equal(connections, opensBefore);
  assert.equal(manager.getSettings, undefined);
  assert.equal(views[0].close, undefined);
  await Promise.all(views.map(view => view.getSettings()));
  assert.equal(connections, opensBefore + 1);
  await manager.close();
  await manager.close();
  assert.equal(closedConnections, closesBefore + 1);
  await assert.rejects(views[0].getSettings(), /closed/i);
});

test('invalid browser owners are rejected before opening the database', async t => {
  const manager = setup(t, 'local').open();
  const before = connections;
  for (const value of ['', 'legacy', '../private', 'x'.repeat(10_000), undefined, null, 123, '01234567-89ab-cdef-0123-456789abcdef-extra']) {
    assert.throws(() => manager.forOwner(value), /browser owner/i);
  }
  assert.equal(connections, before);
});
