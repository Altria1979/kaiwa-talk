/* AudioWorklet global scope: actual device sample rate -> mono 16 kHz PCM16. */
class PcmCaptureProcessor extends AudioWorkletProcessor {
  constructor() {
    super();
    this.ratio = sampleRate / 16000;
    this.remaining = this.ratio;
    this.sum = 0;
    this.chunk = new Int16Array(640);
    this.offset = 0;
    this.muted = false;
    this.port.onmessage = event => { this.muted = Boolean(event.data?.muted); };
  }

  process(inputs, outputs) {
    // Keep the capture graph alive without routing microphone sound to speakers.
    for (const output of outputs) for (const channel of output) channel.fill(0);
    const channels = inputs[0];
    if (!channels?.length || !channels[0]?.length) return true;
    for (let i = 0; i < channels[0].length; i += 1) {
      let sample = 0;
      if (!this.muted) {
        for (const channel of channels) sample += channel[i] || 0;
        sample /= channels.length;
      }
      // Area averaging preserves fractional phase across render quanta, including 44.1 kHz input.
      let available = 1;
      while (available > 1e-8) {
        const weight = Math.min(available, this.remaining);
        this.sum += sample * weight;
        this.remaining -= weight;
        available -= weight;
        if (this.remaining <= 1e-8) {
          const value = Math.max(-1, Math.min(1, this.sum / this.ratio));
          this.chunk[this.offset++] = value < 0 ? Math.round(value * 32768) : Math.round(value * 32767);
          this.sum = 0;
          this.remaining = this.ratio;
          if (this.offset === this.chunk.length) {
            this.port.postMessage(this.chunk.buffer, [this.chunk.buffer]);
            this.chunk = new Int16Array(640);
            this.offset = 0;
          }
        }
      }
    }
    return true;
  }
}

registerProcessor('pcm-capture', PcmCaptureProcessor);
