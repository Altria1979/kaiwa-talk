import assert from 'node:assert/strict';
import { test } from 'node:test';
import { browserCookie, browserIdFromCookie, browserSecret, isCloudDeployment } from '../shared/cloud-access.ts';
import { serviceAddress } from '../src/lib/service-address.ts';
const secret = 'test-only-long-secret-0123456789';
const now = 1_800_000_000_000;
const owner = '11111111-1111-4111-8111-111111111111';
function preserveEnvironment(t, keys) {
  const previous = keys.map(key => [key, process.env[key]]);
  t.after(() => { for (const [key, value] of previous) { if (value === undefined) delete process.env[key]; else process.env[key] = value; } });
  for (const key of keys) delete process.env[key];
}
test('browser identity is signed, expires, rejects duplicates, tampering and old login cookies', () => {
  const cookie = browserCookie(owner, secret, true, now);
  assert.match(cookie, /HttpOnly; Secure; SameSite=Strict/);
  assert.equal(browserIdFromCookie(cookie, secret, true, now), owner);
  assert.equal(browserIdFromCookie(`locale=ja; ${cookie}`, secret, true, now + 1000), owner);
  for (const value of [`${cookie}; ${cookie}`, cookie.replace(owner, '22222222-2222-4222-8222-222222222222'), '__Host-virtualmaid-access=1800043200.signature']) {
    assert.equal(browserIdFromCookie(value, secret, true, now), null);
  }
  assert.equal(browserIdFromCookie(cookie, secret + 'rotated', true, now), null);
  assert.equal(browserIdFromCookie(cookie, secret, true, now + 365 * 86400_000), null);
  assert.equal(browserIdFromCookie(cookie, secret, true, now - 1000), null);
  assert.throws(() => browserCookie('../legacy', secret, true, now));
});
test('local identity uses a separate cookie and never grants cloud access', () => {
  const cookie = browserCookie(owner, secret, false, now);
  assert.doesNotMatch(cookie, /Secure|__Host-/);
  assert.equal(browserIdFromCookie(cookie, secret, false, now), owner);
  assert.equal(browserIdFromCookie(cookie, secret, true, now), null);
});
test('browser signing secret prefers its dedicated setting and supports deployment rollout', t => {
  preserveEnvironment(t, ['KAIWA_TALK_BROWSER_SECRET', 'KAIWA_TALK_ACCESS_PASSWORD', 'KAIWA_LAB_ACCESS_PASSWORD', 'VIRTUALMAID_ACCESS_PASSWORD']);
  assert.throws(() => browserSecret(), /KAIWA_TALK_BROWSER_SECRET/);
  for (const key of ['VIRTUALMAID_ACCESS_PASSWORD', 'KAIWA_LAB_ACCESS_PASSWORD', 'KAIWA_TALK_ACCESS_PASSWORD', 'KAIWA_TALK_BROWSER_SECRET']) {
    process.env[key] = secret + key;
    assert.equal(browserSecret(), secret + key);
    process.env[key] = '';
    assert.throws(() => browserSecret(), /at least 24/);
    process.env[key] = secret + key;
  }
});

test('cloud deployment prefers the newest setting while retaining platform detection and legacy aliases', t => {
  preserveEnvironment(t, ['KAIWA_TALK_DEPLOYMENT', 'KAIWA_LAB_DEPLOYMENT', 'VIRTUALMAID_DEPLOYMENT', 'VERCEL']);
  assert.equal(isCloudDeployment(), false);
  for (const prefix of ['VIRTUALMAID', 'KAIWA_LAB', 'KAIWA_TALK']) {
    process.env[`${prefix}_DEPLOYMENT`] = '';
    assert.equal(isCloudDeployment(), false);
    process.env[`${prefix}_DEPLOYMENT`] = 'vercel';
    assert.equal(isCloudDeployment(), true);
  }
  process.env.KAIWA_TALK_DEPLOYMENT = '';
  process.env.VERCEL = '1';
  assert.equal(isCloudDeployment(), true);
});

test('online clients use same-origin HTTPS/WSS while local launcher ports stay compatible', () => {
  assert.deepEqual(serviceAddress({ hostname: 'example.vercel.app', protocol: 'https:', host: 'example.vercel.app', port: '' }), { serviceUrl: '', socketUrl: 'wss://example.vercel.app/ws' });
  const local = { hostname: 'localhost', protocol: 'http:', host: 'localhost:13000', port: '13000' };
  assert.deepEqual(serviceAddress(local), { serviceUrl: 'http://localhost:13001', socketUrl: 'ws://localhost:13001/ws' });
  assert.deepEqual(serviceAddress(local, true), { serviceUrl: '', socketUrl: 'ws://localhost:13000/ws' });
});
