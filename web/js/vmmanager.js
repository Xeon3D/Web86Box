// Web86Box - VM manager: the start screen, modeled on 86Box's Qt VM manager
// (list of machines on the left, details on the right, toolbar on top).

import { h, icon, dialog, messageBox, confirm, prompt, pickFiles, downloadBlob, formatSize } from './ui.js';
import { Ini } from './ini.js';
import * as storage from './storage.js';
import { VMFiles, manageFilesDialog } from './files.js';
import { openSettings } from './settings.js';
import { showAbout } from './about.js';

const NAME_RE = /^[^/\\:*?"<>|\u0000-\u001f]{1,64}$/;
const LAST_KEY = 'web86box.lastVM';

export class VMManager {
  constructor({ root, catalog, onStart }) {
    this.root = root;
    this.catalog = catalog;
    this.onStart = onStart;
    this.vms = [];
    this.selected = null;
  }

  async show() {
    document.title = '86Box VM Manager';
    this.list = h('div.list-view.vmm-list');
    this.details = h('div.vmm-details');
    const tb = (iconName, label, action, id) => {
      const b = h('button.tool-button.text', { type: 'button', title: label, onclick: action }, icon(iconName), label);
      if (id) this[id] = b;
      return b;
    };
    this.toolbar = h('div.toolbar.vmm-toolbar', null,
      tb('new_vm', 'Add', () => this.addVM()),
      h('div.toolbar-sep'),
      tb('run', 'Start', () => this.start(), 'btnStart'),
      tb('settings', 'Settings', () => this.settings(), 'btnSettings'),
      h('div.toolbar-sep'),
      tb('browse', 'Files', () => this.manageFiles(), 'btnFiles'),
      tb('export', 'Export', () => this.exportVM(), 'btnExport'),
      tb('cdrom_folder', 'Import', () => this.importVM()),
      h('div.toolbar-sep'),
      tb('acpi_shutdown', 'Delete', () => this.deleteVM(), 'btnDelete'),
      h('div', { style: { flex: 1 } }),
      tb('emulator', 'About', () => showAbout(this.catalog)));
    this.root.replaceChildren(h('div.vmm', null, this.toolbar, h('div.vmm-main', null, this.list, this.details)));
    await this.refresh(localStorage.getItem(LAST_KEY));
  }

  async refresh(select) {
    this.vms = await storage.listVMs();
    if (select !== undefined) this.selected = this.vms.find((v) => v.name === select) || null;
    else if (this.selected) this.selected = this.vms.find((v) => v.name === this.selected.name) || null;
    if (!this.selected && this.vms.length) this.selected = this.vms[0];
    this.renderList();
    this.renderDetails();
  }

  summary(vm) {
    const ini = new Ini(vm.cfg || '');
    const cat = this.catalog;
    const m = cat.machine(ini.get('Machine', 'machine', '')) || cat.machines[0];
    const famIdx = cat.cpuFamily(ini.get('Machine', 'cpu_family', ''));
    const fam = famIdx >= 0 ? cat.cpu_families[famIdx] : null;
    const speed = ini.getInt('Machine', 'cpu_speed', 0);
    const cpu = fam ? `${fam.m} ${fam.n}${speed ? ` @ ${(speed / 1e6).toFixed(speed % 1e6 ? 2 : 0)} MHz` : ''}` : '';
    const mem = ini.getInt('Machine', 'mem_size', 0);
    const memStr = mem >= 1024 ? `${mem / 1024} MB` : `${mem} KB`;
    const devName = (key, internal) => (internal === 'internal' ? 'Internal' : cat.find(key, internal)?.n || internal);
    return { ini, m, cpu, memStr, devName };
  }

  renderList() {
    this.list.replaceChildren();
    if (!this.vms.length) {
      this.list.append(h('div.muted', { style: { padding: '12px' } }, 'No virtual machines yet.'));
    }
    for (const vm of this.vms) {
      const { m } = this.summary(vm);
      const item = h('div.list-item', null,
        h('img', { src: vmIcon(vm), alt: '', style: { width: '32px', height: '32px' } }),
        h('div', null, h('div.name', null, vm.name), h('div.sub', null, m?.n || '')));
      if (vm === this.selected) item.classList.add('selected');
      item.addEventListener('click', () => { this.selected = vm; this.renderList(); this.renderDetails(); });
      item.addEventListener('dblclick', () => { this.selected = vm; this.start(); });
      this.list.append(item);
    }
    const has = !!this.selected;
    for (const b of [this.btnStart, this.btnSettings, this.btnFiles, this.btnExport, this.btnDelete]) b.disabled = !has;
  }

  renderDetails() {
    const vm = this.selected;
    if (!vm) {
      this.details.replaceChildren(h('div.vmm-empty', null, h('div', null,
        h('img', { src: 'icons/86Box-yellow.ico', alt: '', style: { width: '64px', height: '64px' } }),
        h('h2', { style: { justifyContent: 'center' } }, 'Welcome to 86Box'),
        h('p', null, 'Click “Add” to create a new virtual machine.'),
        h('p.muted', null, 'Everything runs locally in your browser. Machines and disk images are kept in this browser’s private storage.'),
        h('button.btn.default', { type: 'button', onclick: () => this.addVM() }, 'Add a new machine…'))));
      return;
    }
    const { ini, m, cpu, memStr, devName } = this.summary(vm);
    const sec = (iconName, title, rows) => h('div.section', null,
      h('h3', null, icon(iconName), title),
      h('dl', null, ...rows.filter(Boolean).flatMap(([k, v]) => [h('dt', null, k), h('dd', null, v || '—')])));
    const disks = [];
    for (let i = 1; i <= 8; i++) {
      const n = String(i).padStart(2, '0');
      const p = ini.get('Hard disks', `hdd_${n}_parameters`, null);
      const mm = p && /^(\d+),\s*(\d+),\s*(\d+),\s*\d+,\s*(\w+)/.exec(p);
      if (mm) disks.push([`Disk ${i}`, `${formatSize(mm[1] * mm[2] * mm[3] * 512)} (${mm[4].toUpperCase()}) ${ini.get('Hard disks', `hdd_${n}_fn`, '').split('/').pop()}`]);
    }
    const F = 'Floppy and CD-ROM drives';
    const fdds = [];
    for (let i = 1; i <= 4; i++) {
      const t = ini.get(F, `fdd_${String(i).padStart(2, '0')}_type`, i <= 2 ? '525_2dd' : 'none');
      if (t !== 'none') fdds.push(this.catalog.fdd_types.find(([x]) => x === t)?.[1] || t);
    }
    const cds = [];
    for (let i = 1; i <= 8; i++) {
      const p = ini.get(F, `cdrom_${String(i).padStart(2, '0')}_parameters`, i === 1 ? '1, none' : '0, none');
      const mm = /,\s*(\w+)/.exec(p);
      if (mm && mm[1] !== 'none') cds.push(mm[1].toUpperCase());
    }
    const snd = ['sndcard', 'sndcard2', 'sndcard3', 'sndcard4'].map((k) => ini.get('Sound', k, 'none')).filter((x) => x !== 'none');
    const net = [1, 2, 3, 4].map((i) => ini.get('Network', `net_0${i}_card`, 'none')).filter((x) => x !== 'none');

    this.details.replaceChildren(
      h('h2', null, h('img', { src: vmIcon(vm), alt: '', style: { width: '40px', height: '40px' } }), vm.name),
      sec('machine', 'System', [['Machine', m?.n], ['CPU', cpu], ['Memory', memStr]]),
      sec('display', 'Display', [['Video', devName('video', ini.get('Video', 'gfxcard', this.catalog.hasFlag(m, 'MACHINE_VIDEO') ? 'internal' : 'none'))]]),
      sec('storage_controllers', 'Storage', [...disks, ['Floppy drives', fdds.join(', ') || 'None'], ['CD-ROM drives', cds.join(', ') || 'None']]),
      sec('sound', 'Audio', [['Sound cards', snd.map((s) => devName('sound', s)).join(', ') || 'None'], ['MIDI out', devName('midi_out', ini.get('Sound', 'midi_device', 'none'))]]),
      sec('network', 'Network', [['Network cards', net.map((s) => devName('network', s)).join(', ') || 'None']]),
      sec('input_devices', 'Input', [['Keyboard', devName('keyboard', ini.get('Input devices', 'keyboard_type', 'internal'))], ['Mouse', devName('mouse', ini.get('Input devices', 'mouse_type', 'none'))]]),
      h('div.row', { style: { marginTop: '6px' } },
        h('button.btn.default', { type: 'button', onclick: () => this.start() }, '▶ Start'),
        h('button.btn', { type: 'button', onclick: () => this.settings() }, 'Settings…'),
        h('button.btn', { type: 'button', onclick: () => this.rename() }, 'Rename…'),
        h('button.btn', { type: 'button', onclick: () => this.chooseIcon() }, 'Change icon…')));
  }

  // -------------------------------------------------------------- actions

  validateName(name, except) {
    if (!NAME_RE.test(name) || name.trim() !== name || name === '.' || name === '..') return 'Enter a name without / \\ : * ? " < > |';
    if (this.vms.some((v) => v.name.toLowerCase() === name.toLowerCase() && v.name !== except)) return 'A machine with this name already exists.';
    return null;
  }

  async addVM() {
    let n = 1;
    while (this.vms.some((v) => v.name === `Machine ${n}`)) n++;
    const name = await prompt('Machine name:', `Machine ${n}`, { title: 'Add new machine', validate: (v) => this.validateName(v) });
    if (!name) return;
    const ini = new Ini(defaultConfig(this.catalog));
    const files = new VMFiles(name);
    await storage.createVM(name, ini.toString());
    const result = await openSettings({ catalog: this.catalog, ini, vm: name, files: files.settingsHelper(), newVM: true });
    if (!result) {
      // Cancelled: remove the VM, unless the user created files for it.
      const left = await files.list().catch(() => []);
      if (!left.length) await storage.deleteVM(name).catch(() => {});
      await this.refresh();
      return;
    }
    await storage.writeFile(`vms/${name}/86box.cfg`, result.toString());
    await this.refresh(name);
  }

  async settings() {
    const vm = this.selected;
    if (!vm) return;
    const ini = new Ini(vm.cfg || '');
    const result = await openSettings({ catalog: this.catalog, ini, vm: vm.name, files: new VMFiles(vm.name).settingsHelper() });
    if (!result) return;
    await storage.writeFile(`vms/${vm.name}/86box.cfg`, result.toString());
    await this.refresh(vm.name);
  }

  async rename() {
    const vm = this.selected;
    if (!vm) return;
    const name = await prompt('New name:', vm.name, { title: 'Rename', validate: (v) => (v === vm.name ? null : this.validateName(v, vm.name)) });
    if (!name || name === vm.name) return;
    const pd = (await import('./ui.js')).progressDialog('Renaming', 'Copying the machine’s files…');
    try {
      await storage.renameVM(vm.name, name);
      // Absolute paths inside the VM folder must follow the rename.
      const cfg = await storage.readText(`vms/${name}/86box.cfg`);
      await storage.writeFile(`vms/${name}/86box.cfg`, cfg.split(storage.vmPath(vm.name)).join(storage.vmPath(name)));
      moveIcon(vm.name, name);
    } catch (e) {
      await messageBox({ kind: 'error', text: `Could not rename the machine.\n\n${e}` });
    } finally {
      pd.close();
    }
    await this.refresh(name);
  }

  async chooseIcon() {
    const vm = this.selected;
    if (!vm) return;
    const names = ['86Box-gray', '86Box-yellow', '86Box-green', '86Box-red'];
    let chosen = null;
    const grid = h('div', { style: { display: 'flex', flexWrap: 'wrap', gap: '6px' } });
    const systemIcons = await fetch('icons/systemicons.json').then((r) => (r.ok ? r.json() : [])).catch(() => []);
    const all = [...names.map((n) => `icons/${n}.ico`), ...systemIcons.map((n) => `icons/systemicons/${n}`)];
    for (const src of all) {
      const b = h('button.tool-button', { type: 'button', style: { width: '44px', height: '44px' } }, h('img', { src, alt: '', style: { width: '32px', height: '32px' } }));
      b.addEventListener('click', () => { grid.querySelectorAll('.checked').forEach((x) => x.classList.remove('checked')); b.classList.add('checked'); chosen = src; });
      grid.append(b);
    }
    const ok = await dialog({ title: 'Change icon', width: '560px', body: h('div.list-view', { style: { maxHeight: '360px', padding: '6px' } }, grid), buttons: [{ label: 'OK', value: true, default: true }, { label: 'Cancel', value: false }] });
    if (ok && chosen) {
      const icons = JSON.parse(localStorage.getItem('web86box.icons') || '{}');
      icons[vm.name] = chosen;
      localStorage.setItem('web86box.icons', JSON.stringify(icons));
      this.renderList();
      this.renderDetails();
    }
  }

  async manageFiles() {
    if (!this.selected) return;
    await manageFilesDialog(new VMFiles(this.selected.name));
  }

  async deleteVM() {
    const vm = this.selected;
    if (!vm) return;
    if (!(await confirm(`Are you sure you want to delete the virtual machine “${vm.name}” and all its files?\n\nThis cannot be undone.`, { yes: 'Delete', no: 'Cancel' }))) return;
    await storage.deleteVM(vm.name);
    this.selected = null;
    await this.refresh();
  }

  // Export: the configuration file (disk images can be downloaded from Files).
  async exportVM() {
    const vm = this.selected;
    if (!vm) return;
    downloadBlob(new Blob([vm.cfg || ''], { type: 'text/plain' }), `${vm.name}.cfg`);
  }

  // Import an 86Box configuration file (and optionally the images it uses).
  async importVM() {
    const files = await pickFiles({ accept: '.cfg', multiple: false });
    if (!files.length) return;
    const text = await files[0].text();
    const base = files[0].name.replace(/\.cfg$/i, '').replace(/^86box$/i, 'Imported machine');
    let name = base;
    for (let i = 2; this.vms.some((v) => v.name === name); i++) name = `${base} (${i})`;
    name = await prompt('Machine name:', name, { title: 'Import machine', validate: (v) => this.validateName(v) });
    if (!name) return;
    // Image paths from another computer will not exist here; keep only the
    // file names so images imported into the VM folder are found.
    const ini = new Ini(text);
    for (const [sec, map] of ini.sections) {
      for (const [k, v] of map) {
        if (/(_fn|_image_path|_file)$/.test(k) && v) map.set(k, v.split(/[\\/]/).pop());
        if (/_image_history_/.test(k)) map.delete(k);
      }
    }
    await storage.createVM(name, ini.toString());
    await this.refresh(name);
    await messageBox({ kind: 'info', text: 'Machine imported. Use “Files” to add its disk images (keeping their original file names).' });
  }

  start() {
    const vm = this.selected;
    if (!vm) return;
    localStorage.setItem(LAST_KEY, vm.name);
    this.onStart(vm.name);
  }
}

function vmIcon(vm) {
  try {
    const icons = JSON.parse(localStorage.getItem('web86box.icons') || '{}');
    if (icons[vm.name]) return icons[vm.name];
  } catch (e) { /* ignore */ }
  return 'icons/86Box-gray.ico';
}

function moveIcon(from, to) {
  try {
    const icons = JSON.parse(localStorage.getItem('web86box.icons') || '{}');
    if (icons[from]) { icons[to] = icons[from]; delete icons[from]; localStorage.setItem('web86box.icons', JSON.stringify(icons)); }
  } catch (e) { /* ignore */ }
}

// A reasonable starting point for new machines (the Settings dialog opens
// right away so the user can change everything).
function defaultConfig(catalog) {
  const want = ['ibmat', 'ibmxt', 'ibmpc'];
  const m = want.map((n) => catalog.machine(n)).find((x) => x && x.a) || catalog.machines.find((x) => x.a);
  const ini = new Ini();
  ini.set('Machine', 'machine', m.i);
  ini.set('Video', 'gfxcard', catalog.find('video', 'vga')?.a ? 'vga' : 'cga');
  ini.set('Input devices', 'mouse_type', 'none');
  return ini.toString();
}
