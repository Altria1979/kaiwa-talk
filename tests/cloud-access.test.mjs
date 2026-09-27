import assert from 'node:assert/strict';
import { test } from 'node:test';
import { accessCookie, validAccessCookie, validBasicAuthorization, accessSecret } from '../shared/cloud-access.ts';
import { serviceAddress } from '../src/lib/service-address.ts';

const secret = 'test-only-long-password-0123456789';
const now = 1_800_000_000_000;
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
});

test('Basic authentication requires the exact user and secret and missing cloud secrets fail closed', t => {
  const auth = value => `Basic ${Buffer.from(value).toString('base64')}`;
  assert.equal(validBasicAuthorization(auth(`virtualmaid:${secret}`), secret), true);
  for (const value of [`other:${secret}`, 'virtualmaid:bad', `${secret}:`, '']) {
    assert.equal(validBasicAuthorization(auth(value), secret), false);
  }
  assert.equal(validBasicAuthorization('Basic !!!', secret), false);
  const previous = process.env.VIRTUALMAID_ACCESS_PASSWORD;
  t.after(() => { if (previous === undefined) delete process.env.VIRTUALMAID_ACCESS_PASSWORD; else process.env.VIRTUALMAID_ACCESS_PASSWORD = previous; });
  delete process.env.VIRTUALMAID_ACCESS_PASSWORD;
  assert.throws(() => accessSecret(), /at least 24/);
});

test('online clients use same-origin HTTPS/WSS while local launcher ports stay compatible', () => {
  assert.deepEqual(serviceAddress({ hostname: 'example.vercel.app', protocol: 'https:', host: 'example.vercel.app', port: '' }), { serviceUrl: '', socketUrl: 'wss://example.vercel.app/ws' });
  const local = { hostname: 'localhost', protocol: 'http:', host: 'localhost:13000', port: '13000' };
  assert.deepEqual(serviceAddress(local), { serviceUrl: 'http://127.0.0.1:13001', socketUrl: 'ws://127.0.0.1:13001/ws' });
  assert.deepEqual(serviceAddress(local, true), { serviceUrl: '', socketUrl: 'ws://localhost:13000/ws' });
});
