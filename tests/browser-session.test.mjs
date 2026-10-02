import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { test } from 'node:test';

function check(script, location = { hostname: 'example.vercel.app', protocol: 'https:', host: 'example.vercel.app', port: '' }) {
  const environment = Object.fromEntries(Object.entries(process.env).filter(([key]) => !key.startsWith('NEXT_PUBLIC_')));
  const result = spawnSync(process.execPath, ['--import', 'tsx', '--input-type=module', '-e', `
    import assert from 'node:assert/strict';
    import { setImmediate as nextTick } from 'node:timers/promises';
    globalThis.window = { location: ${JSON.stringify(location)} };
    const { api, ensureBrowserSession, SERVICE_URL, SOCKET_URL } = await import('./src/lib/api.ts');
    const ok = () => new Response(JSON.stringify({ ok: true }), { status: 200 });
    ${script}
  `], { cwd: new URL('../', import.meta.url), env: environment, encoding: 'utf8', timeout: 15_000 });
  assert.equal(result.status, 0, result.stderr || result.error?.message);
}

test('concurrent browser requests share one bootstrap and wait for its cookie probe', () => {
  check(`
    const calls = [];
    let finishBootstrap;
    let finishProbe;
    const locks = [];
    Object.defineProperty(globalThis, 'navigator', { configurable: true, value: { locks: {
      async request(name, callback) { locks.push(name); return callback(); },
    } } });
    globalThis.fetch = async (url, options) => {
      calls.push({ url, options });
      if (options.method === 'POST') return new Promise(resolve => { finishBootstrap = () => resolve(ok()); });
      if (url.endsWith('/api/browser')) return new Promise(resolve => { finishProbe = () => resolve(ok()); });
      return ok();
    };
    const pending = Promise.all([api.settings(), api.status({ apiKey: 'test-key' }), api.session('active-session')]);
    await nextTick();
    assert.deepEqual(calls.map(call => call.url), ['/api/browser']);
    finishBootstrap();
    await nextTick();
    assert.deepEqual(calls.map(call => call.url), ['/api/browser', '/api/browser']);
    finishProbe();
    await pending;
    assert.deepEqual(locks, ['kaiwa-talk-browser-session']);
    assert.equal(calls.filter(call => call.options.method === 'POST').length, 1);
    assert.equal(calls.length, 5);
    for (const { options } of calls) {
      assert.equal(options.credentials, 'include');
      assert.equal(options.cache, 'no-store');
      assert.ok(options.signal instanceof AbortSignal);
    }
  `);
});

test('a failed bootstrap releases its promise so a later request can retry safely', () => {
  check(`
    let attempts = 0;
    globalThis.fetch = async (url, options) => {
      if (options.method === 'POST' && ++attempts === 1) throw new Error('private network details');
      return ok();
    };
    await assert.rejects(api.settings(), { errorCode: 'serviceUnavailable' });
    await api.settings();
    assert.equal(attempts, 2);
  `);
});

test('blocked cookies prevent both reads and writes after the bootstrap probe', () => {
  check(`
    const calls = [];
    globalThis.fetch = async (url, options) => {
      calls.push({ url, method: options.method });
      return options.method === 'POST' ? ok() : new Response('{}', { status: 401 });
    };
    await assert.rejects(api.saveSettings({ characterName: 'never saved' }), { errorCode: 'browserSessionRequired' });
    assert.deepEqual(calls.map(call => call.url), ['/api/browser', '/api/browser']);
    assert.equal(calls.some(call => call.method === 'PUT'), false);
  `);
});

test('a lost cookie never reboots identity or retries an API write', () => {
  check(`
    const calls = [];
    globalThis.fetch = async (url, options) => {
      calls.push({ url, options });
      if (url.endsWith('/api/browser')) return ok();
      return new Response(JSON.stringify({ error: 'cookie missing', errorCode: 'browserSessionRequired' }), { status: 401 });
    };
    await ensureBrowserSession();
    await assert.rejects(api.saveSettings({ characterName: 'private draft' }), { errorCode: 'browserSessionRequired' });
    await assert.rejects(api.settings(), { errorCode: 'browserSessionRequired' });
    assert.equal(calls.filter(call => call.url.endsWith('/api/browser')).length, 2);
    assert.equal(calls.filter(call => call.options.method === 'PUT').length, 1);
  `);
});

test('local API and WebSocket addresses retain the page hostname and transport cookies', () => {
  for (const hostname of ['localhost', '127.0.0.1', '[::1]']) check(`
    assert.equal(SERVICE_URL, 'http://${hostname}:13001');
    assert.equal(SOCKET_URL, 'ws://${hostname}:13001/ws');
    const calls = [];
    globalThis.fetch = async (url, options) => { calls.push({ url, options }); return ok(); };
    await api.status({ apiKey: 'browser-test-key' });
    assert.deepEqual(calls.map(call => call.url), [SERVICE_URL + '/api/browser', SERVICE_URL + '/api/browser', SERVICE_URL + '/api/status']);
    for (const call of calls) assert.equal(call.options.credentials, 'include');
    assert.equal(calls[0].options.headers, undefined);
    assert.equal(calls[1].options.headers, undefined);
    assert.equal(new Headers(calls[2].options.headers).get('x-bailian-api-key'), 'browser-test-key');
  `, { hostname, protocol: 'http:', host: `${hostname}:13000`, port: '13000' });
});

test('separate tabs serialize bootstraps and reuse the cookie created inside the preceding lock', () => {
  check(`
    let queue = Promise.resolve();
    let cookie;
    let minted = 0;
    let posts = 0;
    Object.defineProperty(globalThis, 'navigator', { configurable: true, value: { locks: {
      request(name, callback) {
        assert.equal(name, 'kaiwa-talk-browser-session');
        const work = queue.then(callback);
        queue = work.catch(() => {});
        return work;
      },
    } } });
    globalThis.fetch = async (url, options) => {
      if (options.method === 'POST') {
        posts++;
        const existing = cookie;
        await nextTick();
        cookie = existing ?? 'owner-' + (++minted);
      }
      return cookie ? ok() : new Response('{}', { status: 401 });
    };
    const tabA = await import('./src/lib/browser-session.ts?tab=A');
    const tabB = await import('./src/lib/browser-session.ts?tab=B');
    await Promise.all([tabA.ensureBrowserSession(), tabB.ensureBrowserSession()]);
    assert.equal(posts, 2);
    assert.equal(minted, 1);
  `);
});
