// Web86Box - reader/writer for 86Box's INI configuration files.
//
// Keeps section and key order so a file round-trips with minimal churn,
// and leaves sections the UI does not understand (device configuration,
// shader settings, ...) untouched.

export class Ini {
  constructor(text = '') {
    this.sections = new Map(); // name -> Map(key -> value)
    if (text) this.parse(text);
  }

  parse(text) {
    let current = null;
    for (const raw of text.split(/\r?\n/)) {
      const line = raw.trim();
      if (!line || line[0] === '#' || line[0] === ';') continue;
      if (line[0] === '[') {
        const end = line.lastIndexOf(']');
        current = this.section(line.slice(1, end > 0 ? end : undefined), true);
        continue;
      }
      if (!current) current = this.section('', true);
      const eq = line.indexOf('=');
      if (eq < 0) continue;
      current.set(line.slice(0, eq).trim(), line.slice(eq + 1).trim());
    }
    return this;
  }

  section(name, create = false) {
    let s = this.sections.get(name);
    if (!s && create) {
      s = new Map();
      this.sections.set(name, s);
    }
    return s || null;
  }

  has(sec, key) {
    return !!this.section(sec)?.has(key);
  }

  get(sec, key, def = null) {
    const s = this.section(sec);
    return s && s.has(key) ? s.get(key) : def;
  }

  getInt(sec, key, def = 0) {
    const v = this.get(sec, key, null);
    if (v === null || v === '') return def;
    const n = /^0x/i.test(v) ? parseInt(v, 16) : parseInt(v, 10);
    return Number.isNaN(n) ? def : n;
  }

  getHex(sec, key, def = 0) {
    const v = this.get(sec, key, null);
    if (v === null || v === '') return def;
    const n = parseInt(v, 16);
    return Number.isNaN(n) ? def : n;
  }

  set(sec, key, value) {
    this.section(sec, true).set(key, String(value));
  }

  // Set, or remove the key when the value equals 86Box's default (this is
  // what 86Box's own config_save() does, keeping files short).
  setDefault(sec, key, value, def) {
    if (value === def || String(value) === String(def)) this.delete(sec, key);
    else this.set(sec, key, value);
  }

  delete(sec, key) {
    const s = this.section(sec);
    if (!s) return;
    s.delete(key);
    if (!s.size) this.sections.delete(sec);
  }

  deleteSection(sec) {
    this.sections.delete(sec);
  }

  clone() {
    const c = new Ini();
    for (const [name, s] of this.sections) c.sections.set(name, new Map(s));
    return c;
  }

  toString() {
    let out = '';
    for (const [name, s] of this.sections) {
      if (!s.size) continue;
      if (name) out += `[${name}]\n`;
      for (const [k, v] of s) out += `${k} = ${v}\n`;
      out += '\n';
    }
    return out;
  }
}
