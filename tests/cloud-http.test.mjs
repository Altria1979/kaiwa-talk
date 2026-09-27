import assert from 'node:assert/strict';
import { EventEmitter } from 'node:events';
import { after, mock, test } from 'node:test';
import { accessCookie } from '../shared/cloud-access.ts';

const secret = 'cloud-http-test-only-password-123456';
process.env.VIRTUALMAID_ACCESS_PASSWORD = secret;
let handler;
let server;
let upgrades = 0;
let reads = 0;
const activeSession = 'aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa';
mock.module('node:http', { exports: { createServer(fn) { handler = fn; server = new EventEmitter(); server.listen = () => server; return server; } } });
mock.module('ws', { exports: {
  default: class { static OPEN = 1; },
  WebSocket: class { static OPEN = 1; },
  WebSocketServer: class extends EventEmitter {
    clients = new Set();
    handleUpgrade() { upgrades++; }
  },
} });
mock.module('../server/config.ts', { exports: {
  config: { cloud: true, webPort: 3000, servicePort: 8080, publicOrigin: 'https://maid.example' },
  CredentialError: class extends Error {},
  getStatus: () => ({ ready: false }), parseBrowserCredentials: value => value, resolveBailianConfig: () => ({}),
} });
mock.module('../server/storage.ts', { exports: { store: {
  async getSettings() { reads++; return { characterName: 'Saved character' }; },
  async listSessions() { throw new Error('private-database-token'); },
} } });
mock.module('../server/session.ts', { exports: { RealtimeSession: class {}, getActiveSessionId: async () => activeSession } });
const signals = new Map(['SIGINT', 'SIGTERM'].map(signal => [signal, new Set(process.listeners(signal))]));
await import('../server/index.ts');
after(() => { for (const [signal, old] of signals) for (const fn of process.listeners(signal)) if (!old.has(fn)) process.off(signal, fn); });

function request(path, headers = {}, method = 'GET') {
  const req = new EventEmitter();
  Object.assign(req, { method, url: path, headers: { host: 'internal-service', ...headers }, headersDistinct: {} });
  const res = new EventEmitter();
  res.headers = {};
  res.setHeader = (key, value) => { res.headers[key] = value; };
  res.writeHead = (status, values = {}) => { res.status = status; Object.assign(res.headers, values); };
  return new Promise(resolve => {
    res.end = value => { res.writableEnded = true; res.body = value ? JSON.parse(value) : null; resolve(res); };
    handler(req, res);
  });
}
const cookie = () => accessCookie(secret).split(';')[0];

test('cloud data requires authentication and uses asynchronous storage across HTTP boundaries', async () => {
  const denied = await request('/api/settings');
  assert.equal(denied.status, 401);
  assert.equal(denied.body.errorCode, 'accessRequired');
  assert.match(denied.headers['WWW-Authenticate'], /Basic/);
  assert.equal(reads, 0);
  const settings = await request('/api/settings', { cookie: cookie() });
  assert.equal(settings.status, 200);
  assert.equal(settings.body.characterName, 'Saved character');
  const status = await request('/api/status', { cookie: cookie() });
  assert.equal(status.body.activeSessionId, activeSession);
});

test('successful Basic login sets a signed cookie and upstream exceptions stay private', async () => {
  const authorization = 'Basic ' + Buffer.from(`virtualmaid:${secret}`).toString('base64');
  const res = await request('/api/settings', { authorization });
  assert.equal(res.status, 200);
  assert.match(res.headers['Set-Cookie'], /HttpOnly; Secure; SameSite=Strict/);
  const failure = await request('/api/sessions', { cookie: cookie() });
  assert.equal(failure.status, 500);
  assert.doesNotMatch(JSON.stringify(failure.body), /private-database-token/);
});

test('cloud mutations and websocket upgrades reject cross-origin or unauthenticated requests', async () => {
  for (const origin of [undefined, 'https://attacker.example']) {
    const res = await request('/api/avatar/upload', { cookie: cookie(), ...(origin ? { origin } : {}) }, 'POST');
    assert.equal(res.status, 403);
  }
  for (const headers of [{ origin: 'https://maid.example' }, { cookie: cookie(), origin: 'https://attacker.example' }]) {
    const socket = { write: () => {}, destroy: () => {} };
    server.emit('upgrade', { url: '/ws', headers }, socket, Buffer.alloc(0));
  }
  assert.equal(upgrades, 0);
  server.emit('upgrade', { url: '/ws', headers: { cookie: cookie(), origin: 'https://maid.example' } }, {}, Buffer.alloc(0));
  assert.equal(upgrades, 1);
});
