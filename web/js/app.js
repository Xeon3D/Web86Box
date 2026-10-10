// Web86Box - application bootstrap: environment checks, loading the
// emulator, the VM manager and the emulator window.

import { Emulator, State } from './emulator.js';
import { Catalog } from './catalog.js';
import { VMManager } from './vmmanager.js';
import { MainWindow } from './mainwindow.js';
import * as storage from './storage.js';
import { h, messageBox } from './ui.js';

const root = document.getElementById('app');

function applyTheme() {
  const t = localStorage.getItem('web86box.theme');
  if (t) document.documentElement.dataset.theme = t;
}

function screenMessage(title, text, { progress = false, error = false } = {}) {
  const bar = progress ? h('div.progress', null, h('div')) : null;
  root.replaceChildren(h('div.screen-area', { style: { height: '100%' } },
    h('div.screen-message', null, h('div.box', null,
      h('img', { src: `icons/86Box-${error ? 'red' : 'yellow'}.ico`, alt: '', style: { width: '48px', height: '48px' } }),
      h('h2', { style: { fontWeight: 400 } }, title),
      text ? h('div', { style: { whiteSpace: 'pre-wrap' } }, text) : null,
      bar))));
  return bar?.firstChild;
}

// wasm64 (memory64) support: 86Box only builds as a 64-bit program.
function hasMemory64() {
  try {
    return WebAssembly.validate(new Uint8Array([0, 97, 115, 109, 1, 0, 0, 0, 5, 3, 1, 4, 1]));
  } catch (e) {
    return false;
  }
}

function environmentProblems() {
  const problems = [];
  if (!window.crossOriginIsolated) problems.push('The page is not cross-origin isolated, so SharedArrayBuffer (needed for threads) is unavailable. Reload the page; if this persists, the server must send COOP/COEP headers.');
  if (!hasMemory64()) problems.push('This browser does not support 64-bit WebAssembly (memory64). Use a recent Chrome, Edge or Firefox.');
  if (!storage.isSupported()) problems.push('This browser does not support the Origin Private File System.');
  if (!('AudioWorkletNode' in window)) problems.push('This browser does not support AudioWorklet.');
  return problems;
}

function waitFor(emu, type, pred = () => true) {
  return new Promise((resolve) => {
    const fn = (e) => { if (pred(e.detail)) { emu.removeEventListener(type, fn); resolve(e.detail); } };
    emu.addEventListener(type, fn);
  });
}

async function main() {
  applyTheme();
  const problems = environmentProblems();
  if (problems.length) {
    screenMessage('86Box cannot run in this browser', problems.join('\n\n'), { error: true });
    return;
  }

  const bar = screenMessage('Loading 86Box…', 'Downloading the emulator. This may take a moment the first time.', { progress: true });
  if (bar) bar.style.width = '30%';
  await storage.requestPersistence();

  // A hidden canvas until the emulator window takes over.
  const emu = new Emulator({ canvas: document.createElement('canvas') });
  window.web86box = emu; // handy for debugging from the console

  let window86 = null;
  emu.addEventListener('msgbox', (e) => {
    if (window86) window86.handleMsgbox(e.detail);
    else messageBox({ title: e.detail.header || '86Box', text: e.detail.message, kind: 'warning' }).then(() => emu.msgboxReply(e.detail.id, 1));
  });
  emu.addEventListener('error', (e) => {
    screenMessage('86Box failed to start', String(e.detail), { error: true });
  });

  const waiting = waitFor(emu, 'state', (s) => Number(s) === State.WAITING || Number(s) === State.ERROR);
  try {
    await emu.load();
  } catch (e) {
    screenMessage('86Box failed to load', String(e?.message || e), { error: true });
    return;
  }
  if (bar) bar.style.width = '60%';
  if (emu.state !== State.WAITING) {
    const s = Number(await waiting);
    if (s === State.ERROR) return;
  }

  const catalogPromise = waitFor(emu, 'catalog');
  emu.command('catalog');
  const catalog = new Catalog(await catalogPromise);
  if (bar) bar.style.width = '100%';

  const startVM = async (name) => {
    window86 = new MainWindow({
      root, emu, vm: name, catalog,
      onExit: () => { location.href = location.pathname; },
    });
    await window86.reloadIni();
    const url = new URL(location.href);
    url.searchParams.set('vm', name);
    history.replaceState(null, '', url);
    emu.start(storage.vmPath(name));
    window86.canvas.focus();
  };

  const params = new URLSearchParams(location.search);
  const vm = params.get('vm');
  if (vm && await storage.vmExists(vm)) {
    await startVM(vm);
    return;
  }
  if (vm) history.replaceState(null, '', location.pathname);
  const mgr = new VMManager({ root, catalog, onStart: (name) => startVM(name) });
  await mgr.show();
}

main().catch((e) => {
  console.error(e);
  screenMessage('Unexpected error', String(e?.stack || e), { error: true });
});
