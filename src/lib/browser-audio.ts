import { AppError, APP_ERROR_MESSAGES, describeError, type ErrorDescriptor } from '../../shared/app-errors';
import { BrowserVad, type BrowserVadCallbacks } from './browser-vad';
import type { SpeechContext } from '../../shared/speech-policy';
import { captionCharacters, type PlaybackCaption } from './playback-captions';

interface BrowserAudioOptions extends BrowserVadCallbacks {
  /** Raw RMS of the actual playback output, zero while playback is inactive. */
  levelRef: { current: number };
  onPcm: (base64: string, streamId: string) => void;
  getSpeechContext?: () => SpeechContext;
  onPlayed: (turnId: string, sentenceId: string) => void;
  onBusy: (busy: boolean) => void;
  onError: (message: string, source?: 'capture' | 'playback', details?: ErrorDescriptor) => void;
  onCaption?: (caption: PlaybackCaption | null) => void;
}

interface PlaybackSpan {
  start: number;
  duration: number;
  ended: boolean;
}

interface CachedSentence {
  id: string;
  chunks: Uint8Array[];
  bytes: number;
  text: string;
  complete: boolean;
  acknowledged: boolean;
  cancelled: boolean;
  sources: Set<AudioBufferSourceNode>;
  spans: PlaybackSpan[];
  visibleCharacters: number;
  correction: { seconds: number; characters: number } | null;
}

interface CachedTurn {
  id: string;
  sentences: Map<string, CachedSentence>;
}

const SAMPLE_RATE = 24000;
const MAX_CACHE_BYTES = 24 * 1024 * 1024;
const MAX_QUEUE_SECONDS = 30;

function encodeBase64(bytes: Uint8Array): string {
  let binary = '';
  for (let offset = 0; offset < bytes.length; offset += 8192) binary += String.fromCharCode(...bytes.subarray(offset, offset + 8192));
  return btoa(binary);
}

function decodePcm(base64: string): Uint8Array {
  if (base64.length > 2 * 1024 * 1024 || !/^[A-Za-z0-9+/]+={0,2}$/.test(base64)) throw new AppError('invalid PCM');
  const binary = atob(base64);
  if (binary.length % 2) throw new AppError('odd PCM length');
  return Uint8Array.from(binary, character => character.charCodeAt(0));
}

function wav(chunks: Uint8Array[], byteLength: number): Blob {
  const buffer = new ArrayBuffer(44 + byteLength);
  const view = new DataView(buffer);
  const write = (offset: number, text: string) => { for (let index = 0; index < text.length; index++) view.setUint8(offset + index, text.charCodeAt(index)); };
  write(0, 'RIFF'); view.setUint32(4, 36 + byteLength, true); write(8, 'WAVE');
  write(12, 'fmt '); view.setUint32(16, 16, true); view.setUint16(20, 1, true);
  view.setUint16(22, 1, true); view.setUint32(24, SAMPLE_RATE, true);
  view.setUint32(28, SAMPLE_RATE * 2, true); view.setUint16(32, 2, true); view.setUint16(34, 16, true);
  write(36, 'data'); view.setUint32(40, byteLength, true);
  const output = new Uint8Array(buffer);
  let offset = 44;
  for (const chunk of chunks) { output.set(chunk, offset); offset += chunk.byteLength; }
  return new Blob([buffer], { type: 'audio/wav' });
}

/** Session-local capture, streamed playback and pitch-preserving replay. */
export class BrowserAudio {
  private reportError(message: string, source?: 'capture' | 'playback'): void {
    this.options.onError(message, source, describeError(message));
  }

  private context: AudioContext | null = null;
  private analyser: AnalyserNode | null = null;
  private stream: MediaStream | null = null;
  private microphoneSource: MediaStreamAudioSourceNode | null = null;
  private capture: AudioWorkletNode | null = null;
  private captureGain: GainNode | null = null;
  private workletReady: Promise<void> | null = null;
  private micGeneration = 0;
  private vad: BrowserVad | null = null;
  private vadEnabled = false;
  private recognitionStream: string | null = null;
  private recognitionSamples = 0;
  private muted = false;
  private disposed = false;
  private currentTurn: string | null = null;
  private nextStart = 0;
  private sources = new Set<AudioBufferSourceNode>();
  private turns = new Map<string, CachedTurn>();
  private cacheBytes = 0;
  private busy = false;
  private frame = 0;
  private replayElement: HTMLAudioElement | null = null;
  private replaySource: MediaElementAudioSourceNode | null = null;
  private replayUrl: string | null = null;
  private replayTurn: string | null = null;
  private playbackGeneration = 0;
  private caption: PlaybackCaption | null = null;
  private replaySentences: { sentence: CachedSentence; start: number; duration: number }[] = [];
  private replaySentenceIndex = 0;
  private replayVisibleCharacters = 0;

  constructor(private readonly options: BrowserAudioOptions) {}

  async prepare(): Promise<void> {
    if (this.disposed) throw new AppError('音声セッションは終了しました。会話を開始し直してください。');
    try {
      if (!this.context) {
        this.context = new AudioContext({ latencyHint: 'interactive' });
        this.analyser = this.context.createAnalyser();
        this.analyser.fftSize = 1024;
        this.analyser.smoothingTimeConstant = 0.4;
        this.analyser.connect(this.context.destination);
      }
      if (this.context.state === 'suspended') await this.context.resume();
    } catch {
      throw new AppError(this.disposed ? APP_ERROR_MESSAGES.audioSessionEnded : APP_ERROR_MESSAGES.audioNotRunning);
    }
    if (this.disposed || !this.context) throw new AppError('音声セッションは終了しました。会話を開始し直してください。');
    if (this.context.state !== 'running') throw new AppError('ブラウザーの音声機能が起動していません。もう一度、会話の開始ボタンを押してください。');
  }

  async startMicrophone(_vadSilenceMs?: number): Promise<void> {
    // Silence timing belongs to the shared frame policy, not another VAD graph.
    void _vadSilenceMs;
    if (this.stream) return;
    this.vadEnabled = false;
    await this.prepare();
    const generation = ++this.micGeneration;
    if (!navigator.mediaDevices?.getUserMedia) throw new AppError('このブラウザーではマイクを使用できません。この端末のブラウザーでページを開いてください。');
    let stream: MediaStream;
    try {
      stream = await navigator.mediaDevices.getUserMedia({
        audio: { channelCount: 1, echoCancellation: true, noiseSuppression: true, autoGainControl: true },
      });
    } catch (error) {
      if (error instanceof DOMException && (error.name === 'NotAllowedError' || error.name === 'SecurityError')) throw new AppError('マイクの使用が許可されていません。テキストで会話を続けられます。');
      throw new AppError('マイクを起動できません。機器とブラウザーの権限を確認してください。テキストで会話を続けられます。');
    }
    if (this.disposed || generation !== this.micGeneration || !this.context) {
      stream.getTracks().forEach(track => track.stop());
      return;
    }
    this.stream = stream;
    try {
      this.workletReady ??= this.context.audioWorklet.addModule('/audio/pcm-capture.js');
      await this.workletReady;
      if (this.disposed || generation !== this.micGeneration || !this.context) return;
      const capture = new AudioWorkletNode(this.context, 'pcm-capture', {
        numberOfInputs: 1, numberOfOutputs: 1, outputChannelCount: [1], channelCount: 1, channelCountMode: 'explicit',
      });
      this.capture = capture;
      this.captureGain = this.context.createGain();
      this.captureGain.gain.value = 0;
      this.microphoneSource = this.context.createMediaStreamSource(stream);
      this.microphoneSource.connect(capture);
      capture.connect(this.captureGain);
      this.captureGain.connect(this.context.destination);
      capture.port.onmessage = (event: MessageEvent<ArrayBuffer>) => {
        if (generation !== this.micGeneration || this.disposed || !this.vadEnabled || !this.recognitionStream) return;
        const bytes = new Uint8Array(event.data);
        if (!bytes.byteLength || bytes.byteLength % 2) return;
        const streamId = this.recognitionStream;
        const startMs = this.getRecognitionTime();
        const context = this.options.getSpeechContext?.();
        if (this.muted) bytes.fill(0);
        this.recognitionSamples += bytes.byteLength / 2;
        this.options.onPcm(encodeBase64(bytes), streamId);
        if (!this.muted && context) this.vad?.pushPcm(bytes, streamId, startMs, context);
      };
      capture.onprocessorerror = () => {
        this.stopMicrophone();
        this.reportError('マイクの音声処理が停止しました。音声での会話を開始し直してください。', 'capture');
      };
      for (const track of stream.getAudioTracks()) track.onended = () => {
        if (generation !== this.micGeneration) return;
        this.stopMicrophone();
        this.reportError('マイクが切断されました。テキストで会話を続けられます。', 'capture');
      };
      this.setMuted(this.muted);
      this.vad = new BrowserVad(this.options,
        () => !this.disposed && generation === this.micGeneration,
        this.muted || !this.vadEnabled || !this.recognitionStream);
    } catch {
      if (this.disposed || generation !== this.micGeneration) return;
      this.workletReady = null;
      this.stopMicrophone();
      throw new AppError('マイクの音声機能を起動できませんでした。テキストで会話を続けられます。');
    }
  }

  setMuted(muted: boolean): void {
    this.muted = muted;
    this.capture?.port.postMessage({ muted });
    for (const track of this.stream?.getAudioTracks() ?? []) track.enabled = !muted;
    this.vad?.setPaused(muted || !this.vadEnabled || !this.recognitionStream);
  }

  setVadEnabled(enabled: boolean): void {
    this.vadEnabled = enabled && !this.disposed;
    this.vad?.setPaused(this.muted || !this.vadEnabled || !this.recognitionStream);
  }

  setRecognitionStream(streamId: string | null): void {
    if (this.recognitionStream === streamId) return;
    this.recognitionStream = streamId;
    this.recognitionSamples = 0;
    this.vad?.reset();
    this.vad?.setPaused(this.muted || !this.vadEnabled || !streamId);
  }

  getRecognitionTime(): number {
    return this.recognitionSamples / 16;
  }

  stopMicrophone(): void {
    ++this.micGeneration;
    this.vadEnabled = false;
    this.recognitionStream = null;
    this.recognitionSamples = 0;
    const vad = this.vad;
    this.vad = null;
    // Model loading can outlive capture. Its generation guard releases it when
    // ready; disconnect must not wait for an outstanding model/WASM download.
    if (vad) void vad.destroy().catch(() => undefined);
    this.options.onSpeechEnd?.();
    this.options.onVadStatus?.('idle');
    this.capture?.port.close();
    if (this.capture) this.capture.onprocessorerror = null;
    this.capture?.disconnect();
    this.microphoneSource?.disconnect();
    this.captureGain?.disconnect();
    for (const track of this.stream?.getTracks() ?? []) { track.onended = null; track.stop(); }
    this.capture = null;
    this.microphoneSource = null;
    this.captureGain = null;
    this.stream = null;
  }

  beginTurn(turnId: string): void {
    this.cancelTurn();
    this.currentTurn = turnId;
    if (!this.turns.has(turnId)) this.turns.set(turnId, { id: turnId, sentences: new Map() });
    const turn = this.turns.get(turnId)!;
    for (const [sentenceId, sentence] of turn.sentences) {
      // Cancellation already released incomplete PCM; an explicit retry needs
      // fresh metadata and playback progress while retaining completed audio.
      if (sentence.cancelled && !sentence.complete) turn.sentences.delete(sentenceId);
    }
  }

  registerSentence(turnId: string, sentenceId: string, text: string): void {
    if (this.disposed || this.currentTurn !== turnId) return;
    const sentence = this.getSentence(turnId, sentenceId);
    if (sentence && !sentence.cancelled && !sentence.complete) sentence.text = text;
  }

  pushAudio(turnId: string, sentenceId: string, base64: string): void {
    if (this.disposed || this.currentTurn !== turnId) return;
    const context = this.context;
    if (!context || !this.analyser || context.state !== 'running') {
      this.cancelTurn(turnId);
      this.reportError('音声の再生が有効になっていません。もう一度、会話の開始ボタンを押してください。返信はテキストで確認できます。');
      return;
    }
    try {
      const bytes = decodePcm(base64);
      if (!bytes.length) return;
      const duration = bytes.byteLength / 2 / SAMPLE_RATE;
      const start = Math.max(context.currentTime + 0.015, this.nextStart);
      if (start + duration - context.currentTime > MAX_QUEUE_SECONDS) {
        this.cancelTurn(turnId);
        this.reportError('再生待ちの音声が長すぎるため、再生を停止しました。返信はテキストで確認できます。');
        return;
      }
      const sentence = this.getSentence(turnId, sentenceId);
      if (!sentence) return;
      if (sentence.complete || sentence.cancelled) return;
      this.evictCache(bytes.byteLength);
      if (this.cacheBytes + bytes.byteLength > MAX_CACHE_BYTES) {
        this.cancelTurn(turnId);
        this.reportError('音声が保存容量の上限を超えたため、再生を停止しました。返信はテキストで確認できます。');
        return;
      }
      sentence.chunks.push(bytes);
      sentence.bytes += bytes.byteLength;
      this.cacheBytes += bytes.byteLength;
      const buffer = context.createBuffer(1, bytes.byteLength / 2, SAMPLE_RATE);
      const samples = buffer.getChannelData(0);
      const view = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);
      for (let i = 0; i < samples.length; i++) samples[i] = view.getInt16(i * 2, true) / 32768;
      const source = context.createBufferSource();
      source.buffer = buffer;
      source.connect(this.analyser);
      sentence.sources.add(source);
      this.sources.add(source);
      const span: PlaybackSpan = { start, duration: buffer.duration, ended: false };
      sentence.spans.push(span);
      const activeSentence = sentence;
      const generation = this.playbackGeneration;
      source.onended = () => {
        source.disconnect();
        if (generation !== this.playbackGeneration || this.disposed) return;
        span.ended = true;
        this.sources.delete(source);
        activeSentence.sources.delete(source);
        this.acknowledge(turnId, activeSentence);
        this.updateCaptions();
        if (!this.sources.size && !this.replayTurn) this.setBusy(false);
      };
      source.start(start);
      this.nextStart = start + buffer.duration;
      this.setBusy(true);
    } catch {
      this.cancelTurn(turnId);
      this.reportError('音声を再生できません。返信はテキストで確認できます。');
    }
  }

  finishSentence(turnId: string, sentenceId: string, text: string): void {
    if (this.currentTurn !== turnId || this.disposed) return;
    const sentence = this.turns.get(turnId)?.sentences.get(sentenceId);
    if (!sentence || sentence.cancelled || sentence.complete) return;
    if (!sentence.text) sentence.text = text;
    this.updateCaptions();
    sentence.correction = { seconds: this.playedSeconds(sentence), characters: sentence.visibleCharacters };
    sentence.complete = true;
    this.acknowledge(turnId, sentence);
  }

  cancelTurn(turnId?: string): void {
    if (turnId && this.currentTurn !== turnId && this.replayTurn !== turnId) return;
    ++this.playbackGeneration;
    for (const turn of this.turns.values()) {
      if (turn.id !== this.currentTurn) continue;
      for (const sentence of turn.sentences.values()) {
        sentence.cancelled = true;
        sentence.sources.clear();
        if (!sentence.complete) {
          this.cacheBytes -= sentence.bytes;
          sentence.chunks = [];
          sentence.bytes = 0;
        }
      }
    }
    for (const source of this.sources) {
      source.onended = null;
      try { source.stop(); } catch { /* Source may already have naturally ended. */ }
      source.disconnect();
    }
    this.sources.clear();
    this.currentTurn = null;
    this.nextStart = 0;
    this.stopReplay();
    this.setBusy(false);
  }

  canReplay(turnId: string): boolean {
    return [...(this.turns.get(turnId)?.sentences.values() ?? [])].some(sentence => sentence.complete && sentence.bytes > 0);
  }

  async replay(turnId: string, slow = false): Promise<void> {
    if (!this.canReplay(turnId)) throw new AppError('この音声は現在の会話に保存されていません。');
    const generation = ++this.playbackGeneration;
    try {
      await this.prepare();
    } catch (error) {
      if (generation === this.playbackGeneration) this.cancelTurn();
      throw error;
    }
    if (generation !== this.playbackGeneration || this.disposed) return;
    this.cancelTurn();
    const sentences = [...(this.turns.get(turnId)?.sentences.values() ?? [])].filter(sentence => sentence.complete && sentence.bytes > 0);
    const chunks = sentences.flatMap(sentence => sentence.chunks);
    const bytes = sentences.reduce((sum, sentence) => sum + sentence.bytes, 0);
    if (!bytes || !this.context || !this.analyser) throw new AppError('この音声は保存期間が終了しています。');
    this.replayElement ??= new Audio();
    if (!this.replaySource) {
      this.replaySource = this.context.createMediaElementSource(this.replayElement);
      this.replaySource.connect(this.analyser);
    }
    const element = this.replayElement;
    const url = URL.createObjectURL(wav(chunks, bytes));
    this.replayUrl = url;
    this.replayTurn = turnId;
    let offset = 0;
    this.replaySentences = sentences.map(sentence => {
      const duration = sentence.bytes / 2 / SAMPLE_RATE;
      const entry = { sentence, start: offset, duration };
      offset += duration;
      return entry;
    });
    const playbackGeneration = this.playbackGeneration;
    element.src = url;
    element.currentTime = 0;
    element.preservesPitch = true;
    element.playbackRate = slow ? 0.8 : 1;
    element.onended = () => {
      if (this.replayUrl !== url || playbackGeneration !== this.playbackGeneration) return;
      const last = this.replaySentences.at(-1)?.sentence;
      if (last) this.emitCaption(turnId, last, captionCharacters(last.text).length, 'ended');
      this.stopReplay(false);
      if (!this.sources.size) this.setBusy(false);
    };
    element.onerror = () => {
      if (this.replayUrl !== url || playbackGeneration !== this.playbackGeneration) return;
      this.stopReplay();
      this.setBusy(false);
      this.reportError('音声をもう一度再生できませんでした。再度お試しください。');
    };
    try {
      await element.play();
      if (this.replayUrl === url && playbackGeneration === this.playbackGeneration) this.setBusy(true);
    } catch {
      if (this.replayUrl !== url) return;
      this.stopReplay();
      this.setBusy(false);
      throw new AppError('ブラウザーが音声の再生をブロックしました。もう一度、再生ボタンを押してください。');
    }
  }

  async dispose(): Promise<void> {
    if (this.disposed) return;
    this.disposed = true;
    this.stopMicrophone();
    this.cancelTurn();
    this.turns.clear();
    this.cacheBytes = 0;
    this.replaySource?.disconnect();
    this.analyser?.disconnect();
    if (this.context && this.context.state !== 'closed') await this.context.close().catch(() => undefined);
    this.context = null;
    this.analyser = null;
    this.replayElement = null;
    this.replaySource = null;
  }

  private acknowledge(turnId: string, sentence: CachedSentence): void {
    if (sentence.complete && sentence.bytes > 0 && !sentence.sources.size && !sentence.acknowledged && !sentence.cancelled && this.currentTurn === turnId && !this.disposed) {
      sentence.acknowledged = true;
      this.emitCaption(turnId, sentence, captionCharacters(sentence.text).length, 'ended');
      this.options.onPlayed(turnId, sentence.id);
    }
  }

  private getSentence(turnId: string, sentenceId: string): CachedSentence | undefined {
    const turn = this.turns.get(turnId);
    if (!turn) return;
    let sentence = turn.sentences.get(sentenceId);
    if (!sentence) {
      sentence = {
        id: sentenceId, chunks: [], bytes: 0, text: '', complete: false,
        acknowledged: false, cancelled: false, sources: new Set(), spans: [],
        visibleCharacters: 0, correction: null,
      };
      turn.sentences.set(sentenceId, sentence);
    }
    return sentence;
  }

  private playedSeconds(sentence: CachedSentence): number {
    const now = this.context?.currentTime ?? 0;
    return sentence.spans.reduce((seconds, span) => seconds + (span.ended ? span.duration : Math.min(span.duration, Math.max(0, now - span.start))), 0);
  }

  private updateCaptions(): void {
    if (this.replayTurn && this.replayElement) {
      if (this.replayElement.paused) return;
      const time = this.replayElement.currentTime;
      while (this.replaySentenceIndex < this.replaySentences.length) {
        const { sentence, start, duration } = this.replaySentences[this.replaySentenceIndex];
        const length = captionCharacters(sentence.text).length;
        if (time >= start + duration) {
          this.emitCaption(this.replayTurn, sentence, length, 'ended');
          this.replaySentenceIndex++;
          this.replayVisibleCharacters = 0;
          continue;
        }
        if (time > start) {
          this.replayVisibleCharacters = Math.min(length, Math.max(this.replayVisibleCharacters, 1, Math.floor((time - start) / duration * length)));
          this.emitCaption(this.replayTurn, sentence, this.replayVisibleCharacters, 'playing');
        }
        break;
      }
      return;
    }
    if (!this.currentTurn) return;
    let audibleSentence: CachedSentence | undefined;
    for (const sentence of this.turns.get(this.currentTurn)?.sentences.values() ?? []) {
      if (sentence.cancelled || sentence.acknowledged || !sentence.text) continue;
      const seconds = this.playedSeconds(sentence);
      if (seconds <= 0) continue;
      const length = captionCharacters(sentence.text).length;
      const correction = sentence.correction;
      const remainingSeconds = sentence.bytes / 2 / SAMPLE_RATE - (correction?.seconds ?? 0);
      const estimate = correction && remainingSeconds > 0
        ? correction.characters + (seconds - correction.seconds) / remainingSeconds * (length - correction.characters)
        : seconds * 6;
      sentence.visibleCharacters = Math.min(length, Math.max(sentence.visibleCharacters, 1, Math.floor(estimate)));
      audibleSentence = sentence;
    }
    if (audibleSentence) this.emitCaption(this.currentTurn, audibleSentence, audibleSentence.visibleCharacters, 'playing');
  }

  private emitCaption(turnId: string, sentence: CachedSentence, visibleCharacters: number, status: PlaybackCaption['status']): void {
    if (!sentence.text) return;
    const next: PlaybackCaption = { turnId, sentenceId: sentence.id, text: sentence.text, visibleCharacters, status };
    if (this.caption?.turnId === turnId && this.caption.sentenceId === sentence.id && this.caption.text === next.text && this.caption.visibleCharacters === visibleCharacters && this.caption.status === status) return;
    this.caption = next;
    this.options.onCaption?.(next);
  }

  private clearCaption(): void {
    if (!this.caption) return;
    this.caption = null;
    this.options.onCaption?.(null);
  }

  private evictCache(incoming: number): void {
    for (const [id, turn] of this.turns) {
      if (this.cacheBytes + incoming <= MAX_CACHE_BYTES) break;
      if (id === this.currentTurn || id === this.replayTurn) continue;
      for (const sentence of turn.sentences.values()) this.cacheBytes -= sentence.bytes;
      this.turns.delete(id);
    }
  }

  private stopReplay(clearCaption = true): void {
    if (this.replayElement) {
      this.replayElement.onended = null;
      this.replayElement.onerror = null;
      this.replayElement.pause();
      this.replayElement.removeAttribute('src');
      this.replayElement.load();
    }
    if (this.replayUrl) URL.revokeObjectURL(this.replayUrl);
    this.replayUrl = null;
    this.replayTurn = null;
    this.replaySentences = [];
    this.replaySentenceIndex = 0;
    this.replayVisibleCharacters = 0;
    if (clearCaption) this.clearCaption();
  }

  private setBusy(busy: boolean): void {
    if (this.busy !== busy) { this.busy = busy; this.options.onBusy(busy); }
    if (!busy) {
      cancelAnimationFrame(this.frame);
      this.frame = 0;
      this.options.levelRef.current = 0;
      return;
    }
    if (this.frame || !this.analyser) return;
    const samples = new Float32Array(this.analyser.fftSize);
    const update = () => {
      if (!this.busy || !this.analyser || this.disposed) { this.frame = 0; this.options.levelRef.current = 0; return; }
      this.analyser.getFloatTimeDomainData(samples);
      const rms = Math.sqrt(samples.reduce((sum, value) => sum + value * value, 0) / samples.length);
      this.options.levelRef.current = rms;
      this.updateCaptions();
      this.frame = requestAnimationFrame(update);
    };
    this.frame = requestAnimationFrame(update);
  }
}
