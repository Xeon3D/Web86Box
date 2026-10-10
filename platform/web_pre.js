// Web86Box: runs at the start of the module in every thread (main + workers).
//
// WasmFS's fetch backend builds file URLs as `${base}/${path}` where `path`
// already starts with "/", which yields "roms//machines/...". Collapse the
// duplicate slashes in the path so static hosts serve the files.
if (typeof globalThis.fetch === 'function' && !globalThis.__web86boxFetchPatched) {
  const origFetch = globalThis.fetch.bind(globalThis);
  globalThis.fetch = (input, init) => {
    if (typeof input === 'string') {
      input = input.replace(/^([a-z]+:\/\/[^/]+)?(.*)$/i, (m, origin, path) => (origin || '') + path.replace(/\/{2,}/g, '/'));
    }
    return origFetch(input, init);
  };
  globalThis.__web86boxFetchPatched = true;
}
