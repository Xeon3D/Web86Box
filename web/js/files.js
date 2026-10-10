// Web86Box - files of a VM: importing, creating and exporting images.
//
// Every VM is a folder in the Origin Private File System, which the
// emulator sees under /opfs. Images the user picks are copied into the VM
// folder (streamed, so large CD images do not need to fit in memory).

import * as storage from './storage.js';
import { h, dialog, pickFiles, progressDialog, downloadBlob, formatSize, messageBox, confirm } from './ui.js';

export const ACCEPT = {
  floppy: '.img,.ima,.vfd,.flp,.dsk,.86f,.td0,.imd,.fdi,.mfm,.json,.xdf,.dmf,.ddi,.360,.720,.12,.144',
  cdrom: '.iso,.cue,.bin,.img,.chd,.mds,.mdf,.ccd,.nrg,.toast,.vcd,.viso',
  hdd: '.img,.hdi,.hdx,.hdv,.vhd,.ima,.raw,.dsk,.86f',
  rdisk: '.img,.ima,.zdi,.raw',
  mo: '.img,.mdi',
  cassette: '.pcm,.raw,.wav,.cas',
  cartridge: '.a,.b,.jrc',
};

export class VMFiles {
  constructor(vmName) {
    this.vm = vmName;
    this.dir = `vms/${vmName}`;
    this.base = storage.vmPath(vmName); // as the emulator sees it
  }

  // Absolute emulator path for a file name inside the VM folder.
  path(name) { return `${this.base}${name}`; }

  // Resolve a path from 86box.cfg (absolute, or relative to the VM folder).
  resolve(p) {
    if (!p) return '';
    return p.startsWith('/') ? p : `${this.base}${p}`;
  }

  // Name inside the VM folder for an emulator path, or null if elsewhere.
  localName(p) {
    const abs = this.resolve(p);
    return abs.startsWith(this.base) ? abs.slice(this.base.length) : null;
  }

  async list() {
    const files = await storage.listFiles(this.dir);
    return files.filter((f) => !f.dir && f.name !== '86box.cfg').sort((a, b) => a.name.localeCompare(b.name));
  }

  async uniqueName(name) {
    const existing = new Set((await storage.listFiles(this.dir)).map((f) => f.name));
    if (!existing.has(name)) return name;
    const dot = name.lastIndexOf('.');
    const stem = dot > 0 ? name.slice(0, dot) : name;
    const ext = dot > 0 ? name.slice(dot) : '';
    for (let i = 2; ; i++) {
      const n = `${stem} (${i})${ext}`;
      if (!existing.has(n)) return n;
    }
  }

  // Copy user-picked files into the VM folder; returns [{ name, path, size }].
  async importFiles(files, { replace = false } = {}) {
    const out = [];
    for (const file of files) {
      const name = replace ? file.name : await this.uniqueName(file.name);
      const pd = progressDialog('Importing', `Copying ${file.name} (${formatSize(file.size)})…`);
      try {
        await storage.writeFile(`${this.dir}/${name}`, file, (done, total) => pd.update(total ? done / total : 1));
      } catch (e) {
        pd.close();
        await messageBox({ kind: 'error', header: 'Could not import the file', text: String(e) });
        continue;
      } finally {
        pd.close();
      }
      out.push({ name, path: this.path(name), size: file.size });
    }
    return out;
  }

  // Pick a single file from disk and import it.
  async importOne(accept) {
    const files = await pickFiles({ accept });
    if (!files.length) return null;
    const [res] = await this.importFiles(files);
    return res || null;
  }

  // Let the user choose an image: from the VM folder or from their computer.
  async choose({ title = 'Open image', accept = '', kind = '' } = {}) {
    const files = await this.list();
    const exts = accept ? accept.split(',').map((e) => e.trim().toLowerCase()) : [];
    const matches = (n) => !exts.length || exts.some((e) => n.toLowerCase().endsWith(e));
    const shown = files.filter((f) => matches(f.name));
    let selected = null;
    const tbody = h('tbody');
    const render = () => {
      tbody.replaceChildren(...shown.map((f) => {
        const tr = h('tr', null, h('td', null, f.name), h('td', null, formatSize(f.size)));
        if (f === selected) tr.classList.add('selected');
        tr.addEventListener('click', () => { selected = f; render(); });
        tr.addEventListener('dblclick', () => { selected = f; okBtn.el.click(); });
        return tr;
      }));
    };
    render();
    const okBtn = { label: 'Open', default: true, value: 'open', onClick: () => !!selected };
    const res = await dialog({
      title,
      width: '560px',
      body: [
        h('div', { style: { marginBottom: '6px' } }, `Images stored in this VM${kind ? ` (${kind})` : ''}:`),
        h('div.list-view', { style: { height: '240px' } },
          shown.length
            ? h('table.grid', null, h('thead', null, h('tr', null, h('th', null, 'Name'), h('th', null, 'Size'))), tbody)
            : h('div.muted', { style: { padding: '10px' } }, 'No matching images yet. Use “Import from computer…”.')),
      ],
      buttons: [
        { label: 'Import from computer…', left: true, value: 'import' },
        okBtn,
        { label: 'Cancel', value: null },
      ],
    });
    if (res === 'open' && selected) return this.path(selected.name);
    if (res === 'import') {
      const r = await this.importOne(accept);
      return r ? r.path : null;
    }
    return null;
  }

  async createBlank(name, size) {
    const unique = await this.uniqueName(name);
    const pd = progressDialog('Creating image', `Creating ${unique} (${formatSize(size)})…`);
    try {
      await storage.createBlankFile(`${this.dir}/${unique}`, size);
    } finally {
      pd.close();
    }
    return this.path(unique);
  }

  async download(pathOrName) {
    const name = this.localName(pathOrName) ?? pathOrName;
    try {
      const file = await storage.getFile(`${this.dir}/${name}`);
      downloadBlob(file, name.split('/').pop());
    } catch (e) {
      await messageBox({ kind: 'error', header: 'Could not export the file', text: `${name}: ${e}` });
    }
  }

  async remove(name) {
    await storage.removeFile(`${this.dir}/${name}`);
  }

  // The object the Settings dialog uses for its file actions.
  settingsHelper() {
    return {
      pick: async (filter) => this.choose({ title: 'Select file', accept: filterToAccept(filter) }),
      importDisk: async () => {
        const path = await this.choose({ title: 'Existing hard disk image', accept: ACCEPT.hdd, kind: 'hard disks' });
        if (!path) return null;
        const f = await storage.getFile(`${this.dir}/${this.localName(path)}`);
        return { path, size: f.size };
      },
      createDisk: async (name, size) => this.createBlank(name, size),
    };
  }
}

// Qt file filter ("Images (*.img *.ima)|...") -> accept attribute.
function filterToAccept(filter) {
  if (!filter) return '';
  const exts = [...filter.matchAll(/\*\.([a-z0-9]+)/gi)].map((m) => `.${m[1].toLowerCase()}`);
  return [...new Set(exts)].join(',');
}

// A "Manage files" dialog for a VM (VM manager and Tools menu).
export async function manageFilesDialog(vmFiles) {
  const tbody = h('tbody');
  let selected = null;
  const refresh = async () => {
    const files = await vmFiles.list();
    selected = files.find((f) => f.name === selected?.name) || null;
    tbody.replaceChildren(...files.map((f) => {
      const tr = h('tr', null, h('td', null, f.name), h('td', null, formatSize(f.size)), h('td', null, new Date(f.lastModified).toLocaleString()));
      if (selected && f.name === selected.name) tr.classList.add('selected');
      tr.addEventListener('click', () => { selected = f; refresh(); });
      return tr;
    }));
    const est = await storage.estimate();
    quota.textContent = est ? `Browser storage used: ${formatSize(est.usage || 0)} of ${formatSize(est.quota || 0)}` : '';
  };
  const quota = h('div.muted');
  await refresh();
  await dialog({
    title: `Files - ${vmFiles.vm}`,
    width: '640px',
    body: [
      h('div.list-view', { style: { height: '300px' } },
        h('table.grid', null, h('thead', null, h('tr', null, h('th', null, 'Name'), h('th', null, 'Size'), h('th', null, 'Modified'))), tbody)),
      h('div', { style: { marginTop: '6px' } }, quota),
    ],
    buttons: [
      { label: 'Import…', left: true, onClick: async () => { const fs = await pickFiles({ multiple: true }); if (fs.length) await vmFiles.importFiles(fs); await refresh(); return false; } },
      { label: 'Download', left: true, onClick: async () => { if (selected) await vmFiles.download(selected.name); return false; } },
      { label: 'Delete', left: true, onClick: async () => {
        if (!selected) return false;
        if (await confirm(`Delete “${selected.name}”? This cannot be undone.`)) {
          try { await vmFiles.remove(selected.name); } catch (e) { await messageBox({ kind: 'error', text: `The file is in use or could not be deleted.\n\n${e}` }); }
          selected = null;
          await refresh();
        }
        return false;
      } },
      { label: 'Close', value: true, default: true },
    ],
  });
}
