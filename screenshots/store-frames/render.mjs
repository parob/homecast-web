// Store screenshots with copy: a raw capture inside a device frame, a
// headline above it, on a brand gradient — one HTML template rendered at each
// store's exact pixel size.
//   node render.mjs <rawRoot> <outRoot>
// rawRoot holds {., iphone, ipad} sets from capture.spec.ts; outRoot gets
// {mac, iphone, ipad, android}. Android reuses the iPhone captures at 9:16.
import { chromium } from '@playwright/test';
import { readFileSync, mkdirSync } from 'node:fs';
import { resolve, dirname } from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';

const here = dirname(fileURLToPath(import.meta.url));
const [rawRoot, outRoot] = process.argv.slice(2).map((p) => resolve(p));
const captions = JSON.parse(readFileSync(resolve(here, 'captions.json'), 'utf8'));

const targets = {
  mac:     { w: 2560, h: 1600, raw: '.',      names: captions.mac,    q: { landscape: '1', h1: '92px', p: '38px', 'device-top': '29%', 'device-w': '86%' } },
  iphone:  { w: 1284, h: 2778, raw: 'iphone', names: captions.iphone, q: { h1: '104px', p: '44px', 'device-top': '23%', 'device-w': '86%', radius: '116px', bezel: '22px' } },
  ipad:    { w: 2048, h: 2732, raw: 'ipad',   names: captions.ipad,   q: { h1: '120px', p: '50px', 'device-top': '21%', 'device-w': '84%', radius: '72px', bezel: '34px' } },
  android: { w: 1440, h: 2560, raw: 'iphone', names: captions.iphone, q: { h1: '110px', p: '46px', 'device-top': '23%', 'device-w': '84%', radius: '96px', bezel: '20px' } },
};

const browser = await chromium.launch();
const page = await browser.newPage({ deviceScaleFactor: 1 });
for (const [name, t] of Object.entries(targets)) {
  const outDir = resolve(outRoot, name); mkdirSync(outDir, { recursive: true });
  await page.setViewportSize({ width: t.w, height: t.h });
  for (const c of t.names) {
    const img = pathToFileURL(resolve(rawRoot, t.raw, c.file)).href;
    const q = new URLSearchParams({ w: `${t.w}px`, h: `${t.h}px`, title: c.title, sub: c.sub, accent: c.accent, accent2: c.accent2, img, ...t.q });
    await page.goto(pathToFileURL(resolve(here, 'frame.html')).href + '?' + q.toString());
    await page.waitForFunction(() => { const i = document.getElementById('shot'); return i && i.complete && i.naturalWidth > 0; });
    await page.evaluate(() => document.fonts.ready);
    const out = resolve(outDir, c.file);
    await page.screenshot({ path: out, clip: { x: 0, y: 0, width: t.w, height: t.h } });
    console.log('wrote', name, c.file);
  }
}
await browser.close();
