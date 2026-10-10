// Web86Box - "About 86Box" dialog.
import { h, dialog } from './ui.js';

export function showAbout(catalog) {
  return dialog({
    title: 'About 86Box',
    width: '520px',
    body: h('div', { style: { display: 'flex', gap: '16px', alignItems: 'flex-start' } },
      h('img', { src: 'icons/86Box-yellow.ico', alt: '', style: { width: '64px', height: '64px' } }),
      h('div', null,
        h('div', { style: { fontSize: '14pt', marginBottom: '4px' } }, `86Box ${catalog?.version || ''}`),
        h('p', null, 'An emulator of old computers.'),
        h('p', null, 'Authors: Miran Grča (OBattler), RichardG867, Jasmine Iwanek, TC1995, coldbrewed, Teemu Korhonen (Manaatti), Joakim L. Gilje, Adrien Moulin (elyosh), Daniel Balsom (gloriouscow), Cacodemon345, Fred N. van Kempen (waltje), Tiseno100, reenigne, and others.'),
        h('p', null, 'With previous core contributions from Sarah Walker, leilei, JohnElliott, greatpsycho, and others.'),
        h('p', null, 'Released under the GNU General Public License version 2 or later. See LICENSE for more information.'),
        h('p', null, 'Web86Box: this build runs 86Box compiled to WebAssembly, entirely in your browser. ',
          h('a', { href: 'https://86box.net/', target: '_blank', rel: 'noopener' }, '86box.net')))),
    buttons: [{ label: 'OK', value: true, default: true }],
  });
}
