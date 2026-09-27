import assert from 'node:assert/strict';
import { test } from 'node:test';
import { accessCookie, validAccessCookie, validBasicAuthorization, accessSecret, accessChallenge, isCloudDeployment } from '../shared/cloud-access.ts';
import { serviceAddress } from '../src/lib/service-address.ts';

const secret = 'test-only-long-password-0123456789';
const now = 1_800_000_000_000;
function preserveEnvironment(t, keys) {
  const previous = keys.map(key => [key, process.env[key]]);
  t.after(() => { for (const [key, value] of previous) { if (value === undefined) delete process.env[key]; else process.env[key] = value; } });
  for (const key of keys) delete process.env[key];
}

test('signed access cookies expire, reject tampering and duplicate values, and rotate with the password', () => {
  const cookie = accessCookie(secret, now);
  assert.match(cookie, /HttpOnly; Secure; SameSite=Strict/);
  assert.ok(validAccessCookie(cookie, secret, now));
  assert.ok(validAccessCookie(`virtualmaid-locale=ja; ${cookie}`, secret, now + 1000));
  assert.equal(validAccessCookie(`${cookie}; ${cookie}`, secret, now), false);
  assert.equal(validAccessCookie(cookie.replace(/=(\d)/, '=9'), secret, now), false);
  assert.equal(validAccessCookie(cookie, secret + 'changed', now), false);
  assert.equal(validAccessCookie(cookie, secret, now + 12 * 60 * 60 * 1000), false);
  assert.equal(validAccessCookie(cookie, secret, now - 1000), false);
  assert.equal(validAccessCookie('__Host-virtualmaid-access=arbitrary', secret, now), false);
  // Keep already issued login sessions valid across the application rename.
  const existingCookie = '__Host-virtualmaid-access=1800043200.9au2HFtoqKjTlMeDZ_rMVSdzMWFoBeASaYf5Pi0rtvg';
  assert.ok(validAccessCookie(existingCookie, secret, now));
  assert.equal(cookie.split(';')[0], existingCookie);
});

test('Basic authentication accepts the current and legacy usernames with the exact secret', () => {
  const auth = value => `Basic ${Buffer.from(value).toString('base64')}`;
  assert.equal(validBasicAuthorization(auth(`kaiwa-talk:${secret}`), secret), true);
  assert.equal(validBasicAuthorization(auth(`kaiwa-lab:${secret}`), secret), true);
  assert.equal(validBasicAuthorization(auth(`virtualmaid:${secret}`), secret), true);
  for (const value of [`other:${secret}`, `kaiwa-talk:${secret}extra`, 'kaiwa-talk:bad', `kaiwa-lab:${secret}extra`, 'kaiwa-lab:bad', 'virtualmaid:bad', `${secret}:`, '']) {
    assert.equal(validBasicAuthorization(auth(value), secret), false);
  }
  assert.equal(validBasicAuthorization('Basic !!!', secret), false);
  assert.equal(accessChallenge['WWW-Authenticate'], 'Basic realm="Kaiwa Talk", charset="UTF-8"');
});

test('cloud passwords prefer the newest setting, retain legacy fallbacks, and fail closed when explicitly empty', t => {
  preserveEnvironment(t, ['KAIWA_TALK_ACCESS_PASSWORD', 'KAIWA_LAB_ACCESS_PASSWORD', 'VIRTUALMAID_ACCESS_PASSWORD']);
  assert.throws(() => accessSecret(), /KAIWA_TALK_ACCESS_PASSWORD.*at least 24/);
  for (const prefix of ['VIRTUALMAID', 'KAIWA_LAB', 'KAIWA_TALK']) {
    const replacement = `${secret}-${prefix}`;
    process.env[`${prefix}_ACCESS_PASSWORD`] = replacement;
    assert.equal(accessSecret(), replacement);
    for (const value of ['', 'short']) {
      process.env[`${prefix}_ACCESS_PASSWORD`] = value;
      assert.throws(() => accessSecret(), /KAIWA_TALK_ACCESS_PASSWORD.*at least 24/);
    }
    process.env[`${prefix}_ACCESS_PASSWORD`] = replacement;
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
  assert.deepEqual(serviceAddress(local), { serviceUrl: 'http://127.0.0.1:13001', socketUrl: 'ws://127.0.0.1:13001/ws' });
  assert.deepEqual(serviceAddress(local, true), { serviceUrl: '', socketUrl: 'ws://localhost:13000/ws' });
});
