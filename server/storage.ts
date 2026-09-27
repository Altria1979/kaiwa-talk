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

async function checkLease(db: DatabaseConnection, browserId: string, guard: SessionLeaseGuard | undefined, sessionId: string): Promise<void> {
  if (!guard) return;
  if (guard.sessionId !== sessionId) throw new SessionLeaseLostError();
  const result = await db.execute(`SELECT session_id FROM browser_session_lease WHERE owner_id = ? AND session_id = ? AND holder_id = ? AND expires_at > ${databaseNow}`, [browserId, sessionId, guard.ownerId]);
  if (!result.rows.length) throw new SessionLeaseLostError();
}

async function readSettings(db: DatabaseConnection, browserId: string): Promise<Settings> {
  const settings = { ...DEFAULT_SETTINGS, ...parse<Settings>((await db.execute('SELECT data FROM browser_settings WHERE owner_id = ?', [browserId])).rows[0]) };
  // Only known built-in values are migrated; custom names, personas and models remain intact.
  if (settings.characterName === '小春') settings.characterName = DEFAULT_SETTINGS.characterName;
  if (settings.persona === '温柔、耐心、有好奇心的日语聊天伙伴。像朋友一样自然交流。') settings.persona = DEFAULT_SETTINGS.persona;
  settings.learningLanguage = languageNames.get(settings.learningLanguage) ?? settings.learningLanguage;
  settings.supportLanguage = settings.supportLanguage === '中文' ? DEFAULT_SETTINGS.supportLanguage : languageNames.get(settings.supportLanguage) ?? settings.supportLanguage;
  return settings;
}

async function readSession(db: DatabaseConnection, browserId: string, id: string): Promise<SessionRecord | null> {
  return localizedSession(parse<SessionRecord>((await db.execute('SELECT data FROM browser_sessions WHERE owner_id = ? AND id = ?', [browserId, id])).rows[0]));
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
          // Legacy shared tables stay untouched and are never assigned to an anonymous visitor.
          for (const sql of [
            'CREATE TABLE IF NOT EXISTS browser_settings (owner_id TEXT PRIMARY KEY NOT NULL, data TEXT NOT NULL)',
            'CREATE TABLE IF NOT EXISTS browser_sessions (owner_id TEXT NOT NULL, id TEXT NOT NULL, created_at TEXT NOT NULL, data TEXT NOT NULL, PRIMARY KEY (owner_id, id))',
            'CREATE INDEX IF NOT EXISTS browser_sessions_created ON browser_sessions(owner_id, created_at)',
            'CREATE TABLE IF NOT EXISTS browser_messages (owner_id TEXT NOT NULL, id TEXT NOT NULL, session_id TEXT NOT NULL, created_at TEXT NOT NULL, data TEXT NOT NULL, PRIMARY KEY (owner_id, id), FOREIGN KEY (owner_id, session_id) REFERENCES browser_sessions(owner_id, id))',
            'CREATE INDEX IF NOT EXISTS browser_messages_session ON browser_messages(owner_id, session_id, created_at)',
            'CREATE TABLE IF NOT EXISTS browser_memories (owner_id TEXT NOT NULL, id TEXT NOT NULL, created_at TEXT NOT NULL, data TEXT NOT NULL, PRIMARY KEY (owner_id, id))',
            'CREATE INDEX IF NOT EXISTS browser_memories_created ON browser_memories(owner_id, created_at)',
            'CREATE TABLE IF NOT EXISTS browser_session_lease (owner_id TEXT PRIMARY KEY NOT NULL, session_id TEXT NOT NULL, holder_id TEXT NOT NULL, expires_at INTEGER NOT NULL)',
          ]) await connection.execute(sql);
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

  function forOwner(browserId: string) {
    if (typeof browserId !== 'string' || !/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/.test(browserId)) throw new Error('Invalid browser owner');
    const storage = {
      getSettings(): Promise<Settings> { return read(db => readSettings(db, browserId)); },
      updateSettings(patch: Partial<Settings>): Promise<Settings> {
        return write(async db => {
          const settings = { ...await readSettings(db, browserId), ...patch };
          await db.execute('INSERT INTO browser_settings (owner_id, data) VALUES (?, ?) ON CONFLICT(owner_id) DO UPDATE SET data = excluded.data', [browserId, JSON.stringify(settings)]);
          return settings;
        });
      },
      listSessions(): Promise<SessionRecord[]> {
        return read(async db => (await db.execute('SELECT data FROM browser_sessions WHERE owner_id = ? ORDER BY created_at DESC LIMIT 200', [browserId])).rows.map(row => localizedSession(parse<SessionRecord>(row))!));
      },
      getSession(id: string): Promise<SessionRecord | null> { return read(db => readSession(db, browserId, id)); },
      createSession(guard?: SessionLeaseGuard): Promise<SessionRecord> {
        return write(async db => {
          const id = guard?.sessionId ?? randomUUID();
          await checkLease(db, browserId, guard, id);
          const session: SessionRecord = { id, title: defaultSessionTitle, createdAt: now(), endedAt: null, review: null };
          await db.execute('INSERT INTO browser_sessions (owner_id, id, created_at, data) VALUES (?, ?, ?, ?)', [browserId, session.id, session.createdAt, JSON.stringify(session)]);
          return session;
        });
      },
      reopenSession(id: string, guard?: SessionLeaseGuard): Promise<SessionRecord> {
        return write(async db => {
          await checkLease(db, browserId, guard, id);
          const session = await readSession(db, browserId, id);
          if (!session) throw new Error('会話が見つかりません');
          session.endedAt = null;
          session.review = null;
          await db.execute('UPDATE browser_sessions SET data = ? WHERE owner_id = ? AND id = ?', [JSON.stringify(session), browserId, id]);
          return session;
        });
      },
      endSession(id: string, review?: LearningReview, guard?: SessionLeaseGuard): Promise<SessionRecord> {
        return write(async db => {
          await checkLease(db, browserId, guard, id);
          const session = await readSession(db, browserId, id);
          if (!session) throw new Error('会話が見つかりません');
          session.endedAt ??= now();
          if (review) session.review = review;
          await db.execute('UPDATE browser_sessions SET data = ? WHERE owner_id = ? AND id = ?', [JSON.stringify(session), browserId, id]);
          return session;
        });
      },
      saveReview(id: string, review: LearningReview, guardOrEndedAt?: SessionLeaseGuard | string): Promise<SessionRecord> {
        if (typeof guardOrEndedAt !== 'string') return storage.endSession(id, review, guardOrEndedAt);
        return write(async db => {
          const session = await readSession(db, browserId, id);
          if (!session?.endedAt || session.endedAt !== guardOrEndedAt) throw new SessionLeaseLostError();
          session.review = review;
          await db.execute('UPDATE browser_sessions SET data = ? WHERE owner_id = ? AND id = ?', [JSON.stringify(session), browserId, id]);
          return session;
        });
      },
      listMessages(sessionId: string): Promise<ChatMessage[]> {
        return read(async db => (await db.execute('SELECT data FROM (SELECT rowid, data FROM browser_messages WHERE owner_id = ? AND session_id = ? ORDER BY rowid DESC LIMIT 500) ORDER BY rowid', [browserId, sessionId])).rows.map(row => parse<ChatMessage>(row)!));
      },
      getMessage(id: string): Promise<ChatMessage | null> {
        return read(async db => parse<ChatMessage>((await db.execute('SELECT data FROM browser_messages WHERE owner_id = ? AND id = ?', [browserId, id])).rows[0]));
      },
      addMessage(input: Pick<ChatMessage, 'sessionId' | 'turnId' | 'role' | 'content' | 'delivery'>, guard?: SessionLeaseGuard): Promise<ChatMessage> {
        return write(async db => {
          await checkLease(db, browserId, guard, input.sessionId);
          const message: ChatMessage = { ...input, id: randomUUID(), spokenContent: '', interrupted: false, translation: null, createdAt: now() };
          await db.execute('INSERT INTO browser_messages (owner_id, id, session_id, created_at, data) VALUES (?, ?, ?, ?, ?)', [browserId, message.id, message.sessionId, message.createdAt, JSON.stringify(message)]);
          const session = await readSession(db, browserId, message.sessionId);
          if (session && input.role === 'user' && session.title === defaultSessionTitle) {
            session.title = input.content.slice(0, 32);
            await db.execute('UPDATE browser_sessions SET data = ? WHERE owner_id = ? AND id = ?', [JSON.stringify(session), browserId, session.id]);
          }
          return message;
        });
      },
      updateMessage(id: string, patch: Partial<ChatMessage>, guard?: SessionLeaseGuard): Promise<ChatMessage> {
        return write(async db => {
          const current = parse<ChatMessage>((await db.execute('SELECT data FROM browser_messages WHERE owner_id = ? AND id = ?', [browserId, id])).rows[0]);
          if (!current) throw new Error('メッセージが見つかりません');
          await checkLease(db, browserId, guard, current.sessionId);
          const message = { ...current, ...patch, id: current.id, sessionId: current.sessionId };
          await db.execute('UPDATE browser_messages SET data = ? WHERE owner_id = ? AND id = ?', [JSON.stringify(message), browserId, id]);
          return message;
        });
      },
      listMemories(): Promise<MemoryRecord[]> {
        return read(async db => (await db.execute('SELECT data FROM browser_memories WHERE owner_id = ? ORDER BY created_at DESC LIMIT 200', [browserId])).rows.map(row => parse<MemoryRecord>(row)!));
      },
      addMemory(content: string): Promise<MemoryRecord> {
        return write(async db => {
          const memory: MemoryRecord = { id: randomUUID(), content, createdAt: now(), updatedAt: now() };
          await db.execute('INSERT INTO browser_memories (owner_id, id, created_at, data) VALUES (?, ?, ?, ?)', [browserId, memory.id, memory.createdAt, JSON.stringify(memory)]);
          return memory;
        });
      },
      updateMemory(id: string, content: string): Promise<MemoryRecord | null> {
        return write(async db => {
          const memory = parse<MemoryRecord>((await db.execute('SELECT data FROM browser_memories WHERE owner_id = ? AND id = ?', [browserId, id])).rows[0]);
          if (!memory) return null;
          memory.content = content;
          memory.updatedAt = now();
          await db.execute('UPDATE browser_memories SET data = ? WHERE owner_id = ? AND id = ?', [JSON.stringify(memory), browserId, id]);
          return memory;
        });
      },
      deleteMemory(id: string): Promise<boolean> {
        return write(async db => (await db.execute('DELETE FROM browser_memories WHERE owner_id = ? AND id = ?', [browserId, id])).rowsAffected > 0);
      },
      async recentReviews(limit: number): Promise<LearningReview[]> {
        return (await storage.listSessions()).filter(session => session.review).slice(0, Math.min(limit, 10)).map(session => session.review!);
      },
      async acquireSessionLease(sessionId: string, ownerId: string, ttlMs: number): Promise<boolean> {
        validateLease(sessionId, ownerId, ttlMs);
        return read(async db => (await db.execute(`INSERT INTO browser_session_lease (owner_id, session_id, holder_id, expires_at) VALUES (?, ?, ?, ${databaseNow} + ?)
          ON CONFLICT(owner_id) DO UPDATE SET session_id = excluded.session_id, holder_id = excluded.holder_id, expires_at = excluded.expires_at
          WHERE browser_session_lease.expires_at <= ${databaseNow} OR browser_session_lease.holder_id = excluded.holder_id`, [browserId, sessionId, ownerId, ttlMs])).rowsAffected > 0);
      },
      async renewSessionLease(sessionId: string, ownerId: string, ttlMs: number): Promise<boolean> {
        validateLease(sessionId, ownerId, ttlMs);
        return read(async db => (await db.execute(`UPDATE browser_session_lease SET expires_at = ${databaseNow} + ? WHERE owner_id = ? AND session_id = ? AND holder_id = ? AND expires_at > ${databaseNow}`, [ttlMs, browserId, sessionId, ownerId])).rowsAffected > 0);
      },
      async releaseSessionLease(sessionId: string, ownerId: string): Promise<void> {
        await read(db => db.execute('DELETE FROM browser_session_lease WHERE owner_id = ? AND session_id = ? AND holder_id = ?', [browserId, sessionId, ownerId]));
      },
      getActiveSessionId(): Promise<string | null> {
        return read(async db => (await db.execute(`SELECT session_id FROM browser_session_lease WHERE owner_id = ? AND expires_at > ${databaseNow}`, [browserId])).rows[0]?.session_id as string | undefined ?? null);
      },
    };
    return storage;
  }
  return {
    forOwner,
    async close(): Promise<void> {
      closed = true;
      const current = database;
      database = undefined;
      if (current) await (await current).close();
    },
  };
}

export type ScopedStore = ReturnType<ReturnType<typeof createStore>['forOwner']>;

export const store = createStore({
  dataDir: config.dataDir,
  databaseUrl: process.env.TURSO_DATABASE_URL,
  authToken: process.env.TURSO_AUTH_TOKEN,
  deployment: config.cloud ? 'vercel' : undefined,
});
