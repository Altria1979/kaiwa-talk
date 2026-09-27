export type ConversationRecordingResult =
  | { status: 'ready'; blob: Blob; extension: string }
  | { status: 'unavailable' | 'failed' | 'empty' };

const MIME_TYPES = ['audio/webm;codecs=opus', 'audio/mp4', 'audio/ogg;codecs=opus'];
const EXTENSIONS: Record<string, string> = {
  'audio/webm': 'webm', 'video/webm': 'webm', 'audio/mp4': 'm4a', 'video/mp4': 'mp4',
  'audio/ogg': 'ogg', 'application/ogg': 'ogg', 'audio/wav': 'wav', 'audio/mpeg': 'mp3', 'audio/aac': 'aac',
};

/** Records the audible output and an optional microphone into one fixed stream. */
export class ConversationRecorder {
  private recorder: MediaRecorder | null = null;
  private destination: MediaStreamAudioDestinationNode | null = null;
  private microphoneGain: GainNode | null = null;
  private microphone: AudioNode | null = null;
  private chunks: Blob[] = [];
  private mimeType = '';
  private failed = false;
  private stopping = false;
  private finished = false;
  private stopTimeout: ReturnType<typeof setTimeout> | null = null;
  private resolveResult!: (result: ConversationRecordingResult) => void;
  private readonly result = new Promise<ConversationRecordingResult>(resolve => { this.resolveResult = resolve; });

  constructor(context: AudioContext, private readonly playback: AudioNode) {
    if (typeof MediaRecorder === 'undefined' || !context.createMediaStreamDestination) {
      this.finish({ status: 'unavailable' });
      return;
    }
    try {
      this.destination = context.createMediaStreamDestination();
      this.microphoneGain = context.createGain();
      this.microphoneGain.connect(this.destination);
      playback.connect(this.destination);
      this.mimeType = MIME_TYPES.find(type => MediaRecorder.isTypeSupported?.(type)) ?? '';
      const recorder = new MediaRecorder(this.destination.stream, this.mimeType ? { mimeType: this.mimeType } : undefined);
      this.recorder = recorder;
      recorder.ondataavailable = event => {
        if (!this.finished && event.data.size > 0) this.chunks.push(event.data);
      };
      recorder.onerror = () => {
        this.failed = true;
        // An encoder error is followed by final data and stop events as well.
        this.stop();
      };
      recorder.onstop = () => this.finalize();
      recorder.start(1000);
    } catch {
      this.finish({ status: 'failed' });
    }
  }

  setMicrophone(source: AudioNode | null): void {
    if (source === this.microphone || this.finished || this.stopping) return;
    this.disconnectMicrophone();
    if (!source || !this.microphoneGain) return;
    try {
      source.connect(this.microphoneGain);
      this.microphone = source;
    } catch {
      this.failed = true;
      this.stop();
    }
  }

  setMuted(muted: boolean): void {
    if (this.microphoneGain) this.microphoneGain.gain.value = muted ? 0 : 1;
  }

  stop(): Promise<ConversationRecordingResult> {
    if (this.finished || this.stopping) return this.result;
    this.stopping = true;
    // A broken encoder must not leave session teardown waiting indefinitely.
    this.stopTimeout = setTimeout(() => this.finish({ status: 'failed' }), 5000);
    try {
      if (this.recorder && this.recorder.state !== 'inactive') this.recorder.stop();
    } catch {
      this.finish({ status: 'failed' });
    }
    return this.result;
  }

  private finalize(): void {
    if (this.finished) return;
    if (this.failed) { this.finish({ status: 'failed' }); return; }
    if (!this.chunks.length) { this.finish({ status: 'empty' }); return; }
    const mimeType = this.recorder?.mimeType || this.chunks.find(chunk => chunk.type)?.type || this.mimeType;
    const extension = EXTENSIONS[mimeType.split(';')[0].trim().toLowerCase()];
    if (!extension) { this.finish({ status: 'unavailable' }); return; }
    this.finish({ status: 'ready', blob: new Blob(this.chunks, { type: mimeType }), extension });
  }

  private disconnectMicrophone(): void {
    if (this.microphone && this.microphoneGain) {
      try { this.microphone.disconnect(this.microphoneGain); } catch { /* Capture may already be disconnected. */ }
    }
    this.microphone = null;
  }

  private finish(result: ConversationRecordingResult): void {
    if (this.finished) return;
    this.finished = true;
    if (this.stopTimeout) clearTimeout(this.stopTimeout);
    if (this.recorder) {
      this.recorder.ondataavailable = null;
      this.recorder.onstop = null;
      this.recorder.onerror = null;
    }
    this.disconnectMicrophone();
    this.microphoneGain?.disconnect();
    if (this.destination) {
      try { this.playback.disconnect(this.destination); } catch { /* Playback may already be disconnected. */ }
      this.destination.stream.getTracks().forEach(track => track.stop());
      this.destination.disconnect();
    }
    this.recorder = null;
    this.microphoneGain = null;
    this.destination = null;
    this.chunks = [];
    this.resolveResult(result);
  }
}
