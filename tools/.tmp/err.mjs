import { chromium } from 'playwright-core';
const b = await chromium.launch({ channel: 'chrome', headless: true, args: ['--use-angle=metal','--enable-gpu','--ignore-gpu-blocklist'] });
const p = await b.newPage();
p.on('console', (m) => { if (m.type()==='error'||m.type()==='warning') console.log('['+m.type()+']', m.text().slice(0,600)); });
p.on('pageerror', (e) => console.log('[pageerror]', e.message, e.stack?.slice(0,800)));
await p.goto('http://127.0.0.1:5173/?fresh=1');
await p.waitForTimeout(25000);
console.log(await p.evaluate(() => !!window.__forge && window.__forge.engine.ready));
await b.close();
