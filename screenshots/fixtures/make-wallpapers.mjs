/**
 * Regenerates the wallpapers `wallpaper-edge-colour.spec.ts` drives.
 *
 * Three pictures, chosen so the canvas rule is shown working rather than
 * asserted — the reported fault, a control, and the awkward case:
 *
 * | file | top edge | picture overall | what it proves |
 * |---|---|---|---|
 * | `sky-over-dark-house` | bright sky | dark facade | the reported fault: the band took the sky |
 * | `even-daylight-room`  | ~the average | ~the edge | nothing moves when there is nothing to correct |
 * | `dusk-over-water`     | dark sky | mid, bright at the foot | one colour has to serve both ends |
 *
 * The first is built to the measurements of the report on
 * parob/homecast-cloud#157, whose screenshot had a sky band averaging
 * `#91abd9` (luminance 169) over a page body of `#5a5a55` (luminance 90).
 * Synthetic rather than the reporter's own photograph on purpose: the
 * condition is reproducible without publishing a picture of someone's house.
 *
 *   node fixtures/make-wallpapers.mjs
 */
import { chromium } from '@playwright/test';
import fs from 'node:fs';

const W = 1200, H = 1600;

/** Seeded, so regenerating does not churn the committed files. */
const painters = {
  'sky-over-dark-house': `
    const sky = x.createLinearGradient(0, 0, 0, H * 0.30);
    sky.addColorStop(0, '#9fb6e0'); sky.addColorStop(0.6, '#8aa5d6'); sky.addColorStop(1, '#7e97c4');
    x.fillStyle = sky; x.fillRect(0, 0, W, H * 0.30);
    const wall = x.createLinearGradient(0, H * 0.30, 0, H);
    wall.addColorStop(0, '#6a5b50'); wall.addColorStop(0.5, '#574c45'); wall.addColorStop(1, '#3d3733');
    x.fillStyle = wall; x.fillRect(0, H * 0.28, W, H * 0.72);
    x.fillStyle = '#4a433f';
    x.beginPath(); x.moveTo(0, H * 0.34); x.lineTo(W * 0.55, H * 0.24); x.lineTo(W, H * 0.32);
    x.lineTo(W, H * 0.42); x.lineTo(0, H * 0.44); x.closePath(); x.fill();
    x.fillStyle = '#2b2f36';
    for (let r = 0; r < 3; r++) for (let c = 0; c < 3; c++)
      x.fillRect(W * (0.12 + c * 0.28), H * (0.50 + r * 0.16), W * 0.16, H * 0.10);
    texture(H * 0.28, H * 0.72, 6000);
  `,
  'even-daylight-room': `
    const wash = x.createLinearGradient(0, 0, 0, H);
    wash.addColorStop(0, '#b9b2a6'); wash.addColorStop(0.5, '#b3aca0'); wash.addColorStop(1, '#aca597');
    x.fillStyle = wash; x.fillRect(0, 0, W, H);
    x.fillStyle = 'rgba(160,150,135,0.5)';
    for (let i = 0; i < 5; i++) x.fillRect(W * (0.08 + i * 0.18), H * 0.30, W * 0.10, H * 0.42);
    texture(0, H, 6000);
  `,
  'dusk-over-water': `
    const sky = x.createLinearGradient(0, 0, 0, H * 0.55);
    sky.addColorStop(0, '#221d2e'); sky.addColorStop(0.7, '#3a2f43'); sky.addColorStop(1, '#6d4a4a');
    x.fillStyle = sky; x.fillRect(0, 0, W, H * 0.55);
    const water = x.createLinearGradient(0, H * 0.55, 0, H);
    water.addColorStop(0, '#95604f'); water.addColorStop(0.45, '#d59a63'); water.addColorStop(1, '#f0c489');
    x.fillStyle = water; x.fillRect(0, H * 0.55, W, H * 0.45);
    x.fillStyle = 'rgba(255,225,180,0.55)';
    for (let i = 0; i < 40; i++) x.fillRect(W * 0.30 + rand() * W * 0.40, H * 0.58 + rand() * H * 0.40, W * 0.10, 3);
    texture(0, H, 4000);
  `,
};

const b = await chromium.launch();
const page = await b.newPage();
for (const [name, body] of Object.entries(painters)) {
  const dataUrl = await page.evaluate(({ W, H, body }) => {
    const c = document.createElement('canvas'); c.width = W; c.height = H;
    const x = c.getContext('2d');
    let seed = 0x9e3779b9;
    const rand = () => {
      seed ^= seed << 13; seed ^= seed >>> 17; seed ^= seed << 5;
      return ((seed >>> 0) % 100000) / 100000;
    };
    const texture = (fromY, height, n) => {
      for (let i = 0; i < n; i++) {
        x.fillStyle = `rgba(${rand() > 0.5 ? '255,255,255' : '0,0,0'},0.05)`;
        x.fillRect(rand() * W, fromY + rand() * height, 6, 3);
      }
    };
    // eslint-disable-next-line no-new-func
    new Function('x', 'W', 'H', 'rand', 'texture', body)(x, W, H, rand, texture);
    return c.toDataURL('image/png');
  }, { W, H, body });
  fs.writeFileSync(new URL(`${name}.png`, import.meta.url), Buffer.from(dataUrl.split(',')[1], 'base64'));
  console.log('wrote', name);
}
await b.close();
