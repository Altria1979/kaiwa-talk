import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { test } from 'node:test';

const root = new URL('../', import.meta.url);
const cleanEnvironment = Object.fromEntries(Object.entries(process.env).filter(([key]) => !/^(KAIWA_TALK_|KAIWA_LAB_|VIRTUALMAID_|KOHARU_|NEXT_PUBLIC_(KAIWA_TALK|KAIWA_LAB|VIRTUALMAID)_|VERCEL$|PORT$)/.test(key)));

function run(script, environment = {}) {
  return spawnSync(process.execPath, ['--import', 'tsx', '--experimental-test-module-mocks', '--input-type=module', '-e', script], {
    cwd: root, env: { ...cleanEnvironment, ...environment }, encoding: 'utf8', timeout: 15_000,
  });
}

function output(script, environment) {
  const result = run(script, environment);
  assert.equal(result.status, 0, result.stderr || result.error?.message);
  return JSON.parse(result.stdout);
}

const portScript = `
  import { mock } from 'node:test';
  import { EventEmitter } from 'node:events';
  const launches = [];
  mock.module('node:child_process', { exports: { spawn(executable, args) {
    launches.push(args);
    return Object.assign(new EventEmitter(), { exitCode: null, signalCode: null, kill() {} });
  } } });
  await import('./scripts/run.mjs');
  const { config } = await import('./server/config.ts');
  console.log(JSON.stringify({ launcherPort: Number(launches[0].at(-1)), webPort: config.webPort, servicePort: config.servicePort, launches: launches.length }));
`;

test('launcher and server agree on default, legacy and preferred web ports', () => {
  for (const [environment, port] of [
    [{}, 3000],
    [{ KOHARU_WEB_PORT: '' }, 3000],
    [{ KOHARU_WEB_PORT: '13000' }, 13000],
    [{ KAIWA_LAB_WEB_PORT: '14000' }, 14000],
    [{ KAIWA_LAB_WEB_PORT: '15000', KOHARU_WEB_PORT: '13000' }, 15000],
    [{ KAIWA_TALK_WEB_PORT: '16000' }, 16000],
    [{ KAIWA_TALK_WEB_PORT: '16000', KAIWA_LAB_WEB_PORT: '14000', KOHARU_WEB_PORT: '13000' }, 16000],
  ]) {
    assert.deepEqual(output(portScript, environment), { launcherPort: port, webPort: port, servicePort: port + 1, launches: 2 });
  }
});

test('invalid preferred ports cannot fall back to a valid legacy port', () => {
  for (const key of ['KAIWA_LAB_WEB_PORT', 'KAIWA_TALK_WEB_PORT']) {
    for (const value of ['', '1023', '65535', '13000.5', 'invalid']) {
      const environment = { KOHARU_WEB_PORT: '13000', KAIWA_LAB_WEB_PORT: '14000', [key]: value };
      for (const script of [portScript, "await import('./server/config.ts');"]) {
        const result = run(script, environment);
        assert.notEqual(result.status, 0);
        assert.match(result.stderr, /KAIWA_TALK_WEB_PORT/);
      }
    }
  }
});

const cloudScript = `
  const { config } = await import('./server/config.ts');
  console.log(JSON.stringify({ cloud: config.cloud, publicOrigin: config.publicOrigin, servicePort: config.servicePort }));
`;
const cloudStorage = { TURSO_DATABASE_URL: 'libsql://test.invalid', TURSO_AUTH_TOKEN: 'test-only-token', BLOB_READ_WRITE_TOKEN: 'test-only-token' };
const secret = 'test-only-cloud-password-0123456789';

test('cloud configuration supports all naming generations and gives the preferred origin priority', () => {
  const namingGenerations = ['VIRTUALMAID', 'KAIWA_LAB', 'KAIWA_TALK'];
  const environment = {};
  for (const prefix of namingGenerations) {
    environment[`${prefix}_DEPLOYMENT`] = 'vercel';
    environment[`${prefix}_PUBLIC_ORIGIN`] = `https://${prefix.toLowerCase().replaceAll('_', '-')}.example`;
    environment[`${prefix}_ACCESS_PASSWORD`] = secret;
    assert.deepEqual(output(cloudScript, { ...cloudStorage, ...environment }), {
      cloud: true, publicOrigin: environment[`${prefix}_PUBLIC_ORIGIN`], servicePort: 8080,
    });
  }
  for (const prefix of ['KAIWA_LAB', 'KAIWA_TALK']) {
    const result = run(cloudScript, {
      ...cloudStorage, VIRTUALMAID_DEPLOYMENT: 'vercel', VIRTUALMAID_ACCESS_PASSWORD: secret,
      VIRTUALMAID_PUBLIC_ORIGIN: 'https://legacy.example', KAIWA_LAB_PUBLIC_ORIGIN: 'https://kaiwa-lab.example',
      [`${prefix}_PUBLIC_ORIGIN`]: '',
    });
    assert.notEqual(result.status, 0, `${prefix} must not fall back from an empty origin`);
  }
});

test('storage uses the resolved deployment mode when the new setting overrides the legacy one', () => {
  const script = `
    import { mock } from 'node:test';
    let databaseOptions;
    mock.module('./server/database.ts', { exports: { async openDatabase(options) {
      databaseOptions = options;
      throw new Error('database-probe');
    } } });
    const { config } = await import('./server/config.ts');
    const { store } = await import('./server/storage.ts');
    try { await store.getSettings(); } catch (error) { if (error.message !== 'database-probe') throw error; }
    console.log(JSON.stringify({ cloud: config.cloud, deployment: databaseOptions.deployment ?? null }));
  `;
  for (const deployment of [
    { KAIWA_LAB_DEPLOYMENT: '', VIRTUALMAID_DEPLOYMENT: 'vercel' },
    { KAIWA_TALK_DEPLOYMENT: '', KAIWA_LAB_DEPLOYMENT: 'vercel', VIRTUALMAID_DEPLOYMENT: 'vercel' },
  ]) {
    assert.deepEqual(output(script, deployment), { cloud: false, deployment: null });
  }
  for (const deployment of [{ KAIWA_TALK_DEPLOYMENT: 'vercel' }, { KAIWA_LAB_DEPLOYMENT: 'vercel' }, { VIRTUALMAID_DEPLOYMENT: 'vercel' }]) {
    assert.deepEqual(output(script, {
      ...cloudStorage, ...deployment, KAIWA_LAB_ACCESS_PASSWORD: secret, KAIWA_LAB_PUBLIC_ORIGIN: 'https://kaiwa.example',
    }), { cloud: true, deployment: 'vercel' });
  }
});

const clientScript = `
  globalThis.window = { location: { hostname: 'localhost', protocol: 'http:', host: 'localhost:13000', port: '13000' } };
  const { SERVICE_URL, SOCKET_URL } = await import('./src/lib/api.ts');
  console.log(JSON.stringify({ serviceUrl: SERVICE_URL, socketUrl: SOCKET_URL }));
`;

test('browser same-origin mode supports the legacy alias with explicit new-setting precedence', () => {
  for (const [environment, sameOrigin] of [
    [{}, false],
    [{ NEXT_PUBLIC_VIRTUALMAID_SAME_ORIGIN: '1' }, true],
    [{ NEXT_PUBLIC_KAIWA_LAB_SAME_ORIGIN: '1' }, true],
    [{ NEXT_PUBLIC_KAIWA_TALK_SAME_ORIGIN: '1' }, true],
    [{ NEXT_PUBLIC_KAIWA_TALK_SAME_ORIGIN: '1', NEXT_PUBLIC_KAIWA_LAB_SAME_ORIGIN: '0', NEXT_PUBLIC_VIRTUALMAID_SAME_ORIGIN: '0' }, true],
    [{ NEXT_PUBLIC_KAIWA_TALK_SAME_ORIGIN: '0', NEXT_PUBLIC_KAIWA_LAB_SAME_ORIGIN: '1', NEXT_PUBLIC_VIRTUALMAID_SAME_ORIGIN: '1' }, false],
    [{ NEXT_PUBLIC_KAIWA_TALK_SAME_ORIGIN: '', NEXT_PUBLIC_KAIWA_LAB_SAME_ORIGIN: '1', NEXT_PUBLIC_VIRTUALMAID_SAME_ORIGIN: '1' }, false],
    [{ NEXT_PUBLIC_KAIWA_LAB_SAME_ORIGIN: '0', NEXT_PUBLIC_VIRTUALMAID_SAME_ORIGIN: '1' }, false],
    [{ NEXT_PUBLIC_KAIWA_LAB_SAME_ORIGIN: '', NEXT_PUBLIC_VIRTUALMAID_SAME_ORIGIN: '1' }, false],
  ]) {
    assert.deepEqual(output(clientScript, environment), sameOrigin
      ? { serviceUrl: '', socketUrl: 'ws://localhost:13000/ws' }
      : { serviceUrl: 'http://127.0.0.1:13001', socketUrl: 'ws://127.0.0.1:13001/ws' });
  }
});
