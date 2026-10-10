// Web86Box - VM storage in the Origin Private File System.
//
// Layout (the emulator sees the OPFS root mounted at /opfs):
//   vms/<vm name>/86box.cfg      configuration (86Box INI format)
//   vms/<vm name>/nvr/...        CMOS/NVRAM, written by the emulator
//   vms/<vm name>/<images>       disk/floppy/CD images
//   global/86box_global.cfg      emulator-wide preferences

export const OPFS_MOUNT = '/opfs';
const VMS = 'vms';

async function root() {
  return navigator.storage.getDirectory();
}

async function dir(path, create = false) {
  let d = await root();
  for (const part of path.split('/').filter(Boolean))
    d = await d.getDirectoryHandle(part, { create });
  return d;
}

export function vmPath(name) {
  return `${OPFS_MOUNT}/${VMS}/${name}/`;
}

export function isSupported() {
  return !!(navigator.storage && navigator.storage.getDirectory);
}

export async function requestPersistence() {
  try {
    if (navigator.storage.persist && !(await navigator.storage.persisted()))
      await navigator.storage.persist();
  } catch (e) { /* best effort */ }
}

export async function listVMs() {
  const d = await dir(VMS, true);
  const out = [];
  for await (const [name, handle] of d.entries()) {
    if (handle.kind !== 'directory') continue;
    let cfg = null;
    try { cfg = await readText(`${VMS}/${name}/86box.cfg`); } catch (e) { /* missing */ }
    out.push({ name, cfg });
  }
  out.sort((a, b) => a.name.localeCompare(b.name));
  return out;
}

export async function vmExists(name) {
  try { await dir(`${VMS}/${name}`); return true; } catch (e) { return false; }
}

export async function createVM(name, cfgText) {
  await dir(`${VMS}/${name}`, true);
  await writeFile(`${VMS}/${name}/86box.cfg`, cfgText);
}

export async function deleteVM(name) {
  const d = await dir(VMS);
  await d.removeEntry(name, { recursive: true });
}

export async function renameVM(oldName, newName) {
  // OPFS has no portable rename for directories: copy then delete.
  await copyDir(`${VMS}/${oldName}`, `${VMS}/${newName}`);
  await deleteVM(oldName);
}

async function copyDir(from, to) {
  const src = await dir(from);
  await dir(to, true);
  for await (const [name, handle] of src.entries()) {
    if (handle.kind === 'directory') await copyDir(`${from}/${name}`, `${to}/${name}`);
    else await writeFile(`${to}/${name}`, await handle.getFile());
  }
}

function splitPath(path) {
  const parts = path.split('/').filter(Boolean);
  return { dirPath: parts.slice(0, -1).join('/'), name: parts[parts.length - 1] };
}

export async function getFile(path) {
  const { dirPath, name } = splitPath(path);
  const d = await dir(dirPath);
  return (await d.getFileHandle(name)).getFile();
}

export async function readText(path) {
  return (await getFile(path)).text();
}

export async function fileExists(path) {
  try { await getFile(path); return true; } catch (e) { return false; }
}

export async function listFiles(path) {
  const d = await dir(path, true);
  const out = [];
  for await (const [name, handle] of d.entries()) {
    if (handle.kind === 'file') {
      const f = await handle.getFile();
      out.push({ name, size: f.size, lastModified: f.lastModified });
    } else {
      out.push({ name, dir: true });
    }
  }
  return out;
}

export async function removeFile(path) {
  const { dirPath, name } = splitPath(path);
  await (await dir(dirPath)).removeEntry(name);
}

// Write a string, Blob/File or ArrayBuffer. Streams large files without
// loading them into memory where the browser supports createWritable();
// otherwise (Safari) falls back to a worker with a sync access handle.
export async function writeFile(path, data, onProgress) {
  const { dirPath, name } = splitPath(path);
  const d = await dir(dirPath, true);
  const fh = await d.getFileHandle(name, { create: true });
  if (fh.createWritable) {
    const w = await fh.createWritable();
    if (data instanceof Blob && onProgress) {
      const reader = data.stream().getReader();
      let done = 0;
      for (;;) {
        const { value, done: end } = await reader.read();
        if (end) break;
        await w.write(value);
        done += value.byteLength;
        onProgress(done, data.size);
      }
    } else {
      await w.write(data);
    }
    await w.close();
    return;
  }
  await writeViaWorker(path, data, onProgress);
}

function writeViaWorker(path, data, onProgress) {
  return new Promise((resolve, reject) => {
    const worker = new Worker(new URL('./opfs-writer.js', import.meta.url), { type: 'module' });
    worker.onmessage = (e) => {
      if (e.data.progress !== undefined) { onProgress?.(e.data.progress, e.data.total); return; }
      worker.terminate();
      if (e.data.error) reject(new Error(e.data.error)); else resolve();
    };
    worker.postMessage({ path, data });
  });
}

// Create a zero-filled file of `size` bytes (blank disk images).
export async function createBlankFile(path, size, onProgress) {
  const { dirPath, name } = splitPath(path);
  const d = await dir(dirPath, true);
  const fh = await d.getFileHandle(name, { create: true });
  if (fh.createWritable) {
    const w = await fh.createWritable();
    await w.truncate(size);
    await w.close();
    onProgress?.(size, size);
    return;
  }
  await writeViaWorker(path, { truncate: size }, onProgress);
}

export async function estimate() {
  try { return await navigator.storage.estimate(); } catch (e) { return null; }
}
