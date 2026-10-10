// Boot test: node tests/boot.mjs <base url> <out dir>
//
// Creates a VM (IBM PC/XT, 5.25" 360K floppy) whose floppy holds a tiny
// hand-assembled boot sector that prints a banner and echoes keystrokes,
// starts it through the UI, types into it and takes a screenshot.
const { chromium } = await import(process.env.PW_MODULE || 'playwright');
const base = process.argv[2] || 'http://127.0.0.1:8086/';
const out = process.argv[3] || '.';

// xor ax,ax / mov ds,ax / print banner with INT 10h / echo INT 16h keys.
const BOOT_HEX = '31c08ed8be227cac08c07409b40ebb0700cd10ebf2b400cd16b40ebb0700cd10ebf3'
  + '48656c6c6f2066726f6d205765623836426f7821205479706520736f6d657468696e673a2000';

const browser = await chromium.launch();
const page = await browser.newPage({ viewport: { width: 1024, height: 768 } });
const errors = [];
page.on('pageerror', (e) => { errors.push(e.message); console.log('[pageerror]', e.message); });
page.on('console', (m) => { if (m.type() === 'error') console.log('[console]', m.text()); });
await page.goto(base);
await page.waitForSelector('.vmm', { timeout: 60000 });
await page.evaluate(async (hex) => {
  const storage = await import('./js/storage.js');
  const img = new Uint8Array(368640);
  for (let i = 0; i < hex.length / 2; i++) img[i] = parseInt(hex.substr(i * 2, 2), 16);
  img[510] = 0x55; img[511] = 0xaa;
  await storage.createVM('Boot test', [
    '[Machine]', 'machine = ibmxt', 'cpu_family = 8088', 'cpu_speed = 4772728', 'mem_size = 640', '',
    '[Video]', 'gfxcard = cga', '',
    '[Input devices]', 'keyboard_type = internal', 'mouse_type = none', '',
    '[Floppy and CD-ROM drives]', 'fdd_01_type = 525_2dd', 'fdd_01_fn = echo.img', 'fdd_02_type = none', '',
  ].join('\n'));
  await storage.writeFile('vms/Boot test/echo.img', img);
}, BOOT_HEX);
await page.goto(`${base}?vm=Boot%20test`);
await page.waitForSelector('.main-window canvas', { timeout: 30000 });
await page.waitForTimeout(Number(process.env.BOOT_SECONDS || 20) * 1000);
await page.click('.main-window canvas');
await page.keyboard.type('abc 123', { delay: 120 });
await page.waitForTimeout(2000);
await page.screenshot({ path: `${out}/boot.png` });
const speed = await page.evaluate(() => window.web86box.speedPercent);
console.log('title:', await page.title());
console.log('speed:', speed, 'errors:', errors.length);
await browser.close();
if (errors.length || !speed) process.exitCode = 1;
