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

// Big-app conventions: a clean light (or dark) ground, a huge left-aligned
// headline with one phrase in the brand colour, and the device drawn large
// and slightly tilted so it runs off the frame. `theme`/`tilt` per caption.
const targets = {
  mac:     { w: 2560, h: 1600, raw: '.',      names: captions.mac,    q: { landscape: '1', h1: '96px', p: '36px', 'device-top': '31%', 'device-w': '90%', 'shift-x': '4%' } },
  iphone:  { w: 1284, h: 2778, raw: 'iphone', names: captions.iphone, q: { h1: '124px', p: '42px', 'device-top': '27%', 'device-w': '96%', radius: '132px', bezel: '24px' } },
  ipad:    { w: 2048, h: 2732, raw: 'ipad',   names: captions.ipad,   q: { h1: '140px', p: '50px', 'device-top': '25%', 'device-w': '96%', radius: '78px', bezel: '36px', island: '0' } },
  android: { w: 1440, h: 2560, raw: 'iphone', names: captions.iphone, q: { h1: '128px', p: '44px', 'device-top': '27%', 'device-w': '96%', radius: '110px', bezel: '22px', island: '0' } },
};

const browser = await chromium.launch();
const page = await browser.newPage({ deviceScaleFactor: 1 });
for (const [name, t] of Object.entries(targets)) {
  const outDir = resolve(outRoot, name); mkdirSync(outDir, { recursive: true });
  await page.setViewportSize({ width: t.w, height: t.h });
  for (const c of t.names) {
    const img = pathToFileURL(resolve(rawRoot, t.raw, c.file)).href;
    const q = new URLSearchParams({ w: `${t.w}px`, h: `${t.h}px`, title: c.title, sub: c.sub, img, tilt: c.tilt || '0deg', theme: c.theme || 'light', ...t.q });
    await page.goto(pathToFileURL(resolve(here, 'frame.html')).href + '?' + q.toString());
    await page.waitForFunction(() => { const i = document.getElementById('shot'); return i && i.complete && i.naturalWidth > 0; });
    await page.evaluate(() => document.fonts.ready);
    const out = resolve(outDir, c.file);
    await page.screenshot({ path: out, clip: { x: 0, y: 0, width: t.w, height: t.h } });
    console.log('wrote', name, c.file);
  }
}
await browser.close();
