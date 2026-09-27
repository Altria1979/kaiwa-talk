import { createHmac, timingSafeEqual } from 'node:crypto';

export const ACCESS_COOKIE = '__Host-virtualmaid-access';
const SESSION_SECONDS = 12 * 60 * 60;
export const isCloudDeployment = () => process.env.VIRTUALMAID_DEPLOYMENT === 'vercel' || process.env.VERCEL === '1';

export function accessSecret(): string {
  const secret = process.env.VIRTUALMAID_ACCESS_PASSWORD ?? '';
  if (secret.length < 24) throw new Error('VIRTUALMAID_ACCESS_PASSWORD must contain at least 24 characters.');
  return secret;
}

function equal(a: string, b: string): boolean {
  const left = Buffer.from(a);
  const right = Buffer.from(b);
  return left.length === right.length && timingSafeEqual(left, right);
}

function signature(expires: string, secret: string): string {
  return createHmac('sha256', secret).update(`virtualmaid-access:v1:${expires}`).digest('base64url');
}

export function validAccessCookie(cookie: string | undefined, secret = accessSecret(), now = Date.now()): boolean {
  const values = (cookie ?? '').split(';').map(value => value.trim()).filter(value => value.startsWith(`${ACCESS_COOKIE}=`));
  if (values.length !== 1) return false;
  const value = values[0].slice(ACCESS_COOKIE.length + 1);
  const match = /^(\d{10})\.([A-Za-z0-9_-]{43})$/.exec(value);
  if (!match) return false;
  const expires = Number(match[1]);
  if (expires <= Math.floor(now / 1000) || expires > Math.floor(now / 1000) + SESSION_SECONDS) return false;
  return equal(match[2], signature(match[1], secret));
}

export function validBasicAuthorization(header: string | undefined, secret = accessSecret()): boolean {
  if (!header?.startsWith('Basic ') || header.length > 2048) return false;
  const encoded = header.slice(6);
  if (!/^[A-Za-z0-9+/]+={0,2}$/.test(encoded)) return false;
  return equal(Buffer.from(encoded, 'base64').toString('utf8'), `virtualmaid:${secret}`);
}

export function accessCookie(secret = accessSecret(), now = Date.now()): string {
  const expires = String(Math.floor(now / 1000) + SESSION_SECONDS);
  return `${ACCESS_COOKIE}=${expires}.${signature(expires, secret)}; Path=/; HttpOnly; Secure; SameSite=Strict; Max-Age=${SESSION_SECONDS}`;
}

export const accessChallenge = { 'WWW-Authenticate': 'Basic realm="VirtualMaid", charset="UTF-8"', 'Cache-Control': 'no-store' };
