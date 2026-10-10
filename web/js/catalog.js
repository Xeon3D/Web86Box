// Web86Box - helpers over the hardware catalog exported by web_catalog.c.

export class Catalog {
  constructor(json) {
    Object.assign(this, json);
    const c = {};
    for (const [k, v] of Object.entries(json.consts)) c[k] = BigInt(v);
    this.C = c;
    this.machineByName = new Map(this.machines.map((m, i) => [m.i, i]));
    for (const m of this.machines) {
      m.busB = BigInt(m.bus);
      m.flB = BigInt(m.fl);
    }
  }

  machine(internal) {
    const i = this.machineByName.get(internal);
    return i === undefined ? null : this.machines[i];
  }

  hasFlag(m, flag) { return !!m && (m.flB & this.C[flag]) !== 0n; }
  hasBus(m, flag) { return !!m && (m.busB & this.C[flag]) !== 0n; }

  // device_is_valid() from device.c.
  valid(dev, m) {
    if (!dev || dev.f === undefined || !m) return true;
    const f = BigInt(dev.f);
    const C = this.C;
    if ((f & C.DEVICE_BUS) === 0n) return true;
    if ((f & C.DEVICE_PCI) && (m.flB & C.MACHINE_PCI_INTERNAL)) return false;
    if ((f & C.DEVICE_AGP) && (m.flB & C.MACHINE_AGP_INTERNAL)) return false;
    return (m.busB & f & C.DEVICE_BUS) !== 0n;
  }

  // Entries of a device list usable on machine `m` (available + valid).
  list(key, m, { includeUnavailable = false } = {}) {
    return (this[key] || []).map((d, id) => ({ ...d, id }))
      .filter((d) => (includeUnavailable || d.a) && this.valid(d, m));
  }

  find(key, internal) {
    const arr = this[key] || [];
    const id = arr.findIndex((d) => d.i === internal);
    return id < 0 ? null : { ...arr[id], id };
  }

  cpuFamily(internal) {
    return this.cpu_families.findIndex((f) => f.i === internal);
  }

  // Eligible CPU families for a machine: [{ fam, cpus: [cpuIndex...] }]
  eligibleCpus(m) {
    return (m?.cpus || []).map(([fam, cpus]) => ({ fam, cpus }));
  }
}

// Section name used by 86Box for a device's configuration
// (device_set_context(): "<name>" or "<name> #<instance>").
export function deviceSection(dev, inst = 0) {
  return inst ? `${dev.s} #${inst}` : dev.s;
}
