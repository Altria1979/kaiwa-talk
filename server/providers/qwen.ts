import { getStatus, resolveBailianConfig, type BailianProviderConfig } from '../config.js';
import { ProviderError, abortError, upstreamError } from './errors.js';

export interface PromptMessage {
  role: 'system' | 'user' | 'assistant';
  content: string;
}

export class QwenClient {
  constructor(private readonly runtime: BailianProviderConfig = resolveBailianConfig()) {}

  async *stream(messages: PromptMessage[], signal: AbortSignal): AsyncGenerator<string> {
    if (!getStatus(this.runtime).ready || !this.runtime.chatBaseUrl) {
      throw new ProviderError('練習設定に Bailian API キーを入力し、接続先ドメインを確認してください。');
    }
    const timeout = AbortSignal.timeout(60_000);
    const combined = AbortSignal.any([signal, timeout]);
    let reader: ReadableStreamDefaultReader<Uint8Array> | undefined;
    try {
      const response = await fetch(`${this.runtime.chatBaseUrl.replace(/\/$/, '')}/chat/completions`, {
        method: 'POST',
        headers: { Authorization: `Bearer ${this.runtime.apiKey}`, 'Content-Type': 'application/json' },
        body: JSON.stringify({
          model: this.runtime.chatModel,
          messages,
          stream: true,
          enable_thinking: false,
          preserve_thinking: false,
          max_tokens: 1400,
        }),
        signal: combined,
      });
      if (!response.ok) {
        // Status alone is sufficient; never echo an upstream body or authenticated URL.
        await response.body?.cancel();
        throw upstreamError(undefined, response.status);
      }
      if (!response.body) throw new ProviderError('会話サービスから応答ストリームが返されませんでした。再試行してください。');
      reader = response.body.getReader();
      const decoder = new TextDecoder();
      let buffer = '';
      let outputLength = 0;
      let done = false;
      while (!done) {
        const result = await reader.read();
        buffer += result.done ? decoder.decode() : decoder.decode(result.value, { stream: true });
        // SSE frames can cross chunks and use LF or CRLF. Preserve incomplete frames.
        buffer = buffer.replace(/\r\n/g, '\n');
        if (buffer.length > 256_000) throw new ProviderError('会話データに問題があります。会話を開始し直してください。');
        let boundary: number;
        while ((boundary = buffer.indexOf('\n\n')) >= 0) {
          const frame = buffer.slice(0, boundary);
          buffer = buffer.slice(boundary + 2);
          const data = frame.split('\n').filter((line) => line.startsWith('data:')).map((line) => line.slice(5).trimStart()).join('\n');
          if (!data) continue;
          if (data === '[DONE]') { done = true; break; }
          let payload: { error?: { code?: string }; choices?: { delta?: { content?: unknown } }[] };
          try { payload = JSON.parse(data); } catch { throw new ProviderError('返信の形式が正しくありません。再試行してください。'); }
          if (payload.error) throw upstreamError(payload.error.code);
          const delta = payload.choices?.[0]?.delta?.content;
          // reasoning_content and all other fields are intentionally excluded.
          if (typeof delta === 'string' && delta) {
            const accepted = delta.slice(0, 6000 - outputLength);
            outputLength += accepted.length;
            if (accepted) yield accepted;
            if (outputLength >= 6000) { done = true; break; }
          }
        }
        if (result.done) break;
      }
      if (!outputLength) throw new ProviderError('表示できる返信が生成されませんでした。再試行してください。');
    } catch (error) {
      if (signal.aborted) throw abortError();
      if (timeout.aborted) throw new ProviderError('返信がタイムアウトしました。再試行してください。');
      if (error instanceof ProviderError) throw error;
      throw new ProviderError('会話サービスに接続できません。ネットワークと Bailian の接続先ドメインを確認してください。');
    } finally {
      await reader?.cancel().catch(() => undefined);
      reader?.releaseLock();
    }
  }

  async complete(messages: PromptMessage[], signal?: AbortSignal): Promise<string> {
    let result = '';
    for await (const delta of this.stream(messages, signal ?? new AbortController().signal)) result += delta;
    return result;
  }
}
