import { randomUUID } from 'node:crypto';
import WebSocket from 'ws';
import { resolveBailianConfig, type BailianProviderConfig } from '../config.js';
import { ProviderError, abortError, upstreamError } from './errors.js';

export type TtsLanguage = 'Japanese' | 'English' | 'Korean' | 'French' | 'German' | 'Spanish' | 'Auto';

/** Use the learning context: Han characters alone cannot distinguish Japanese from Chinese. */
export function resolveTtsLanguage(learningLanguage: string): TtsLanguage {
  switch (learningLanguage.trim()) {
    case '日本語': case '日语': return 'Japanese';
    case '英語': case '英语': return 'English';
    case '韓国語': case '韩语': return 'Korean';
    case 'フランス語': case '法语': return 'French';
    case 'ドイツ語': case '德语': return 'German';
    case 'スペイン語': case '西班牙语': return 'Spanish';
    default: return 'Auto';
  }
}

/** A sentence owns one socket, so cancelling cannot leave upstream synthesis running. */
export class TtsClient {
  constructor(private readonly runtime: BailianProviderConfig = resolveBailianConfig()) {}

  async synthesize(text: string, voice: string, languageType: TtsLanguage, signal: AbortSignal, onAudio: (audio: string) => void): Promise<void> {
    if (signal.aborted) throw abortError();
    if (!this.runtime.realtimeUrl || !this.runtime.apiKey) throw new ProviderError('音声合成が設定されていません。Bailian API キーと接続先ドメインを確認してください。');
    const endpoint = new URL(this.runtime.realtimeUrl);
    endpoint.searchParams.set('model', this.runtime.ttsModel);
    await new Promise<void>((resolve, reject) => {
      const socket = new WebSocket(endpoint, {
        headers: { Authorization: `Bearer ${this.runtime.apiKey}` },
        handshakeTimeout: 10_000,
        maxPayload: 4 * 1024 * 1024,
      });
      let finished = false;
      let gotAudio = false;
      const timer = setTimeout(() => finish(new ProviderError('音声合成がタイムアウトしました。返信のテキストは確認できます。')), 45_000);
      const finish = (error?: Error) => {
        if (finished) return;
        finished = true;
        clearTimeout(timer);
        signal.removeEventListener('abort', onAbort);
        socket.terminate();
        if (error) reject(error); else resolve();
      };
      const onAbort = () => finish(abortError());
      signal.addEventListener('abort', onAbort, { once: true });
      const send = (event: Record<string, unknown>) => {
        if (socket.readyState === WebSocket.OPEN) socket.send(JSON.stringify({ event_id: randomUUID(), ...event }));
      };
      socket.on('open', () => send({
        type: 'session.update',
        session: { voice, mode: 'server_commit', language_type: languageType, response_format: 'pcm', sample_rate: 24000 },
      }));
      socket.on('message', (raw) => {
        if (finished || signal.aborted) return;
        let event: Record<string, unknown>;
        try { event = JSON.parse(raw.toString()) as Record<string, unknown>; }
        catch { finish(new ProviderError('音声合成データに問題があります。返信のテキストは確認できます。')); return; }
        if (event.type === 'session.updated') {
          send({ type: 'input_text_buffer.append', text });
          send({ type: 'session.finish' });
        } else if (event.type === 'response.audio.delta' && typeof event.delta === 'string') {
          gotAudio = true;
          onAudio(event.delta);
        } else if (event.type === 'error') {
          finish(upstreamError((event.error as { code?: string } | undefined)?.code));
        } else if (event.type === 'response.done') {
          const response = event.response as { status?: string } | undefined;
          if (response?.status === 'failed' || response?.status === 'cancelled') finish(new ProviderError('音声合成が完了しませんでした。返信のテキストは確認できます。'));
        } else if (event.type === 'session.finished') {
          finish(gotAudio ? undefined : new ProviderError('音声サービスから音声が返されませんでした。返信のテキストは確認できます。'));
        }
      });
      socket.on('unexpected-response', (request, response) => {
        response.resume();
        finish(upstreamError(undefined, response.statusCode));
        request.destroy();
      });
      socket.on('error', () => finish(new ProviderError('音声合成サービスに接続できません。返信のテキストは確認できます。')));
      socket.on('close', () => { if (!finished) finish(new ProviderError('音声合成の接続が切れました。返信のテキストは確認できます。')); });
      if (signal.aborted) onAbort();
    });
  }
}
