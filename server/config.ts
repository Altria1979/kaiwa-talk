import { AppError } from '../shared/app-errors.js';
import { resolve } from 'node:path';
import type { BrowserBailianCredentials, ServiceStatus } from '../shared/protocol.js';
import { isCloudDeployment } from '../shared/cloud-access.js';

import { loadBrowserSecret } from './browser-secret.js';

const cloud = isCloudDeployment();
const cloudPort = Number(process.env.PORT || 8080);
const publicOrigin = (process.env.KAIWA_TALK_PUBLIC_ORIGIN ?? process.env.KAIWA_LAB_PUBLIC_ORIGIN ?? process.env.VIRTUALMAID_PUBLIC_ORIGIN)?.trim() ?? '';
if (cloud) {
  if (!Number.isInteger(cloudPort) || cloudPort < 1 || cloudPort > 65535) throw new Error('PORT must be an integer between 1 and 65535.');
  const origin = new URL(publicOrigin);
  if (origin.protocol !== 'https:' || origin.origin !== publicOrigin) throw new Error('KAIWA_TALK_PUBLIC_ORIGIN must be an HTTPS origin without a trailing slash.');
  for (const key of ['TURSO_DATABASE_URL', 'TURSO_AUTH_TOKEN', 'BLOB_READ_WRITE_TOKEN']) {
    if (!process.env[key]?.trim()) throw new Error(`${key} is required for cloud deployment.`);
  }
}

const webPort = Number(process.env.KAIWA_TALK_WEB_PORT ?? process.env.KAIWA_LAB_WEB_PORT ?? (process.env.KOHARU_WEB_PORT || 3000));
if (!Number.isInteger(webPort) || webPort < 1024 || webPort > 65534) throw new Error('KAIWA_TALK_WEB_PORT（旧 KAIWA_LAB_WEB_PORT・KOHARU_WEB_PORT）は 1024～65534 の整数で指定してください');
const publicHosts: Readonly<Record<string, string>> = Object.freeze({
  'dashscope.aliyuncs.com': 'cn-beijing',
  'dashscope-intl.aliyuncs.com': 'ap-southeast-1',
  'dashscope-us.aliyuncs.com': 'us-east-1',
  'cn-hongkong.dashscope.aliyuncs.com': 'cn-hongkong',
});

export class CredentialError extends AppError {}

/** Only host names are accepted; callers cannot replace provider paths or add credentials. */
function browserHost(value: unknown): { hostname: string; region: string } {
  if (value !== undefined && typeof value !== 'string') throw new CredentialError('Bailian の接続先ドメインの形式が正しくありません。');
  const input = (value as string | undefined)?.trim() || 'dashscope.aliyuncs.com';
  if (input.length > 253 || /[\s\p{Cc}]/u.test(input)) throw new CredentialError('Bailian の接続先ドメインの形式が正しくありません。');
  const hostname = input.replace(/^https:\/\//i, '').replace(/\/$/, '').toLowerCase();
  if (Object.hasOwn(publicHosts, hostname)) return { hostname, region: publicHosts[hostname] };
  const workspace = hostname.match(/^([a-z0-9](?:[a-z0-9-]{0,61}[a-z0-9])?)\.([a-z][a-z0-9-]{2,40})\.maas\.aliyuncs\.com$/);
  if (workspace && workspace[1] !== 'trial') return { hostname, region: workspace[2] };
  throw new CredentialError('Bailian 公式のパブリックドメインまたはワークスペース専用ドメインを入力してください。パス、ポート、試用ドメインは使用できません。');
}

export function parseBrowserCredentials(value: unknown): BrowserBailianCredentials {
  if (!value || typeof value !== 'object' || Array.isArray(value)) throw new CredentialError('練習設定に Bailian API キーを入力してください。');
  const input = value as Record<string, unknown>;
  if (typeof input.apiKey !== 'string') throw new CredentialError('Bailian API キーの形式が正しくありません。');
  const apiKey = input.apiKey.trim();
  if (!apiKey) throw new CredentialError('練習設定に Bailian API キーを入力してください。');
  if (!/^[\x21-\x7e]{1,512}$/.test(apiKey)) throw new CredentialError('Bailian API キーは空白を含まない 1～512 文字の半角英数字・記号で入力してください。');
  return { apiKey, apiHost: browserHost(input.apiHost).hostname };
}

export const config = Object.freeze({
  cloud,
  publicOrigin,
  webPort,
  servicePort: cloud ? cloudPort : webPort + 1,
  chatModel: process.env.BAILIAN_CHAT_MODEL?.trim() || 'qwen3.8-flash',
  asrModel: process.env.BAILIAN_ASR_MODEL?.trim() || 'fun-asr-realtime',
  ttsModel: process.env.BAILIAN_TTS_MODEL?.trim() || 'qwen3-tts-flash-realtime',
  browserSecret: loadBrowserSecret(cloud, resolve(process.cwd(), 'data')),
  dataDir: resolve(process.cwd(), 'data'),
});

export interface BailianProviderConfig {
  readonly apiKey: string;
  readonly chatBaseUrl: string;
  readonly asrUrl: string;
  readonly realtimeUrl: string;
  readonly chatModel: string;
  readonly asrModel: string;
  readonly ttsModel: string;
  readonly region: string | null;
  readonly credentialSource: ServiceStatus['credentialSource'];
}

/** This value stays in memory for a request/session and is never written to application settings. */
export function resolveBailianConfig(credentials?: BrowserBailianCredentials): BailianProviderConfig {
  const models = { chatModel: config.chatModel, asrModel: config.asrModel, ttsModel: config.ttsModel };
  if (credentials !== undefined) {
    const parsed = parseBrowserCredentials(credentials);
    const selected = browserHost(parsed.apiHost);
    return Object.freeze({
      ...models,
      apiKey: parsed.apiKey,
      chatBaseUrl: `https://${selected.hostname}/compatible-mode/v1`,
      asrUrl: `wss://${selected.hostname}/api-ws/v1/inference`,
      realtimeUrl: `wss://${selected.hostname}/api-ws/v1/realtime`,
      region: selected.region,
      credentialSource: 'browser',
    });
  }
  return Object.freeze({
    ...models,
    apiKey: '',
    chatBaseUrl: '',
    asrUrl: '',
    realtimeUrl: '',
    region: null,
    credentialSource: 'none',
  });
}

export function getStatus(runtime: BailianProviderConfig = resolveBailianConfig()): ServiceStatus {
  const missing: string[] = [];
  if (!runtime.apiKey) missing.push('BAILIAN_API_KEY');
  else {
    if (!runtime.chatBaseUrl) missing.push('有効な会話エンドポイント');
    if (!runtime.asrUrl) missing.push('有効な ASR inference エンドポイント');
    if (!runtime.realtimeUrl) missing.push('有効な TTS realtime エンドポイント');
  }
  return {
    ready: missing.length === 0,
    missing,
    credentialSource: runtime.credentialSource,
    region: runtime.region,
    models: { chat: runtime.chatModel, asr: runtime.asrModel, tts: runtime.ttsModel },
    asrLanguage: 'ja',
    activeSessionId: null,
  };
}
