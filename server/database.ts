import { mkdirSync } from 'node:fs';
import { join } from 'node:path';

type SqlValue = string | number | null;
type QueryResult = { rows: Record<string, unknown>[]; rowsAffected: number };
export type DatabaseConnection = { execute(sql: string, args?: SqlValue[]): Promise<QueryResult> };
export type DatabaseOptions = { dataDir: string; databaseUrl?: string; authToken?: string; deployment?: string };
export type DatabaseAdapter = {
  read<T>(work: (connection: DatabaseConnection) => Promise<T>): Promise<T>;
  write<T>(work: (connection: DatabaseConnection) => Promise<T>): Promise<T>;
  close(): Promise<void>;
};

/** Open connections on first storage use, never during the application build. */
export async function openDatabase(options: DatabaseOptions): Promise<DatabaseAdapter> {
  if (options.deployment === 'vercel' && (!options.databaseUrl || !options.authToken)) {
    throw new Error('Vercel requires TURSO_DATABASE_URL and TURSO_AUTH_TOKEN');
  }
  if (options.databaseUrl) {
    if (options.deployment === 'vercel' && !/^(libsql|https):\/\//.test(options.databaseUrl)) {
      throw new Error('Vercel requires a remote Turso database');
    }
    const { createClient } = await import('@libsql/client');
    const client = createClient({ url: options.databaseUrl, authToken: options.authToken });
    const connection: DatabaseConnection = {
      async execute(sql, args = []) {
        const result = await client.execute({ sql, args });
        return { rows: result.rows as Record<string, unknown>[], rowsAffected: result.rowsAffected };
      },
    };
    return {
      read: work => work(connection),
      async write(work) {
        const transaction = await client.transaction('write');
        try {
          const result = await work({
            async execute(sql, args = []) {
              const result = await transaction.execute({ sql, args });
              return { rows: result.rows as Record<string, unknown>[], rowsAffected: result.rowsAffected };
            },
          });
          await transaction.commit();
          return result;
        } catch (error) {
          await transaction.rollback().catch(() => {});
          throw error;
        } finally {
          transaction.close();
        }
      },
      async close() { client.close(); },
    };
  }

  const { default: Database } = await import('better-sqlite3');
  mkdirSync(options.dataDir, { recursive: true, mode: 0o700 });
  const db = new Database(join(options.dataDir, 'companion.sqlite'));
  db.pragma('journal_mode = WAL');
  db.pragma('foreign_keys = ON');
  const connection: DatabaseConnection = {
    async execute(sql, args = []) {
      const statement = db.prepare(sql);
      if (statement.reader) return { rows: statement.all(...args) as Record<string, unknown>[], rowsAffected: 0 };
      return { rows: [], rowsAffected: statement.run(...args).changes };
    },
  };
  // Keep ownership of the local connection across every await until commit/rollback.
  let pending: Promise<unknown> = Promise.resolve();
  function serialize<T>(work: () => Promise<T>): Promise<T> {
    const result = pending.then(work);
    pending = result.catch(() => {});
    return result;
  }
  return {
    read: work => serialize(() => work(connection)),
    write: work => serialize(async () => {
      db.exec('BEGIN IMMEDIATE');
      try {
        const result = await work(connection);
        db.exec('COMMIT');
        return result;
      } catch (error) {
        db.exec('ROLLBACK');
        throw error;
      }
    }),
    close: () => serialize(async () => { db.close(); }),
  };
}
