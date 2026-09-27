import { AppError, describeError, type ErrorDescriptor } from '../../shared/app-errors';
import { MAX_MODEL_BYTES, type BrowserBailianCredentials, type ChatMessage, type MemoryRecord, type ServiceStatus, type SessionRecord, type Settings } from '../../shared/protocol';
import { browserCredentialHeaders, readBrowserCredentials } from './bailian-credentials';
import { serviceAddress } from './service-address';

const address = serviceAddress(typeof window === 'undefined' ? undefined : window.location, process.env.NEXT_PUBLIC_VIRTUALMAID_SAME_ORIGIN === '1');
export const SERVICE_URL = address.serviceUrl;
export const SOCKET_URL = address.socketUrl;

async function request<T>(path: string, options: RequestInit = {}, timeout = 15_000): Promise<T> {
  try {
    const response = await fetch(`${SERVICE_URL}${path}`, {
      ...options,
      cache: 'no-store',
      credentials: 'same-origin',
      signal: options.signal ? AbortSignal.any([options.signal, AbortSignal.timeout(timeout)]) : AbortSignal.timeout(timeout),
    });
    const result = await response.json() as T & { error?: string } & Partial<ErrorDescriptor>;
    if (!response.ok) throw new ApiError(typeof result.error === 'string' ? result.error : 'ローカルサービスでリクエストを完了できませんでした。', describeError(result));
    return result;
  } catch (error) {
    if (error instanceof ApiError) throw error;
    throw new ApiError('ローカルサービスに接続できません。アプリが起動していることを確認して、もう一度お試しください。');
  }
}

export class ApiError extends AppError {}

const json = (method: string, value: unknown): RequestInit => ({
  method,
  headers: { 'Content-Type': 'application/json' },
  body: JSON.stringify(value),
});

export const api = {
  status: async (credentials: BrowserBailianCredentials | undefined = readBrowserCredentials()) => request<ServiceStatus>('/api/status', { headers: browserCredentialHeaders(credentials) }),
  settings: () => request<Settings>('/api/settings'),
  saveSettings: (settings: Partial<Settings>) => request<Settings>('/api/settings', json('PUT', settings)),
  sessions: () => request<SessionRecord[]>('/api/sessions'),
  session: (id: string) => request<{ session: SessionRecord; messages: ChatMessage[] }>(`/api/sessions/${encodeURIComponent(id)}`),
  translate: async (id: string) => request<{ translation: string }>(`/api/messages/${encodeURIComponent(id)}/translate`, { method: 'POST', headers: browserCredentialHeaders() }, 70_000),
  suggestionAudio: (id: string, index: number, signal: AbortSignal) => request<{ audio: string; sampleRate: 24000 }>(
    `/api/messages/${encodeURIComponent(id)}/suggestions/${index}/audio`,
    { method: 'POST', headers: browserCredentialHeaders(), signal },
    70_000,
  ),
  memories: () => request<MemoryRecord[]>('/api/memories'),
  addMemory: (content: string) => request<MemoryRecord>('/api/memories', json('POST', { content })),
  updateMemory: (id: string, content: string) => request<MemoryRecord>(`/api/memories/${encodeURIComponent(id)}`, json('PUT', { content })),
  deleteMemory: (id: string) => request<{ ok: true }>(`/api/memories/${encodeURIComponent(id)}`, { method: 'DELETE' }),
  uploadAvatar: async (file: File | Blob) => {
    if (file.size > MAX_MODEL_BYTES) return Promise.reject(new ApiError('モデルファイルは 30 MB 以下にしてください。'));
    const storage = await request<{ storage: 'local' | 'blob' }>('/api/avatar/storage');
    if (storage.storage === 'blob') {
      const grant = await request<{ id: string; pathname: string; token: string }>('/api/avatar/upload', json('POST', {}));
      try {
        const { put } = await import('@vercel/blob/client');
        await put(grant.pathname, file, { token: grant.token, access: 'private', contentType: 'application/octet-stream', multipart: true });
        return await request<{ avatarUrl: string }>('/api/avatar/complete', json('POST', { id: grant.id }), 70_000);
      } catch (error) {
        if (error instanceof ApiError) throw error;
        throw new ApiError('ローカルサービスでリクエストを完了できませんでした。');
      }
    }
    return request<{ avatarUrl: string }>('/api/avatar', {
      method: 'POST', headers: { 'Content-Type': 'application/octet-stream' }, body: file,
    }, 30_000);
  },
};
