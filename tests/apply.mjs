// Settings-apply test: node tests/apply.mjs <base url> <out dir>
// Starts a VM, opens Settings from the toolbar, changes the memory size,
// saves (which reloads the configuration and hard-resets the machine) and
// checks that the emulator picked up the new configuration.
const { chromium } = await import(process.env.PW_MODULE || 'playwright');
const [base = 'http://127.0.0.1:8086/', out = '.'] = process.argv.slice(2);
const browser = await chromium.launch();
const page = await browser.newPage({ viewport: { width: 1280, height: 860 } });
const errors = [];
page.on('pageerror', (e) => { errors.push(e.message); console.log('[pageerror]', e.message); });
page.on('console', (m) => { if (m.type() === 'error' || m.type() === 'warning') console.log('[console]', m.text().slice(0, 300)); });
await page.goto(base);
await page.waitForSelector('.vmm', { timeout: 60000 });
await page.evaluate(async () => (await import('./js/storage.js')).createVM('Apply', '[Machine]\nmachine = ibmat\nmem_size = 512\n\n[Video]\ngfxcard = vga\n'));
await page.goto(`${base}?vm=Apply`);
await page.waitForSelector('.main-window canvas', { timeout: 30000 });
await page.waitForTimeout(6000);
await page.click('.toolbar button[title="Settings…"]');
await page.waitForSelector('.settings', { timeout: 10000 });
await page.fill('.settings input[type=number]', '256'); // IBM AT: 256-512 KB
await page.click('.settings .btn.default');
await page.waitForSelector('.msgbox');
const reset = page.evaluate(() => new Promise((r) => window.web86box.addEventListener('config_reloaded', () => r(true), { once: true })));
await page.click('.msgbox .btn.default');
const reloaded = await Promise.race([reset, new Promise((r) => setTimeout(() => r(false), 15000))]);
console.log('config reloaded:', reloaded);
await page.waitForTimeout(6000);
const cfg = await page.evaluate(async () => (await import('./js/storage.js')).readText('vms/Apply/86box.cfg'));
const mem = /mem_size = (\d+)/.exec(cfg)?.[1];
const speed = await page.evaluate(() => window.web86box.speedPercent);
console.log('mem_size in cfg:', mem, 'speed:', speed, 'errors:', errors.length);
await page.screenshot({ path: `${out}/apply.png` });
await browser.close();
if (!reloaded || mem !== '256' || !speed || errors.length) process.exitCode = 1;
