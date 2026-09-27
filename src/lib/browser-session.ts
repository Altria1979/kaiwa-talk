import { AppError, APP_ERROR_MESSAGES } from '../../shared/app-errors';
import { serviceAddress } from './service-address';

const address = serviceAddress(typeof window === 'undefined' ? undefined : window.location, (process.env.NEXT_PUBLIC_KAIWA_TALK_SAME_ORIGIN ?? process.env.NEXT_PUBLIC_KAIWA_LAB_SAME_ORIGIN ?? process.env.NEXT_PUBLIC_VIRTUALMAID_SAME_ORIGIN) === '1');
export const SERVICE_URL = address.serviceUrl;
export const SOCKET_URL = address.socketUrl;

let session: Promise<void> | undefined;

async function bootstrap(): Promise<void> {
  const options = { credentials: 'include', cache: 'no-store', signal: AbortSignal.timeout(15_000) } as const;
  const created = await fetch(`${SERVICE_URL}/api/browser`, { ...options, method: 'POST' });
  if (!created.ok) throw new AppError(APP_ERROR_MESSAGES.serviceRequestFailed);
  // HttpOnly cookies cannot be inspected from JavaScript. Confirm the browser accepted it.
  const verified = await fetch(`${SERVICE_URL}/api/browser`, options);
  if (verified.status === 401) throw new AppError(APP_ERROR_MESSAGES.browserSessionRequired);
  if (!verified.ok) throw new AppError(APP_ERROR_MESSAGES.serviceRequestFailed);
}

export function ensureBrowserSession(): Promise<void> {
  if (!session) {
    // Each tab bootstraps inside the lock, using the cookie set by the preceding tab.
    session = (async () => {
      if (typeof navigator !== 'undefined' && navigator.locks) await navigator.locks.request('kaiwa-talk-browser-session', bootstrap);
      else await bootstrap();
    })().catch(error => {
      session = undefined;
      if (error instanceof AppError) throw error;
      throw new AppError(APP_ERROR_MESSAGES.serviceUnavailable);
    });
  }
  return session;
}
