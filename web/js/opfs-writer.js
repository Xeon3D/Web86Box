// Web86Box - OPFS writer worker, for browsers without createWritable()
// (Safari). Uses a synchronous access handle, which only workers may open.

self.onmessage = async (e) => {
  const { path, data } = e.data;
  try {
    const parts = path.split('/').filter(Boolean);
    let d = await navigator.storage.getDirectory();
    for (const p of parts.slice(0, -1)) d = await d.getDirectoryHandle(p, { create: true });
    const fh = await d.getFileHandle(parts[parts.length - 1], { create: true });
    const h = await fh.createSyncAccessHandle();
    try {
      if (data && data.truncate !== undefined) {
        h.truncate(data.truncate);
        self.postMessage({ progress: data.truncate, total: data.truncate });
      } else if (data instanceof Blob) {
        h.truncate(0);
        const reader = data.stream().getReader();
        let at = 0;
        for (;;) {
          const { value, done } = await reader.read();
          if (done) break;
          h.write(value, { at });
          at += value.byteLength;
          self.postMessage({ progress: at, total: data.size });
        }
      } else {
        const bytes = typeof data === 'string' ? new TextEncoder().encode(data) : new Uint8Array(data);
        h.truncate(0);
        h.write(bytes, { at: 0 });
      }
      h.flush();
    } finally {
      h.close();
    }
    self.postMessage({ ok: true });
  } catch (err) {
    self.postMessage({ error: String(err) });
  }
};
