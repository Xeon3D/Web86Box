// UI walkthrough: node tests/ui.mjs <base url> <out dir>
// Creates a VM through the VM manager and Settings dialog, starts it and
// takes screenshots along the way.
const { chromium } = await import(process.env.PW_MODULE || 'playwright');
const base = process.argv[2] || 'http://127.0.0.1:8086/';
const out = process.argv[3] || '.';
const browser = await chromium.launch();
const page = await browser.newPage({ viewport: { width: 1280, height: 860 } });
const errors = [];
page.on('console', (m) => { if (m.type() === 'error' || /error|abort/i.test(m.text())) console.log('[console]', m.text()); });
page.on('pageerror', (e) => { errors.push(e.message); console.log('[pageerror]', e.message); });
await page.goto(base);
await page.waitForSelector('.vmm', { timeout: 60000 });
await page.screenshot({ path: `${out}/1-manager.png` });
await page.click('text=Add a new machine…');
await page.waitForSelector('.dialog input[type=text]');
await page.fill('.dialog input[type=text]', 'Test PC');
await page.click('.dialog .btn.default');
await page.waitForSelector('.settings', { timeout: 20000 });
await page.screenshot({ path: `${out}/2-settings-machine.png` });
for (const tab of ['Display', 'Sound', 'Storage controllers', 'Hard disks', 'Floppy & CD-ROM drives']) {
  await page.click(`.settings-nav .list-item:has-text("${tab}")`);
  await page.screenshot({ path: `${out}/3-settings-${tab.replace(/\W+/g, '_')}.png` });
}
await page.click('.settings .btn.default');
await page.waitForSelector('.vmm-details h2:has-text("Test PC")');
await page.screenshot({ path: `${out}/4-manager-vm.png` });
await page.click('.vmm-toolbar button[title="Start"]');
await page.waitForSelector('.main-window', { timeout: 20000 });
await page.waitForTimeout(Number(process.env.RUN_SECONDS || 15) * 1000);
await page.screenshot({ path: `${out}/5-running.png` });
console.log('title:', await page.title());
console.log('errors:', errors.length);
await browser.close();
