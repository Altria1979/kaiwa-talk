const SILENCE_THRESHOLD = 0.008;
const MOUTH_GAIN = 4.5;
const MAX_OPENNESS = 0.75;
const ATTACK_SECONDS = 0.045;
const RELEASE_SECONDS = 0.065;

/** Convert raw playback RMS into a bounded VRM aa weight at any frame rate. */
export function getMouthOpenness(previous: number, rms: number, deltaSeconds: number): number {
  // Playback completion and cancellation publish zero and should close immediately.
  if (!Number.isFinite(rms) || rms <= 0) return 0;
  const current = Number.isFinite(previous) ? Math.min(MAX_OPENNESS, Math.max(0, previous)) : 0;
  const target = Math.min(MAX_OPENNESS, Math.max(0, rms - SILENCE_THRESHOLD) * MOUTH_GAIN);
  const elapsed = Number.isFinite(deltaSeconds) ? Math.max(0, deltaSeconds) : 0;
  const duration = target > current ? ATTACK_SECONDS : RELEASE_SECONDS;
  const openness = target + (current - target) * Math.exp(-elapsed / duration);
  return target === 0 && openness < 0.001 ? 0 : openness;
}
