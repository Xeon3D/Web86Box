// Web86Box - the emulator main window, modeled on 86Box's Qt MainWindow:
// menu bar (Action / View / Media / Tools / Help), toolbar, screen and
// the status bar with per-drive media icons.

import { h, icon, MenuBar, popupMenu, tooltip, dialog, messageBox, confirm, MBX, isDialogOpen, downloadBlob } from './ui.js';
import { Input } from './input.js';
import { Ini } from './ini.js';
import * as storage from './storage.js';
import { VMFiles, ACCEPT, manageFilesDialog } from './files.js';
import { openSettings } from './settings.js';
import { showAbout } from './about.js';

const SB = { CASSETTE: 0x00, CARTRIDGE: 0x10, FLOPPY: 0x20, CDROM: 0x30, RDISK: 0x40, MO: 0x50, TAPE: 0x60, HDD: 0x70, NETWORK: 0x80, SOUND: 0x90 };
const HDD_BUSES = [['mfm', 1, 'MFM/RLL'], ['xta', 2, 'XTA'], ['esdi', 3, 'ESDI'], ['ide', 7, 'IDE'], ['atapi', 8, 'ATAPI'], ['scsi', 9, 'SCSI']];
const PREFS_KEY = 'web86box.view';

const FLOPPY_SIZES = [
  ['160 kB', 163840], ['180 kB', 184320], ['320 kB', 327680], ['360 kB', 368640],
  ['640 kB', 655360], ['720 kB', 737280], ['1.2 MB', 1228800], ['1.25 MB', 1281024],
  ['1.44 MB', 1474560], ['DMF (cluster 1024)', 1720320], ['2.88 MB', 2949120],
];

function loadPrefs() {
  try { return { ...defaults(), ...JSON.parse(localStorage.getItem(PREFS_KEY) || '{}') }; } catch (e) { return defaults(); }
}
function defaults() {
  return { hideToolbar: false, hideStatusbar: false, fit: true, scale: 1, force43: false, filter: 'nearest', fsMode: 'keep', hidpi: true };
}

export class MainWindow {
  constructor({ root, emu, vm, catalog, onExit }) {
    this.root = root;
    this.emu = emu;
    this.vm = vm;
    this.catalog = catalog;
    this.files = new VMFiles(vm);
    this.onExit = onExit;
    this.prefs = loadPrefs();
    this.ini = new Ini();
    this.mounted = {}; // tag -> emulator path
    this.wp = {};
    this.title = '';
    this.machineInfo = null;
    this.speed = 0;
    this.build();
  }

  savePrefs() {
    try { localStorage.setItem(PREFS_KEY, JSON.stringify(this.prefs)); } catch (e) { /* ignore */ }
  }

  // ------------------------------------------------------------ layout

  build() {
    this.menubar = h('div');
    this.toolbar = h('div.toolbar');
    this.canvas = h('canvas', { width: 640, height: 480, tabindex: 0 });
    this.overlay = h('div.screen-overlay', { hidden: true }, h('span'));
    this.screen = h('div.screen-area', { tabindex: -1 }, this.canvas, this.overlay);
    this.statusbar = h('div.statusbar');
    this.window = h('div.main-window', null, this.menubar, this.toolbar, this.screen, this.statusbar);
    this.root.replaceChildren(this.window);
    this.emu.canvas = this.canvas;
    this.emu.ctx = this.canvas.getContext('2d', { alpha: false, desynchronized: true });

    this.buildMenus();
    this.buildToolbar();
    this.applyView();

    this.input = new Input(this.emu, this.canvas, {
      onCaptureChange: (c) => {
        this.screen.classList.toggle('captured', c);
        this.showHint(c ? 'Press Ctrl+End or middle button to release mouse' : '');
        this.updateTitle();
      },
      shouldHandleKeys: (e) => !isDialogOpen() && !document.querySelector('.menu') && !(e.target instanceof HTMLInputElement) && !(e.target instanceof HTMLSelectElement) && !(e.target instanceof HTMLTextAreaElement),
    });

    const ro = new ResizeObserver(() => this.layoutScreen());
    ro.observe(this.screen);
    this.emu.addEventListener('framesize', () => this.layoutScreen());
    this.emu.addEventListener('resize', () => this.layoutScreen());
    this.emu.addEventListener('statusbar', () => this.updateStatusIcons());
    this.emu.addEventListener('speed', () => { this.speed = this.emu.speedPercent; this.updateTitle(); });
    this.emu.addEventListener('hard_reset', (e) => {
      this.machineInfo = e.detail;
      this.input.releaseButtons = e.detail.mouse_release_buttons || 4;
      this.input.absolute = (e.detail.mouse_input_mode || 0) >= 1;
      this.updateTitle();
    });
    this.emu.addEventListener('mouse_capture', (e) => { if (e.detail === '0' || e.detail === 0) this.input.release(); });
    this.emu.addEventListener('status', () => this.refreshToolbar());
    this.emu.addEventListener('sb_update', () => this.reloadIni());
    this.emu.addEventListener('config_reloaded', () => this.reloadIni());
    this.emu.addEventListener('state', (e) => {
      if (Number(e.detail) === 3) this.onStopped();
    });
    document.addEventListener('fullscreenchange', () => this.layoutScreen());
    window.addEventListener('beforeunload', (e) => {
      if (this.emu.state === 2) { e.preventDefault(); e.returnValue = ''; }
    });
  }

  showHint(text, ms = 4000) {
    clearTimeout(this.hintTimer);
    this.overlay.hidden = !text;
    this.overlay.firstChild.textContent = text;
    if (text) this.hintTimer = setTimeout(() => { this.overlay.hidden = true; }, ms);
  }

  // Size the canvas inside the screen area according to the View options.
  layoutScreen() {
    const fs = document.fullscreenElement === this.screen;
    const W = this.screen.clientWidth;
    const H = this.screen.clientHeight;
    // Display size as 86Box intends it (e.g. 640x200 CGA shown as 640x400),
    // reported through plat_resize(); the canvas holds the raw frame.
    let w = this.emu.screenW || this.canvas.width;
    let hh = this.emu.screenH || this.canvas.height;
    const dpr = this.prefs.hidpi ? 1 : (window.devicePixelRatio || 1);
    const aspect43 = this.prefs.force43;
    if (aspect43) hh = w * 3 / 4;
    let dw;
    let dh;
    const mode = fs ? this.prefs.fsMode : (this.prefs.fit ? 'keep' : 'fixed');
    if (mode === 'fixed') {
      dw = (w * this.prefs.scale) / dpr;
      dh = (hh * this.prefs.scale) / dpr;
    } else if (mode === 'full') {
      dw = W; dh = H;
    } else {
      const ratio = (mode === '43' || mode === 'int43') ? 4 / 3 : w / hh;
      dw = W; dh = W / ratio;
      if (dh > H) { dh = H; dw = H * ratio; }
      if (mode === 'int' || mode === 'int43') {
        const baseW = mode === 'int43' ? hh * 4 / 3 : w;
        const k = Math.max(1, Math.floor(Math.min(W / baseW, H / hh)));
        dw = baseW * k; dh = hh * k;
      }
    }
    this.canvas.style.width = `${Math.round(dw)}px`;
    this.canvas.style.height = `${Math.round(dh)}px`;
    this.canvas.classList.toggle('linear', this.prefs.filter === 'linear');
  }

  applyView() {
    this.toolbar.hidden = this.prefs.hideToolbar;
    this.statusbar.hidden = this.prefs.hideStatusbar;
    this.layoutScreen();
  }

  // ------------------------------------------------------------ title

  updateTitle() {
    const mi = this.machineInfo;
    const parts = [`${this.vm} - 86Box ${this.catalog?.version || ''}`.trim()];
    if (this.emu.paused) parts.push('PAUSED');
    else parts.push(`${this.speed}%`);
    if (mi) parts.push(`${mi.machine_name} - ${mi.cpu}`);
    if (this.input && !this.input.absolute && this.input.mouseEnabled) parts.push(this.input.captured ? 'Press Ctrl+End to release mouse' : 'Click to capture mouse');
    document.title = parts.join(' - ');
    this.sbText.textContent = `${this.emu.paused ? 'Paused' : `${this.speed}%`}${mi ? ` · ${mi.machine_name}` : ''}`;
  }

  // ------------------------------------------------------------ menus

  buildMenus() {
    const mb = new MenuBar(this.menubar);
    const g = (k, d = 0) => this.ini.getInt('General', k, d);
    mb.add('&Action', () => [
      { label: '&Keyboard requires capture', checked: !!g('kbd_req_capture'), action: () => this.toggleGeneral('kbd_req_capture') },
      { label: '&Right CTRL is left ALT', checked: !!g('rctrl_is_lalt'), action: () => this.toggleGeneral('rctrl_is_lalt') },
      '-',
      { label: '&Update mouse every CPU frame', checked: !this.ini.getInt('General', 'force_constant_mouse', 0), action: () => this.toggleMouseTimed() },
      '-',
      { label: '&Pause', icon: 'pause', checked: this.emu.paused, action: () => this.togglePause(), shortcut: 'Ctrl+Alt+Pause' },
      '-',
      { label: '&Fullscreen', icon: 'monitor', action: () => this.fullscreen(), shortcut: 'Ctrl+Alt+PgUp' },
      '-',
      { label: '&Fast forward', icon: 'fast_forward', checked: this.fastForward, action: () => this.toggleFastForward() },
      '-',
      { label: '&Hard reset', icon: 'hard_reset', action: () => this.hardReset() },
      { label: '&Ctrl+Alt+Del', icon: 'send_cad', action: () => this.emu.command('cad'), shortcut: 'Ctrl+F12' },
      '-',
      { label: 'Ctrl+Alt+&Esc', icon: 'send_cae', action: () => this.emu.command('cae') },
      { label: '&Non-maskable interrupt', action: () => this.emu.command('nmi') },
      '-',
      { label: 'ACP&I shutdown', icon: 'acpi_shutdown', action: () => this.emu.command('acpi_shutdown') },
      { label: 'E&xit', action: () => this.exit() },
    ]);
    mb.add('&View', () => this.viewMenu());
    mb.add('&Media', () => this.mediaMenu());
    mb.add('&Tools', () => [
      { label: '&Settings…', icon: 'settings', action: () => this.showSettings() },
      { label: '&Update status bar icons', checked: g('update_icons', 1) !== 0, action: () => this.toggleGeneral('update_icons', 1) },
      '-',
      { label: 'Take s&creenshot', icon: 'take_screenshot', action: () => this.screenshot(false), shortcut: 'Ctrl+F11' },
      { label: 'C&opy screenshot', icon: 'copy_screenshot', action: () => this.screenshot(true) },
      '-',
      { label: 'S&ound', submenu: () => [
        { label: '&Mute', checked: !!g('sound_muted'), action: () => this.toggleMute() },
        '-',
        { label: 'Sound &gain…', action: () => this.soundGain() },
      ] },
      '-',
      { label: '&Preferences…', icon: 'settings', action: () => this.preferences() },
      '-',
      { label: 'Manage &files…', action: () => manageFilesDialog(this.files).then(() => this.reloadIni()) },
      { label: 'Show emulator &log…', action: () => this.showLog() },
    ]);
    mb.add('&Help', () => [
      { label: '&Documentation…', action: () => window.open('https://86box.readthedocs.io/', '_blank', 'noopener') },
      { label: '&About 86Box…', action: () => showAbout(this.catalog) },
    ]);
  }

  viewMenu() {
    const p = this.prefs;
    const set = (k, v) => { p[k] = v; this.savePrefs(); this.applyView(); };
    const g = (k, d = 0) => this.ini.getInt('General', k, d);
    const scales = [0.5, 1, 1.5, 2, 3, 4, 5, 6, 7, 8];
    const fsModes = [['full', '&Full screen stretch'], ['43', '&4:3'], ['keep', '&Square pixels (Keep ratio)'], ['int', '&Integer scale'], ['int43', '4:&3 Integer scale']];
    return [
      { label: 'Hide &toolbar', checked: p.hideToolbar, action: () => set('hideToolbar', !p.hideToolbar) },
      { label: '&Hide status bar', checked: p.hideStatusbar, action: () => set('hideStatusbar', !p.hideStatusbar) },
      '-',
      { label: '&Fit screen to window', checked: p.fit, action: () => set('fit', !p.fit) },
      { label: 'Force &4:3 display ratio', checked: p.force43, action: () => set('force43', !p.force43) },
      { label: '&Window scale factor', disabled: p.fit, submenu: () => scales.map((s) => ({ label: `${s}x`, radio: true, checked: p.scale === s, action: () => { p.fit = false; set('scale', s); } })) },
      { label: 'Hi&DPI scaling', checked: p.hidpi, action: () => set('hidpi', !p.hidpi) },
      '-',
      { label: 'Fi&lter method', submenu: () => [
        { label: '&Nearest', radio: true, checked: p.filter === 'nearest', action: () => set('filter', 'nearest') },
        { label: '&Linear', radio: true, checked: p.filter === 'linear', action: () => set('filter', 'linear') },
      ] },
      '-',
      { label: '&Fullscreen', icon: 'monitor', action: () => this.fullscreen() },
      { label: 'Fullscreen &stretch mode', submenu: () => fsModes.map(([v, l]) => ({ label: l, radio: true, checked: p.fsMode === v, action: () => set('fsMode', v) })) },
      '-',
      { label: 'E&GA/(S)VGA settings', submenu: () => [
        { label: '&Inverted VGA monitor', checked: !!this.inverted, action: () => { this.inverted = !this.inverted; this.emu.command(`video_option invert ${this.inverted ? 1 : 0}`); } },
        { label: 'VGA screen &type', submenu: () => ['RGB &Color', '&RGB Grayscale', '&Amber monitor', '&Green monitor', '&White monitor'].map((l, i) => ({ label: l, radio: true, checked: g('video_grayscale') === i, action: () => this.videoOption('grayscale', 'video_grayscale', i) })) },
        { label: 'Grayscale &conversion type', submenu: () => ['BT&601 (NTSC/PAL)', 'BT&709 (HDTV)', '&Average'].map((l, i) => ({ label: l, radio: true, checked: g('video_graytype') === i, action: () => this.videoOption('graytype', 'video_graytype', i) })) },
      ] },
      '-',
      { label: '&Overscan', checked: !!g('enable_overscan'), action: () => this.videoOption('overscan', 'enable_overscan', g('enable_overscan') ? 0 : 1) },
      { label: 'Change contrast for &monochrome display', checked: !!g('vid_cga_contrast'), action: () => this.videoOption('contrast', 'vid_cga_contrast', g('vid_cga_contrast') ? 0 : 1) },
    ];
  }

  videoOption(name, key, value) {
    this.ini.set('General', key, value);
    this.emu.command(`video_option ${name} ${value}`);
  }

  toggleGeneral(key, def = 0) {
    const v = this.ini.getInt('General', key, def) ? 0 : 1;
    this.ini.set('General', key, v);
    if (key === 'update_icons') { this.updateIcons = !!v; this.emu.command(`save_config`); return; }
    if (key === 'kbd_req_capture') this.input.kbdRequiresCapture = !!v;
    this.emu.command(`${key} ${v}`);
  }

  toggleMouseTimed() {
    const constant = this.ini.getInt('General', 'force_constant_mouse', 0) ? 0 : 1;
    this.ini.set('General', 'force_constant_mouse', constant);
    this.emu.command(`mouse_timed ${constant}`);
  }

  // ------------------------------------------------------------ toolbar

  buildToolbar() {
    const tb = (iconName, title, action) => {
      const b = h('button.tool-button', { type: 'button', title, onclick: () => { action(); this.canvas.focus(); } }, icon(iconName));
      this.toolbar.append(b);
      return b;
    };
    const sep = () => this.toolbar.append(h('div.toolbar-sep'));
    this.tbPause = tb('pause', 'Pause', () => this.togglePause());
    this.tbFF = tb('fast_forward', 'Fast forward', () => this.toggleFastForward());
    tb('hard_reset', 'Hard reset', () => this.hardReset());
    tb('acpi_shutdown', 'ACPI shutdown', () => this.emu.command('acpi_shutdown'));
    sep();
    tb('send_cad', 'Ctrl+Alt+Del', () => this.emu.command('cad'));
    tb('send_cae', 'Ctrl+Alt+Esc', () => this.emu.command('cae'));
    sep();
    tb('settings', 'Settings…', () => this.showSettings());
    sep();
    tb('take_screenshot', 'Take screenshot', () => this.screenshot(false));
    tb('copy_screenshot', 'Copy screenshot', () => this.screenshot(true));
    sep();
    tb('monitor', 'Fullscreen', () => this.fullscreen());
  }

  refreshToolbar() {
    this.tbPause?.classList.toggle('checked', this.emu.paused);
    this.tbFF?.classList.toggle('checked', !!this.fastForward);
    this.updateTitle();
  }

  // ------------------------------------------------------------ actions

  togglePause() {
    this.emu.command(`pause ${this.emu.paused ? 0 : 1}`);
    setTimeout(() => this.refreshToolbar(), 50);
  }

  toggleFastForward() {
    this.fastForward = !this.fastForward;
    this.emu.command(`fast_forward ${this.fastForward ? 1 : 0}`);
    this.refreshToolbar();
  }

  async hardReset() {
    if (this.ini.getInt('General', 'confirm_reset', 1) && !(await confirm('Are you sure you want to hard reset the emulated machine?', { yes: 'Reset', no: 'Don’t reset' }))) return;
    this.emu.command('hard_reset');
  }

  async exit() {
    if (!(await confirm('Are you sure you want to exit 86Box?', { yes: 'Exit', no: 'Cancel' }))) return;
    this.emu.command('power_off');
  }

  onStopped() {
    this.input.release();
    this.onExit?.();
  }

  fullscreen() {
    if (document.fullscreenElement) { document.exitFullscreen(); return; }
    this.screen.requestFullscreen?.({ navigationUI: 'hide' }).then(() => {
      // Let Esc and other system keys reach the guest where supported.
      navigator.keyboard?.lock?.().catch(() => {});
      this.showHint('Press F11 or Ctrl+Alt+PgDn to exit fullscreen');
    }).catch(() => {});
  }

  async screenshot(copy) {
    const blob = await new Promise((r) => this.canvas.toBlob(r, 'image/png'));
    if (!blob) return;
    if (copy && navigator.clipboard?.write && window.ClipboardItem) {
      try {
        await navigator.clipboard.write([new ClipboardItem({ 'image/png': blob })]);
        this.showHint('Screenshot copied to the clipboard', 2000);
        return;
      } catch (e) { /* fall through to download */ }
    }
    const d = new Date();
    const pad = (n) => String(n).padStart(2, '0');
    downloadBlob(blob, `${this.vm}-${d.getFullYear()}${pad(d.getMonth() + 1)}${pad(d.getDate())}-${pad(d.getHours())}${pad(d.getMinutes())}${pad(d.getSeconds())}.png`);
  }

  toggleMute() {
    const v = this.ini.getInt('General', 'sound_muted', 0) ? 0 : 1;
    this.ini.set('General', 'sound_muted', v);
    this.emu.command(`sound_mute ${v}`);
    this.updateStatusIcons(true);
  }

  async soundGain() {
    const cur = this.ini.getInt('General', 'sound_gain', 0);
    const slider = h('input', { type: 'range', min: -60, max: 0, step: 1, value: cur, style: { width: '100%' } });
    const label = h('div', { style: { textAlign: 'center' } }, `${cur} dB`);
    slider.addEventListener('input', () => { label.textContent = `${slider.value} dB`; this.emu.command(`sound_gain ${slider.value}`); });
    const ok = await dialog({ title: 'Sound Gain', width: '320px', body: [slider, label], buttons: [{ label: 'OK', value: true, default: true }, { label: 'Cancel', value: false }] });
    const v = ok ? +slider.value : cur;
    this.ini.set('General', 'sound_gain', v);
    this.emu.command(`sound_gain ${v}`);
  }

  async preferences() {
    const theme = h('select', null, h('option', { value: '' }, 'System'), h('option', { value: 'light' }, 'Light'), h('option', { value: 'dark' }, 'Dark'));
    theme.value = localStorage.getItem('web86box.theme') || '';
    const ok = await dialog({
      title: 'Preferences', width: '420px',
      body: h('div.form', null, h('label', null, 'Color scheme:'), h('div.span2', null, theme)),
      buttons: [{ label: 'OK', value: true, default: true }, { label: 'Cancel', value: false }],
    });
    if (!ok) return;
    localStorage.setItem('web86box.theme', theme.value);
    if (theme.value) document.documentElement.dataset.theme = theme.value;
    else delete document.documentElement.dataset.theme;
  }

  async showLog() {
    const pre = h('pre.mono', { style: { margin: 0, whiteSpace: 'pre-wrap', fontSize: '8.5pt' } }, this.emu.log.slice(-500).join('\n'));
    await dialog({
      title: 'Emulator log', width: '760px',
      body: h('div.list-view', { style: { height: '420px', padding: '6px' } }, pre),
      buttons: [{ label: 'Download', left: true, onClick: () => { downloadBlob(new Blob([this.emu.log.join('\n')], { type: 'text/plain' }), '86box.log'); return false; } }, { label: 'Close', value: true, default: true }],
    });
  }

  // Ask the emulator to write its configuration, then read it.
  async syncIni() {
    await new Promise((resolve) => {
      const done = () => { this.emu.removeEventListener('config_saved', done); resolve(); };
      this.emu.addEventListener('config_saved', done);
      this.emu.command('save_config');
      setTimeout(done, 1500);
    });
    await this.reloadIni();
  }

  async reloadIni() {
    try {
      this.ini = new Ini(await storage.readText(`vms/${this.vm}/86box.cfg`));
    } catch (e) { /* not written yet */ }
    this.input.kbdRequiresCapture = !!this.ini.getInt('General', 'kbd_req_capture', 0);
    this.input.mouseEnabled = this.ini.get('Input devices', 'mouse_type', 'ps2') !== 'none';
    this.updateIcons = this.ini.getInt('General', 'update_icons', 1) !== 0;
    this.buildStatusBar();
  }

  async showSettings() {
    const wasPaused = this.emu.paused;
    this.emu.command('pause 1');
    await this.syncIni();
    const result = await openSettings({ catalog: this.catalog, ini: this.ini, vm: this.vm, files: this.files.settingsHelper() });
    if (result) {
      if (await confirm('Do you want to save the settings?\n\nThis will hard reset the emulated machine.', { yes: 'Save', no: 'Cancel' })) {
        await storage.writeFile(`vms/${this.vm}/86box.cfg`, result.toString());
        this.ini = result;
        this.emu.command('reload_config');
        this.buildStatusBar();
      }
    }
    if (!wasPaused) this.emu.command('pause 0');
    this.canvas.focus();
  }

  // ------------------------------------------------------------ drives

  drives() {
    const ini = this.ini;
    const cat = this.catalog;
    const F = 'Floppy and CD-ROM drives';
    const out = [];
    if (ini.getInt('Storage controllers', 'cassette_enabled', 0))
      out.push({ kind: 'cassette', tag: SB.CASSETTE, label: 'Cassette', icon: 'cassette', file: ini.get('Storage controllers', 'cassette_file', '') });
    for (let i = 0; i < 4; i++) {
      const n = String(i + 1).padStart(2, '0');
      const type = ini.get(F, `fdd_${n}_type`, i < 2 ? '525_2dd' : 'none');
      if (type === 'none') continue;
      const tname = cat?.fdd_types.find(([x]) => x === type)?.[1] || type;
      out.push({ kind: 'floppy', id: i, tag: SB.FLOPPY | i, label: `Floppy ${i + 1} (${tname})`, icon: type.startsWith('35') ? 'floppy_35' : 'floppy_525', file: ini.get(F, `fdd_${n}_fn`, ''), wp: ini.getInt(F, `fdd_${n}_writeprot`, 0) });
    }
    for (let i = 0; i < 8; i++) {
      const n = String(i + 1).padStart(2, '0');
      const p = ini.get(F, `cdrom_${n}_parameters`, i === 0 ? '1, none' : '0, none');
      const m = /^(\d+),\s*(\w+)/.exec(p);
      if (!m || m[2] === 'none') continue;
      const type = ini.get(F, `cdrom_${n}_type`, '');
      const dvd = cat?.cdrom_types.find(([x]) => x === type)?.[3];
      out.push({ kind: 'cdrom', id: i, tag: SB.CDROM | i, label: `CD-ROM ${i + 1} (${m[2].toUpperCase()})`, icon: dvd ? 'dvdrom' : 'cdrom', file: ini.get(F, `cdrom_${n}_image_path`, ''), muted: m[1] === '0' });
    }
    const O = 'Other removable devices';
    for (let i = 0; i < 4; i++) {
      const n = String(i + 1).padStart(2, '0');
      const p = ini.get(O, `rdisk_${n}_parameters`, '0, none');
      if (!/,\s*(atapi|scsi)/.test(p)) continue;
      out.push({ kind: 'rdisk', id: i, tag: SB.RDISK | i, label: `ZIP ${i + 1}`, icon: 'zip', file: ini.get(O, `rdisk_${n}_image_path`, ''), wp: ini.getInt(O, `rdisk_${n}_writeprot`, 0) });
    }
    for (let i = 0; i < 4; i++) {
      const n = String(i + 1).padStart(2, '0');
      const p = ini.get(O, `mo_${n}_parameters`, '0, none');
      if (!/,\s*(atapi|scsi)/.test(p)) continue;
      out.push({ kind: 'mo', id: i, tag: SB.MO | i, label: `MO ${i + 1}`, icon: 'mo', file: ini.get(O, `mo_${n}_image_path`, ''), wp: ini.getInt(O, `mo_${n}_writeprot`, 0) });
    }
    const busesUsed = new Set();
    for (let i = 0; i < 8; i++) {
      const p = ini.get('Hard disks', `hdd_${String(i + 1).padStart(2, '0')}_parameters`, null);
      const m = p && /,\s*(\w+)\s*$/.exec(p);
      if (m) busesUsed.add(m[1]);
    }
    for (const [name, bus, label] of HDD_BUSES) {
      if (busesUsed.has(name)) out.push({ kind: 'hdd', tag: SB.HDD | bus, label: `Hard disk (${label})`, icon: 'hard_disk' });
    }
    for (let i = 0; i < 4; i++) {
      const card = this.ini.get('Network', `net_${String(i + 1).padStart(2, '0')}_card`, i === 0 ? this.ini.get('Network', 'net_card', 'none') : 'none');
      if (card && card !== 'none') out.push({ kind: 'network', tag: SB.NETWORK | i, label: `Network card ${i + 1}`, icon: 'network' });
    }
    out.push({ kind: 'sound', tag: SB.SOUND, label: 'Sound', icon: 'sound' });
    return out;
  }

  buildStatusBar() {
    this.statusbar.replaceChildren();
    this.sbIcons = [];
    for (const d of this.drives()) {
      const overlay = h('img.overlay', { alt: '', hidden: true });
      const el = h('div.sb-icon', null, icon(d.icon), overlay);
      el.drive = d;
      el.overlay = overlay;
      tooltip(el, () => this.driveTooltip(d));
      if (d.kind === 'sound') {
        el.addEventListener('click', () => this.soundGain());
        el.addEventListener('contextmenu', (e) => { e.preventDefault(); this.toggleMute(); });
      } else if (d.kind !== 'hdd' && d.kind !== 'network') {
        const open = (e) => {
          e.preventDefault();
          const r = el.getBoundingClientRect();
          const items = this.driveMenu(d);
          const menu = popupMenu(items, r.left, r.top);
          const mr = menu.getBoundingClientRect();
          menu.style.top = `${Math.max(0, r.top - mr.height)}px`;
        };
        el.addEventListener('click', open);
        el.addEventListener('contextmenu', open);
      }
      this.statusbar.append(el);
      this.sbIcons.push(el);
    }
    this.sbText = h('div.sb-text');
    this.statusbar.append(this.sbText);
    this.updateStatusIcons(true);
    this.updateTitle();
  }

  driveTooltip(d) {
    if (d.kind === 'sound') return `Sound${this.ini.getInt('General', 'sound_muted', 0) ? ' (muted)' : ''}\nClick: sound gain · Right-click: mute`;
    if (d.kind === 'hdd' || d.kind === 'network') return d.label;
    const f = this.currentFile(d);
    return `${d.label}: ${f ? f.split('/').pop() : '(empty)'}`;
  }

  currentFile(d) {
    if (d.tag in this.mounted) return this.mounted[d.tag];
    return d.file ? this.files.resolve(d.file) : '';
  }

  updateStatusIcons(force = false) {
    if (!this.sbIcons) return;
    if (!force && this.updateIcons === false) return;
    const s = this.emu.sharedPtr ? this.emu.statusIcons() : null;
    for (const el of this.sbIcons) {
      const d = el.drive;
      let empty = false;
      if (['floppy', 'cdrom', 'rdisk', 'mo', 'cassette'].includes(d.kind)) empty = !this.currentFile(d);
      if (d.kind === 'sound') empty = !!this.ini.getInt('General', 'sound_muted', 0);
      const active = s && s.active[d.tag];
      const write = s && s.write[d.tag];
      const wp = this.wp[d.tag] ?? d.wp;
      el.firstChild.style.filter = empty ? 'grayscale(1) opacity(0.45)' : '';
      let ov = null;
      if (write && this.updateIcons !== false) ov = 'write_active';
      else if (active && this.updateIcons !== false) ov = 'active';
      else if (wp && !empty) ov = 'write_protected';
      el.overlay.hidden = !ov;
      if (ov && el.overlay.dataset.ov !== ov) { el.overlay.src = `icons/${ov}.ico`; el.overlay.dataset.ov = ov; }
    }
  }

  mediaMenu() {
    const items = [];
    for (const d of this.drives()) {
      if (['hdd', 'network', 'sound'].includes(d.kind)) continue;
      const f = this.currentFile(d);
      items.push({ label: `${d.label}: ${f ? f.split('/').pop() : '(empty)'}`, icon: d.icon, submenu: () => this.driveMenu(d) });
    }
    if (!items.length) items.push({ label: '(no removable drives)', disabled: true });
    return items;
  }

  driveMenu(d) {
    const f = this.currentFile(d);
    const items = [];
    switch (d.kind) {
      case 'floppy':
        items.push(
          { label: '&New image…', icon: 'new', action: () => this.newFloppy(d) },
          '-',
          { label: '&Existing image…', icon: 'browse', action: () => this.mountChoose(d, false) },
          { label: 'Existing image (&Write-protected)…', icon: 'browse', action: () => this.mountChoose(d, true) },
          '-',
          { label: '&Download image…', icon: 'export', disabled: !f, action: () => this.files.download(f) },
          '-',
          { label: 'E&ject', icon: 'eject', disabled: !f, action: () => this.eject(d) });
        break;
      case 'cdrom':
        items.push(
          { label: d.muted ? '&Unmute' : '&Mute', icon: d.muted ? 'cdrom_unmute' : 'cdrom_mute', action: () => this.toggleCdMute(d) },
          '-',
          { label: '&Image…', icon: 'cdrom_image', action: () => this.mountChoose(d, false) },
          '-',
          { label: 'E&ject', icon: 'eject', disabled: !f, action: () => this.eject(d) });
        break;
      case 'rdisk':
      case 'mo':
        items.push(
          { label: '&Existing image…', icon: 'browse', action: () => this.mountChoose(d, false) },
          { label: 'Existing image (&Write-protected)…', icon: 'browse', action: () => this.mountChoose(d, true) },
          '-',
          { label: '&Download image…', icon: 'export', disabled: !f, action: () => this.files.download(f) },
          '-',
          { label: 'E&ject', icon: 'eject', disabled: !f, action: () => this.eject(d) });
        break;
      case 'cassette':
        items.push(
          { label: '&Existing image…', icon: 'browse', action: () => this.mountChoose(d, false) },
          '-',
          { label: 'E&ject', icon: 'eject', disabled: !f, action: () => this.eject(d) });
        break;
    }
    return items;
  }

  async mountChoose(d, wp) {
    const accept = ACCEPT[d.kind] || '';
    const path = await this.files.choose({ title: `${d.label} - Open image`, accept, kind: d.kind });
    if (path) this.mount(d, path, wp);
  }

  mount(d, path, wp = false) {
    const id = d.id ?? 0;
    switch (d.kind) {
      case 'floppy': this.emu.command(`fdd_mount ${id} ${wp ? 1 : 0} ${path}`); break;
      case 'cdrom': this.emu.command(`cdrom_mount ${id} ${path}`); break;
      case 'rdisk': this.emu.command(`rdisk_mount ${id} ${wp ? 1 : 0} ${path}`); break;
      case 'mo': this.emu.command(`mo_mount ${id} ${wp ? 1 : 0} ${path}`); break;
      case 'cassette': this.emu.command(`cassette_mount ${wp ? 1 : 0} ${path}`); break;
    }
    this.mounted[d.tag] = path;
    this.wp[d.tag] = wp ? 1 : 0;
    this.updateStatusIcons(true);
    this.canvas.focus();
  }

  eject(d) {
    const id = d.id ?? 0;
    const cmd = { floppy: `fdd_eject ${id}`, cdrom: `cdrom_eject ${id}`, rdisk: `rdisk_eject ${id}`, mo: `mo_eject ${id}`, cassette: 'cassette_eject' }[d.kind];
    if (cmd) this.emu.command(cmd);
    this.mounted[d.tag] = '';
    this.updateStatusIcons(true);
  }

  async toggleCdMute(d) {
    await this.syncIni();
    const F = 'Floppy and CD-ROM drives';
    const n = String(d.id + 1).padStart(2, '0');
    const p = this.ini.get(F, `cdrom_${n}_parameters`, '1, atapi');
    const m = /^(\d+),\s*(\w+)/.exec(p);
    if (!m) return;
    this.ini.set(F, `cdrom_${n}_parameters`, `${m[1] === '0' ? 1 : 0}, ${m[2]}`);
    await storage.writeFile(`vms/${this.vm}/86box.cfg`, this.ini.toString());
    this.emu.command('reload_config');
  }

  async newFloppy(d) {
    const name = h('input', { type: 'text', value: `floppy${d.id + 1}.img` });
    const size = h('select', null, ...FLOPPY_SIZES.map(([l, s]) => h('option', { value: String(s) }, l)));
    size.value = d.icon === 'floppy_35' ? '1474560' : '1228800';
    const wp = h('input', { type: 'checkbox' });
    const ok = await dialog({
      title: 'New Image', icon: 'new', width: '420px',
      body: h('div.form', null,
        h('label', null, 'File name:'), h('div.span2', null, name),
        h('label', null, 'Disk size:'), h('div.span2', null, size),
        h('div.full', null, h('label.check', null, wp, 'Write-protected')),
        h('div.full.muted', null, 'Creates a blank (unformatted) raw image; format it from the guest OS.')),
      buttons: [{ label: 'OK', value: true, default: true }, { label: 'Cancel', value: false }],
    });
    if (!ok) return;
    let fname = name.value.trim() || 'floppy.img';
    if (!/\.[a-z0-9]+$/i.test(fname)) fname += '.img';
    const path = await this.files.createBlank(fname, +size.value);
    this.mount(d, path, wp.checked);
  }

  // ------------------------------------------------------------ message boxes from C

  async handleMsgbox(m) {
    const kind = (m.flags & MBX.FATAL) || (m.flags & MBX.ERROR) ? 'error' : (m.flags & MBX.WARNING) ? 'warning' : (m.flags & MBX.QUESTION_YN) ? 'question' : 'info';
    let result = 1;
    if (m.flags & MBX.QUESTION_YN) {
      result = await messageBox({ title: m.header || '86Box', text: m.message, kind, buttons: [{ label: 'Yes', value: 1, default: true }, { label: 'No', value: 0 }] });
    } else {
      await messageBox({ title: m.header || '86Box', header: m.header, text: m.message, kind });
    }
    this.emu.msgboxReply(m.id, result);
  }
}
