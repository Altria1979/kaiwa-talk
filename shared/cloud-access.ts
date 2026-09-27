import { createHmac, timingSafeEqual } from 'node:crypto';

const BROWSER_SECONDS = 365 * 24 * 60 * 60;
const identifier = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/;
const cookieName = (secure: boolean) => secure ? '__Host-kaiwa-talk-browser' : 'kaiwa-talk-browser-local';
export const isCloudDeployment = () => (process.env.KAIWA_TALK_DEPLOYMENT ?? process.env.KAIWA_LAB_DEPLOYMENT ?? process.env.VIRTUALMAID_DEPLOYMENT) === 'vercel' || process.env.VERCEL === '1';

/** Legacy environment names are rollout fallbacks, never an interactive login. */
export function browserSecret(): string {
  const secret = process.env.KAIWA_TALK_BROWSER_SECRET ?? process.env.KAIWA_TALK_ACCESS_PASSWORD ?? process.env.KAIWA_LAB_ACCESS_PASSWORD ?? process.env.VIRTUALMAID_ACCESS_PASSWORD ?? '';
  if (secret.length < 24) throw new Error('KAIWA_TALK_BROWSER_SECRET must contain at least 24 characters.');
  return secret;
}
function signature(value: string, secret: string): string {
  return createHmac('sha256', secret).update(`kaiwa-talk-browser:v1:${value}`).digest('base64url');
}
export function browserIdFromCookie(cookie: string | undefined, secret: string, secure = true, now = Date.now()): string | null {
  const name = cookieName(secure);
  const values = (cookie ?? '').split(';').map(value => value.trim()).filter(value => value.startsWith(`${name}=`));
  if (values.length !== 1) return null;
  const value = values[0].slice(name.length + 1);
  const match = /^([0-9a-f-]{36})\.(\d{10})\.([A-Za-z0-9_-]{43})$/.exec(value);
  if (!match || !identifier.test(match[1])) return null;
  const expires = Number(match[2]);
  if (expires <= Math.floor(now / 1000) || expires > Math.floor(now / 1000) + BROWSER_SECONDS) return null;
  return timingSafeEqual(Buffer.from(match[3]), Buffer.from(signature(`${match[1]}.${match[2]}`, secret))) ? match[1] : null;
}
export function browserCookie(browserId: string, secret: string, secure = true, now = Date.now()): string {
  if (!identifier.test(browserId)) throw new Error('Invalid browser identity.');
  const value = `${browserId}.${Math.floor(now / 1000) + BROWSER_SECONDS}`;
  return `${cookieName(secure)}=${value}.${signature(value, secret)}; Path=/; HttpOnly; ${secure ? 'Secure; ' : ''}SameSite=Strict; Max-Age=${BROWSER_SECONDS}`;
}
