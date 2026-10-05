/**
 * Draws the blog's charts from the code the posts publish.
 *
 *   node scripts/blog/render-charts.mts
 *
 * The train-light chart is not drawn from a description of the train light; it
 * runs the `<!-- snippet: train-light -->` block out of the post itself — the
 * same text readers paste into a Code node — at every minute of a morning, and
 * plots what it returned. Change the snippet and re-run this, and the chart
 * can't disagree with it.
 */
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../..');
const post = fs.readFileSync(path.join(root, 'content/blog/apple-home-when-to-leave-light.md'), 'utf-8');
const code = post.match(/<!-- snippet: train-light -->\s*```js\n([\s\S]*?)```/)?.[1];
if (!code) throw new Error('train-light snippet not found');
const walk = Number(code.match(/const WALK = (\d+)/)?.[1]);
const quickWalk = Number(code.match(/const QUICK_WALK = (\d+)/)?.[1]);
const buffer = Number(code.match(/const BUFFER = (\d+)/)?.[1]);
const patience = Number(code.match(/const PATIENCE = (\d+)/)?.[1]);

// One journey, leaving at a fixed time; step "now" towards it three seconds
// at a time. TfL's planner gives London times with no zone (BST in October).
const due = Date.parse('2026-10-05T08:17:00+01:00');
const leg = {
  departureTime: '2026-10-05T08:17:00', scheduledDepartureTime: '2026-10-05T08:17:00',
  arrivalTime: '2026-10-05T08:56:00', scheduledArrivalTime: '2026-10-05T08:56:00',
};
const plan = { journeys: [{ arrivalDateTime: '2026-10-05T08:56:00', legs: [leg] }] };
const run = new Function('input', `"use strict";\n${code}`);
const realNow = Date.now;
type Point = { remaining: number; brightness: number; colour: string };
const points: Point[] = [];
for (let tick = 500; tick >= 0; tick--) {
  const remaining = tick / 20;
  Date.now = () => due - remaining * 60_000;
  const r = run({ nodes: { http: { data: { body: plan } } } });
  points.push({ remaining, brightness: r.brightness, colour: r.colour });
}
Date.now = realNow;

// ── Layout ───────────────────────────────────────────────────────────────────
const W = 900, H = 520;
const m = { top: 70, right: 28, bottom: 150, left: 76 };
const pw = W - m.left - m.right, ph = H - m.top - m.bottom;
const x = (remaining: number) => m.left + ((25 - remaining) / 25) * pw; // time runs left → right
const y = (b: number) => m.top + (1 - b / 100) * ph;

const ink = { primary: '#0f172a', secondary: '#475569', muted: '#94a3b8', grid: '#e2e8f0', surface: '#ffffff' };
const series = { green: '#15803d', amber: '#d97706', purple: '#9333ea', red: '#dc2626' };

const path_ = (colour: string) => {
  const seg = points.filter((p) => p.colour === colour);
  return seg.map((p, i) => `${i ? 'L' : 'M'}${x(p.remaining).toFixed(1)},${y(p.brightness).toFixed(1)}`).join(' ');
};

const grid = [0, 25, 50, 75, 100].map((b) =>
  `<line x1="${m.left}" x2="${W - m.right}" y1="${y(b)}" y2="${y(b)}" stroke="${ink.grid}" stroke-width="1"/>`
  + `<text x="${m.left - 12}" y="${y(b) + 7}" text-anchor="end" font-size="20" fill="${ink.secondary}">${b}%</text>`).join('');
const ticks = [25, 20, 15, 10, 5, 0].map((s) =>
  `<text x="${x(s)}" y="${H - m.bottom + 32}" text-anchor="middle" font-size="20" fill="${ink.secondary}">${s}</text>`).join('');
const guide = (s: number, label: string, offset = 0) =>
  `<line x1="${x(s)}" x2="${x(s)}" y1="${m.top}" y2="${H - m.bottom}" stroke="${ink.muted}" stroke-width="1.5" stroke-dasharray="3 5"/>`
  + `<text x="${x(s)}" y="${m.top - 12 - offset}" text-anchor="middle" font-size="18" fill="${ink.secondary}">${label}</text>`;

const svg = `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 ${W} ${H}" width="${W}" height="${H}" font-family="-apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, Helvetica, Arial, sans-serif" role="img" aria-labelledby="t d">
<title id="t">Train light brightness as departure approaches</title>
<desc id="d">Amber means wait. Green means walk normally (${walk} minutes). Purple means walk quickly (${quickWalk} minutes). Both preserve at least ${buffer} minutes on the platform. Below ${quickWalk + buffer} minutes to departure, this train is skipped; red means no later journey is available in this example.</desc>
<rect width="${W}" height="${H}" fill="${ink.surface}"/>
${grid}
${guide(walk + patience, "Walk normally")}
${guide(walk + buffer, "Walk quickly", 30)}
${guide(quickWalk + buffer, "Skip train")}
<path d="${path_('amber')}" fill="none" stroke="${series.amber}" stroke-width="4" stroke-linecap="round" stroke-dasharray="10 7"/>
<path d="${path_('green')}" fill="none" stroke="${series.green}" stroke-width="4" stroke-linecap="round"/>
<path d="${path_('purple')}" fill="none" stroke="${series.purple}" stroke-width="4" stroke-linecap="round"/>
<path d="${path_('red')}" fill="none" stroke="${series.red}" stroke-width="4" stroke-linecap="round" stroke-dasharray="3 6"/>
<g transform="translate(${m.left} ${H - 80})">
  <line x1="0" x2="44" y1="0" y2="0" stroke="${series.amber}" stroke-width="4" stroke-linecap="round" stroke-dasharray="10 7"/>
  <text x="56" y="7" font-size="20" fill="${ink.primary}">Amber — wait</text>
  <line x1="0" x2="44" y1="34" y2="34" stroke="${series.green}" stroke-width="4" stroke-linecap="round"/>
  <text x="56" y="41" font-size="20" fill="${ink.primary}">Green — walk normally</text>
  <line x1="410" x2="454" y1="0" y2="0" stroke="${series.purple}" stroke-width="4"/>
  <text x="466" y="7" font-size="20" fill="${ink.primary}">Purple — walk quickly</text>
  <line x1="410" x2="454" y1="34" y2="34" stroke="${series.red}" stroke-width="4" stroke-dasharray="3 6"/>
  <text x="466" y="41" font-size="20" fill="${ink.primary}">Red — no suitable train</text>
</g>
${ticks}
<text x="${m.left + pw / 2}" y="${H - 104}" text-anchor="middle" font-size="20" fill="${ink.primary}">Minutes until expected departure</text>
<text transform="translate(22 ${m.top + ph / 2}) rotate(-90)" text-anchor="middle" font-size="20" fill="${ink.primary}">Brightness</text>
</svg>
`;
const out = path.join(root, 'public/blog/apple-home-when-to-leave-light/leave-curve.svg');
fs.writeFileSync(out, svg);
console.log(`wrote ${path.relative(root, out)} (${points.length} points)`);
