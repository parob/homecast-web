/**
 * Regenerates `sky-over-dark-house.png`, the wallpaper
 * `wallpaper-edge-colour.spec.ts` drives.
 *
 * It is not a photograph but it is built to the measurements of one: the
 * report on parob/homecast-cloud#157 attached a screenshot whose sky band
 * averaged `#91abd9` (luminance 169) over a page body of `#5a5a55`
 * (luminance 90). A bright strip at the top of an otherwise dark picture is
 * the whole input condition, and the spec asserts the fixture still has that
 * shape before it asserts anything about the canvas.
 *
 * Synthetic rather than the reporter's own photograph on purpose: the
 * condition is reproducible without publishing a picture of someone's house
 * in a pull request.
 *
 *   node fixtures/make-sky-over-dark-house.mjs
 */
import { chromium } from '@playwright/test';
import fs from 'node:fs';
const b = await chromium.launch();
const page = await b.newPage();
const dataUrl = await page.evaluate(() => {
  const W = 1200, H = 1600;
  const c = document.createElement('canvas'); c.width = W; c.height = H;
  const x = c.getContext('2d');
  // Sky: the measured band from the report (#91abd9), deepening downward.
  const sky = x.createLinearGradient(0, 0, 0, H * 0.30);
  sky.addColorStop(0, '#9fb6e0'); sky.addColorStop(0.6, '#8aa5d6'); sky.addColorStop(1, '#7e97c4');
  x.fillStyle = sky; x.fillRect(0, 0, W, H * 0.30);
  // Building: dark brick, the bulk of the frame (~lum 90).
  const wall = x.createLinearGradient(0, H * 0.30, 0, H);
  wall.addColorStop(0, '#6a5b50'); wall.addColorStop(0.5, '#574c45'); wall.addColorStop(1, '#3d3733');
  x.fillStyle = wall; x.fillRect(0, H * 0.28, W, H * 0.72);
  // Roofline, so the sky/wall boundary is not a ruler-straight line.
  x.fillStyle = '#4a433f';
  x.beginPath(); x.moveTo(0, H * 0.34); x.lineTo(W * 0.55, H * 0.24); x.lineTo(W, H * 0.32);
  x.lineTo(W, H * 0.42); x.lineTo(0, H * 0.44); x.closePath(); x.fill();
  // Windows: dark panes, the sort of thing that keeps a facade's average low.
  x.fillStyle = '#2b2f36';
  for (let r = 0; r < 3; r++) for (let col = 0; col < 3; col++)
    x.fillRect(W * (0.12 + col * 0.28), H * (0.50 + r * 0.16), W * 0.16, H * 0.10);
  // Brick texture. Seeded, so regenerating the fixture does not churn the
  // committed file for no reason.
  let seed = 0x9e3779b9;
  const rand = () => {
    seed ^= seed << 13; seed ^= seed >>> 17; seed ^= seed << 5;
    return ((seed >>> 0) % 100000) / 100000;
  };
  for (let i = 0; i < 6000; i++) {
    const px = rand() * W, py = H * 0.28 + rand() * H * 0.72;
    x.fillStyle = `rgba(${rand() > 0.5 ? '255,255,255' : '0,0,0'},0.05)`;
    x.fillRect(px, py, 6, 3);
  }
  return c.toDataURL('image/png');
});
fs.writeFileSync(new URL('sky-over-dark-house.png', import.meta.url), Buffer.from(dataUrl.split(',')[1], 'base64'));
await b.close();
console.log('written');
