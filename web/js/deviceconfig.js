// Web86Box - "Device Configuration" dialog, the counterpart of Qt's
// DeviceConfig: builds a form from a device's device_config_t table
// (exported in the catalog) and reads/writes the device's INI section.

import { h, dialog } from './ui.js';
import { deviceSection } from './catalog.js';

function cfgTypeMask(catalog) { return Number(catalog.C.CONFIG_TYPE_MASK); }

export async function configureDevice({ catalog, ini, dev, inst = 0, pickFile }) {
  if (!dev || !dev.c) return false;
  const C = Object.fromEntries(Object.entries(catalog.C).map(([k, v]) => [k, Number(v)]));
  const section = deviceSection(dev, inst);
  const mask = cfgTypeMask(catalog);
  const rows = [];
  const getters = [];

  const form = h('div.form');
  for (const cfg of dev.c) {
    const type = cfg.type & mask;
    const label = h('label', null, `${cfg.desc}:`);
    let control = null;

    switch (type) {
      case C.CONFIG_BINARY: {
        const cb = h('input', { type: 'checkbox' });
        cb.checked = !!ini.getInt(section, cfg.name, cfg.di);
        control = h('label.check.span2', null, cb, cfg.desc);
        form.append(control);
        getters.push(() => ini.set(section, cfg.name, cb.checked ? 1 : 0));
        continue;
      }
      case C.CONFIG_INT:
      case C.CONFIG_SELECTION:
      case C.CONFIG_MEMORY:
      case C.CONFIG_HEX16:
      case C.CONFIG_HEX20: {
        const isHex = type === C.CONFIG_HEX16 || type === C.CONFIG_HEX20;
        const cur = isHex ? ini.getHex(section, cfg.name, cfg.di) : ini.getInt(section, cfg.name, cfg.di);
        const sel = h('select');
        for (const [desc, val] of cfg.sel || []) sel.append(h('option', { value: String(val) }, desc));
        sel.value = String(cur);
        if (sel.selectedIndex < 0 && sel.options.length) sel.selectedIndex = 0;
        control = sel;
        getters.push(() => {
          const v = parseInt(sel.value, 10);
          if (type === C.CONFIG_HEX16) ini.set(section, cfg.name, v.toString(16).toUpperCase().padStart(4, '0'));
          else if (type === C.CONFIG_HEX20) ini.set(section, cfg.name, v.toString(16).toUpperCase().padStart(5, '0'));
          else ini.set(section, cfg.name, v);
        });
        break;
      }
      case C.CONFIG_MIDI_OUT:
      case C.CONFIG_MIDI_IN: {
        const list = type === C.CONFIG_MIDI_OUT ? catalog.midi_out : catalog.midi_in;
        const sel = h('select');
        list.forEach((d, i) => { if (d.a) sel.append(h('option', { value: String(i) }, d.n)); });
        sel.value = String(ini.getInt(section, cfg.name, cfg.di));
        control = sel;
        getters.push(() => ini.set(section, cfg.name, parseInt(sel.value, 10)));
        break;
      }
      case C.CONFIG_SPINNER: {
        const [min, max, step] = cfg.spin || [0, 65535, 1];
        const inp = h('input', { type: 'number', min, max, step: step || 1 });
        inp.value = String(ini.getInt(section, cfg.name, cfg.di));
        control = inp;
        getters.push(() => {
          let v = parseInt(inp.value, 10);
          if (Number.isNaN(v)) v = cfg.di;
          ini.set(section, cfg.name, Math.max(min, Math.min(max, v)));
        });
        break;
      }
      case C.CONFIG_BIOS: {
        const sel = h('select');
        const cur = ini.get(section, cfg.name, cfg.ds || '');
        for (const [name, internal, avail] of cfg.bios || []) {
          if (!avail) continue;
          sel.append(h('option', { value: internal }, name));
        }
        sel.value = cur;
        if (sel.selectedIndex < 0 && sel.options.length) sel.selectedIndex = 0;
        control = sel;
        getters.push(() => ini.set(section, cfg.name, sel.value));
        break;
      }
      case C.CONFIG_FNAME: {
        const inp = h('input', { type: 'text', value: ini.get(section, cfg.name, cfg.ds || '') });
        const browse = h('button.btn.small', { type: 'button' }, '…');
        browse.addEventListener('click', async () => {
          const path = await pickFile?.(cfg.filter);
          if (path) inp.value = path;
        });
        control = h('div.row', null, h('div.grow', null, inp), browse);
        inp.style.width = '100%';
        getters.push(() => ini.set(section, cfg.name, inp.value));
        break;
      }
      case C.CONFIG_MAC: {
        const inp = h('input', { type: 'text', placeholder: 'random', value: ini.get(section, cfg.name, '') });
        control = inp;
        getters.push(() => {
          const v = inp.value.trim();
          if (/^[0-9a-f]{2}:[0-9a-f]{2}:[0-9a-f]{2}$/i.test(v)) ini.set(section, cfg.name, v.toLowerCase());
          else ini.delete(section, cfg.name);
        });
        break;
      }
      case C.CONFIG_STRING:
      case C.CONFIG_SERPORT:
      default: {
        const inp = h('input', { type: 'text', value: ini.get(section, cfg.name, cfg.ds || '') });
        control = inp;
        getters.push(() => ini.set(section, cfg.name, inp.value));
        break;
      }
    }
    control.classList?.add('span2');
    form.append(label, control);
    rows.push(cfg);
  }

  const ok = await dialog({
    title: `${dev.n} Device Configuration`,
    width: '520px',
    body: [h('div', { style: { textAlign: 'center', marginBottom: '8px' } }, dev.n), h('hr'), form],
    buttons: [{ label: 'OK', value: true, default: true }, { label: 'Cancel', value: false }],
  });
  if (ok) getters.forEach((g) => g());
  return !!ok;
}
