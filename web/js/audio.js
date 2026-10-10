// Web86Box - audio output: an AudioWorklet that mixes 86Box's sound rings.
//
// The worklet reads the per-source rings (web_audio_ring_t) directly from
// the wasm memory; this side only owns the AudioContext and keeps the
// worklet's view of memory current when it grows.

export class AudioOutput {
  constructor() {
    this.context = null;
    this.node = null;
    this.emu = null;
    this.volume = 1.0;
    this.muted = false;
    this._postedBytes = 0;
    this._resumeOnGesture = this._resumeOnGesture.bind(this);
  }

  async attach(emu) {
    if (this.context) return;
    this.emu = emu;
    try {
      this.context = new AudioContext({ latencyHint: 'interactive', sampleRate: 48000 });
    } catch (e) {
      this.context = new AudioContext({ latencyHint: 'interactive' });
    }
    const url = new URL('./audio-worklet.js', import.meta.url);
    await this.context.audioWorklet.addModule(url);
    this.node = new AudioWorkletNode(this.context, 'web86box-audio', {
      numberOfInputs: 0,
      numberOfOutputs: 1,
      outputChannelCount: [2],
    });
    this.node.connect(this.context.destination);
    this._postMemory();
    this._applyGain();
    setInterval(() => this._postMemory(), 1000);

    if (this.context.state !== 'running') {
      for (const ev of ['pointerdown', 'keydown', 'touchstart'])
        window.addEventListener(ev, this._resumeOnGesture, { capture: true });
    }
  }

  _resumeOnGesture() {
    if (!this.context) return;
    this.context.resume().then(() => {
      if (this.context.state === 'running') {
        for (const ev of ['pointerdown', 'keydown', 'touchstart'])
          window.removeEventListener(ev, this._resumeOnGesture, { capture: true });
      }
    });
  }

  // (Re)send the memory and ring table when the wasm memory has grown.
  _postMemory() {
    if (!this.node || !this.emu?.module) return;
    const buffer = this.emu.buffer;
    const rings = this.emu.audioRings();
    const key = buffer.byteLength + ':' + rings.join(',');
    if (key === this._postedBytes) return;
    this._postedBytes = key;
    this.node.port.postMessage({ type: 'memory', buffer, rings });
  }

  setVolume(v) { this.volume = v; this._applyGain(); }
  setMuted(m) { this.muted = m; this._applyGain(); }
  _applyGain() {
    this.node?.port.postMessage({ type: 'gain', gain: this.muted ? 0 : this.volume });
  }
}
