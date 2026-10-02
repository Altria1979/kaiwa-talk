import { AppError, APP_ERROR_MESSAGES } from '../../shared/app-errors';

/** Page-owned microphone grant; conversation owners borrow only disabled tracks. */
export class BrowserMicrophone {
  private stream: MediaStream | null = null;
  private pending: Promise<MediaStream | null> | null = null;
  private owner: object | null = null;
  private ownerGeneration = 0;
  private generation = 0;

  async acquire(owner: object): Promise<MediaStream | null> {
    if (this.owner !== owner) ++this.ownerGeneration;
    this.owner = owner;
    const ownerGeneration = this.ownerGeneration;
    const generation = this.generation;
    if (this.stream && !this.hasLiveAudio(this.stream)) {
      this.stopStream(this.stream);
      this.stream = null;
    }
    for (const track of this.stream?.getAudioTracks() ?? []) track.enabled = false;
    const pending = this.stream ? Promise.resolve(this.stream) : this.pending ??= this.requestStream(generation);
    try {
      const stream = await pending;
      return generation === this.generation && ownerGeneration === this.ownerGeneration && this.owner === owner
        ? stream : null;
    } catch (error) {
      if (generation !== this.generation || ownerGeneration !== this.ownerGeneration || this.owner !== owner) return null;
      throw error;
    } finally {
      if (this.pending === pending) this.pending = null;
    }
  }

  release(owner: object): void {
    if (this.owner !== owner) return;
    this.owner = null;
    ++this.ownerGeneration;
    for (const track of this.stream?.getAudioTracks() ?? []) track.enabled = false;
  }

  dispose(): void {
    ++this.generation;
    ++this.ownerGeneration;
    this.owner = null;
    this.pending = null;
    if (this.stream) this.stopStream(this.stream);
    this.stream = null;
  }

  private async requestStream(generation: number): Promise<MediaStream | null> {
    if (typeof navigator === 'undefined' || !navigator.mediaDevices?.getUserMedia) {
      throw new AppError(APP_ERROR_MESSAGES.microphoneUnsupported);
    }
    let stream: MediaStream;
    try {
      stream = await navigator.mediaDevices.getUserMedia({
        audio: { channelCount: 1, echoCancellation: true, noiseSuppression: true, autoGainControl: true },
      });
    } catch (error) {
      const denied = error instanceof DOMException && (error.name === 'NotAllowedError' || error.name === 'SecurityError');
      throw new AppError(denied ? APP_ERROR_MESSAGES.microphoneDenied : APP_ERROR_MESSAGES.microphoneStartFailed);
    }
    if (generation !== this.generation) {
      this.stopStream(stream);
      return null;
    }
    if (!this.hasLiveAudio(stream)) {
      this.stopStream(stream);
      throw new AppError(APP_ERROR_MESSAGES.microphoneStartFailed);
    }
    for (const track of stream.getAudioTracks()) track.enabled = false;
    this.stream = stream;
    return stream;
  }

  private hasLiveAudio(stream: MediaStream): boolean {
    const tracks = stream.getAudioTracks();
    return tracks.length > 0 && tracks.every(track => track.readyState === 'live');
  }

  private stopStream(stream: MediaStream): void {
    for (const track of stream.getTracks()) {
      track.enabled = false;
      track.stop();
    }
  }
}
