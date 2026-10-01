import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { EventEmitter } from 'node:events';
import { browserCookie } from '../shared/cloud-access.ts';
import { after, mock, test } from 'node:test';

// Valid legacy settings must never authorize a request without a browser key.
Object.assign(process.env, {
  BAILIAN_API_KEY: 'legacy-server-key-must-not-be-used',
  BAILIAN_REGION: 'cn-beijing', BAILIAN_WORKSPACE_ID: 'legacy-workspace',
  BAILIAN_CHAT_BASE_URL: 'https://dashscope.aliyuncs.com/compatible-mode/v1',
  BAILIAN_ASR_URL: 'wss://dashscope.aliyuncs.com/api-ws/v1/inference',
  BAILIAN_REALTIME_URL: 'wss://dashscope.aliyuncs.com/api-ws/v1/realtime',
});
delete process.env.VERCEL;
delete process.env.VIRTUALMAID_DEPLOYMENT;
const { config, getStatus, resolveBailianConfig } = await import('../server/config.ts');
let handler;
let writes = 0;
mock.module('node:http', { exports: { createServer(fn) {
  handler = fn;
  const server = new EventEmitter();
  server.listen = () => server;
  return server;
} } });
mock.module('ws', { exports: {
  default: class { static OPEN = 1; },
  WebSocket: class { static OPEN = 1; },
  WebSocketServer: class extends EventEmitter { clients = new Set(); },
} });
const scopedStore = {
  getActiveSessionId: async () => null,
  acquireSessionLease: async () => { writes++; return false; },
  getMessage: async () => { throw new Error('Must reject missing credentials before reading message'); },
};
mock.module('../server/storage.ts', { exports: { store: { forOwner: () => scopedStore } } });
const { RealtimeSession } = await import('../server/session.ts');
const signals = new Map(['SIGINT', 'SIGTERM'].map(signal => [signal, new Set(process.listeners(signal))]));
await import('../server/index.ts');
after(() => { for (const [signal, old] of signals) for (const fn of process.listeners(signal)) if (!old.has(fn)) process.off(signal, fn); });

function request(path, credentials, method = 'GET') {
  const headers = { cookie: browserCookie('11111111-1111-4111-8111-111111111111', config.browserSecret, false).split(';')[0], host: `127.0.0.1:${config.servicePort}`, origin: `http://localhost:${config.webPort}` };
  if (credentials) {
    headers['x-bailian-api-key'] = credentials.apiKey;
    if (credentials.apiHost) headers['x-bailian-api-host'] = credentials.apiHost;
  }
  const req = Object.assign(new EventEmitter(), { method, url: path, headers,
    headersDistinct: Object.fromEntries(Object.entries(headers).map(([key, value]) => [key, [value]])) });
  const res = new EventEmitter();
  res.setHeader = () => {};
  res.writeHead = status => { res.status = status; };
  return new Promise(resolve => {
    res.end = value => { res.writableEnded = true; res.body = JSON.parse(value); resolve(res); };
    handler(req, res);
  });
}

test('TTS model and default voice are paired code constants regardless of legacy environment settings', () => {
  const environment = Object.fromEntries(Object.entries(process.env).filter(([key]) => !/^(BAILIAN_TTS_|KAIWA_TALK_|KAIWA_LAB_|VIRTUALMAID_|KOHARU_|VERCEL$|PORT$)/.test(key)));
  for (const overrides of [
    {},
    { BAILIAN_TTS_MODEL: 'qwen3-tts-flash-realtime', BAILIAN_TTS_VOICE: 'Cherry' },
  ]) {
    const result = spawnSync(process.execPath, ['--import', 'tsx', '--input-type=module', '-e', `
      const { config } = await import('./server/config.ts');
      const { DEFAULT_SETTINGS } = await import('./shared/protocol.ts');
      console.log(JSON.stringify({ voice: DEFAULT_SETTINGS.voice, model: config.ttsModel }));
    `], { cwd: new URL('../', import.meta.url), env: { ...environment, ...overrides }, encoding: 'utf8', timeout: 15_000 });
    assert.equal(result.status, 0, result.stderr || result.error?.message);
    assert.deepEqual(JSON.parse(result.stdout), {
      voice: 'qwen-tts-vc-kaiwa-voice-20261001155111507-6512',
      model: 'qwen3-tts-vc-realtime-2026-01-15',
    });
  }
});

test('legacy server credentials and endpoints cannot make an unconfigured browser ready', () => {
  const runtime = resolveBailianConfig();
  assert.equal(runtime.apiKey, '');
  assert.equal(runtime.credentialSource, 'none');
  assert.equal(runtime.region, null);
  assert.equal(runtime.chatBaseUrl, '');
  assert.equal(runtime.asrUrl, '');
  assert.equal(runtime.realtimeUrl, '');
  assert.deepEqual(getStatus(runtime).missing, ['BAILIAN_API_KEY']);
  assert.equal(getStatus(runtime).ready, false);
});

test('only the supplied browser key and approved host select the provider credentials', () => {
  for (const [apiHost, region] of [
    ['dashscope.aliyuncs.com', 'cn-beijing'],
    ['dashscope-intl.aliyuncs.com', 'ap-southeast-1'],
    ['workspace.cn-beijing.maas.aliyuncs.com', 'cn-beijing'],
  ]) {
    const runtime = resolveBailianConfig({ apiKey: 'browser-test-key', apiHost });
    assert.equal(runtime.apiKey, 'browser-test-key');
    assert.equal(runtime.credentialSource, 'browser');
    assert.equal(runtime.region, region);
    assert.equal(runtime.chatBaseUrl, `https://${apiHost}/compatible-mode/v1`);
    assert.equal(getStatus(runtime).ready, true);
  }
  assert.throws(() => resolveBailianConfig({ apiKey: 'browser-test-key', apiHost: 'attacker.example' }), { errorCode: 'hostNotAllowed' });
  assert.throws(() => resolveBailianConfig({ apiKey: '' }), { errorCode: 'apiKeyRequired' });
});

test('HTTP status reflects saving and deleting a browser key without server fallback or key disclosure', async () => {
  for (const credentials of [undefined, { apiKey: 'browser-test-key' }, undefined]) {
    const res = await request('/api/status', credentials);
    assert.equal(res.status, 200);
    assert.equal(res.body.ready, Boolean(credentials));
    assert.equal(res.body.credentialSource, credentials ? 'browser' : 'none');
    assert.doesNotMatch(JSON.stringify(res.body), /browser-test-key|legacy-server-key/);
  }
});

test('HTTP translation and suggestion audio require a browser key before model or storage work', async () => {
  const id = 'aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa';
  for (const path of [`/api/messages/${id}/translate`, `/api/messages/${id}/suggestions/0/audio`]) {
    const res = await request(path, undefined, 'POST');
    assert.equal(res.status, 400);
    assert.equal(res.body.errorCode, 'apiKeyRequired');
  }
});

test('text, voice and resumed sessions without credentials ask for settings and never acquire a lease', async () => {
  for (const event of [
    { type: 'start', voice: false },
    { type: 'start', voice: true },
    { type: 'start', voice: false, sessionId: 'saved-session', resume: true },
  ]) {
    const sent = [];
    const session = new RealtimeSession({ readyState: 1, send: value => sent.push(JSON.parse(value)) }, scopedStore);
    await session.handle(event);
    assert.equal(session.sessionId, null);
    assert.equal(sent.length, 1);
    assert.equal(sent[0].errorCode, 'apiKeyRequired');
    assert.equal(sent[0].source, 'config');
    await session.dispose();
  }
  assert.equal(writes, 0);
});
