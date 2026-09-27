/** Shared initial tuning for voice admission; pause length is a separate setting. */
export const SPEECH_POLICY = {
  noiseThreshold: 0.2,
  probability: 0.9,
  inputSpeechMs: 250,
  interruptionMs: 1000,
  interruptionSpeechMs: 800,
  transcriptStableMs: 300,
  maxSpeechGapMs: 200,
  evidenceRetentionMs: 30_000,
  pendingSegmentLimit: 32,
} as const;

export interface SpeechSegment {
  streamId: string;
  segmentId: number;
  beginMs: number;
  endMs: number | null;
}

export interface SpeechContext {
  epoch: number;
  interrupting: boolean;
  turnId: string | null;
  replayRequest: number;
}

export interface SpeechFrame {
  streamId: string;
  startMs: number;
  endMs: number;
  probability: number;
  context: SpeechContext;
}
