import type { SpeechContext, SpeechFrame } from '../../shared/speech-policy';

export type VadStatus = 'idle' | 'loading' | 'ready' | 'unavailable';

export interface BrowserVadCallbacks {
  onSpeechStart?: () => void;
  onSpeechRealStart?: () => void;
  onSpeechEnd?: () => void;
  onVADMisfire?: () => void;
  onVadStatus?: (status: VadStatus) => void;
  onVadFrame?: (frame: SpeechFrame) => void;
  vadRedemptionMs?: number;
}

interface VadModel {
  process(frame: Float32Array): Promise<{ isSpeech: number }>;
  reset_state(): void;
  release(): Promise<void>;
}

interface PendingFrame extends Omit<SpeechFrame, 'probability'> {
  samples: Float32Array;
  generation: number;
}

const FRAME_SAMPLES = 512;
const SAMPLES_PER_MS = 16;
const MAX_PENDING_FRAMES = 32;

/** Processes the very same PCM16 samples sent to ASR, without another capture graph. */
export class BrowserVad {
  private model: VadModel | null = null;
  private closed = false;
  private failed = false;
  private status: VadStatus = 'idle';
  private generation = 0;
  private modelGeneration = -1;
  private queue: PendingFrame[] = [];
  private processing = false;
  private processingTask: Promise<void> = Promise.resolve();
  private initializeTask: Promise<void>;
  private destroyTask: Promise<void> | null = null;
  private fetchController = new AbortController();
  private remainder = new Float32Array(FRAME_SAMPLES);
  private remainderLength = 0;
  private remainderStartMs = 0;
  private remainderContext: SpeechContext | null = null;
  private expectedMs: number | null = null;
  private streamId: string | null = null;
  private captureContext: SpeechContext | null = null;

  constructor(
    private readonly callbacks: BrowserVadCallbacks,
    private readonly isCurrent: () => boolean,
    private paused: boolean,
  ) {
    this.report('loading');
    this.initializeTask = this.initialize().catch(() => this.fail());
  }

  setPaused(paused: boolean): void {
    if (this.paused === paused) return;
    this.paused = paused;
    this.reset();
  }

  /** Invalidate queued/in-flight evidence without resetting the ASR sample clock. */
  reset(): void {
    this.generation++;
    this.queue = [];
    this.remainderLength = 0;
    this.remainderContext = null;
    this.expectedMs = null;
    this.streamId = null;
    this.captureContext = null;
  }

  pushPcm(bytes: Uint8Array, streamId: string, startMs: number, context: SpeechContext): void {
    if (!this.active() || !this.model) return;
    if (bytes.byteLength % 2 || !Number.isFinite(startMs) || startMs < 0) {
      this.fail();
      return;
    }
    if (this.streamId !== streamId || this.expectedMs !== startMs || this.captureContext?.epoch !== context.epoch) this.reset();
    this.streamId = streamId;
    this.captureContext = { ...context };
    const samples = bytes.byteLength / 2;
    this.expectedMs = startMs + samples / SAMPLES_PER_MS;
    const view = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);
    for (let offset = 0; offset < samples; offset++) {
      if (!this.remainderLength) {
        this.remainderStartMs = startMs + offset / SAMPLES_PER_MS;
        this.remainderContext = { ...context };
      }
      this.remainder[this.remainderLength++] = view.getInt16(offset * 2, true) / 32768;
      if (this.remainderLength !== FRAME_SAMPLES) continue;
      if (this.queue.length + Number(this.processing) >= MAX_PENDING_FRAMES) {
        this.fail();
        return;
      }
      this.queue.push({
        samples: this.remainder, generation: this.generation, streamId,
        startMs: this.remainderStartMs, endMs: this.remainderStartMs + FRAME_SAMPLES / SAMPLES_PER_MS,
        context: this.remainderContext!,
      });
      this.remainder = new Float32Array(FRAME_SAMPLES);
      this.remainderLength = 0;
      this.drain();
    }
  }

  destroy(): Promise<void> {
    if (this.destroyTask) return this.destroyTask;
    this.closed = true;
    this.fetchController.abort();
    this.reset();
    this.destroyTask = Promise.all([this.initializeTask, this.processingTask]).then(() => this.release());
    return this.destroyTask;
  }

  private active(): boolean {
    return !this.closed && !this.failed && !this.paused && this.isCurrent();
  }

  private async initialize(): Promise<void> {
    const [{ Silero }, ort] = await Promise.all([
      import('@ricky0123/vad-web/dist/models/silero.js'),
      import('onnxruntime-web/wasm'),
    ]);
    if (this.closed || !this.isCurrent()) return;
    ort.env.wasm.numThreads = 1;
    ort.env.wasm.wasmPaths = '/vad/ort/';
    const model = await Silero.new(ort, async () => {
      const response = await fetch('/vad/silero_vad_v6.onnx', { signal: this.fetchController.signal });
      if (!response.ok) throw new Error('VAD model could not be loaded');
      return response.arrayBuffer();
    });
    if (this.closed || !this.isCurrent()) {
      await model.release();
      return;
    }
    this.model = model;
    this.report('ready');
  }

  private drain(): void {
    if (this.processing || !this.model || !this.active()) return;
    this.processing = true;
    this.processingTask = (async () => {
      while (this.active() && this.model && this.queue.length) {
        const frame = this.queue.shift()!;
        if (frame.generation !== this.generation) continue;
        if (this.modelGeneration !== frame.generation) {
          this.model.reset_state();
          this.modelGeneration = frame.generation;
        }
        const result = await this.model.process(frame.samples);
        if (!this.active() || frame.generation !== this.generation) continue;
        if (!Number.isFinite(result.isSpeech) || result.isSpeech < 0 || result.isSpeech > 1) throw new Error('Invalid VAD probability');
        this.callbacks.onVadFrame?.({
          streamId: frame.streamId, startMs: frame.startMs, endMs: frame.endMs,
          probability: result.isSpeech, context: frame.context,
        });
      }
    })().catch(() => this.fail()).finally(() => {
      this.processing = false;
      if (this.queue.length) this.drain();
    });
  }

  private fail(): void {
    if (this.failed || this.closed) return;
    this.failed = true;
    this.reset();
    this.report('unavailable');
    // Never release an ONNX session while its inference is still running.
    void this.processingTask.then(() => this.release()).catch(() => undefined);
  }

  private async release(): Promise<void> {
    const model = this.model;
    this.model = null;
    if (model) await model.release();
  }

  private report(status: VadStatus): void {
    if (this.closed || !this.isCurrent() || this.status === status) return;
    this.status = status;
    this.callbacks.onVadStatus?.(status);
  }
}
