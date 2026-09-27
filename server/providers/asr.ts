import { randomUUID } from 'node:crypto';
import WebSocket from 'ws';
import { MAX_TEXT_LENGTH } from '../../shared/protocol.js';
import { SPEECH_POLICY, type SpeechSegment } from '../../shared/speech-policy.js';
import { resolveBailianConfig, type BailianProviderConfig } from '../config.js';
import { ProviderError, upstreamError } from './errors.js';

interface AsrCallbacks {
  onSpeechStarted(segment: SpeechSegment): void;
  onTranscript(text: string, final: boolean, segment: SpeechSegment): void;
  onError(error: ProviderError): void;
}

function object(value: unknown): Record<string, unknown> | undefined {
  return value && typeof value === 'object' && !Array.isArray(value) ? value as Record<string, unknown> : undefined;
}

export class AsrClient {
  readonly streamId = randomUUID();
  private sentSamples = 0;
  private socket?: WebSocket;
  private ready = false;
  private stopped = false;
  private finishing = false;
  private finishPromise?: Promise<void>;
  private finishResolver?: () => void;
  private connectReject?: (error: ProviderError) => void;
  // Fun-ASR sentence IDs increase within one task. High-water marks keep dedup bounded.
  private lastStartedSentence = 0;
  private lastCompletedSentence = 0;

  constructor(private readonly callbacks: AsrCallbacks, private readonly runtime: BailianProviderConfig = resolveBailianConfig()) {}

  get time(): number { return this.sentSamples / 16; }

  async connect(silenceMs: number): Promise<void> {
    if (this.socket || this.stopped) throw new ProviderError('音声認識の接続は再利用できません。再接続してください。');
    if (!this.runtime.asrUrl || !this.runtime.apiKey) throw new ProviderError('音声認識が設定されていません。Bailian API キーと接続先ドメインを確認してください。');
    const socket = new WebSocket(this.runtime.asrUrl, {
      headers: { Authorization: `Bearer ${this.runtime.apiKey}` },
      handshakeTimeout: 10_000,
      maxPayload: 1024 * 1024,
    });
    this.socket = socket;
    await new Promise<void>((resolve, reject) => {
      const timer = setTimeout(() => fail(new ProviderError('音声認識の接続がタイムアウトしました。テキストで会話を続けられます。')), 12_000);
      const fail = (error: ProviderError) => {
        clearTimeout(timer);
        this.connectReject = undefined;
        this.close();
        reject(error);
      };
      this.connectReject = fail;
      socket.on('open', () => this.sendTask('run-task', {
        task_group: 'audio',
        task: 'asr',
        function: 'recognition',
        model: this.runtime.asrModel,
        parameters: {
          format: 'pcm',
          sample_rate: 16000,
          language_hints: ['ja'],
          semantic_punctuation_enabled: false,
          speech_noise_threshold: SPEECH_POLICY.noiseThreshold,
          max_sentence_silence: Number.isFinite(silenceMs) ? Math.max(200, Math.min(6000, Math.round(silenceMs))) : 1600,
          heartbeat: true,
        },
        input: {},
      }));
      socket.on('message', (raw, binary) => {
        if (this.stopped) return;
        let event: Record<string, unknown> | undefined;
        try { if (!binary) event = object(JSON.parse(raw.toString())); }
        catch { /* Invalid payloads are handled without exposing upstream content. */ }
        const header = object(event?.header);
        if (!header) { this.fail(new ProviderError('音声認識データに問題があります。再接続してください。')); return; }
        if (header.task_id !== this.streamId) return;
        switch (header.event) {
          case 'task-started':
            if (this.ready || this.finishing) return;
            this.ready = true;
            clearTimeout(timer);
            this.connectReject = undefined;
            resolve();
            break;
          case 'result-generated': {
            if (!this.ready) return;
            const sentence = object(object(object(event?.payload)?.output)?.sentence);
            if (sentence) this.result(sentence);
            break;
          }
          case 'task-finished':
            if (this.finishing) this.close();
            else this.fail(new ProviderError('音声認識が終了しました。テキストで会話を続けるか、再接続してください。'));
            break;
          case 'task-failed':
            this.fail(upstreamError(header.error_code));
            break;
        }
      });
      socket.on('unexpected-response', (request, response) => {
        response.resume();
        this.fail(upstreamError(undefined, response.statusCode));
        request.destroy();
      });
      socket.on('error', () => this.fail(new ProviderError('音声認識に接続できませんでした。テキストで会話を続けるか、再接続してください。')));
      socket.on('close', () => {
        if (!this.stopped) this.fail(new ProviderError('音声認識の接続が切れました。テキストで会話を続けるか、再接続してください。'));
      });
    });
  }

  append(audio: string): void {
    if (!this.ready || this.stopped || this.finishing) return;
    if ((this.socket?.bufferedAmount ?? 0) > 512_000) {
      this.fail(new ProviderError('音声の送信が混み合っているため、認識を停止しました。再接続してください。'));
      return;
    }
    // The browser transport is base64 JSON; the provider requires raw PCM binary frames.
    const pcm = Buffer.from(audio, 'base64');
    if (!pcm.length || pcm.length % 2 !== 0) return;
    if (this.socket?.readyState === WebSocket.OPEN) {
      this.sentSamples += pcm.length / 2;
      this.socket.send(pcm, { binary: true }, (error) => {
        if (error) this.fail(new ProviderError('音声を送信できませんでした。テキストで会話を続けるか、再接続してください。'));
      });
    }
  }

  async finish(): Promise<void> {
    if (this.stopped) return;
    if (this.finishPromise) return this.finishPromise;
    if (!this.ready) { this.close(); return; }
    this.finishing = true;
    this.finishPromise = new Promise<void>((resolve) => {
      const timer = setTimeout(() => this.close(), 2500);
      this.finishResolver = () => { clearTimeout(timer); resolve(); };
      // Final result-generated events remain valid until task-finished or the bounded timeout.
      this.sendTask('finish-task', { input: {} });
    });
    await this.finishPromise;
    this.close();
  }

  close(): void {
    if (this.stopped) return;
    this.stopped = true;
    this.ready = false;
    const reject = this.connectReject;
    this.connectReject = undefined;
    reject?.(new ProviderError('音声認識の接続はキャンセルされました。'));
    this.finishResolver?.();
    this.finishResolver = undefined;
    this.socket?.terminate();
  }

  private result(sentence: Record<string, unknown>): void {
    const id = sentence.sentence_id;
    if (sentence.heartbeat === true || id === 0 || typeof id !== 'number' || !Number.isSafeInteger(id) || id < 1) return;
    if (id <= this.lastCompletedSentence) return;
    const begin = sentence.begin_time;
    const end = sentence.end_time;
    const final = sentence.sentence_end === true;
    // Missing or impossible timestamps cannot be joined to local audio evidence.
    if (typeof begin !== 'number' || !Number.isSafeInteger(begin) || begin < 0 || begin > Math.ceil(this.time)) return;
    if (end !== null && (typeof end !== 'number' || !Number.isSafeInteger(end) || end < begin || end > Math.ceil(this.time))) return;
    if (final && (end === null || end === begin)) return;
    const segment: SpeechSegment = { streamId: this.streamId, segmentId: id, beginMs: begin, endMs: end as number | null };
    if (sentence.sentence_begin === true && id > this.lastStartedSentence) {
      this.lastStartedSentence = id;
      // Empty onset is only a candidate; the client requires corroborating speech/text.
      if (!this.finishing) this.callbacks.onSpeechStarted(segment);
    }
    if (this.stopped || typeof sentence.text !== 'string') return;
    if (final) this.lastCompletedSentence = id;
    const text = sentence.text.slice(0, MAX_TEXT_LENGTH);
    if (final || (!this.finishing && text.trim())) this.callbacks.onTranscript(text, final, segment);
  }

  private sendTask(action: 'run-task' | 'finish-task', payload: Record<string, unknown>): void {
    if (this.stopped || this.socket?.readyState !== WebSocket.OPEN) return;
    this.socket.send(JSON.stringify({ header: { action, task_id: this.streamId, streaming: 'duplex' }, payload }), (error) => {
      if (error) this.fail(new ProviderError('音声認識のリクエストを送信できませんでした。再接続してください。'));
    });
  }

  private fail(error: ProviderError): void {
    if (this.stopped) return;
    if (this.connectReject) this.connectReject(error);
    else {
      this.close();
      if (!this.finishing) this.callbacks.onError(error);
    }
  }
}
