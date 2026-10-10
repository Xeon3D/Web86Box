// Web86Box - keyboard, mouse and gamepad input.
//
// Keys are translated from KeyboardEvent.code to XT (set 1) scancodes, with
// 0x100 marking the E0 prefix, the same values the Qt and SDL frontends pass
// to keyboard_input(). The C side handles Print Screen / Pause / right Ctrl
// remapping exactly like MainWindow::processKeyboardInput().

export const CODE_TO_XT = {
  Escape: 0x01, Digit1: 0x02, Digit2: 0x03, Digit3: 0x04, Digit4: 0x05,
  Digit5: 0x06, Digit6: 0x07, Digit7: 0x08, Digit8: 0x09, Digit9: 0x0a,
  Digit0: 0x0b, Minus: 0x0c, Equal: 0x0d, Backspace: 0x0e, Tab: 0x0f,
  KeyQ: 0x10, KeyW: 0x11, KeyE: 0x12, KeyR: 0x13, KeyT: 0x14, KeyY: 0x15,
  KeyU: 0x16, KeyI: 0x17, KeyO: 0x18, KeyP: 0x19, BracketLeft: 0x1a,
  BracketRight: 0x1b, Enter: 0x1c, ControlLeft: 0x1d, KeyA: 0x1e, KeyS: 0x1f,
  KeyD: 0x20, KeyF: 0x21, KeyG: 0x22, KeyH: 0x23, KeyJ: 0x24, KeyK: 0x25,
  KeyL: 0x26, Semicolon: 0x27, Quote: 0x28, Backquote: 0x29, ShiftLeft: 0x2a,
  Backslash: 0x2b, KeyZ: 0x2c, KeyX: 0x2d, KeyC: 0x2e, KeyV: 0x2f, KeyB: 0x30,
  KeyN: 0x31, KeyM: 0x32, Comma: 0x33, Period: 0x34, Slash: 0x35,
  ShiftRight: 0x36, NumpadMultiply: 0x37, AltLeft: 0x38, Space: 0x39,
  CapsLock: 0x3a, F1: 0x3b, F2: 0x3c, F3: 0x3d, F4: 0x3e, F5: 0x3f, F6: 0x40,
  F7: 0x41, F8: 0x42, F9: 0x43, F10: 0x44, NumLock: 0x45, ScrollLock: 0x46,
  Numpad7: 0x47, Numpad8: 0x48, Numpad9: 0x49, NumpadSubtract: 0x4a,
  Numpad4: 0x4b, Numpad5: 0x4c, Numpad6: 0x4d, NumpadAdd: 0x4e, Numpad1: 0x4f,
  Numpad2: 0x50, Numpad3: 0x51, Numpad0: 0x52, NumpadDecimal: 0x53,
  IntlBackslash: 0x56, F11: 0x57, F12: 0x58,
  NumpadEnter: 0x11c, ControlRight: 0x11d, NumpadDivide: 0x135,
  PrintScreen: 0x137, AltRight: 0x138, Pause: 0x145, Home: 0x147,
  ArrowUp: 0x148, PageUp: 0x149, ArrowLeft: 0x14b, ArrowRight: 0x14d,
  End: 0x14f, ArrowDown: 0x150, PageDown: 0x151, Insert: 0x152, Delete: 0x153,
  MetaLeft: 0x15b, MetaRight: 0x15c, ContextMenu: 0x15d, OSLeft: 0x15b, OSRight: 0x15c,
  // Japanese / Brazilian keys
  IntlRo: 0x73, KanaMode: 0x70, Convert: 0x79, NonConvert: 0x7b, IntlYen: 0x7d,
  NumpadComma: 0x7e, NumpadEqual: 0x59,
  // Multimedia
  AudioVolumeMute: 0x120, AudioVolumeDown: 0x12e, AudioVolumeUp: 0x130,
  MediaPlayPause: 0x122, MediaStop: 0x124, MediaTrackPrevious: 0x110,
  MediaTrackNext: 0x119, BrowserHome: 0x132, Power: 0x15e, Sleep: 0x15f, WakeUp: 0x163,
};

// Browser mouse button -> 86Box mouse_set_buttons_ex() bit.
const BUTTON_BITS = [1, 4, 2, 8, 16];

export class Input {
  constructor(emu, target, { onCaptureChange, onReleaseHint, shouldHandleKeys } = {}) {
    this.emu = emu;
    this.target = target; // element that receives the pointer
    this.captured = false;
    this.buttons = 0;
    this.pressed = new Set();
    this.mouseEnabled = true; // false when the machine has no mouse
    this.absolute = false;    // tablet modes
    this.releaseButtons = 4;  // MOUSE_RELEASE_MIDDLE by default
    this.kbdRequiresCapture = false;
    this.onCaptureChange = onCaptureChange || (() => {});
    this.shouldHandleKeys = shouldHandleKeys || (() => true);
    this.pendingDx = 0;
    this.pendingDy = 0;

    document.addEventListener('keydown', (e) => this._key(e, true), true);
    document.addEventListener('keyup', (e) => this._key(e, false), true);
    window.addEventListener('blur', () => this.releaseAllKeys());

    target.addEventListener('mousedown', (e) => this._mouseDown(e));
    document.addEventListener('mouseup', (e) => this._mouseUp(e));
    document.addEventListener('mousemove', (e) => this._mouseMove(e));
    target.addEventListener('wheel', (e) => this._wheel(e), { passive: false });
    target.addEventListener('contextmenu', (e) => e.preventDefault());
    document.addEventListener('pointerlockchange', () => this._lockChanged());

    this._gamepadLoop = this._gamepadLoop.bind(this);
    requestAnimationFrame(this._gamepadLoop);
  }

  // ---- keyboard ----

  _key(e, down) {
    if (!this.shouldHandleKeys(e)) return;
    // Release-mouse shortcut, as in 86Box: Ctrl+End.
    if (down && e.code === 'End' && e.ctrlKey && this.captured) {
      this.release();
      e.preventDefault();
      return;
    }
    if (this.kbdRequiresCapture && !this.captured) return;
    const code = CODE_TO_XT[e.code];
    if (code === undefined) return;
    e.preventDefault();
    e.stopPropagation();
    if (down) {
      if (e.repeat && this.pressed.has(e.code)) {
        this.emu.key(true, code);
        return;
      }
      this.pressed.add(e.code);
    } else {
      if (!this.pressed.has(e.code) && e.code !== 'PrintScreen') return;
      this.pressed.delete(e.code);
      // Browsers only report keyup for Print Screen: synthesize the press.
      if (e.code === 'PrintScreen') this.emu.key(true, code);
    }
    this.emu.key(down, code);
  }

  releaseAllKeys() {
    for (const c of this.pressed) {
      const code = CODE_TO_XT[c];
      if (code !== undefined) this.emu.key(false, code);
    }
    this.pressed.clear();
    if (this.buttons) {
      this.buttons = 0;
      this.emu.mouseButtons(0);
    }
  }

  // Send a sequence of [down, scancode] pairs (e.g. Ctrl+Alt+Del).
  sendKeys(seq) {
    for (const [down, code] of seq) this.emu.key(down, code);
  }

  // ---- mouse ----

  capture() {
    if (this.captured || !this.mouseEnabled || this.absolute) return;
    const p = this.target.requestPointerLock?.({ unadjustedMovement: true });
    if (p && p.catch) p.catch(() => this.target.requestPointerLock());
  }

  release() {
    if (document.pointerLockElement) document.exitPointerLock();
  }

  _lockChanged() {
    const locked = document.pointerLockElement === this.target;
    if (locked === this.captured) return;
    this.captured = locked;
    if (!locked && this.buttons) {
      this.buttons = 0;
      this.emu.mouseButtons(0);
    }
    this.emu.command(`mouse_capture ${locked ? 1 : 0}`);
    this.onCaptureChange(locked);
  }

  _mouseDown(e) {
    if (this.absolute) {
      this._absMove(e);
      this.buttons |= BUTTON_BITS[e.button] || 0;
      this.emu.mouseButtons(this.buttons);
      e.preventDefault();
      return;
    }
    if (!this.captured) {
      // Like Qt: a left click on the screen captures the mouse.
      if (e.button === 0) this.capture();
      this.target.focus?.();
      e.preventDefault();
      return;
    }
    const bit = BUTTON_BITS[e.button] || 0;
    if (bit & this.releaseButtons) {
      this.release();
      e.preventDefault();
      return;
    }
    this.buttons |= bit;
    this.emu.mouseButtons(this.buttons);
    e.preventDefault();
  }

  _mouseUp(e) {
    const bit = BUTTON_BITS[e.button] || 0;
    if (!(this.buttons & bit)) return;
    this.buttons &= ~bit;
    this.emu.mouseButtons(this.buttons);
  }

  _mouseMove(e) {
    if (this.absolute) {
      if (e.target === this.target) this._absMove(e);
      return;
    }
    if (!this.captured) return;
    this.emu.mouseMove(e.movementX, e.movementY);
  }

  _absMove(e) {
    const r = this.target.getBoundingClientRect();
    const x = (e.clientX - r.left) / r.width;
    const y = (e.clientY - r.top) / r.height;
    const inside = x >= 0 && x <= 1 && y >= 0 && y <= 1;
    this.emu.mouseAbs(Math.min(1, Math.max(0, x)), Math.min(1, Math.max(0, y)), inside);
  }

  _wheel(e) {
    if (!this.captured && !this.absolute) return;
    e.preventDefault();
    const dz = e.deltaY > 0 ? -1 : e.deltaY < 0 ? 1 : 0;
    if (dz) this.emu.mouseWheel(dz);
  }

  // ---- gamepads ----

  _gamepadLoop() {
    requestAnimationFrame(this._gamepadLoop);
    if (!navigator.getGamepads) return;
    const pads = navigator.getGamepads();
    for (let i = 0; i < Math.min(4, pads.length); i++) {
      const p = pads[i];
      if (!p) continue;
      let mask = 0;
      p.buttons.forEach((b, j) => { if (b.pressed && j < 31) mask |= 1 << j; });
      this.emu.joystick(i, p.axes, mask);
    }
  }
}
