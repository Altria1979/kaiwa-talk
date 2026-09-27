import { AppError, describeError, type ErrorDescriptor } from '../../shared/app-errors.js';

export class ProviderError extends AppError {
  constructor(message: string, details?: Partial<ErrorDescriptor>) {
    super(message, details);
    this.name = 'ProviderError';
  }
}

/** Only allow our own messages across the provider boundary. */
export function providerMessage(error: unknown, fallback: string): string {
  return error instanceof ProviderError ? error.message : fallback;
}

/** Keep presentation details only for errors created inside the provider boundary. */
export function providerError(error: unknown, fallback: string): ErrorDescriptor {
  return describeError(error instanceof ProviderError ? error : fallback);
}

export function upstreamError(code: unknown, status?: number): ProviderError {
  const value = typeof code === 'string' ? code.toLowerCase() : '';
  if (status === 401 || /invalid.?api.?key|authentication|unauthorized/.test(value)) {
    return new ProviderError('Alibaba Cloud の認証に失敗しました。練習設定の API キーと接続先ドメインの組み合わせを確認してください。');
  }
  if (status === 403 || /access.?denied|forbidden|permission|not.?enabled/.test(value)) {
    return new ProviderError('このアカウントにはモデルのアクセス権がありません。モデルの有効化とリージョン、ワークスペースを確認してください。');
  }
  if (status === 402 || status === 429 || /quota|limit|throttl|balance|arrearage/.test(value)) {
    return new ProviderError('Alibaba Cloud の利用枠が不足しているか、リクエストが多すぎます。残高と利用枠を確認して再試行してください。');
  }
  if (status === 404 || /model.?not.?found|unsupported.?model|invalid.?model/.test(value)) {
    return new ProviderError('選択したモデルがこのリージョンまたはワークスペースに見つかりません。サービス設定を確認してください。');
  }
  if (status === 400 || /invalid|bad.?request/.test(value)) {
    return new ProviderError('Alibaba Cloud がリクエスト設定を受け付けませんでした。リージョン、ワークスペース、モデル、音声を確認してください。');
  }
  return new ProviderError('Alibaba Cloud を一時的に利用できません。しばらくしてから再試行してください。');
}

export function abortError(): Error {
  return new DOMException('リクエストはキャンセルされました', 'AbortError');
}
