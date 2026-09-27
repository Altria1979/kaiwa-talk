import { randomBytes } from 'node:crypto';
import { mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { browserSecret } from '../shared/cloud-access.js';

export function loadBrowserSecret(cloud: boolean, dataDir: string): string {
  if (cloud || process.env.KAIWA_TALK_BROWSER_SECRET !== undefined) return browserSecret();
  // Persist the local signing key across restarts without committing it to source.
  mkdirSync(dataDir, { recursive: true, mode: 0o700 });
  const path = join(dataDir, '.browser-secret');
  try { writeFileSync(path, randomBytes(32).toString('base64url'), { flag: 'wx', mode: 0o600 }); }
  catch (error) { if ((error as NodeJS.ErrnoException).code !== 'EEXIST') throw error; }
  const secret = readFileSync(path, 'utf8');
  if (secret.length < 24) throw new Error('Local browser signing secret is invalid.');
  return secret;
}
