// Web86Box - the Settings dialog, modeled page by page on 86Box's Qt
// settings (src/qt/qt_settings*.cpp). It edits a copy of the VM's
// 86box.cfg (same sections, keys and formats 86Box's config.c reads);
// the caller writes it back and asks the emulator to reload.

import { h, icon, dialog, messageBox, tabWidget, formatSize } from './ui.js';
import { configureDevice } from './deviceconfig.js';

const HDD_NUM = 8;
const FDD_NUM = 4;
const CDROM_NUM = 4; // drives shown in the dialog (86Box supports 8)
const SCSI_BUS_MAX = 4;

const BUS = { DISABLED: 0, MFM: 1, XTA: 2, ESDI: 3, LPT: 6, IDE: 7, ATAPI: 8, SCSI: 9 };
const HDD_BUS_NAMES = { 1: 'mfm', 2: 'xta', 3: 'esdi', 7: 'ide', 8: 'atapi', 9: 'scsi' };
const HDD_BUS_LABELS = { 1: 'MFM/RLL', 2: 'XTA', 3: 'ESDI', 7: 'IDE', 8: 'ATAPI', 9: 'SCSI' };
const CD_BUS = { DISABLED: 0, MKE: 4, MITSUMI: 5, LPT: 6, ATAPI: 8, SCSI: 9, HITACHI: 12, PHILIPS: 13, CM100: 14, SONY: 15 };
const CD_BUS_NAMES = { 0: 'none', 4: 'mke', 5: 'mitsumi', 6: 'lpt', 8: 'atapi', 9: 'scsi', 12: 'hitachi', 13: 'philips', 14: 'philips_cm100', 15: 'sony' };
const CD_BUS_LABELS = { 0: 'Disabled', 4: 'Panasonic/MKE', 5: 'Mitsumi', 6: 'Parallel port', 8: 'ATAPI', 9: 'SCSI', 12: 'Hitachi', 13: 'Philips', 14: 'Philips CM100', 15: 'Sony' };

// ---------------------------------------------------------------- helpers

function select(options, value, { onchange } = {}) {
  const s = h('select');
  for (const o of options) {
    const opt = h('option', { value: String(o.v) }, o.t);
    if (o.disabled) opt.disabled = true;
    s.append(opt);
  }
  if (value !== undefined) s.value = String(value);
  if (s.selectedIndex < 0 && s.options.length) s.selectedIndex = 0;
  s.disabled = s.options.length <= 1;
  if (onchange) s.addEventListener('change', onchange);
  return s;
}

function check(label, checked, { onchange, disabled } = {}) {
  const cb = h('input', { type: 'checkbox' });
  cb.checked = !!checked;
  cb.disabled = !!disabled;
  if (onchange) cb.addEventListener('change', onchange);
  const l = h('label.check', null, cb, label);
  l.input = cb;
  return l;
}

function btn(label, onclick, disabled = false) {
  const b = h('button.btn', { type: 'button', onclick });
  b.textContent = label;
  b.disabled = disabled;
  return b;
}

function devOptions(list) {
  return list.map((d) => ({ v: d.i, t: d.n }));
}

function chanStr(c) { return `${c >> 1}:${c & 1}`; }
function parseChan(s, def) {
  const m = /^(\d+):(\d+)$/.exec(s || '');
  return m ? (parseInt(m[1], 10) << 1) | (parseInt(m[2], 10) & 1) : def;
}
function scsiStr(bus, id) { return `${bus}:${String(id).padStart(2, '0')}`; }
function parseScsi(s) {
  const m = /^(\d+):(\d+)$/.exec(s || '');
  return m ? { bus: parseInt(m[1], 10), id: parseInt(m[2], 10) } : null;
}

// ---------------------------------------------------------------- dialog

export async function openSettings({ catalog, ini: original, vm, files, newVM = false }) {
  const ini = original.clone();
  const ctx = {
    catalog,
    ini,
    vm,
    files,
    machine: null,
    listeners: [],
    onMachineChanged(fn) { this.listeners.push(fn); },
    setMachine(m) {
      this.machine = m;
      for (const fn of this.listeners) fn(m);
    },
  };
  ctx.machine = catalog.machine(ini.get('Machine', 'machine', catalog.machines[0].i)) || catalog.machines.find((m) => m.a);

  const pages = [
    { title: 'Machine', icon: 'machine', page: machinePage },
    { title: 'Display', icon: 'display', page: displayPage },
    { title: 'Input devices', icon: 'input_devices', page: inputPage },
    { title: 'Sound', icon: 'sound', page: soundPage },
    { title: 'Network', icon: 'network', page: networkPage },
    { title: 'Ports (COM & LPT)', icon: 'ports', page: portsPage },
    { title: 'Storage controllers', icon: 'storage_controllers', page: storagePage },
    { title: 'Hard disks', icon: 'hard_disk', page: hardDisksPage },
    { title: 'Floppy & CD-ROM drives', icon: 'floppy_and_cdrom_drives', page: floppyCdPage },
    { title: 'Other removable devices', icon: 'other_removable_devices', page: otherRemovablePage },
    { title: 'Other peripherals', icon: 'other_peripherals', page: otherPeripheralsPage },
  ];
  // Build every page up front (like Qt) so cross-page machine changes apply.
  for (const p of pages) p.inst = p.page(ctx);
  ctx.setMachine(ctx.machine);

  const nav = h('div.list-view.settings-nav');
  const header = h('div.settings-header');
  const content = h('div.settings-content');
  const show = (p) => {
    nav.querySelectorAll('.list-item').forEach((x) => x.classList.toggle('selected', x.page === p));
    header.replaceChildren(icon(p.icon, 'icon icon32'), p.title);
    content.replaceChildren(p.inst.el);
  };
  for (const p of pages) {
    const item = h('div.list-item', null, icon(p.icon), p.title);
    item.page = p;
    item.addEventListener('click', () => show(p));
    nav.append(item);
  }
  show(pages[0]);

  const ok = await dialog({
    title: newVM ? `Settings - ${vm}` : `Settings`,
    icon: 'machine',
    className: 'settings',
    body: [nav, h('div.settings-page', null, header, content)],
    buttons: [
      { label: 'OK', default: true, value: true, onClick: async () => {
        for (const p of pages) {
          const err = p.inst.validate?.();
          if (err) { show(p); await messageBox({ kind: 'warning', text: err }); return false; }
        }
        return true;
      } },
      { label: 'Cancel', value: false },
    ],
  });
  if (!ok) return null;
  for (const p of pages) p.inst.save();
  return ini;
}

// ---------------------------------------------------------------- Machine

function machinePage(ctx) {
  const { catalog: cat, ini } = ctx;
  const S = 'Machine';
  let cpuFam = cat.cpuFamily(ini.get(S, 'cpu_family', ''));
  const cpuSpeed = ini.getInt(S, 'cpu_speed', 0);
  const cpuMulti = parseFloat(ini.get(S, 'cpu_multi', '0')) || 0;
  let fpuName = ini.get(S, 'fpu_type', 'none');
  let memKB = ini.getInt(S, 'mem_size', 0);
  let waitstates = ini.getInt(S, 'cpu_waitstates', 0);

  const typeSel = select([], undefined);
  const machSel = select([], undefined);
  const machCfg = btn('Configure', () => {
    const m = cat.machines[+machSel.value];
    configureDevice({ catalog: cat, ini, dev: m.dev?.[0], pickFile: ctx.files?.pick });
  });
  const cpuSel = h('select');
  const speedSel = h('select');
  const fpuSel = h('select');
  const wsSel = select([{ v: 0, t: 'Default' }, ...Array.from({ length: 8 }, (_, i) => ({ v: i + 1, t: `${i} wait state${i === 1 ? '' : 's'}` }))], waitstates);
  const pitSel = select([{ v: -1, t: 'Auto' }, { v: 0, t: 'Slow' }, { v: 1, t: 'Fast' }], ini.getInt(S, 'pit_mode', -1));
  const memInp = h('input', { type: 'number' });
  const memUnit = h('span');
  const softfloat = check('Softfloat FPU', ini.getInt(S, 'fpu_softfloat', 0));
  const softWarn = h('span.muted', { hidden: true }, '⚠ High performance impact');
  softfloat.input.addEventListener('change', () => { softWarn.hidden = !softfloat.input.checked; });
  const interp = check('Use the 486 interpreter for 286 and 386 processors', ini.getInt(S, 'cpu_override_interpreter', 0));
  const ts = ini.get(S, 'time_sync', 'local');
  const tsName = `ts${Math.random()}`;
  const tsRadio = (v, label) => {
    const r = h('input', { type: 'radio', name: tsName, value: v });
    r.checked = (ts === v) || (v === 'local' && !['utc', 'gmt', 'disabled'].includes(ts)) || (v === 'utc' && ts === 'gmt');
    return h('label.check', { style: { marginRight: '12px' } }, r, label);
  };
  const tsBox = h('fieldset', null, h('legend', null, 'Time synchronization'),
    tsRadio('disabled', 'Disabled'), tsRadio('local', 'Enabled (local time)'), tsRadio('utc', 'Enabled (UTC)'));
  const frName = `fr${Math.random()}`;
  const f10 = ini.getInt('General', 'force_10ms', 0);
  const frLarge = h('input', { type: 'radio', name: frName });
  const frSmall = h('input', { type: 'radio', name: frName });
  frLarge.checked = !!f10;
  frSmall.checked = !f10;
  const frBox = h('fieldset', null, h('legend', null, 'CPU frame size'),
    h('label.check', { style: { marginRight: '12px' } }, frLarge, 'Larger frames (less smooth)'),
    h('label.check', null, frSmall, 'Smaller frames (smoother)'));

  // Machine types that have at least one available machine.
  const types = cat.machine_types.filter((t) => cat.machines.some((m) => m.t === t.id && m.a));
  typeSel.replaceChildren(...types.map((t) => h('option', { value: String(t.id) }, t.name)));
  typeSel.disabled = false;

  const fillMachines = (keep) => {
    const t = +typeSel.value;
    machSel.replaceChildren();
    cat.machines.forEach((m, i) => {
      if (m.t === t && m.a) machSel.append(h('option', { value: String(i) }, m.n));
    });
    machSel.disabled = false;
    if (keep) machSel.value = String(cat.machineByName.get(keep.i));
    if (machSel.selectedIndex < 0) machSel.selectedIndex = 0;
  };

  const fillCpus = () => {
    const m = cat.machines[+machSel.value];
    machCfg.disabled = !m.dev;
    cpuSel.replaceChildren();
    for (const { fam } of cat.eligibleCpus(m)) {
      const f = cat.cpu_families[fam];
      cpuSel.append(h('option', { value: String(fam) }, `${f.m} ${f.n}`));
    }
    cpuSel.value = String(cpuFam);
    if (cpuSel.selectedIndex < 0) cpuSel.selectedIndex = 0;
    cpuSel.disabled = cpuSel.options.length <= 1;

    // Memory: KB below 1 MB granularity, MB otherwise (as in Qt).
    const [min, max, step] = m.ram;
    const div = step < 1024 ? 1 : 1024;
    memUnit.textContent = div === 1 ? 'KB' : 'MB';
    memInp.min = min / div;
    memInp.max = max / div;
    memInp.step = Math.max(1, step / div);
    if (!memKB) memKB = min;
    memInp.value = String(Math.round(Math.min(max, Math.max(min, memKB)) / div));
    memInp.disabled = min === max;
    memInp.dataset.div = div;
    fillSpeeds();
  };

  const fillSpeeds = () => {
    const m = cat.machines[+machSel.value];
    const fam = +cpuSel.value;
    const f = cat.cpu_families[fam];
    const elig = cat.eligibleCpus(m).find((e) => e.fam === fam);
    speedSel.replaceChildren();
    let sel = -1;
    for (const ci of elig?.cpus || []) {
      const c = f.cpus[ci];
      speedSel.append(h('option', { value: String(ci) }, c.n));
      if (fam === cpuFam && c.s === cpuSpeed && Math.abs(c.x - cpuMulti) < 1e-6) sel = ci;
    }
    if (sel < 0 && fam === cpuFam) {
      // Closest faster CPU, like config.c.
      const cand = (elig?.cpus || []).find((ci) => f.cpus[ci].s >= cpuSpeed);
      sel = cand ?? (elig?.cpus || []).slice(-1)[0];
    }
    if (sel >= 0) speedSel.value = String(sel);
    if (speedSel.selectedIndex < 0) speedSel.selectedIndex = 0;
    speedSel.disabled = speedSel.options.length <= 1;
    fillFpu();
  };

  const fillFpu = () => {
    const m = cat.machines[+machSel.value];
    const f = cat.cpu_families[+cpuSel.value];
    const c = f.cpus[+speedSel.value];
    wsSel.disabled = !c.ws;
    if (!c.ws) wsSel.value = '0'; else wsSel.value = String(waitstates);
    interp.input.disabled = !c.oi;
    interp.classList.toggle('disabled', !c.oi);
    fpuSel.replaceChildren(...c.fpus.map(([name, internal]) => h('option', { value: internal }, name)));
    fpuSel.value = fpuName;
    if (fpuSel.selectedIndex < 0) fpuSel.selectedIndex = 0;
    fpuSel.disabled = fpuSel.options.length <= 1;
    onFpu(m);
  };

  const onFpu = (m) => {
    const f = cat.cpu_families[+cpuSel.value];
    const c = f.cpus[+speedSel.value];
    const fpu = c.fpus.find(([, internal]) => internal === fpuSel.value);
    const none = !fpu || fpu[2] === 0;
    const sfOnly = cat.hasFlag(m, 'MACHINE_SOFTFLOAT_ONLY');
    if (none) {
      softfloat.input.checked = false;
      softfloat.input.disabled = true;
    } else {
      if (sfOnly) softfloat.input.checked = true;
      softfloat.input.disabled = sfOnly;
    }
    softWarn.hidden = !softfloat.input.checked;
  };

  typeSel.addEventListener('change', () => { fillMachines(); machSel.dispatchEvent(new Event('change')); });
  machSel.addEventListener('change', () => { fillCpus(); ctx.setMachine(cat.machines[+machSel.value]); });
  cpuSel.addEventListener('change', () => { cpuFam = +cpuSel.value; fillSpeeds(); });
  speedSel.addEventListener('change', fillFpu);
  fpuSel.addEventListener('change', () => { fpuName = fpuSel.value; onFpu(cat.machines[+machSel.value]); });
  wsSel.addEventListener('change', () => { waitstates = +wsSel.value; });
  memInp.addEventListener('change', () => { memKB = (+memInp.value) * (+memInp.dataset.div || 1); });

  const m0 = ctx.machine;
  typeSel.value = String(m0?.t ?? types[0]?.id);
  fillMachines(m0);
  fillCpus();

  const el = tabWidget([{
    title: 'Machine',
    content: h('div', null,
      h('div.form', null,
        h('label', null, 'Machine type:'), h('div.span2', null, typeSel),
        h('label', null, 'Machine:'), machSel, machCfg,
        h('label', null, 'CPU type:'), h('div.row.span2', null, h('div.grow', null, cpuSel), h('label', null, 'Frequency:'), h('div.grow', null, speedSel)),
        h('label', null, 'FPU:'), h('div.span2', null, fpuSel),
        h('label', null, 'Wait states:'), h('div.span2', null, wsSel),
        h('label', null, 'Memory:'), h('div.row.span2', null, memInp, memUnit),
        h('label', null, 'PIT mode:'), h('div.span2', null, pitSel),
        h('div.full', null, softfloat, ' ', softWarn),
        h('div.full', null, interp)),
      tsBox, frBox),
  }]);
  [cpuSel, speedSel, fpuSel].forEach((s) => { s.style.width = '100%'; });

  return {
    el,
    save() {
      const m = cat.machines[+machSel.value];
      const f = cat.cpu_families[+cpuSel.value];
      const c = f.cpus[+speedSel.value];
      ini.set(S, 'machine', m.i);
      ini.set(S, 'cpu_family', f.i);
      ini.set(S, 'cpu_speed', c.s);
      ini.set(S, 'cpu_multi', Number(c.x.toPrecision(6)));
      ini.delete(S, 'cpu_manufacturer');
      ini.delete(S, 'cpu');
      ini.setDefault(S, 'cpu_waitstates', wsSel.disabled ? 0 : +wsSel.value, 0);
      ini.setDefault(S, 'fpu_type', fpuSel.value, 'none');
      const [min, max, step] = m.ram;
      let mem = (+memInp.value || 0) * (+memInp.dataset.div || 1);
      if (mem > min) mem = min + Math.floor((mem - min) / step) * step;
      mem = Math.max(min, Math.min(max, mem));
      ini.set(S, 'mem_size', mem);
      ini.setDefault(S, 'fpu_softfloat', softfloat.input.checked ? 1 : 0, 0);
      ini.setDefault(S, 'cpu_override_interpreter', interp.input.checked && !interp.input.disabled ? 1 : 0, 0);
      const tsv = tsBox.querySelector('input:checked')?.value || 'local';
      if (tsv === 'local') ini.delete(S, 'time_sync'); else ini.set(S, 'time_sync', tsv);
      ini.setDefault(S, 'pit_mode', +pitSel.value, -1);
      ini.set(S, 'cpu_use_dynarec', 0);
      ini.setDefault('General', 'force_10ms', frLarge.checked ? 1 : 0, 0);
    },
  };
}

// ---------------------------------------------------------------- Display

function displayPage(ctx) {
  const { catalog: cat, ini } = ctx;
  const S = 'Video';
  let cur1 = ini.get(S, 'gfxcard', null); // absent: internal if on board, else none
  let cur2 = ini.get(S, 'gfxcard_2', 'none');
  const vid1 = h('select');
  const vid2 = h('select');
  const cfg1 = btn('Configure', () => {
    const m = ctx.machine;
    if (vid1.value === 'internal') configureDevice({ catalog: cat, ini, dev: m.vid?.[0], pickFile: ctx.files?.pick });
    else configureDevice({ catalog: cat, ini, dev: cat.find('video', vid1.value), pickFile: ctx.files?.pick });
  });
  const cfg2 = btn('Configure', () => configureDevice({ catalog: cat, ini, dev: cat.find('video', vid2.value), inst: 2, pickFile: ctx.files?.pick }));
  const extra = (key, label, cfgKey) => {
    const c = check(label, ini.getInt(S, key, 0));
    const b = btn('Configure', () => configureDevice({ catalog: cat, ini, dev: cfgKey()?.[0], pickFile: ctx.files?.pick }));
    c.input.addEventListener('change', () => { b.disabled = !c.input.checked || !cfgKey()?.[0]?.c; });
    return { c, b, key };
  };
  const voodoo = extra('voodoo', 'Voodoo 1 or 2 Graphics', () => cat.extra.voodoo);
  const i8514 = extra('8514a', 'IBM 8514/A Graphics', () => (cat.hasBus(ctx.machine, 'MACHINE_BUS_MCA') ? cat.extra['8514a_mca'] : cat.extra['8514a_isa']));
  const xga = extra('xga', 'XGA Graphics', () => cat.extra.xga);
  const da2 = extra('da2', 'IBM PS/55 Display Adapter Graphics', () => cat.extra.da2);
  const G = 'General';
  const screenType = select([{ v: 0, t: 'Color' }, { v: 1, t: 'Grayscale' }, { v: 2, t: 'Amber' }, { v: 3, t: 'Green' }, { v: 4, t: 'White' }], ini.getInt(G, 'video_grayscale', 0));
  const grayType = select([{ v: 0, t: 'BT601 (NTSC/PAL)' }, { v: 1, t: 'BT709 (HDTV)' }, { v: 2, t: 'Average' }], ini.getInt(G, 'video_graytype', 0));
  const overscan = check('Overscan', ini.getInt(G, 'enable_overscan', 0));
  const contrast = check('Change contrast for monochrome display', ini.getInt(G, 'vid_cga_contrast', 0));

  const refresh = (m) => {
    const onboardOnly = cat.hasFlag(m, 'MACHINE_VIDEO_ONLY');
    const hasOnboard = cat.hasFlag(m, 'MACHINE_VIDEO');
    const list = cat.list('video', m).filter((d) => {
      if (d.i === 'internal') return hasOnboard;
      if (onboardOnly) return false;
      return true;
    });
    vid1.replaceChildren(...list.map((d) => h('option', { value: d.i }, d.n)));
    vid1.value = cur1 ?? (hasOnboard ? 'internal' : 'none');
    if (vid1.selectedIndex < 0) vid1.selectedIndex = 0;
    vid1.disabled = vid1.options.length <= 1;
    refresh2();
    const isa16 = cat.hasBus(m, 'MACHINE_BUS_ISA16') || cat.hasBus(m, 'MACHINE_BUS_MCA');
    const pci = cat.hasBus(m, 'MACHINE_BUS_PCI');
    for (const [x, en] of [[voodoo, pci], [i8514, isa16], [xga, isa16], [da2, cat.hasBus(m, 'MACHINE_BUS_MCA')]]) {
      x.c.input.disabled = !en;
      if (!en) x.c.input.checked = false;
      x.c.classList.toggle('disabled', !en);
      x.b.disabled = !x.c.input.checked;
    }
  };
  const refresh2 = () => {
    const m = ctx.machine;
    const primary = cat.find('video', vid1.value);
    const list = cat.list('video', m).filter((d) => d.i !== 'internal');
    vid2.replaceChildren(...list.map((d) => h('option', { value: d.i }, d.n)));
    vid2.value = cur2;
    if (vid2.selectedIndex < 0) vid2.selectedIndex = 0;
    vid2.disabled = !primary || vid1.value === 'none' || vid2.options.length <= 1;
    cfg1.disabled = !(vid1.value === 'internal' ? m?.vid?.[0]?.c : primary?.c);
    cfg2.disabled = vid2.disabled || !cat.find('video', vid2.value)?.c;
  };
  vid1.addEventListener('change', () => { cur1 = vid1.value; refresh2(); });
  vid2.addEventListener('change', () => { cur2 = vid2.value; refresh2(); });
  ctx.onMachineChanged(refresh);

  const el = tabWidget([{
    title: 'Display',
    content: h('div', null,
      h('div.form', null,
        h('label', null, 'Video:'), vid1, cfg1,
        h('label', null, 'Video #2:'), vid2, cfg2,
        h('div.span2', null, voodoo.c), voodoo.b,
        h('div.span2', null, i8514.c), i8514.b,
        h('div.span2', null, xga.c), xga.b,
        h('div.span2', null, da2.c), da2.b,
        h('label', null, 'VGA screen type:'), h('div.span2', null, screenType),
        h('label', null, 'Grayscale conversion type:'), h('div.span2', null, grayType)),
      h('div', { style: { marginTop: '10px', display: 'grid', gap: '4px' } }, overscan, contrast)),
  }]);

  return {
    el,
    save() {
      ini.set(S, 'gfxcard', vid1.value);
      ini.setDefault(S, 'gfxcard_2', vid2.disabled ? 'none' : vid2.value, 'none');
      for (const x of [voodoo, i8514, xga, da2]) ini.setDefault(S, x.key, x.c.input.checked ? 1 : 0, 0);
      ini.setDefault(G, 'video_grayscale', +screenType.value, 0);
      ini.setDefault(G, 'video_graytype', +grayType.value, 0);
      ini.setDefault(G, 'enable_overscan', overscan.input.checked ? 1 : 0, 0);
      ini.setDefault(G, 'vid_cga_contrast', contrast.input.checked ? 1 : 0, 0);
    },
  };
}

// ---------------------------------------------------------------- Input

function inputPage(ctx) {
  const { catalog: cat, ini } = ctx;
  const S = 'Input devices';
  let kbd = ini.get(S, 'keyboard_type', 'internal');
  let mouse = ini.get(S, 'mouse_type', 'none');
  let tablet = ini.get(S, 'tablet_type', 'none');
  const kbdSel = h('select');
  const mouseSel = h('select');
  const tabletSel = h('select');
  const joySel = select([{ v: 'none', t: 'None' }, ...cat.joysticks.filter((j) => j.i !== 'none').map((j) => ({ v: j.i, t: j.n }))], ini.get(S, 'joystick_type', 'none'));
  const cfgFor = (key, sel) => btn('Configure', () => configureDevice({ catalog: cat, ini, dev: cat.find(key, sel.value), pickFile: ctx.files?.pick }));
  const kbdCfg = cfgFor('keyboard', kbdSel);
  const mouseCfg = cfgFor('mouse', mouseSel);
  const tabletCfg = cfgFor('tablet', tabletSel);

  const joyButtons = [1, 2, 3, 4].map((n) => btn(`Joystick ${n}…`, () => joystickDialog(n - 1)));
  const joyState = {};
  for (let js = 0; js < 4; js++) joyState[js] = ini.getInt(S, `joystick_${js}_nr`, 0);
  const joystickDialog = async (js) => {
    const sel = select([{ v: 0, t: 'None' }, ...[1, 2, 3, 4].map((i) => ({ v: i, t: `Gamepad ${i}` }))], joyState[js]);
    sel.disabled = false;
    const ok = await dialog({
      title: `Joystick ${js + 1} configuration`,
      width: '380px',
      body: [h('div.form', null, h('label', null, 'Device:'), h('div.span2', null, sel)),
        h('p.muted', null, 'Gamepads use the browser’s standard mapping: axes and buttons are passed through in order.')],
      buttons: [{ label: 'OK', value: true, default: true }, { label: 'Cancel', value: false }],
    });
    if (ok) joyState[js] = +sel.value;
  };
  const refreshJoy = () => {
    const j = cat.joysticks.find((x) => x.i === joySel.value);
    joyButtons.forEach((b, i) => { b.disabled = !j || j.i === 'none' || i >= (j.max || 0); });
  };
  joySel.addEventListener('change', refreshJoy);

  const refreshCfg = () => {
    kbdCfg.disabled = !cat.find('keyboard', kbdSel.value)?.c;
    mouseCfg.disabled = !cat.find('mouse', mouseSel.value)?.c;
    tabletCfg.disabled = !cat.find('tablet', tabletSel.value)?.c;
  };
  const refresh = (m) => {
    const fill = (sel, key, cur, skipInternal) => {
      const list = cat.list(key, m).filter((d) => !(d.i === 'internal' && skipInternal));
      sel.replaceChildren(...list.map((d) => h('option', { value: d.i }, d.n)));
      sel.value = cur;
      if (sel.selectedIndex < 0) sel.selectedIndex = 0;
      sel.disabled = sel.options.length <= 1;
    };
    fill(kbdSel, 'keyboard', kbd, !cat.hasFlag(m, 'MACHINE_KEYBOARD'));
    fill(mouseSel, 'mouse', mouse, !cat.hasFlag(m, 'MACHINE_MOUSE'));
    fill(tabletSel, 'tablet', tablet, false);
    refreshCfg();
    refreshJoy();
  };
  kbdSel.addEventListener('change', () => { kbd = kbdSel.value; refreshCfg(); });
  mouseSel.addEventListener('change', () => { mouse = mouseSel.value; refreshCfg(); });
  tabletSel.addEventListener('change', () => { tablet = tabletSel.value; refreshCfg(); });
  joySel.disabled = false;
  ctx.onMachineChanged(refresh);

  const el = h('div', null,
    h('div.form', null,
      h('label', null, 'Keyboard:'), kbdSel, kbdCfg,
      h('label', null, 'Mouse:'), mouseSel, mouseCfg,
      h('label', null, 'Tablet:'), tabletSel, tabletCfg,
      h('label', null, 'Joystick:'), h('div.span2', null, joySel)),
    h('div.row', { style: { marginTop: '8px', flexWrap: 'wrap' } }, joyButtons));

  return {
    el,
    save() {
      ini.set(S, 'keyboard_type', kbdSel.value);
      ini.set(S, 'mouse_type', mouseSel.value);
      ini.setDefault(S, 'tablet_type', tabletSel.value, 'none');
      ini.setDefault(S, 'joystick_type', joySel.value, 'none');
      for (let js = 0; js < 4; js++) ini.setDefault(S, `joystick_${js}_nr`, joyState[js], 0);
    },
  };
}

// ---------------------------------------------------------------- Sound

function soundPage(ctx) {
  const { catalog: cat, ini } = ctx;
  const S = 'Sound';
  const keys = ['sndcard', 'sndcard2', 'sndcard3', 'sndcard4'];
  const cur = keys.map((k) => ini.get(S, k, 'none'));
  const sels = keys.map(() => h('select'));
  const cfgs = sels.map((sel, i) => btn('Configure', () => {
    if (sel.value === 'internal') configureDevice({ catalog: cat, ini, dev: ctx.machine?.snd?.[0], pickFile: ctx.files?.pick });
    else configureDevice({ catalog: cat, ini, dev: cat.find('sound', sel.value), inst: i + 1, pickFile: ctx.files?.pick });
  }));
  const midiOut = h('select');
  const midiIn = h('select');
  const midiOutCfg = btn('Configure', () => configureDevice({ catalog: cat, ini, dev: cat.find('midi_out', midiOut.value), pickFile: ctx.files?.pick }));
  const midiInCfg = btn('Configure', () => configureDevice({ catalog: cat, ini, dev: cat.find('midi_in', midiIn.value), pickFile: ctx.files?.pick }));
  const mpu = check('Standalone MPU-401', ini.getInt(S, 'mpu401_standalone', 0));
  const mpuCfg = btn('Configure', () => configureDevice({ catalog: cat, ini, dev: (cat.hasBus(ctx.machine, 'MACHINE_BUS_MCA') ? cat.extra.mpu401_mca : cat.extra.mpu401)[0], pickFile: ctx.files?.pick }));
  const fm = select([{ v: 'nuked', t: 'Nuked (more accurate)' }, { v: 'ymfm', t: 'YMFM (faster)' }], ini.get(S, 'fm_driver', 'nuked'));
  fm.disabled = false;
  const float32 = check('Use FLOAT32 sound', ini.get(S, 'sound_type', 'float') === 'float');
  const rate = select([{ v: 44100, t: '44100 Hz' }, { v: 48000, t: '48000 Hz' }, { v: 96000, t: '96000 Hz' }], ini.getInt(S, 'sound_sample_rate', 48000));
  rate.disabled = false;

  const refreshCfg = () => {
    sels.forEach((sel, i) => {
      const dev = sel.value === 'internal' ? ctx.machine?.snd?.[0] : cat.find('sound', sel.value);
      cfgs[i].disabled = !dev?.c;
    });
    midiOutCfg.disabled = !cat.find('midi_out', midiOut.value)?.c;
    midiInCfg.disabled = !cat.find('midi_in', midiIn.value)?.c;
    mpuCfg.disabled = !mpu.input.checked;
  };
  const refresh = (m) => {
    const hasSnd = cat.hasFlag(m, 'MACHINE_SOUND');
    sels.forEach((sel, i) => {
      const list = cat.list('sound', m).filter((d) => d.i !== 'internal' || (i === 0 && hasSnd));
      sel.replaceChildren(...list.map((d) => h('option', { value: d.i }, d.n)));
      sel.value = cur[i];
      if (sel.selectedIndex < 0) sel.selectedIndex = 0;
      sel.disabled = sel.options.length <= 1;
    });
    const mo = cat.midi_out.filter((d) => d.a);
    midiOut.replaceChildren(...mo.map((d) => h('option', { value: d.i }, d.n)));
    midiOut.value = ini.get(S, 'midi_device', 'none');
    if (midiOut.selectedIndex < 0) midiOut.selectedIndex = 0;
    const mi = cat.midi_in.filter((d) => d.a);
    midiIn.replaceChildren(...mi.map((d) => h('option', { value: d.i }, d.n)));
    midiIn.value = ini.get(S, 'midi_in_device', 'none');
    if (midiIn.selectedIndex < 0) midiIn.selectedIndex = 0;
    const isa = cat.hasBus(m, 'MACHINE_BUS_ISA') || cat.hasBus(m, 'MACHINE_BUS_MCA');
    mpu.input.disabled = !isa;
    if (!isa) mpu.input.checked = false;
    refreshCfg();
  };
  sels.forEach((sel, i) => sel.addEventListener('change', () => { cur[i] = sel.value; refreshCfg(); }));
  midiOut.addEventListener('change', refreshCfg);
  midiIn.addEventListener('change', refreshCfg);
  mpu.input.addEventListener('change', refreshCfg);
  ctx.onMachineChanged(refresh);

  const el = tabWidget([
    { title: 'Sound', content: h('div', null,
      h('div.form', null,
        ...sels.flatMap((sel, i) => [h('label', null, `Sound card ${i + 1}:`), sel, cfgs[i]]),
        h('label', null, 'MIDI Out Device:'), midiOut, midiOutCfg,
        h('label', null, 'MIDI In Device:'), midiIn, midiInCfg,
        h('div.span2', null, mpu), mpuCfg,
        h('label', null, 'FM synth driver:'), h('div.span2', null, fm),
        h('label', null, 'Sample rate:'), h('div.span2', null, rate),
        h('div.full', null, float32))) },
  ]);

  return {
    el,
    save() {
      keys.forEach((k, i) => ini.setDefault(S, k, sels[i].value, 'none'));
      ini.setDefault(S, 'midi_device', midiOut.value, 'none');
      ini.setDefault(S, 'midi_in_device', midiIn.value, 'none');
      ini.setDefault(S, 'mpu401_standalone', mpu.input.checked ? 1 : 0, 0);
      ini.setDefault(S, 'fm_driver', fm.value, 'nuked');
      ini.set(S, 'sound_type', float32.input.checked ? 'float' : 'int16');
      ini.setDefault(S, 'sound_sample_rate', +rate.value, 48000);
    },
  };
}

// ---------------------------------------------------------------- Network

function networkPage(ctx) {
  const { catalog: cat, ini } = ctx;
  const S = 'Network';
  const cards = [0, 1, 2, 3].map((c) => {
    const n = String(c + 1).padStart(2, '0');
    const curCard = ini.get(S, `net_${n}_card`, c === 0 ? (ini.get(S, 'net_card', 'none')) : 'none');
    const mode = select([{ v: 'none', t: 'Null Driver' }, { v: 'slirp', t: 'SLiRP (not available in the browser)', disabled: true }], 'none');
    mode.disabled = false;
    const nic = h('select');
    const cfg = btn('Configure', () => configureDevice({ catalog: cat, ini, dev: cat.find('network', nic.value), inst: c + 1, pickFile: ctx.files?.pick }));
    nic.addEventListener('change', () => { card.cur = nic.value; cfg.disabled = !cat.find('network', nic.value)?.c; });
    const card = { c, n, cur: curCard, mode, nic, cfg };
    return card;
  });
  const refresh = (m) => {
    const hasNic = cat.hasFlag(m, 'MACHINE_NIC');
    for (const card of cards) {
      const list = cat.list('network', m).filter((d) => d.i !== 'internal' || (card.c === 0 && hasNic));
      card.nic.replaceChildren(...list.map((d) => h('option', { value: d.i }, d.n)));
      card.nic.value = card.cur;
      if (card.nic.selectedIndex < 0) card.nic.selectedIndex = 0;
      card.nic.disabled = card.nic.options.length <= 1;
      card.cfg.disabled = !cat.find('network', card.nic.value)?.c;
    }
  };
  ctx.onMachineChanged(refresh);
  const el = tabWidget(cards.map((card) => ({
    title: `Network card ${card.c + 1}`,
    content: h('div', null,
      h('div.notice', null, 'Browsers cannot open raw network connections, so the emulated network card is connected to the null driver.'),
      h('div.form', null,
        h('label', null, 'Mode:'), h('div.span2', null, card.mode),
        h('label', null, 'Adapter:'), card.nic, card.cfg)),
  })));
  return {
    el,
    save() {
      ini.delete(S, 'net_card');
      ini.delete(S, 'net_type');
      ini.delete(S, 'net_host_device');
      for (const card of cards) {
        ini.setDefault(S, `net_${card.n}_card`, card.nic.value, 'none');
        if (card.nic.value !== 'none') ini.set(S, `net_${card.n}_net_type`, 'none');
        else ini.delete(S, `net_${card.n}_net_type`);
      }
    },
  };
}

// ---------------------------------------------------------------- Ports

function portsPage(ctx) {
  const { catalog: cat, ini } = ctx;
  const S = 'Ports (COM & LPT)';
  const C = cat.C;
  const mk = (kind, idx) => {
    const isCom = kind === 'serial';
    const en = check(`${isCom ? 'COM' : 'LPT'}${idx + 1}:`, ini.getInt(S, `${kind}${idx + 1}_enabled`, isCom ? (idx < 2 ? 1 : 0) : (idx === 0 ? 1 : 0)));
    const sel = h('select');
    const cfg = btn('Configure', () => configureDevice({ catalog: cat, ini, dev: cat.find('char', sel.value), inst: isCom ? idx + 1 : 1, pickFile: ctx.files?.pick }));
    const p = { kind, idx, en, sel, cfg, cur: ini.get(S, `${kind}${idx + 1}_device`, 'none'), flag: isCom ? C.DEVICE_COM : C.DEVICE_LPT };
    const upd = () => { sel.disabled = !en.input.checked || sel.options.length <= 1; cfg.disabled = sel.disabled || !cat.find('char', sel.value)?.c; };
    en.input.addEventListener('change', upd);
    sel.addEventListener('change', () => { p.cur = sel.value; upd(); });
    p.upd = upd;
    return p;
  };
  const lpts = [0, 1, 2, 3].map((i) => mk('lpt', i));
  const coms = [0, 1, 2, 3].map((i) => mk('serial', i));
  const refresh = (m) => {
    for (const p of [...lpts, ...coms]) {
      const list = cat.list('char', m).filter((d) => d.f !== undefined && (BigInt(d.f) & p.flag));
      p.sel.replaceChildren(...list.map((d) => h('option', { value: d.i }, d.n)));
      p.sel.value = p.cur;
      if (p.sel.selectedIndex < 0) p.sel.selectedIndex = 0;
      p.upd();
    }
  };
  ctx.onMachineChanged(refresh);
  const row = (p) => [h('div', null, p.en), p.sel, p.cfg];
  const el = tabWidget([
    { title: 'Parallel ports', content: h('div.form', null, ...lpts.flatMap(row)) },
    { title: 'Serial ports', content: h('div.form', null, ...coms.flatMap(row)) },
  ]);
  return {
    el,
    save() {
      for (const p of [...lpts, ...coms]) {
        ini.set(S, `${p.kind}${p.idx + 1}_enabled`, p.en.input.checked ? 1 : 0);
        ini.setDefault(S, `${p.kind}${p.idx + 1}_device`, p.sel.value, 'none');
      }
    },
  };
}

// ---------------------------------------------------------------- Storage controllers

function storagePage(ctx) {
  const { catalog: cat, ini } = ctx;
  const S = 'Storage controllers';
  let fdcCur = ini.get(S, 'fdc', 'internal');
  let cdCur = ini.get(S, 'cdrom_interface', 'none');
  const hdcCur = [1, 2, 3, 4].map((i) => ini.get(S, `hdc_${i}`, i === 1 ? ini.get(S, 'hdc', 'internal') : 'none'));
  const scsiCur = [1, 2, 3, 4].map((i) => ini.get(S, `scsicard_${i}`, 'none'));
  const fdc = h('select');
  const cdif = h('select');
  const hdcs = hdcCur.map(() => h('select'));
  const scsis = scsiCur.map(() => h('select'));
  const fdcCfg = btn('Configure', () => configureDevice({ catalog: cat, ini, dev: cat.find('fdc', fdc.value), pickFile: ctx.files?.pick }));
  const cdCfg = btn('Configure', () => configureDevice({ catalog: cat, ini, dev: cat.find('cdrom_interface', cdif.value), pickFile: ctx.files?.pick }));
  const hdcCfg = hdcs.map((sel, i) => btn('Configure', () => configureDevice({ catalog: cat, ini, dev: cat.find('hdc', sel.value), inst: i + 1, pickFile: ctx.files?.pick })));
  const scsiCfg = scsis.map((sel, i) => btn('Configure', () => configureDevice({ catalog: cat, ini, dev: cat.find('scsi', sel.value), inst: i + 1, pickFile: ctx.files?.pick })));
  const cassette = check('Cassette', ini.getInt(S, 'cassette_enabled', 0));

  const fill = (sel, list, cur) => {
    sel.replaceChildren(...list.map((d) => h('option', { value: d.i }, d.n)));
    sel.value = cur;
    if (sel.selectedIndex < 0) sel.selectedIndex = 0;
    sel.disabled = sel.options.length <= 1;
  };
  const refreshCfg = () => {
    fdcCfg.disabled = !cat.find('fdc', fdc.value)?.c;
    cdCfg.disabled = !cat.find('cdrom_interface', cdif.value)?.c;
    hdcs.forEach((s, i) => { hdcCfg[i].disabled = !cat.find('hdc', s.value)?.c; });
    scsis.forEach((s, i) => { scsiCfg[i].disabled = !cat.find('scsi', s.value)?.c; });
  };
  const refresh = (m) => {
    fill(fdc, cat.list('fdc', m).filter((d) => d.i !== 'internal' || cat.hasFlag(m, 'MACHINE_FDC')), fdcCur);
    fill(cdif, cat.list('cdrom_interface', m), cdCur);
    hdcs.forEach((s, i) => fill(s, cat.list('hdc', m).filter((d) => d.i !== 'internal' || (i === 0 && cat.hasFlag(m, 'MACHINE_HDC'))), hdcCur[i]));
    scsis.forEach((s, i) => fill(s, cat.list('scsi', m), scsiCur[i]));
    const hasCas = cat.hasBus(m, 'MACHINE_BUS_CASSETTE');
    cassette.input.disabled = !hasCas;
    if (!hasCas) cassette.input.checked = false;
    refreshCfg();
  };
  fdc.addEventListener('change', () => { fdcCur = fdc.value; refreshCfg(); });
  cdif.addEventListener('change', () => { cdCur = cdif.value; refreshCfg(); });
  hdcs.forEach((s, i) => s.addEventListener('change', () => { hdcCur[i] = s.value; refreshCfg(); }));
  scsis.forEach((s, i) => s.addEventListener('change', () => { scsiCur[i] = s.value; refreshCfg(); }));
  ctx.onMachineChanged(refresh);

  const el = tabWidget([
    { title: 'Storage controllers', content: h('div', null,
      h('div.form', null,
        h('label', null, 'Floppy disk controller:'), fdc, fdcCfg,
        h('label', null, 'CD-ROM controller:'), cdif, cdCfg),
      h('fieldset', null, h('legend', null, 'Hard disk controllers'),
        h('div.form', null, ...hdcs.flatMap((s, i) => [h('label', null, `Controller ${i + 1}:`), s, hdcCfg[i]]))),
      cassette) },
    { title: 'SCSI', content: h('div.form', null, ...scsis.flatMap((s, i) => [h('label', null, `Controller ${i + 1}:`), s, scsiCfg[i]])) },
  ]);
  return {
    el,
    save() {
      ini.set(S, 'fdc', fdc.value);
      ini.set(S, 'cdrom_interface', cdif.value);
      ini.delete(S, 'hdc');
      hdcs.forEach((s, i) => ini.setDefault(S, `hdc_${i + 1}`, s.value, 'none'));
      scsis.forEach((s, i) => ini.setDefault(S, `scsicard_${i + 1}`, s.value, 'none'));
      ini.setDefault(S, 'cassette_enabled', cassette.input.checked ? 1 : 0, 0);
    },
  };
}

// ---------------------------------------------------------------- Hard disks

function readHdds(ini) {
  const S = 'Hard disks';
  const out = [];
  for (let c = 0; c < HDD_NUM; c++) {
    const n = String(c + 1).padStart(2, '0');
    const p = ini.get(S, `hdd_${n}_parameters`, null);
    if (!p) continue;
    const m = /^\s*(\d+),\s*(\d+),\s*(\d+),\s*(-?\d+),\s*(\w+)/.exec(p);
    if (!m) continue;
    const bus = Object.entries(HDD_BUS_NAMES).find(([, v]) => v === m[5]);
    if (!bus) continue;
    const busId = +bus[0];
    const d = { spt: +m[1], hpc: +m[2], tracks: +m[3], wp: +m[4], bus: busId, fn: ini.get(S, `hdd_${n}_fn`, ''), speed: ini.get(S, `hdd_${n}_speed`, null) };
    if (busId === BUS.IDE || busId === BUS.ATAPI) d.chan = parseChan(ini.get(S, `hdd_${n}_ide_channel`, null), c);
    else if (busId === BUS.SCSI) {
      const loc = parseScsi(ini.get(S, `hdd_${n}_scsi_location`, null));
      d.chan = loc ? loc.bus * 16 + loc.id : (c + 2);
    } else if (busId === BUS.MFM) d.chan = ini.getInt(S, `hdd_${n}_mfm_channel`, c & 1);
    else if (busId === BUS.XTA) d.chan = ini.getInt(S, `hdd_${n}_xta_channel`, c & 1);
    else if (busId === BUS.ESDI) d.chan = ini.getInt(S, `hdd_${n}_esdi_channel`, c & 1);
    out.push(d);
  }
  return out;
}

function busChannels(bus) {
  switch (bus) {
    case BUS.MFM: case BUS.XTA: case BUS.ESDI:
      return [0, 1].map((c) => ({ v: c, t: `${c}` }));
    case BUS.IDE: case BUS.ATAPI:
      return Array.from({ length: 8 }, (_, c) => ({ v: c, t: chanStr(c) }));
    case BUS.SCSI: {
      const out = [];
      for (let b = 0; b < SCSI_BUS_MAX; b++) for (let id = 0; id < 16; id++) out.push({ v: b * 16 + id, t: scsiStr(b, id) });
      return out;
    }
    default: return [{ v: 0, t: '0' }];
  }
}

function hardDisksPage(ctx) {
  const { catalog: cat, ini } = ctx;
  const S = 'Hard disks';
  const disks = readHdds(ini);
  let selected = disks.length ? 0 : -1;
  const tbody = h('tbody');
  const table = h('table.grid', null, h('thead', null, h('tr', null, ...['Bus', 'File', 'C', 'H', 'S', 'Size', 'Model'].map((t) => h('th', null, t)))), tbody);
  const busSel = select(Object.entries(HDD_BUS_LABELS).map(([v, t]) => ({ v, t })), BUS.IDE);
  busSel.disabled = false;
  const chanSel = h('select');
  const speedSel = select(cat.hdd_presets.map(([i, n]) => ({ v: i, t: n })), '1997_5400rpm');
  speedSel.disabled = false;

  const presetName = (d) => d.speed || ((d.bus === BUS.IDE || d.bus === BUS.ESDI || d.bus === BUS.ATAPI || d.bus === BUS.SCSI) ? '1997_5400rpm' : 'ramdisk');
  const render = () => {
    tbody.replaceChildren(...disks.map((d, i) => {
      const size = d.spt * d.hpc * d.tracks * 512;
      const tr = h('tr', null,
        h('td', null, `${HDD_BUS_LABELS[d.bus]} (${d.bus === BUS.SCSI ? scsiStr(d.chan >> 4, d.chan & 15) : (d.bus === BUS.IDE || d.bus === BUS.ATAPI) ? chanStr(d.chan) : d.chan})`),
        h('td', null, d.fn.split('/').pop()),
        h('td', null, d.tracks), h('td', null, d.hpc), h('td', null, d.spt),
        h('td', null, formatSize(size)),
        h('td', null, cat.hdd_presets.find(([x]) => x === presetName(d))?.[1] || ''));
      if (i === selected) tr.classList.add('selected');
      tr.addEventListener('click', () => { selected = i; render(); });
      return tr;
    }));
    const d = disks[selected];
    [busSel, chanSel, speedSel, removeBtn].forEach((x) => { x.disabled = !d; });
    if (d) {
      busSel.value = String(d.bus);
      chanSel.replaceChildren(...busChannels(d.bus).map((o) => h('option', { value: String(o.v) }, o.t)));
      chanSel.value = String(d.chan);
      speedSel.value = presetName(d);
    }
  };
  busSel.addEventListener('change', () => {
    const d = disks[selected];
    if (!d) return;
    d.bus = +busSel.value;
    d.chan = busChannels(d.bus).find((o) => !disks.some((x) => x !== d && x.bus === d.bus && x.chan === o.v))?.v ?? 0;
    d.speed = null;
    render();
  });
  chanSel.addEventListener('change', () => { const d = disks[selected]; if (d) { d.chan = +chanSel.value; render(); } });
  speedSel.addEventListener('change', () => { const d = disks[selected]; if (d) { d.speed = speedSel.value; render(); } });

  const defaultBus = () => {
    // Prefer the bus the configured controllers offer, as Qt does.
    const m = ctx.machine;
    if (cat.hasBus(m, 'MACHINE_BUS_ISA16') || cat.hasBus(m, 'MACHINE_BUS_PCI') || cat.hasBus(m, 'MACHINE_BUS_MCA')) return BUS.IDE;
    return BUS.MFM;
  };
  const freeChan = (bus) => busChannels(bus).find((o) => !disks.some((x) => x.bus === bus && x.chan === o.v))?.v;

  const newBtn = btn('New…', async () => {
    if (disks.length >= HDD_NUM) return;
    const r = await newHardDiskDialog(cat, defaultBus());
    if (!r) return;
    const fn = await ctx.files.createDisk(r.name, r.size);
    if (!fn) return;
    disks.push({ ...r.geom, wp: 0, bus: r.bus, chan: freeChan(r.bus) ?? 0, fn, speed: null });
    selected = disks.length - 1;
    render();
  });
  const existingBtn = btn('Existing…', async () => {
    if (disks.length >= HDD_NUM) return;
    const res = await ctx.files.importDisk();
    if (!res) return;
    const geom = guessGeometry(res.size);
    const bus = defaultBus();
    disks.push({ ...geom, wp: 0, bus, chan: freeChan(bus) ?? 0, fn: res.path, speed: null });
    selected = disks.length - 1;
    render();
  });
  const removeBtn = btn('Remove', () => {
    if (selected < 0) return;
    disks.splice(selected, 1);
    selected = Math.min(selected, disks.length - 1);
    render();
  });

  const el = h('div', null,
    h('div.list-view', { style: { height: '220px' } }, table),
    h('div.form', { style: { marginTop: '8px' } },
      h('label', null, 'Bus:'), busSel, h('span'),
      h('label', null, 'Channel:'), chanSel, h('span'),
      h('label', null, 'Model:'), speedSel, h('span')),
    h('div.row', { style: { marginTop: '8px' } }, newBtn, existingBtn, removeBtn),
    h('p.muted', null, 'Disk images are stored in your browser (Origin Private File System) in this VM’s folder.'));
  render();

  return {
    el,
    validate() {
      const seen = new Set();
      for (const d of disks) {
        const k = `${d.bus === BUS.ATAPI ? BUS.IDE : d.bus}:${d.chan}`;
        if (seen.has(k)) return 'Two hard disks are attached to the same bus channel.';
        seen.add(k);
      }
      return null;
    },
    save() {
      for (let c = 0; c < HDD_NUM; c++) {
        const n = String(c + 1).padStart(2, '0');
        for (const k of ['parameters', 'fn', 'ide_channel', 'scsi_location', 'scsi_id', 'mfm_channel', 'xta_channel', 'esdi_channel', 'speed', 'vhd_blocksize', 'vhd_parent', 'audio', 'vendor', 'model', 'revision'])
          ini.delete(S, `hdd_${n}_${k}`);
      }
      disks.forEach((d, c) => {
        const n = String(c + 1).padStart(2, '0');
        ini.set(S, `hdd_${n}_parameters`, `${d.spt}, ${d.hpc}, ${d.tracks}, ${d.wp}, ${HDD_BUS_NAMES[d.bus]}`);
        ini.set(S, `hdd_${n}_fn`, d.fn);
        if (d.bus === BUS.IDE || d.bus === BUS.ATAPI) ini.set(S, `hdd_${n}_ide_channel`, chanStr(d.chan));
        else if (d.bus === BUS.SCSI) ini.set(S, `hdd_${n}_scsi_location`, scsiStr(d.chan >> 4, d.chan & 15));
        else if (d.bus === BUS.MFM) ini.set(S, `hdd_${n}_mfm_channel`, d.chan);
        else if (d.bus === BUS.XTA) ini.set(S, `hdd_${n}_xta_channel`, d.chan);
        else if (d.bus === BUS.ESDI) ini.set(S, `hdd_${n}_esdi_channel`, d.chan);
        if (d.speed) ini.set(S, `hdd_${n}_speed`, d.speed);
      });
    },
  };
}

// CHS for a raw image of `size` bytes (LBA-style 16 heads, 63 sectors).
export function guessGeometry(size) {
  const sectors = Math.floor(size / 512);
  let spt = 63;
  let hpc = 16;
  if (sectors < 63 * 16 * 2) { spt = 17; hpc = 4; }
  const tracks = Math.max(1, Math.floor(sectors / (spt * hpc)));
  return { spt, hpc, tracks };
}

async function newHardDiskDialog(cat, bus) {
  const name = h('input', { type: 'text', value: 'hdd.img' });
  const busSel = select(Object.entries(HDD_BUS_LABELS).map(([v, t]) => ({ v, t })), bus);
  busSel.disabled = false;
  const typeSel = select([{ v: -1, t: 'Custom' }, ...cat.hdd_table.map(([t, h2, s], i) => ({ v: i, t: `${formatSize(t * h2 * s * 512)} (${t}/${h2}/${s})` }))], -1);
  typeSel.disabled = false;
  const cyl = h('input', { type: 'number', min: 1, max: 266305, value: 1024 });
  const heads = h('input', { type: 'number', min: 1, max: 255, value: 16 });
  const spt = h('input', { type: 'number', min: 1, max: 255, value: 63 });
  const sizeMB = h('input', { type: 'number', min: 1, max: 131072, value: 504 });
  const fromChs = () => { sizeMB.value = String(Math.floor((+cyl.value * +heads.value * +spt.value * 512) / (1024 * 1024))); };
  const fromSize = () => {
    const g = guessGeometry(+sizeMB.value * 1024 * 1024);
    cyl.value = g.tracks; heads.value = g.hpc; spt.value = g.spt;
  };
  [cyl, heads, spt].forEach((x) => x.addEventListener('input', () => { typeSel.value = '-1'; fromChs(); }));
  sizeMB.addEventListener('input', () => { typeSel.value = '-1'; fromSize(); });
  typeSel.addEventListener('change', () => {
    const i = +typeSel.value;
    if (i < 0) return;
    const [t, hh, s] = cat.hdd_table[i];
    cyl.value = t; heads.value = hh; spt.value = s;
    fromChs();
  });
  const ok = await dialog({
    title: 'Add Hard Disk',
    icon: 'hard_disk',
    width: '520px',
    body: h('div.form', null,
      h('label', null, 'File name:'), h('div.span2', null, name),
      h('label', null, 'Type:'), h('div.span2', null, typeSel),
      h('label', null, 'Cylinders:'), h('div.span2', null, cyl),
      h('label', null, 'Heads:'), h('div.span2', null, heads),
      h('label', null, 'Sectors:'), h('div.span2', null, spt),
      h('label', null, 'Size (MB):'), h('div.span2', null, sizeMB),
      h('label', null, 'Bus:'), h('div.span2', null, busSel),
      h('div.full.muted', null, 'A raw image (.img) is created in browser storage.')),
    buttons: [{ label: 'OK', value: true, default: true }, { label: 'Cancel', value: false }],
  });
  if (!ok) return null;
  const geom = { tracks: Math.max(1, +cyl.value | 0), hpc: Math.max(1, +heads.value | 0), spt: Math.max(1, +spt.value | 0) };
  let fname = name.value.trim() || 'hdd.img';
  if (!/\.[a-z0-9]+$/i.test(fname)) fname += '.img';
  return { name: fname, size: geom.tracks * geom.hpc * geom.spt * 512, geom, bus: +busSel.value };
}

// ---------------------------------------------------------------- Floppy & CD-ROM

function floppyCdPage(ctx) {
  const { catalog: cat, ini } = ctx;
  const S = 'Floppy and CD-ROM drives';
  const fdds = Array.from({ length: FDD_NUM }, (_, c) => {
    const n = String(c + 1).padStart(2, '0');
    return { n, type: ini.get(S, `fdd_${n}_type`, c < 2 ? '525_2dd' : 'none'), turbo: ini.getInt(S, `fdd_${n}_turbo`, 0), bpb: ini.getInt(S, `fdd_${n}_check_bpb`, 1) };
  });
  const cds = Array.from({ length: CDROM_NUM }, (_, c) => {
    const n = String(c + 1).padStart(2, '0');
    const p = ini.get(S, `cdrom_${n}_parameters`, c === 0 ? '1, none' : '0, none');
    const m = /^(\d+),\s*(\w+)/.exec(p) || [null, '0', 'none'];
    const busName = m[2];
    const bus = +(Object.entries(CD_BUS_NAMES).find(([, v]) => v === busName)?.[0] ?? 0);
    const d = { n, sound: +m[1], bus, speed: ini.getInt(S, `cdrom_${n}_speed`, 8), type: ini.get(S, `cdrom_${n}_type`, null), noCheck: ini.getInt(S, `cdrom_${n}_no_check`, 0) };
    if (bus === CD_BUS.ATAPI) d.chan = parseChan(ini.get(S, `cdrom_${n}_ide_channel`, null), c & 3);
    else if (bus === CD_BUS.SCSI) { const loc = parseScsi(ini.get(S, `cdrom_${n}_scsi_location`, null)); d.chan = loc ? loc.bus * 16 + loc.id : (c & 3); }
    else d.chan = 0;
    return d;
  });

  // Floppy table
  let fsel = 0;
  const ftbody = h('tbody');
  const ftype = select(cat.fdd_types.map(([i, n]) => ({ v: i, t: n })), 'none');
  ftype.disabled = false;
  const fturbo = check('Turbo timings', 0);
  const fbpb = check('Check BPB', 1);
  const fname = (i) => cat.fdd_types.find(([x]) => x === i)?.[1] || i;
  const renderF = () => {
    ftbody.replaceChildren(...fdds.map((d, i) => {
      const tr = h('tr', null, h('td', null, `${i + 1}`), h('td', null, fname(d.type)), h('td', null, d.turbo ? 'On' : 'Off'), h('td', null, d.bpb ? 'On' : 'Off'));
      if (i === fsel) tr.classList.add('selected');
      tr.addEventListener('click', () => { fsel = i; renderF(); });
      return tr;
    }));
    const d = fdds[fsel];
    ftype.value = d.type;
    fturbo.input.checked = !!d.turbo;
    fbpb.input.checked = !!d.bpb;
  };
  ftype.addEventListener('change', () => { fdds[fsel].type = ftype.value; renderF(); });
  fturbo.input.addEventListener('change', () => { fdds[fsel].turbo = fturbo.input.checked ? 1 : 0; renderF(); });
  fbpb.input.addEventListener('change', () => { fdds[fsel].bpb = fbpb.input.checked ? 1 : 0; renderF(); });

  // CD-ROM table
  let csel = 0;
  const ctbody = h('tbody');
  const cbus = h('select');
  const cchan = h('select');
  const cspeed = select(Array.from({ length: 72 }, (_, i) => ({ v: i + 1, t: `${i + 1}x` })), 8);
  cspeed.disabled = false;
  const ctype = h('select');
  const cecc = check('Use EDC/ECC emulation', 1);
  const cdChannels = (bus) => {
    if (bus === CD_BUS.ATAPI) return Array.from({ length: 8 }, (_, c) => ({ v: c, t: chanStr(c) }));
    if (bus === CD_BUS.SCSI) return busChannels(BUS.SCSI);
    if (bus === CD_BUS.MKE || bus === CD_BUS.HITACHI) return [0, 1, 2, 3].map((c) => ({ v: c, t: `${c}` }));
    return [{ v: 0, t: '0' }];
  };
  // Drive models for a bus, as in SettingsFloppyCDROM (BUS_TYPE_BOTH = -2).
  const typesFor = (bus) => cat.cdrom_types.filter(([, , b]) => b === bus
    || (b === CD_BUS.ATAPI && bus === CD_BUS.LPT)
    || (b === -2 && ![CD_BUS.MKE, CD_BUS.HITACHI, CD_BUS.PHILIPS, CD_BUS.CM100, CD_BUS.SONY].includes(bus)));
  const renderC = () => {
    ctbody.replaceChildren(...cds.map((d, i) => {
      const t = d.bus ? (cat.cdrom_types.find(([x]) => x === d.type)?.[1] || d.type || '') : '';
      const tr = h('tr', null,
        h('td', null, `${CD_BUS_LABELS[d.bus] || 'Disabled'}${d.bus === CD_BUS.ATAPI ? ` (${chanStr(d.chan)})` : d.bus === CD_BUS.SCSI ? ` (${scsiStr(d.chan >> 4, d.chan & 15)})` : ''}`),
        h('td', null, d.bus ? `${d.speed}x` : ''), h('td', null, t));
      if (i === csel) tr.classList.add('selected');
      tr.addEventListener('click', () => { csel = i; renderC(); });
      return tr;
    }));
    const d = cds[csel];
    cbus.value = String(d.bus);
    cchan.replaceChildren(...cdChannels(d.bus).map((o) => h('option', { value: String(o.v) }, o.t)));
    cchan.value = String(d.chan);
    cchan.disabled = !d.bus;
    cspeed.value = String(d.speed);
    cspeed.disabled = !d.bus;
    const types = typesFor(d.bus);
    ctype.replaceChildren(...types.map(([i, n]) => h('option', { value: i }, n)));
    if (d.bus && !types.some(([i]) => i === d.type)) d.type = types[0]?.[0] || null;
    ctype.value = d.type || '';
    ctype.disabled = !d.bus || types.length <= 1;
    cecc.input.checked = !d.noCheck;
    cecc.input.disabled = !d.bus;
  };
  const refreshBuses = (m) => {
    const opts = [{ v: CD_BUS.DISABLED, t: 'Disabled' }, { v: CD_BUS.ATAPI, t: 'ATAPI' }, { v: CD_BUS.SCSI, t: 'SCSI' }];
    if (cat.hasBus(m, 'MACHINE_BUS_ISA')) {
      for (const b of [CD_BUS.MITSUMI, CD_BUS.MKE, CD_BUS.SONY, CD_BUS.PHILIPS, CD_BUS.HITACHI]) opts.push({ v: b, t: CD_BUS_LABELS[b] });
    }
    cbus.replaceChildren(...opts.map((o) => h('option', { value: String(o.v) }, o.t)));
    renderC();
  };
  cbus.addEventListener('change', () => {
    const d = cds[csel];
    d.bus = +cbus.value;
    d.chan = cdChannels(d.bus).find((o) => !cds.some((x) => x !== d && x.bus === d.bus && x.chan === o.v))?.v ?? 0;
    d.type = null;
    renderC();
  });
  cchan.addEventListener('change', () => { cds[csel].chan = +cchan.value; renderC(); });
  cspeed.addEventListener('change', () => { cds[csel].speed = +cspeed.value; renderC(); });
  ctype.addEventListener('change', () => { cds[csel].type = ctype.value; renderC(); });
  cecc.input.addEventListener('change', () => { cds[csel].noCheck = cecc.input.checked ? 0 : 1; });
  ctx.onMachineChanged(refreshBuses);
  renderF();

  const el = tabWidget([
    { title: 'Floppy drives', content: h('div', null,
      h('div.list-view', { style: { height: '140px' } }, h('table.grid', null, h('thead', null, h('tr', null, ...['Drive', 'Type', 'Turbo timings', 'Check BPB'].map((t) => h('th', null, t)))), ftbody)),
      h('div.form', { style: { marginTop: '8px' } }, h('label', null, 'Type:'), h('div.span2', null, ftype)),
      h('div.row', { style: { marginTop: '6px' } }, fturbo, fbpb)) },
    { title: 'CD-ROM drives', content: h('div', null,
      h('div.list-view', { style: { height: '140px' } }, h('table.grid', null, h('thead', null, h('tr', null, ...['Bus', 'Speed', 'Type'].map((t) => h('th', null, t)))), ctbody)),
      h('div.form', { style: { marginTop: '8px' } },
        h('label', null, 'Bus:'), cbus, h('span'),
        h('label', null, 'Channel:'), cchan, h('span'),
        h('label', null, 'Speed:'), cspeed, h('span'),
        h('label', null, 'Type:'), ctype, h('span')),
      h('div', { style: { marginTop: '6px' } }, cecc)) },
  ]);
  [cbus, cchan, ctype].forEach((x) => { x.disabled = false; });

  return {
    el,
    save() {
      fdds.forEach((d, c) => {
        ini.setDefault(S, `fdd_${d.n}_type`, d.type, c < 2 ? '525_2dd' : 'none');
        ini.setDefault(S, `fdd_${d.n}_turbo`, d.turbo, 0);
        ini.setDefault(S, `fdd_${d.n}_check_bpb`, d.bpb, 1);
      });
      cds.forEach((d) => {
        for (const k of ['ide_channel', 'scsi_location', 'scsi_id', 'mke_channel', 'hitachi_channel', 'lpt_port'])
          ini.delete(S, `cdrom_${d.n}_${k}`);
        ini.set(S, `cdrom_${d.n}_parameters`, `${d.sound}, ${CD_BUS_NAMES[d.bus] || 'none'}`);
        if (!d.bus) {
          ini.delete(S, `cdrom_${d.n}_type`);
          ini.delete(S, `cdrom_${d.n}_speed`);
          return;
        }
        ini.setDefault(S, `cdrom_${d.n}_speed`, d.speed, 8);
        if (d.type) ini.set(S, `cdrom_${d.n}_type`, d.type);
        ini.setDefault(S, `cdrom_${d.n}_no_check`, d.noCheck, 0);
        if (d.bus === CD_BUS.ATAPI) ini.set(S, `cdrom_${d.n}_ide_channel`, chanStr(d.chan));
        else if (d.bus === CD_BUS.SCSI) ini.set(S, `cdrom_${d.n}_scsi_location`, scsiStr(d.chan >> 4, d.chan & 15));
        else if (d.bus === CD_BUS.MKE) ini.set(S, `cdrom_${d.n}_mke_channel`, d.chan);
        else if (d.bus === CD_BUS.HITACHI) ini.set(S, `cdrom_${d.n}_hitachi_channel`, d.chan);
      });
    },
  };
}

// ---------------------------------------------------------------- Other removable

function otherRemovablePage(ctx) {
  const { ini } = ctx;
  const S = 'Other removable devices';
  // ZIP / MO drives: bus selection only (ATAPI or SCSI), like Qt.
  const mk = (prefix, label, count) => Array.from({ length: count }, (_, c) => {
    const n = String(c + 1).padStart(2, '0');
    const p = ini.get(S, `${prefix}_${n}_parameters`, '0, none');
    const m = /^(\d+),\s*(\w+)/.exec(p) || [null, '0', 'none'];
    const sel = select([{ v: 'none', t: 'Disabled' }, { v: 'atapi', t: 'ATAPI' }, { v: 'scsi', t: 'SCSI' }], m[2]);
    sel.disabled = false;
    const chan = h('select');
    const fillChan = () => {
      const opts = sel.value === 'atapi' ? busChannels(BUS.IDE) : sel.value === 'scsi' ? busChannels(BUS.SCSI) : [];
      chan.replaceChildren(...opts.map((o) => h('option', { value: String(o.v) }, o.t)));
      chan.disabled = !opts.length;
    };
    fillChan();
    if (m[2] === 'atapi') chan.value = String(parseChan(ini.get(S, `${prefix}_${n}_ide_channel`, null), 2 + c));
    if (m[2] === 'scsi') { const loc = parseScsi(ini.get(S, `${prefix}_${n}_scsi_location`, null)); chan.value = String(loc ? loc.bus * 16 + loc.id : 4 + c); }
    sel.addEventListener('change', fillChan);
    return { prefix, n, type: m[1], sel, chan, label: `${label} ${c + 1}` };
  });
  const rdisks = mk('rdisk', 'ZIP drive', 4);
  const mos = mk('mo', 'MO drive', 4);
  const rows = (list) => h('div.form', null, ...list.flatMap((d) => [h('label', null, `${d.label}:`), d.sel, d.chan]));
  const el = tabWidget([
    { title: 'ZIP drives', content: rows(rdisks) },
    { title: 'MO drives', content: rows(mos) },
  ]);
  return {
    el,
    save() {
      for (const d of [...rdisks, ...mos]) {
        for (const k of ['parameters', 'ide_channel', 'scsi_location', 'scsi_id']) ini.delete(S, `${d.prefix}_${d.n}_${k}`);
        if (d.sel.value === 'none') continue;
        ini.set(S, `${d.prefix}_${d.n}_parameters`, `${d.type || 0}, ${d.sel.value}`);
        const ch = +d.chan.value;
        if (d.sel.value === 'atapi') ini.set(S, `${d.prefix}_${d.n}_ide_channel`, chanStr(ch));
        else ini.set(S, `${d.prefix}_${d.n}_scsi_location`, scsiStr(ch >> 4, ch & 15));
      }
    },
  };
}

// ---------------------------------------------------------------- Other peripherals

function otherPeripheralsPage(ctx) {
  const { catalog: cat, ini } = ctx;
  const S = 'Other peripherals';
  let rtcCur = ini.get(S, 'isartc_type', 'none');
  const rtc = h('select');
  const rtcCfg = btn('Configure', () => configureDevice({ catalog: cat, ini, dev: cat.find('isartc', rtc.value), pickFile: ctx.files?.pick }));
  const flag = (key, label, extraKey) => {
    const c = check(label, ini.getInt(S, key, 0));
    const b = extraKey ? btn('Configure', () => configureDevice({ catalog: cat, ini, dev: cat.extra[extraKey][0], pickFile: ctx.files?.pick })) : null;
    if (b) { b.disabled = !c.input.checked; c.input.addEventListener('change', () => { b.disabled = !c.input.checked; }); }
    return { key, c, b };
  };
  const flags = [
    flag('bugger_enabled', 'ISABugger device'),
    flag('postcard_enabled', 'POST card'),
    flag('unittester_enabled', '86Box Unit Tester', 'unittester'),
    flag('novell_keycard_enabled', 'Novell NetWare 2.x Key Card', 'novell_keycard'),
    flag('softpower_enabled', 'Software-initiated poweroff device (IBM 5140)', 'softpower'),
  ];
  const memCur = [0, 1, 2, 3].map((c) => ini.get(S, `isamem${c}_type`, 'none'));
  const romCur = [0, 1, 2, 3].map((c) => ini.get(S, `isarom${c}_type`, 'none'));
  const mems = memCur.map(() => h('select'));
  const roms = romCur.map(() => h('select'));
  const memCfg = mems.map((s, i) => btn('Configure', () => configureDevice({ catalog: cat, ini, dev: cat.find(cat.hasBus(ctx.machine, 'MACHINE_BUS_MCA') ? 'mcamem' : 'isamem', s.value), inst: i + 1, pickFile: ctx.files?.pick })));
  const romCfg = roms.map((s, i) => btn('Configure', () => configureDevice({ catalog: cat, ini, dev: cat.find('isarom', s.value), inst: i + 1, pickFile: ctx.files?.pick })));
  let mca = false;
  const fill = (sel, list, cur) => {
    sel.replaceChildren(...list.map((d) => h('option', { value: d.i }, d.n)));
    sel.value = cur;
    if (sel.selectedIndex < 0) sel.selectedIndex = 0;
    sel.disabled = sel.options.length <= 1;
  };
  const refreshCfg = () => {
    rtcCfg.disabled = !cat.find('isartc', rtc.value)?.c;
    mems.forEach((s, i) => { memCfg[i].disabled = !cat.find(mca ? 'mcamem' : 'isamem', s.value)?.c; });
    roms.forEach((s, i) => { romCfg[i].disabled = !cat.find('isarom', s.value)?.c; });
  };
  const refresh = (m) => {
    mca = cat.hasBus(m, 'MACHINE_BUS_MCA');
    const isa = cat.hasBus(m, 'MACHINE_BUS_ISA');
    fill(rtc, cat.list('isartc', m), rtcCur);
    rtc.disabled = !isa || rtc.options.length <= 1;
    mems.forEach((s, i) => fill(s, cat.list(mca ? 'mcamem' : 'isamem', m), memCur[i]));
    roms.forEach((s, i) => fill(s, cat.list('isarom', m), romCur[i]));
    const bugger = flags[0].c.input;
    bugger.disabled = !isa;
    refreshCfg();
  };
  rtc.addEventListener('change', () => { rtcCur = rtc.value; refreshCfg(); });
  mems.forEach((s, i) => s.addEventListener('change', () => { memCur[i] = s.value; refreshCfg(); }));
  roms.forEach((s, i) => s.addEventListener('change', () => { romCur[i] = s.value; refreshCfg(); }));
  ctx.onMachineChanged(refresh);

  const el = tabWidget([
    { title: 'Other peripherals', content: h('div', null,
      h('div.form', null, h('label', null, 'ISA RTC:'), rtc, rtcCfg),
      h('div.form', { style: { marginTop: '8px' } }, ...flags.flatMap((f) => [h('div.span2', null, f.c), f.b || h('span')]))) },
    { title: 'ISA memory expansion', content: h('div.form', null, ...mems.flatMap((s, i) => [h('label', null, `Card ${i + 1}:`), s, memCfg[i]])) },
    { title: 'ISA ROM cards', content: h('div.form', null, ...roms.flatMap((s, i) => [h('label', null, `Card ${i + 1}:`), s, romCfg[i]])) },
  ]);
  return {
    el,
    save() {
      ini.setDefault(S, 'isartc_type', rtc.value, 'none');
      for (const f of flags) ini.setDefault(S, f.key, f.c.input.checked ? 1 : 0, 0);
      mems.forEach((s, i) => {
        ini.delete(S, `isamem${i}_type`);
        ini.delete(S, `mcamem${i}_type`);
        if (s.value !== 'none') ini.set(S, `${mca ? 'mcamem' : 'isamem'}${i}_type`, s.value);
      });
      roms.forEach((s, i) => ini.setDefault(S, `isarom${i}_type`, s.value, 'none'));
    },
  };
}
