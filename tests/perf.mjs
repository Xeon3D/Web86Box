// Performance probe: node tests/perf.mjs <base url> <out dir> <cfg file> [seconds]
// Creates a VM from the given 86box.cfg, runs it and prints the emulation
// speed (as shown in the title bar) every second.
import { readFileSync } from 'node:fs';
const { chromium } = await import(process.env.PW_MODULE || 'playwright');
const [base = 'http://127.0.0.1:8086/', out = '.', cfgPath, secs = '20'] = process.argv.slice(2);
const cfg = readFileSync(cfgPath, 'utf8');
const browser = await chromium.launch();
const page = await browser.newPage({ viewport: { width: 1024, height: 768 } });
page.on('pageerror', (e) => console.log('[pageerror]', e.message));
await page.goto(base);
await page.waitForSelector('.vmm', { timeout: 60000 });
await page.evaluate(async (text) => (await import('./js/storage.js')).createVM('Perf', text), cfg);
await page.goto(`${base}?vm=Perf`);
await page.waitForSelector('.main-window canvas', { timeout: 30000 });
const samples = [];
for (let i = 0; i < Number(secs); i++) {
  await page.waitForTimeout(1000);
  samples.push(await page.evaluate(() => window.web86box.speedPercent));
}
console.log('speed % per second:', samples.join(' '));
await page.screenshot({ path: `${out}/perf.png` });
await browser.close();
