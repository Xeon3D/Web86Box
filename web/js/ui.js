// Web86Box - small widget toolkit: menus, dialogs, message boxes, tooltips.
// Visual behaviour follows the Qt widgets 86Box uses.

export const ICONS = 'icons/';

export function icon(name, cls = 'icon') {
  const img = document.createElement('img');
  img.className = cls;
  img.alt = '';
  img.draggable = false;
  img.src = `${ICONS}${name}.ico`;
  return img;
}

// Tiny element builder: h('div.cls', {attr}, children...)
export function h(tag, attrs, ...children) {
  const [name, ...classes] = tag.split('.');
  const el = document.createElement(name || 'div');
  if (classes.length) el.className = classes.join(' ');
  if (attrs) {
    for (const [k, v] of Object.entries(attrs)) {
      if (v === undefined || v === null || v === false) continue;
      if (k.startsWith('on') && typeof v === 'function') el.addEventListener(k.slice(2), v);
      else if (k === 'style' && typeof v === 'object') Object.assign(el.style, v);
      else if (k === 'dataset') Object.assign(el.dataset, v);
      else if (k in el && typeof v !== 'string') el[k] = v;
      else el.setAttribute(k, v === true ? '' : v);
    }
  }
  for (const c of children.flat(Infinity)) {
    if (c === null || c === undefined || c === false) continue;
    el.append(c instanceof Node ? c : document.createTextNode(String(c)));
  }
  return el;
}

// Strip Qt '&' accelerator markers ("&Action" -> "Action", "&&" -> "&").
export function tr(text) {
  return text.replace(/&&/g, '\u0000').replace(/&/g, '').replace(/\u0000/g, '&');
}

// ---------------------------------------------------------------- menus
//
// Menu items: { label, action, checked, radio, disabled, icon, shortcut,
//               submenu: [items] | () => [items] } or '-' for a separator.

let openMenus = [];

function closeMenusFrom(level) {
  while (openMenus.length > level) openMenus.pop().remove();
}

export function closeAllMenus() {
  closeMenusFrom(0);
  document.querySelectorAll('.menubar').forEach((mb) => {
    mb.classList.remove('active');
    mb.querySelectorAll('.menu-title.open').forEach((t) => t.classList.remove('open'));
  });
}

document.addEventListener('mousedown', (e) => {
  if (!e.target.closest('.menu') && !e.target.closest('.menubar')) closeAllMenus();
}, true);
document.addEventListener('keydown', (e) => {
  if (e.key === 'Escape' && openMenus.length) {
    closeAllMenus();
    e.stopPropagation();
  }
}, true);
window.addEventListener('blur', () => closeAllMenus());
window.addEventListener('resize', () => closeAllMenus());

export function popupMenu(items, x, y, level = 0) {
  closeMenusFrom(level);
  const list = typeof items === 'function' ? items() : items;
  const menu = h('div.menu', { role: 'menu' });
  for (const it of list) {
    if (it === '-' || it === null) {
      if (menu.lastChild && !menu.lastChild.classList.contains('menu-sep')) menu.append(h('div.menu-sep'));
      continue;
    }
    if (it.hidden) continue;
    const check = h('span.check');
    if (it.icon) check.append(icon(it.icon));
    else if (it.checked) check.textContent = it.radio ? '●' : '✓';
    const row = h('div.menu-item', { role: 'menuitem' },
      check,
      h('span.label', null, tr(it.label)),
      it.shortcut ? h('span.shortcut', null, it.shortcut) : null,
      it.submenu ? h('span.arrow', null, '▸') : null);
    if (it.disabled) row.classList.add('disabled');
    if (it.submenu) {
      const openSub = () => {
        if (it.disabled) return;
        menu.querySelectorAll('.menu-item.open').forEach((r) => r.classList.remove('open'));
        row.classList.add('open');
        const r = row.getBoundingClientRect();
        popupMenu(it.submenu, r.right - 2, r.top - 3, level + 1);
      };
      row.addEventListener('mouseenter', openSub);
      row.addEventListener('click', openSub);
    } else {
      row.addEventListener('mouseenter', () => {
        closeMenusFrom(level + 1);
        menu.querySelectorAll('.menu-item.open').forEach((r) => r.classList.remove('open'));
      });
      row.addEventListener('click', (e) => {
        e.stopPropagation();
        if (it.disabled) return;
        closeAllMenus();
        it.action?.();
      });
    }
    menu.append(row);
  }
  if (menu.lastChild?.classList.contains('menu-sep')) menu.lastChild.remove();
  if (!menu.childElementCount) menu.append(h('div.menu-item.disabled', null, h('span.check'), h('span.label', null, '(empty)')));
  document.body.append(menu);
  // Keep on screen.
  const r = menu.getBoundingClientRect();
  if (x + r.width > innerWidth) x = Math.max(0, level ? x - r.width - (r.width > 0 ? 180 : 0) : innerWidth - r.width - 2);
  if (y + r.height > innerHeight) y = Math.max(0, innerHeight - r.height - 2);
  menu.style.left = `${x}px`;
  menu.style.top = `${y}px`;
  openMenus.push(menu);
  return menu;
}

export class MenuBar {
  constructor(el) {
    this.el = el;
    this.el.classList.add('menubar');
    this.menus = [];
  }

  add(title, items) {
    const t = h('div.menu-title', null, tr(title));
    const open = () => {
      this.el.querySelectorAll('.menu-title.open').forEach((x) => x.classList.remove('open'));
      t.classList.add('open');
      this.el.classList.add('active');
      const r = t.getBoundingClientRect();
      popupMenu(items, r.left, r.bottom);
    };
    t.addEventListener('mousedown', (e) => {
      e.preventDefault();
      if (t.classList.contains('open')) closeAllMenus();
      else open();
    });
    t.addEventListener('mouseenter', () => {
      if (this.el.classList.contains('active') && !t.classList.contains('open')) open();
    });
    this.el.append(t);
    this.menus.push(t);
    return t;
  }
}

// ---------------------------------------------------------------- tooltips

let tipEl = null;
export function tooltip(el, textFn) {
  el.addEventListener('mouseenter', (e) => {
    const text = typeof textFn === 'function' ? textFn() : textFn;
    if (!text) return;
    tipEl?.remove();
    tipEl = h('div.tooltip', null, text);
    document.body.append(tipEl);
    const r = el.getBoundingClientRect();
    const tr2 = tipEl.getBoundingClientRect();
    tipEl.style.left = `${Math.min(innerWidth - tr2.width - 4, Math.max(2, r.left))}px`;
    tipEl.style.top = `${r.top - tr2.height - 4 >= 0 ? r.top - tr2.height - 4 : r.bottom + 4}px`;
  });
  el.addEventListener('mouseleave', () => { tipEl?.remove(); tipEl = null; });
  el.addEventListener('mousedown', () => { tipEl?.remove(); tipEl = null; });
}

// ---------------------------------------------------------------- dialogs

const dialogStack = [];

export function isDialogOpen() {
  return dialogStack.length > 0;
}

// Generic modal dialog. `buttons`: [{ label, value, default, left, onClick }]
// onClick may return false to keep the dialog open. Resolves with the value.
export function dialog({ title, icon: iconName, body, buttons = [{ label: 'OK', value: true, default: true }], className = '', width, onOpen, closeValue = null }) {
  return new Promise((resolve) => {
    const backdrop = h('div.modal-backdrop');
    const dlg = h(`div.dialog${className ? '.' + className.split(' ').join('.') : ''}`, { role: 'dialog', 'aria-modal': 'true' });
    if (width) dlg.style.width = width;
    const close = (value) => {
      backdrop.remove();
      dialogStack.splice(dialogStack.indexOf(dlg), 1);
      document.removeEventListener('keydown', onKey, true);
      resolve(value);
    };
    const titleBar = h('div.dialog-title', null,
      iconName ? icon(iconName) : null,
      h('span.title', null, title || '86Box'),
      h('button.close', { title: 'Close', onclick: () => close(closeValue) }, '✕'));
    const bodyEl = h('div.dialog-body');
    if (body) bodyEl.append(...(Array.isArray(body) ? body : [body]));
    const btnRow = h('div.dialog-buttons');
    const left = h('div.left');
    let defBtn = null;
    for (const b of buttons) {
      const el = h('button.btn', { type: 'button' }, b.label);
      if (b.default) { el.classList.add('default'); defBtn = el; }
      if (b.disabled) el.disabled = true;
      el.addEventListener('click', async () => {
        if (b.onClick) {
          const r = await b.onClick(dlg);
          if (r === false) return;
        }
        if (b.value !== undefined) close(b.value);
      });
      b.el = el;
      (b.left ? left : btnRow).append(el);
    }
    if (left.childElementCount) btnRow.prepend(left);
    dlg.append(titleBar, bodyEl);
    if (buttons.length) dlg.append(btnRow);
    backdrop.append(dlg);
    document.body.append(backdrop);
    dialogStack.push(dlg);

    const onKey = (e) => {
      if (dialogStack[dialogStack.length - 1] !== dlg) return;
      if (e.key === 'Escape') { e.preventDefault(); e.stopPropagation(); close(closeValue); }
      if (e.key === 'Enter' && defBtn && !defBtn.disabled && !(e.target instanceof HTMLTextAreaElement) && !(e.target instanceof HTMLSelectElement) && !(e.target instanceof HTMLButtonElement)) {
        e.preventDefault();
        defBtn.click();
      }
    };
    document.addEventListener('keydown', onKey, true);

    // Drag by title bar.
    let drag = null;
    titleBar.addEventListener('mousedown', (e) => {
      if (e.target.closest('button')) return;
      const r = dlg.getBoundingClientRect();
      drag = { dx: e.clientX - r.left, dy: e.clientY - r.top };
      dlg.style.position = 'fixed';
      dlg.style.margin = '0';
      dlg.style.left = `${r.left}px`;
      dlg.style.top = `${r.top}px`;
    });
    document.addEventListener('mousemove', (e) => {
      if (!drag) return;
      dlg.style.left = `${Math.max(0, e.clientX - drag.dx)}px`;
      dlg.style.top = `${Math.max(0, e.clientY - drag.dy)}px`;
    });
    document.addEventListener('mouseup', () => { drag = null; });

    onOpen?.(dlg, close);
    (dlg.querySelector('[autofocus]') || defBtn || dlg).focus?.();
  });
}

// Message box flags (86Box MBX_*).
export const MBX = { INFO: 1, ERROR: 2, QUESTION: 3, QUESTION_YN: 4, QUESTION_OK: 8, QMARK: 0x10, LINK: 0x20, WARNING: 0x40, FATAL: 0x80, ANSI: 0x100, DONTASK: 0x200 };

export function messageBox({ title = '86Box', header, text, kind = 'info', buttons }) {
  const iconName = { info: 'emulator', warning: 'emulator', error: 'emulator', question: 'emulator' }[kind] || 'emulator';
  const glyph = { info: 'ℹ️', warning: '⚠️', error: '⛔', question: '❓' }[kind] || 'ℹ️';
  return dialog({
    title,
    icon: iconName,
    className: 'msgbox',
    body: [
      h('div', { style: { fontSize: '28px', lineHeight: '1' } }, glyph),
      h('div.text', null, header ? h('strong', null, header) : null, text),
    ],
    buttons: buttons || [{ label: 'OK', value: 1, default: true }],
    closeValue: buttons ? 0 : 1,
  });
}

export function confirm(text, { title = '86Box', yes = 'Yes', no = 'No', header } = {}) {
  return messageBox({ title, header, text, kind: 'question', buttons: [{ label: yes, value: true, default: true }, { label: no, value: false }] });
}

export function prompt(label, value = '', { title = '86Box', validate } = {}) {
  const input = h('input', { type: 'text', value, style: { width: '100%' }, autofocus: true });
  const err = h('div.muted', { style: { minHeight: '1.3em', marginTop: '4px' } });
  return dialog({
    title,
    width: '420px',
    body: [h('div', { style: { marginBottom: '6px' } }, label), input, err],
    buttons: [
      { label: 'OK', default: true, onClick: () => {
        const msg = validate?.(input.value);
        if (msg) { err.textContent = msg; return false; }
        return true;
      }, value: true },
      { label: 'Cancel', value: false },
    ],
    onOpen: () => setTimeout(() => { input.focus(); input.select(); }, 0),
  }).then((ok) => (ok ? input.value : null));
}

// Open a native file picker; resolves with File[] (empty if cancelled).
export function pickFiles({ accept = '', multiple = false } = {}) {
  return new Promise((resolve) => {
    const input = h('input', { type: 'file', accept, multiple, style: { display: 'none' } });
    let done = false;
    input.addEventListener('change', () => { done = true; resolve([...input.files]); input.remove(); });
    input.addEventListener('cancel', () => { if (!done) resolve([]); input.remove(); });
    document.body.append(input);
    input.click();
  });
}

export function downloadBlob(blob, name) {
  const url = URL.createObjectURL(blob);
  const a = h('a', { href: url, download: name });
  document.body.append(a);
  a.click();
  a.remove();
  setTimeout(() => URL.revokeObjectURL(url), 10000);
}

// A progress dialog; returns { update(fraction, text), close() }.
export function progressDialog(title, text) {
  const bar = h('div');
  const label = h('div', null, text);
  const backdrop = h('div.modal-backdrop', null,
    h('div.dialog', { style: { width: '380px' } },
      h('div.dialog-title', null, h('span.title', null, title)),
      h('div.dialog-body', null, label, h('div.progress', { style: { width: '100%', background: 'var(--border-light)' } }, bar))));
  document.body.append(backdrop);
  return {
    update(f, t) {
      bar.style.width = `${Math.round(Math.max(0, Math.min(1, f)) * 100)}%`;
      if (t) label.textContent = t;
    },
    close() { backdrop.remove(); },
  };
}

// Tab widget: tabs = [{ title, content: Element }]
export function tabWidget(tabs) {
  const bar = h('div.tab-bar');
  const page = h('div.tab-page');
  const el = h('div.tabs', null, bar, page);
  tabs.forEach((t, i) => {
    const b = h('button', { type: 'button' }, t.title);
    b.addEventListener('click', () => {
      bar.querySelectorAll('button').forEach((x) => x.classList.remove('active'));
      b.classList.add('active');
      page.replaceChildren(t.content);
    });
    bar.append(b);
    if (i === 0) { b.classList.add('active'); page.append(t.content); }
  });
  return el;
}

export function formatSize(bytes) {
  if (bytes >= 1024 ** 3) return `${(bytes / 1024 ** 3).toFixed(2)} GB`;
  if (bytes >= 1024 ** 2) return `${(bytes / 1024 ** 2).toFixed(1)} MB`;
  if (bytes >= 1024) return `${(bytes / 1024).toFixed(0)} KB`;
  return `${bytes} B`;
}
