import { AppError, type ErrorDescriptor } from '../shared/app-errors.js';
import type { ChatMessage, Settings } from '../shared/protocol.js';
import type { BailianProviderConfig } from './config.js';
import { abortError, providerError } from './providers/errors.js';
import { TtsClient, resolveTtsLanguage } from './providers/tts.js';

const MAX_TEXT_LENGTH = 160;
const MAX_AUDIO_BYTES = 24_000 * 2 * 24;
const MAX_AUDIO_BASE64_LENGTH = Math.ceil(MAX_AUDIO_BYTES / 3) * 4;
const audioFailure = 'お手本の音声を生成できませんでした。Bailian の設定を確認して、もう一度お試しください。';
let activeRequests = 0;

export class SuggestionAudioError extends AppError {
  constructor(readonly status: number, message: string, details?: Partial<ErrorDescriptor>) { super(message, details); }
}

/** Synthesize only a saved option, never caller-provided text or pronunciation notes. */
export async function synthesizeSuggestionAudio(
  message: ChatMessage | null,
  index: number,
  settings: Settings,
  runtime: BailianProviderConfig,
  signal: AbortSignal,
): Promise<{ audio: string; sampleRate: 24000 }> {
  if (signal.aborted) throw abortError();
  const suggestion = message?.role === 'assistant' && Number.isInteger(index) && index >= 0 && index < 3
    ? message.replySuggestions?.[index] : undefined;
  if (!suggestion || typeof suggestion.text !== 'string' || !suggestion.text.trim()) {
    throw new SuggestionAudioError(404, '返信候補が見つかりません。');
  }
  if (suggestion.text.length > MAX_TEXT_LENGTH || /[\r\n\t]/u.test(suggestion.text)) {
    throw new SuggestionAudioError(400, 'この返信候補は読み上げられません。');
  }
  if (!runtime.apiKey || !runtime.realtimeUrl) {
    throw new SuggestionAudioError(503, '練習設定に Bailian API キーを入力し、接続先ドメインを確認してください。');
  }
  if (activeRequests >= 3) {
    throw new SuggestionAudioError(429, '音声のリクエストが混み合っています。しばらくしてから再試行してください。');
  }

  activeRequests += 1;
  const controller = new AbortController();
  const cancel = () => controller.abort();
  signal.addEventListener('abort', cancel, { once: true });
  const chunks: Buffer[] = [];
  let size = 0;
  let failure: SuggestionAudioError | undefined;
  try {
    await new TtsClient(runtime).synthesize(
      suggestion.text, settings.voice, resolveTtsLanguage(settings.learningLanguage), controller.signal,
      audio => {
        if (controller.signal.aborted) return;
        // Abort instead of throwing from the provider's WebSocket event callback.
        if (!audio || audio.length > MAX_AUDIO_BASE64_LENGTH || audio.length % 4 !== 0
          || !/^[A-Za-z0-9+/]+={0,2}$/.test(audio)) {
          failure = new SuggestionAudioError(502, audioFailure);
          controller.abort();
          return;
        }
        const chunk = Buffer.from(audio, 'base64');
        if (chunk.length % 2 !== 0 || size + chunk.length > MAX_AUDIO_BYTES) {
          failure = new SuggestionAudioError(502, audioFailure);
          controller.abort();
          return;
        }
        size += chunk.length;
        chunks.push(chunk);
      },
    );
    if (signal.aborted) throw abortError();
    if (failure) throw failure;
    if (!size) throw new SuggestionAudioError(502, audioFailure);
    return { audio: Buffer.concat(chunks, size).toString('base64'), sampleRate: 24000 };
  } catch (error) {
    if (signal.aborted) throw abortError();
    const details = providerError(error, audioFailure);
    throw failure ?? (error instanceof SuggestionAudioError ? error : new SuggestionAudioError(502, audioFailure, details));
  } finally {
    signal.removeEventListener('abort', cancel);
    activeRequests -= 1;
  }
}
