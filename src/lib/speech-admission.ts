import { SPEECH_POLICY, type SpeechContext, type SpeechFrame, type SpeechSegment } from '../../shared/speech-policy';

type Transcript = SpeechSegment & { text: string; final: boolean };
type Run = { frames: SpeechFrame[]; context: SpeechContext; owner?: number };
type Pending = { transcript: Transcript; observedEndMs: number; normalized: string; stableSince: number; accepted: boolean; displayed: string; run?: Run };
export type SpeechDecision = { transcript: Transcript; context: SpeechContext; accept: boolean };

const words = (text: string) => text.replace(/[^\p{L}\p{N}]/gu, '');

/** Correlates evidence by uploaded PCM time, never by WebSocket arrival order. */
export class SpeechAdmission {
  private streamId: string | null = null;
  private runs: Run[] = [];
  private pending = new Map<number, Pending>();
  private beforeMs = 0;
  private latestMs = 0;

  reset(streamId: string | null, beforeMs = 0): void {
    this.streamId = streamId;
    this.beforeMs = beforeMs;
    this.latestMs = beforeMs;
    this.runs = [];
    this.pending.clear();
  }

  frame(frame: SpeechFrame): void {
    if (frame.streamId !== this.streamId || frame.startMs < this.beforeMs || frame.startMs < this.latestMs
      || !Number.isFinite(frame.probability) || frame.endMs <= frame.startMs) return;
    this.latestMs = frame.endMs;
    const cutoff = this.latestMs - SPEECH_POLICY.evidenceRetentionMs;
    this.runs = this.runs.filter(run => run.frames.at(-1)!.endMs >= cutoff);
    for (const [id, item] of this.pending) if (item.observedEndMs < cutoff) this.pending.delete(id);
    if (frame.probability < SPEECH_POLICY.probability) return;
    let run = this.runs.at(-1);
    const previous = run?.frames.at(-1);
    if (!run || !previous || frame.startMs - previous.endMs > SPEECH_POLICY.maxSpeechGapMs || run.context.epoch !== frame.context.epoch) {
      run = { frames: [], context: { ...frame.context } };
      this.runs.push(run);
    }
    run.frames.push(frame);
    // A long uninterrupted utterance must not retain an unbounded frame history.
    while (run.frames[0].endMs < cutoff) run.frames.shift();
  }

  transcript(transcript: Transcript, now: number, uploadedMs: number): void {
    if (transcript.streamId !== this.streamId || !Number.isInteger(transcript.segmentId) || transcript.segmentId < 1
      || !Number.isFinite(transcript.beginMs) || transcript.beginMs < this.beforeMs
      || (transcript.endMs !== null && (!Number.isFinite(transcript.endMs) || transcript.endMs < transcript.beginMs))) return;
    const existing = this.pending.get(transcript.segmentId);
    if (existing?.transcript.final) return;
    const normalized = words(transcript.text);
    if (existing) {
      if (existing.normalized !== normalized) existing.stableSince = now;
      existing.normalized = normalized;
      existing.transcript = transcript;
      existing.observedEndMs = transcript.endMs ?? uploadedMs;
    } else {
      if (this.pending.size >= SPEECH_POLICY.pendingSegmentLimit) this.pending.delete(this.pending.keys().next().value!);
      this.pending.set(transcript.segmentId, {
        transcript, normalized, observedEndMs: transcript.endMs ?? uploadedMs, stableSince: now, accepted: false, displayed: '',
      });
    }
  }

  evaluate(now: number): SpeechDecision[] {
    const decisions: SpeechDecision[] = [];
    for (const [id, item] of this.pending) {
      const { transcript } = item;
      if (!item.normalized) {
        if (item.accepted && transcript.final && item.displayed !== 'true:') {
          decisions.push({ transcript: { ...transcript, text: '' }, context: item.run!.context, accept: false });
          item.displayed = 'true:';
        }
        continue;
      }
      if (!item.accepted) {
        const evidenceEndMs = transcript.final ? item.observedEndMs : Math.max(item.observedEndMs, this.latestMs);
        const run = this.runs.find(candidate => {
          if (candidate.owner !== undefined && candidate.owner !== id) return false;
          // Interim ranges have no end timestamp; don't attach an old cloud onset
          // to a much later utterance just because its result arrived late.
          if (!transcript.final && Math.abs(candidate.frames[0].startMs - transcript.beginMs) > 400) return false;
          const relevant = candidate.frames.filter(frame => frame.endMs > transcript.beginMs && frame.startMs < evidenceEndMs);
          if (!relevant.length) return false;
          const speechMs = relevant.reduce((sum, frame) => sum + Math.max(0, Math.min(frame.endMs, evidenceEndMs) - Math.max(frame.startMs, transcript.beginMs)), 0);
          if (!candidate.context.interrupting) return speechMs >= SPEECH_POLICY.inputSpeechMs;
          return speechMs >= SPEECH_POLICY.interruptionSpeechMs
            && relevant.at(-1)!.endMs - relevant[0].startMs >= SPEECH_POLICY.interruptionMs
            && now - item.stableSince >= SPEECH_POLICY.transcriptStableMs;
        });
        if (!run) continue;
        run.owner = id;
        item.run = run;
        item.accepted = true;
        item.displayed = `${transcript.final}:${transcript.text}`;
        decisions.push({ transcript, context: run.context, accept: true });
      } else {
        const displayed = `${transcript.final}:${transcript.text}`;
        if (displayed !== item.displayed) {
          item.displayed = displayed;
          decisions.push({ transcript, context: item.run!.context, accept: false });
        }
      }
    }
    return decisions;
  }

  nextDeadline(now: number): number | null {
    let deadline = Infinity;
    for (const item of this.pending.values()) {
      const at = item.stableSince + SPEECH_POLICY.transcriptStableMs;
      if (!item.accepted && item.normalized && at > now) deadline = Math.min(deadline, at);
    }
    return Number.isFinite(deadline) ? deadline : null;
  }
}
