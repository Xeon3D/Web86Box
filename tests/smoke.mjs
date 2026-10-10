// Headless boot check: node tests/smoke.mjs [url] [seconds]
// PW_MODULE lets a globally installed Playwright be used (ESM ignores NODE_PATH).
const { chromium } = await import(process.env.PW_MODULE || 'playwright');
const url = process.argv[2] || 'http://127.0.0.1:8086/smoke.html';
const secs = Number(process.argv[3] || 20);
const browser = await chromium.launch({ args: ['--enable-features=SharedArrayBuffer', '--autoplay-policy=no-user-gesture-required'] });
const page = await browser.newPage();
page.on('console', (m) => console.log('[console]', m.text()));
page.on('pageerror', (e) => console.log('[pageerror]', e.message));
await page.goto(url);
for (let i = 0; i < secs; i++) {
  await page.waitForTimeout(1000);
}
const ev = await page.evaluate(() => window.events);
console.log(JSON.stringify(ev.filter(e => e[0] !== 'speed')).slice(0, 4000));
console.log('speed%', await page.evaluate(() => window.emu.speedPercent));
await page.screenshot({ path: process.argv[4] || 'smoke.png' });
await browser.close();
