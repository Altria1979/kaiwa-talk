import assert from 'node:assert/strict';
import { EventEmitter } from 'node:events';
import { Readable } from 'node:stream';
import { after, mock, test } from 'node:test';
import { browserCookie, browserIdFromCookie } from '../shared/cloud-access.ts';

const secret = 'cloud-http-test-only-secret-123456';
const a = '11111111-1111-4111-8111-111111111111';
const b = '22222222-2222-4222-8222-222222222222';
const id = 'aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa';
let handler, server, wss;
let upgrades = 0, reads = 0;
const boundOwners = [];
const settings = new Map();
mock.module('node:http', { exports: { createServer(fn) { handler = fn; server = new EventEmitter(); server.listen = () => server; return server; } } });
mock.module('ws', { exports: {
  default: class { static OPEN = 1; }, WebSocket: class { static OPEN = 1; },
  WebSocketServer: class extends EventEmitter {
    clients = new Set();
    constructor() {
      super();
      // eslint-disable-next-line @typescript-eslint/no-this-alias -- Capture the HTTP upgrade test server.
      wss = this;
    }
    handleUpgrade(req, transport, head, callback) {
      upgrades++;
      const ws = Object.assign(new EventEmitter(), { ping() {}, terminate() { this.emit('close'); } });
      this.clients.add(ws); ws.once('close', () => this.clients.delete(ws)); callback(ws);
    }
  },
} });
mock.module('../server/config.ts', { exports: {
  config: { cloud: true, browserSecret: secret, webPort: 3000, servicePort: 8080, publicOrigin: 'https://kaiwa.example' },
  CredentialError: class extends Error {}, getStatus: () => ({ ready: false }),
  parseBrowserCredentials: value => value, resolveBailianConfig: () => ({}),
} });
mock.module('../server/storage.ts', { exports: { store: { forOwner(owner) { return {
  owner,
  async getSettings() { reads++; return settings.get(owner) ?? { characterName: 'Default' }; },
  async updateSettings(patch) { settings.set(owner, patch); return patch; },
  async getActiveSessionId() { return owner === a ? id : null; },
  async getSession(value) { return owner === a && value === id ? { id } : null; },
  async listMessages() { return []; },
  async listSessions() { throw new Error('private-database-token'); },
}; } } } });
mock.module('../server/session.ts', { exports: { RealtimeSession: class {
  constructor(socket, store) { boundOwners.push(store.owner); }
  async dispose() {}
} } });
mock.module('../server/avatars.ts', { exports: {
  AvatarError: class extends Error {}, prepareAvatarUpload() {}, completeAvatarUpload() {}, saveLocalAvatar() {}, readAvatar() {},
  async assertAvatarOwner(owner) { if (owner !== a) { const error = new Error('foreign avatar'); error.status = 404; throw error; } },
} });
const signals = new Map(['SIGINT', 'SIGTERM'].map(signal => [signal, new Set(process.listeners(signal))]));
await import('../server/index.ts');
after(() => {
  for (const ws of wss.clients) ws.emit('close');
  for (const [signal, old] of signals) for (const fn of process.listeners(signal)) if (!old.has(fn)) process.off(signal, fn);
});
function request(path, headers = {}, method = 'GET', payload) {
  const req = Readable.from(payload ? [JSON.stringify(payload)] : []);
  Object.assign(req, { method, url: path, headers: { host: 'internal-service', ...(payload ? { 'content-type': 'application/json' } : {}), ...headers }, headersDistinct: {} });
  const res = new EventEmitter(); res.headers = {};
  res.setHeader = (key, value) => { res.headers[key] = value; };
  res.writeHead = (status, values = {}) => { res.status = status; Object.assign(res.headers, values); };
  return new Promise(resolve => {
    res.end = value => { res.writableEnded = true; res.body = value ? JSON.parse(value) : null; resolve(res); };
    handler(req, res);
  });
}
const cookie = (owner = a) => browserCookie(owner, secret).split(';')[0];
const origin = 'https://kaiwa.example';
test('public bootstrap creates a browser identity without Basic login and preserves existing identity', async () => {
  const first = await request('/api/browser', { origin }, 'POST');
  assert.equal(first.status, 200); assert.equal(first.headers['WWW-Authenticate'], undefined);
  assert.match(first.headers['Set-Cookie'], /HttpOnly; Secure; SameSite=Strict/);
  const owner = browserIdFromCookie(first.headers['Set-Cookie'], secret);
  assert.ok(owner);
  const next = await request('/api/browser', { origin, cookie: first.headers['Set-Cookie'].split(';')[0] }, 'POST');
  assert.equal(browserIdFromCookie(next.headers['Set-Cookie'], secret), owner);
  assert.equal((await request('/api/browser', { cookie: cookie() })).status, 200);
});
test('missing, forged and legacy cookies cannot read data; Basic headers never grant access', async () => {
  const before = reads;
  for (const headers of [{}, { cookie: '__Host-virtualmaid-access=legacy' }, { cookie: cookie().replace(a, b) }, { authorization: 'Basic ' + Buffer.from(`kaiwa-talk:${secret}`).toString('base64') }]) {
    const res = await request('/api/settings', headers);
    assert.equal(res.status, 401); assert.equal(res.body.errorCode, 'browserSessionRequired');
    assert.equal(res.headers['WWW-Authenticate'], undefined);
  }
  assert.equal(reads, before);
});
test('HTTP routes bind settings, session lookup and busy state to the verified browser only', async () => {
  const saved = await request('/api/settings', { origin, cookie: cookie(b) }, 'PUT', { characterName: 'Only B' });
  assert.equal(saved.status, 200);
  assert.equal((await request('/api/settings', { cookie: cookie(b) })).body.characterName, 'Only B');
  assert.equal((await request('/api/settings', { cookie: cookie(a) })).body.characterName, 'Default');
  assert.equal((await request('/api/status', { cookie: cookie(a) })).body.activeSessionId, id);
  assert.equal((await request('/api/status', { cookie: cookie(b) })).body.activeSessionId, null);
  assert.equal((await request(`/api/sessions/${id}`, { cookie: cookie(a) })).status, 200);
  assert.equal((await request(`/api/sessions/${id}`, { cookie: cookie(b) })).status, 404);
  const failed = await request('/api/sessions', { cookie: cookie() });
  assert.equal(failed.status, 500); assert.doesNotMatch(JSON.stringify(failed.body), /private-database-token/);
});
test('bootstrap, writes and sockets reject foreign origins; sockets bind separate stores and per-browser limits', async () => {
  for (const foreign of [undefined, 'https://attacker.example']) {
    for (const path of ['/api/browser', '/api/avatar/upload']) {
      assert.equal((await request(path, { cookie: cookie(), ...(foreign ? { origin: foreign } : {}) }, 'POST')).status, 403);
    }
  }
  const upgrade = headers => server.emit('upgrade', { url: '/ws', headers }, { write() {}, destroy() {} }, Buffer.alloc(0));
  upgrade({ origin }); upgrade({ origin: 'https://attacker.example', cookie: cookie() });
  assert.equal(upgrades, 0);
  for (let i = 0; i < 5; i++) upgrade({ origin, cookie: cookie(a) });
  assert.equal(upgrades, 4);
  upgrade({ origin, cookie: cookie(b) }); assert.equal(upgrades, 5);
  assert.deepEqual(boundOwners, [a, a, a, a, b]);
});
