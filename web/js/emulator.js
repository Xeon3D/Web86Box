// Web86Box - emulator core: loads the wasm module and bridges it to the page.
//
// The C side (platform/web_*.c) exposes a fixed-layout status block
// (web_shared_t, see platform/web_shared.h). This class reads it straight
// from the shared wasm memory every animation frame for video, the status
// bar and audio, and sends everything else as text commands.

import { AudioOutput } from './audio.js';

// Word offsets into web_shared_t (keep in sync with web_shared.h).
const W = {
  magic: 0, version: 1, fbReady: 2, fbPtr: 3, fbW: 6, fbH: 9, frameCount: 12,
  audioRing: 13, audioGain: 21, state: 22, speed: 23, paused: 24,
  mouseCapture: 25, statusSeq: 26, kbdLeds: 27,
};
const SB_BYTES = { active: 32 * 4, write: 96 * 4, empty: 160 * 4, wp: 224 * 4 };
const FB_NEW = 0x100;
const SHARED_MAGIC = 0x57383642;

export const State = { BOOT: 0, WAITING: 1, RUNNING: 2, STOPPED: 3, ERROR: 4 };

export class Emulator extends EventTarget {
  constructor({ canvas, romBase = 'roms' } = {}) {
    super();
    this.canvas = canvas;
    this.ctx = canvas.getContext('2d', { alpha: false, desynchronized: true });
    this.romBase = new URL(romBase, document.baseURI).href.replace(/\/$/, '');
    this.module = null;
    this.sharedPtr = 0;
    this.front = 0;
    this.imageData = null;
    this.lastStatusSeq = -1;
    this.lastFrameCount = 0;
    this.screenW = 640;
    this.screenH = 480;
    this.audio = new AudioOutput();
    this.catalog = null;
    this.state = State.BOOT;
    this.log = [];
    this._raf = this._raf.bind(this);
  }

  async load() {
    const { default: create86Box } = await import('../86Box.mjs');
    const self = this;
    this.module = await create86Box({
      arguments: [this.romBase],
      web86box: { onEvent: (type, payload) => self._onEvent(type, payload) },
      print: (t) => self._log('out', t),
      printErr: (t) => self._log('err', t),
      locateFile: (path) => new URL(path, new URL('../', import.meta.url)).href,
    });
    this.sharedPtr = Number(this.module._web_get_shared());
    requestAnimationFrame(this._raf);
  }

  _log(kind, text) {
    this.log.push(text);
    if (this.log.length > 2000) this.log.splice(0, 500);
    (kind === 'err' ? console.warn : console.log)('[86Box]', text);
  }

  // ---- memory helpers -----------------------------------------------------

  get buffer() { return this.module.wasmMemory.buffer; }

  _u32() { return new Uint32Array(this.buffer, this.sharedPtr, 256); }

  _word(i) { return Atomics.load(this._u32(), i); }

  // ---- commands -------------------------------------------------------------

  command(text) {
    const m = this.module;
    if (!m) return;
    const len = m.lengthBytesUTF8(text) + 1;
    const ptr = Number(m._malloc(len));
    m.stringToUTF8(text, ptr, len);
    m._web_command(BigInt(ptr)); // wasm64 pointer; ownership passes to C
  }

  start(vmPath) { this.command(`start ${vmPath}`); }

  // Input entry points are cheap direct calls (see web_main.c).
  key(down, scancode) { this.module?._web_key(down ? 1 : 0, scancode); }
  mouseMove(dx, dy) { this.module?._web_mouse_move(dx | 0, dy | 0); }
  mouseAbs(x, y, inRange) { this.module?._web_mouse_abs(x, y, inRange ? 1 : 0); }
  mouseButtons(mask) { this.module?._web_mouse_buttons(mask | 0); }
  mouseWheel(dz) { this.module?._web_mouse_wheel(dz | 0); }
  msgboxReply(id, result) { this.module?._web_msgbox_reply(id, result); }
  joystick(pad, axes, buttons) {
    const a = (i) => Math.max(-32767, Math.min(32767, Math.round((axes[i] || 0) * 32767)));
    this.module?._web_joystick_update(pad, a(0), a(1), a(2), a(3), a(4), a(5), a(6), a(7), buttons | 0);
  }

  // ---- events from C ----------------------------------------------------------

  _onEvent(type, payload) {
    let detail = payload;
    if (payload && (payload[0] === '{' || payload[0] === '[')) {
      try { detail = JSON.parse(payload); } catch (e) { /* keep text */ }
    }
    switch (type) {
      case 'state':
        this.state = Number(payload);
        if (this.state === State.RUNNING) this.audio.attach(this);
        break;
      case 'catalog':
        this.catalog = detail;
        break;
      case 'resize':
        this.screenW = detail.w;
        this.screenH = detail.h;
        break;
    }
    this.dispatchEvent(new CustomEvent(type, { detail }));
  }

  // ---- per-frame work ---------------------------------------------------------

  _raf() {
    requestAnimationFrame(this._raf);
    if (!this.module || !this.sharedPtr) return;
    const u32 = this._u32();
    if (u32[W.magic] !== SHARED_MAGIC) return;

    this._present(u32);

    const seq = Atomics.load(u32, W.statusSeq);
    if (seq !== this.lastStatusSeq) {
      this.lastStatusSeq = seq;
      this.dispatchEvent(new CustomEvent('statusbar'));
    }
  }

  _present(u32) {
    const ready = Atomics.load(u32, W.fbReady);
    if (!(ready & FB_NEW)) return;
    const prev = Atomics.exchange(u32, W.fbReady, this.front);
    this.front = prev & 0xff;

    const w = u32[W.fbW + this.front];
    const h = u32[W.fbH + this.front];
    const ptr = u32[W.fbPtr + this.front];
    if (!w || !h || !ptr) return;

    if (this.canvas.width !== w || this.canvas.height !== h) {
      this.canvas.width = w;
      this.canvas.height = h;
      this.imageData = null;
      this.dispatchEvent(new CustomEvent('framesize', { detail: { w, h } }));
    }
    if (!this.imageData || this.imageData.width !== w || this.imageData.height !== h) {
      this.imageData = new ImageData(w, h);
    }
    // ImageData cannot wrap shared memory, so copy the frame out.
    this.imageData.data.set(new Uint8Array(this.buffer, ptr, w * h * 4));
    this.ctx.putImageData(this.imageData, 0, 0);
  }

  // ---- status ------------------------------------------------------------------

  get speedPercent() { return this.sharedPtr ? this._word(W.speed) : 0; }
  get paused() { return this.sharedPtr ? !!this._word(W.paused) : false; }

  statusIcons() {
    const b = new Uint8Array(this.buffer, this.sharedPtr, 1024);
    return {
      active: b.subarray(SB_BYTES.active, SB_BYTES.active + 256),
      write: b.subarray(SB_BYTES.write, SB_BYTES.write + 256),
      empty: b.subarray(SB_BYTES.empty, SB_BYTES.empty + 256),
      wp: b.subarray(SB_BYTES.wp, SB_BYTES.wp + 256),
    };
  }

  audioRings() {
    const u32 = this._u32();
    const rings = [];
    for (let i = 0; i < 8; i++) rings.push(u32[W.audioRing + i]);
    return rings;
  }
}
