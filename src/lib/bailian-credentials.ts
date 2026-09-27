import { AppError } from '../../shared/app-errors';
import type { BrowserBailianCredentials } from '../../shared/protocol';

const STORAGE_KEY = 'koharu.bailian-credentials.v1';
const CHANGE_EVENT = 'koharu:bailian-credentials-changed';
const UNAVAILABLE = 'storage-unavailable';

export function getBrowserCredentialsSnapshot(): string | null {
  if (typeof window === 'undefined') return null;
  try { return window.localStorage.getItem(STORAGE_KEY); }
  catch { return UNAVAILABLE; }
}

export function parseBrowserCredentials(snapshot: string | null): BrowserBailianCredentials | undefined {
  if (snapshot === null) return undefined;
  if (snapshot === UNAVAILABLE) throw new AppError('ブラウザーのローカルストレージにアクセスできません。このサイトのデータ保存を許可して、もう一度お試しください。');
  try {
    const value: unknown = JSON.parse(snapshot);
    if (!value || typeof value !== 'object' || !('apiKey' in value) || typeof value.apiKey !== 'string'
      || !/^[\x21-\x7e]{1,512}$/.test(value.apiKey)
      || ('apiHost' in value && (typeof value.apiHost !== 'string' || value.apiHost.length > 253))) throw new Error();
    return { apiKey: value.apiKey, ...('apiHost' in value ? { apiHost: value.apiHost as string } : {}) };
  } catch {
    throw new AppError('ブラウザーに保存した API キーを読み込めません。練習設定で保存し直すか、削除してください。');
  }
}

export function readBrowserCredentials(): BrowserBailianCredentials | undefined {
  return parseBrowserCredentials(getBrowserCredentialsSnapshot());
}

export function saveBrowserCredentials(credentials: BrowserBailianCredentials): void {
  const snapshot = JSON.stringify({ apiKey: credentials.apiKey, ...(credentials.apiHost ? { apiHost: credentials.apiHost } : {}) });
  parseBrowserCredentials(snapshot);
  try { window.localStorage.setItem(STORAGE_KEY, snapshot); }
  catch { throw new AppError('API キーを保存できませんでした。サイトの保存権限と空き容量を確認して、もう一度お試しください。'); }
  window.dispatchEvent(new Event(CHANGE_EVENT));
}

export function clearBrowserCredentials(): void {
  try { window.localStorage.removeItem(STORAGE_KEY); }
  catch { throw new AppError('API キーを削除できませんでした。サイトの保存権限を確認して、もう一度お試しください。'); }
  window.dispatchEvent(new Event(CHANGE_EVENT));
}

export function subscribeBrowserCredentials(onChange: () => void): () => void {
  const onStorage = (event: StorageEvent) => {
    if (event.key === STORAGE_KEY || event.key === null) onChange();
  };
  window.addEventListener('storage', onStorage);
  window.addEventListener(CHANGE_EVENT, onChange);
  return () => {
    window.removeEventListener('storage', onStorage);
    window.removeEventListener(CHANGE_EVENT, onChange);
  };
}

export function browserCredentialHeaders(credentials = readBrowserCredentials()): HeadersInit {
  if (!credentials) return {};
  return {
    'X-Bailian-Api-Key': credentials.apiKey,
    ...(credentials.apiHost ? { 'X-Bailian-Api-Host': credentials.apiHost } : {}),
  };
}
