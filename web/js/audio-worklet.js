// Web86Box - AudioWorklet mixer.
//
// Each 86Box sound source writes stereo float frames into its own ring in
// the shared wasm memory (see web_audio_ring_t in platform/web_shared.h):
//   u32 write_pos, u32 read_pos, u32 size, u32 rate, f32 data[size * 2]
// Here every active ring is resampled (linear) to the context rate and the
// sources are summed.

const HEADER_WORDS = 4;
const MAX_LATENCY_S = 0.25;   // drop audio beyond this backlog
const TARGET_LATENCY_S = 0.06;
const PRIME_S = 0.04;         // buffer this much before (re)starting a source

class Web86BoxAudio extends AudioWorkletProcessor {
  constructor() {
    super();
    this.buffer = null;
    this.rings = [];
    this.gain = 1;
    this.state = [];
    this.port.onmessage = (e) => {
      const m = e.data;
      if (m.type === 'memory') {
        this.buffer = m.buffer;
        this.rings = m.rings.map((ptr) => this._ringViews(ptr));
      } else if (m.type === 'gain') {
        this.gain = m.gain;
      }
    };
  }

  _ringViews(ptr) {
    if (!ptr || !this.buffer || ptr + HEADER_WORDS * 4 > this.buffer.byteLength) return null;
    const hdr = new Uint32Array(this.buffer, ptr, HEADER_WORDS);
    const size = hdr[2];
    if (!size || ptr + 16 + size * 8 > this.buffer.byteLength) return null;
    return { hdr, size, data: new Float32Array(this.buffer, ptr + 16, size * 2) };
  }

  process(inputs, outputs) {
    const out = outputs[0];
    const left = out[0];
    const right = out[1] || out[0];
    const frames = left.length;
    left.fill(0);
    if (right !== left) right.fill(0);

    for (let s = 0; s < this.rings.length; s++) {
      const ring = this.rings[s];
      if (!ring) continue;
      const hdr = ring.hdr;
      const rate = Atomics.load(hdr, 3);
      if (!rate) continue;
      const st = this.state[s] || (this.state[s] = { frac: 0, primed: false });

      const w = Atomics.load(hdr, 0);
      let r = Atomics.load(hdr, 1);
      let avail = (w - r) >>> 0;
      const step = rate / sampleRate;

      if (avail > MAX_LATENCY_S * rate) {
        r = (w - Math.floor(TARGET_LATENCY_S * rate)) >>> 0;
        avail = (w - r) >>> 0;
        st.frac = 0;
      }
      const need = Math.ceil(st.frac + step * frames) + 1;
      if (!st.primed) {
        if (avail < PRIME_S * rate) continue;
        st.primed = true;
      }
      if (avail < need) {
        st.primed = false; // underrun: wait for the source to refill
        continue;
      }

      const size = ring.size;
      const data = ring.data;
      let frac = st.frac;
      for (let i = 0; i < frames; i++) {
        const ip = frac | 0;
        const t = frac - ip;
        const i0 = ((r + ip) % size) * 2;
        const i1 = ((r + ip + 1) % size) * 2;
        left[i] += data[i0] + (data[i1] - data[i0]) * t;
        right[i] += data[i0 + 1] + (data[i1 + 1] - data[i0 + 1]) * t;
        frac += step;
      }
      const consumed = frac | 0;
      st.frac = frac - consumed;
      Atomics.store(hdr, 1, (r + consumed) >>> 0);
    }

    const g = this.gain;
    for (let i = 0; i < frames; i++) {
      left[i] = Math.max(-1, Math.min(1, left[i] * g));
      if (right !== left) right[i] = Math.max(-1, Math.min(1, right[i] * g));
    }
    return true;
  }
}

registerProcessor('web86box-audio', Web86BoxAudio);
