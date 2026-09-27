import { randomUUID } from 'node:crypto';
import { config } from './config.js';
import { openDatabase, type DatabaseAdapter, type DatabaseConnection, type DatabaseOptions } from './database.js';
import { DEFAULT_SETTINGS, type Settings, type SessionRecord, type ChatMessage, type LearningReview, type MemoryRecord } from '../shared/protocol.js';

function parse<T>(row: unknown): T | null {
  return row ? JSON.parse((row as { data: string }).data) as T : null;
}
const now = () => new Date().toISOString();
const databaseNow = "CAST((julianday('now') - 2440587.5) * 86400000 AS INTEGER)";
const defaultSessionTitle = '新しい会話';
const legacySessionTitle = '新的日语对话';
const languageNames = new Map([
  ['日语', '日本語'], ['英语', '英語'], ['韩语', '韓国語'], ['法语', 'フランス語'], ['德语', 'ドイツ語'], ['西班牙语', 'スペイン語'], ['中文', '中国語'],
]);

function localizedSession(session: SessionRecord | null): SessionRecord | null {
  return session?.title === legacySessionTitle ? { ...session, title: defaultSessionTitle } : session;
}

export type SessionLeaseGuard = { sessionId: string; ownerId: string };
export class SessionLeaseLostError extends Error {
  constructor() { super('Session lease is no longer owned'); this.name = 'SessionLeaseLostError'; }
}

async function checkLease(db: DatabaseConnection, guard: SessionLeaseGuard | undefined, sessionId: string): Promise<void> {
  if (!guard) return;
  if (guard.sessionId !== sessionId) throw new SessionLeaseLostError();
  const result = await db.execute(`SELECT session_id FROM session_lease WHERE id = 1 AND session_id = ? AND owner_id = ? AND expires_at > ${databaseNow}`, [sessionId, guard.ownerId]);
  if (!result.rows.length) throw new SessionLeaseLostError();
}

async function readSettings(db: DatabaseConnection): Promise<Settings> {
  const settings = { ...DEFAULT_SETTINGS, ...parse<Settings>((await db.execute('SELECT data FROM settings WHERE id = 1')).rows[0]) };
  // Only known built-in values are migrated; custom names, personas and models remain intact.
  if (settings.characterName === '小春') settings.characterName = DEFAULT_SETTINGS.characterName;
  if (settings.persona === '温柔、耐心、有好奇心的日语聊天伙伴。像朋友一样自然交流。') settings.persona = DEFAULT_SETTINGS.persona;
  settings.learningLanguage = languageNames.get(settings.learningLanguage) ?? settings.learningLanguage;
  settings.supportLanguage = settings.supportLanguage === '中文' ? DEFAULT_SETTINGS.supportLanguage : languageNames.get(settings.supportLanguage) ?? settings.supportLanguage;
  return settings;
}

async function readSession(db: DatabaseConnection, id: string): Promise<SessionRecord | null> {
  return localizedSession(parse<SessionRecord>((await db.execute('SELECT data FROM sessions WHERE id = ?', [id])).rows[0]));
}

function validateLease(sessionId: string, ownerId: string, ttlMs: number): void {
  if (!sessionId || !ownerId || !Number.isSafeInteger(ttlMs) || ttlMs <= 0) throw new Error('Invalid session lease');
}

export function createStore(options: DatabaseOptions) {
  let database: Promise<DatabaseAdapter> | undefined;
  let closed = false;
  async function getDatabase(): Promise<DatabaseAdapter> {
    if (closed) throw new Error('Storage is closed');
    database ??= (async () => {
      const db = await openDatabase(options);
      try {
        await db.write(async connection => {
          for (const sql of [
            'CREATE TABLE IF NOT EXISTS settings (id INTEGER PRIMARY KEY CHECK(id = 1), data TEXT NOT NULL)',
            'CREATE TABLE IF NOT EXISTS sessions (id TEXT PRIMARY KEY, created_at TEXT NOT NULL, data TEXT NOT NULL)',
            'CREATE TABLE IF NOT EXISTS messages (id TEXT PRIMARY KEY, session_id TEXT NOT NULL REFERENCES sessions(id), created_at TEXT NOT NULL, data TEXT NOT NULL)',
            'CREATE INDEX IF NOT EXISTS messages_session ON messages(session_id, created_at)',
            'CREATE TABLE IF NOT EXISTS memories (id TEXT PRIMARY KEY, created_at TEXT NOT NULL, data TEXT NOT NULL)',
            'CREATE TABLE IF NOT EXISTS session_lease (id INTEGER PRIMARY KEY CHECK(id = 1), session_id TEXT NOT NULL, owner_id TEXT NOT NULL, expires_at INTEGER NOT NULL)',
          ]) await connection.execute(sql);
          await connection.execute('INSERT OR IGNORE INTO settings (id, data) VALUES (1, ?)', [JSON.stringify(DEFAULT_SETTINGS)]);
        });
        return db;
      } catch (error) {
        await db.close();
        throw error;
      }
    })().catch(error => { database = undefined; throw error; });
    return database;
  }
  const read = async <T>(work: (db: DatabaseConnection) => Promise<T>): Promise<T> => (await getDatabase()).read(work);
  const write = async <T>(work: (db: DatabaseConnection) => Promise<T>): Promise<T> => (await getDatabase()).write(work);

  const storage = {
    getSettings(): Promise<Settings> { return read(readSettings); },
    updateSettings(patch: Partial<Settings>): Promise<Settings> {
      return write(async db => {
        const settings = { ...await readSettings(db), ...patch };
        await db.execute('UPDATE settings SET data = ? WHERE id = 1', [JSON.stringify(settings)]);
        return settings;
      });
    },
    listSessions(): Promise<SessionRecord[]> {
      return read(async db => (await db.execute('SELECT data FROM sessions ORDER BY created_at DESC LIMIT 200')).rows.map(row => localizedSession(parse<SessionRecord>(row))!));
    },
    getSession(id: string): Promise<SessionRecord | null> { return read(db => readSession(db, id)); },
    createSession(guard?: SessionLeaseGuard): Promise<SessionRecord> {
      return write(async db => {
        const id = guard?.sessionId ?? randomUUID();
        await checkLease(db, guard, id);
        const session: SessionRecord = { id, title: defaultSessionTitle, createdAt: now(), endedAt: null, review: null };
        await db.execute('INSERT INTO sessions (id, created_at, data) VALUES (?, ?, ?)', [session.id, session.createdAt, JSON.stringify(session)]);
        return session;
      });
    },
    reopenSession(id: string, guard?: SessionLeaseGuard): Promise<SessionRecord> {
      return write(async db => {
        await checkLease(db, guard, id);
        const session = await readSession(db, id);
        if (!session) throw new Error('会話が見つかりません');
        session.endedAt = null;
        session.review = null;
        await db.execute('UPDATE sessions SET data = ? WHERE id = ?', [JSON.stringify(session), id]);
        return session;
      });
    },
    endSession(id: string, review?: LearningReview, guard?: SessionLeaseGuard): Promise<SessionRecord> {
      return write(async db => {
        await checkLease(db, guard, id);
        const session = await readSession(db, id);
        if (!session) throw new Error('会話が見つかりません');
        session.endedAt ??= now();
        if (review) session.review = review;
        await db.execute('UPDATE sessions SET data = ? WHERE id = ?', [JSON.stringify(session), id]);
        return session;
      });
    },
    saveReview(id: string, review: LearningReview, guardOrEndedAt?: SessionLeaseGuard | string): Promise<SessionRecord> {
      if (typeof guardOrEndedAt !== 'string') return storage.endSession(id, review, guardOrEndedAt);
      return write(async db => {
        const session = await readSession(db, id);
        if (!session?.endedAt || session.endedAt !== guardOrEndedAt) throw new SessionLeaseLostError();
        session.review = review;
        await db.execute('UPDATE sessions SET data = ? WHERE id = ?', [JSON.stringify(session), id]);
        return session;
      });
    },
    listMessages(sessionId: string): Promise<ChatMessage[]> {
      return read(async db => (await db.execute('SELECT data FROM (SELECT rowid, data FROM messages WHERE session_id = ? ORDER BY rowid DESC LIMIT 500) ORDER BY rowid', [sessionId])).rows.map(row => parse<ChatMessage>(row)!));
    },
    getMessage(id: string): Promise<ChatMessage | null> {
      return read(async db => parse<ChatMessage>((await db.execute('SELECT data FROM messages WHERE id = ?', [id])).rows[0]));
    },
    addMessage(input: Pick<ChatMessage, 'sessionId' | 'turnId' | 'role' | 'content' | 'delivery'>, guard?: SessionLeaseGuard): Promise<ChatMessage> {
      return write(async db => {
        await checkLease(db, guard, input.sessionId);
        const message: ChatMessage = { ...input, id: randomUUID(), spokenContent: '', interrupted: false, translation: null, createdAt: now() };
        await db.execute('INSERT INTO messages (id, session_id, created_at, data) VALUES (?, ?, ?, ?)', [message.id, message.sessionId, message.createdAt, JSON.stringify(message)]);
        const session = await readSession(db, message.sessionId);
        if (session && input.role === 'user' && session.title === defaultSessionTitle) {
          session.title = input.content.slice(0, 32);
          await db.execute('UPDATE sessions SET data = ? WHERE id = ?', [JSON.stringify(session), session.id]);
        }
        return message;
      });
    },
    updateMessage(id: string, patch: Partial<ChatMessage>, guard?: SessionLeaseGuard): Promise<ChatMessage> {
      return write(async db => {
        const current = parse<ChatMessage>((await db.execute('SELECT data FROM messages WHERE id = ?', [id])).rows[0]);
        if (!current) throw new Error('メッセージが見つかりません');
        await checkLease(db, guard, current.sessionId);
        const message = { ...current, ...patch, id: current.id, sessionId: current.sessionId };
        await db.execute('UPDATE messages SET data = ? WHERE id = ?', [JSON.stringify(message), id]);
        return message;
      });
    },
    listMemories(): Promise<MemoryRecord[]> {
      return read(async db => (await db.execute('SELECT data FROM memories ORDER BY created_at DESC LIMIT 200')).rows.map(row => parse<MemoryRecord>(row)!));
    },
    addMemory(content: string): Promise<MemoryRecord> {
      return write(async db => {
        const memory: MemoryRecord = { id: randomUUID(), content, createdAt: now(), updatedAt: now() };
        await db.execute('INSERT INTO memories (id, created_at, data) VALUES (?, ?, ?)', [memory.id, memory.createdAt, JSON.stringify(memory)]);
        return memory;
      });
    },
    updateMemory(id: string, content: string): Promise<MemoryRecord | null> {
      return write(async db => {
        const memory = parse<MemoryRecord>((await db.execute('SELECT data FROM memories WHERE id = ?', [id])).rows[0]);
        if (!memory) return null;
        memory.content = content;
        memory.updatedAt = now();
        await db.execute('UPDATE memories SET data = ? WHERE id = ?', [JSON.stringify(memory), id]);
        return memory;
      });
    },
    deleteMemory(id: string): Promise<boolean> {
      return write(async db => (await db.execute('DELETE FROM memories WHERE id = ?', [id])).rowsAffected > 0);
    },
    async recentReviews(limit: number): Promise<LearningReview[]> {
      return (await storage.listSessions()).filter(session => session.review).slice(0, Math.min(limit, 10)).map(session => session.review!);
    },
    async acquireSessionLease(sessionId: string, ownerId: string, ttlMs: number): Promise<boolean> {
      validateLease(sessionId, ownerId, ttlMs);
      return read(async db => (await db.execute(`INSERT INTO session_lease (id, session_id, owner_id, expires_at) VALUES (1, ?, ?, ${databaseNow} + ?)
        ON CONFLICT(id) DO UPDATE SET session_id = excluded.session_id, owner_id = excluded.owner_id, expires_at = excluded.expires_at
        WHERE session_lease.expires_at <= ${databaseNow} OR session_lease.owner_id = excluded.owner_id`, [sessionId, ownerId, ttlMs])).rowsAffected > 0);
    },
    async renewSessionLease(sessionId: string, ownerId: string, ttlMs: number): Promise<boolean> {
      validateLease(sessionId, ownerId, ttlMs);
      return read(async db => (await db.execute(`UPDATE session_lease SET expires_at = ${databaseNow} + ? WHERE id = 1 AND session_id = ? AND owner_id = ? AND expires_at > ${databaseNow}`, [ttlMs, sessionId, ownerId])).rowsAffected > 0);
    },
    async releaseSessionLease(sessionId: string, ownerId: string): Promise<void> {
      await read(db => db.execute('DELETE FROM session_lease WHERE id = 1 AND session_id = ? AND owner_id = ?', [sessionId, ownerId]));
    },
    getActiveSessionId(): Promise<string | null> {
      return read(async db => (await db.execute(`SELECT session_id FROM session_lease WHERE id = 1 AND expires_at > ${databaseNow}`)).rows[0]?.session_id as string | undefined ?? null);
    },
    async close(): Promise<void> {
      closed = true;
      const current = database;
      database = undefined;
      if (current) await (await current).close();
    },
  };
  return storage;
}

export const store = createStore({
  dataDir: config.dataDir,
  databaseUrl: process.env.TURSO_DATABASE_URL,
  authToken: process.env.TURSO_AUTH_TOKEN,
  deployment: config.cloud ? 'vercel' : process.env.VIRTUALMAID_DEPLOYMENT,
});
