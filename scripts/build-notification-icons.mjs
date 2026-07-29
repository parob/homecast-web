// Rasterises the Notify node's built-in icon set to PNGs.
//
// APNs and FCM can only be handed a URL — they will not render an SVG and they
// certainly cannot render a React component — so every slug in
// `src/components/automation-editor/notificationIcons.ts` needs a bitmap sitting
// at a public URL. Firebase Hosting serves `public/` at the site root, so the
// output lands at https://homecast.cloud/notification-icons/{slug}.png.
//
// The output is committed. This script is NOT part of `npm run build`, so CI and
// the production build never need sharp or lucide-static — only regenerating the
// set does. Run it with:
//
//   npm run icons:notifications
//
// Slugs are a public contract (already-shipped automations point at these URLs).
// Adding one is free; renaming or removing one breaks live notifications.

import { readFileSync, writeFileSync, mkdirSync, readdirSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import sharp from 'sharp';

const HERE = dirname(fileURLToPath(import.meta.url));
const ROOT = join(HERE, '..');
const REGISTRY = join(ROOT, 'src/components/automation-editor/notificationIcons.ts');
const LUCIDE_DIR = join(ROOT, 'node_modules/lucide-static/icons');
const OUT_DIR = join(ROOT, 'public/notification-icons');

const SIZE = 256;
const CORNER = 56;
const GLYPH = 148; // ~58% of the canvas, so the glyph breathes inside the tile

/** Pull `{ slug, lucide }` pairs out of the registry, which is the one list. */
function readRegistry() {
  const src = readFileSync(REGISTRY, 'utf8');
  const body = src.split('NOTIFICATION_ICONS: NotificationIconDef[] = [')[1]?.split('\n];')[0];
  if (!body) throw new Error(`Could not find NOTIFICATION_ICONS array in ${REGISTRY}`);

  const icons = [];
  for (const line of body.split('\n')) {
    const slug = line.match(/\bslug:\s*'([^']+)'/);
    const lucide = line.match(/\blucide:\s*'([^']+)'/);
    if (slug && lucide) icons.push({ slug: slug[1], lucide: lucide[1] });
    else if (slug || lucide) {
      // One without the other means the entry was reformatted across lines and
      // this parser would silently skip it — louder to stop than to under-build.
      throw new Error(`Entry split across lines, cannot parse: ${line.trim()}`);
    }
  }
  if (icons.length < 20) throw new Error(`Only parsed ${icons.length} icons — the parser is wrong`);
  return icons;
}

/** Same file, the colour palette. */
function readPalette() {
  const src = readFileSync(REGISTRY, 'utf8');
  const body = src.split('NOTIFICATION_ICON_COLORS: NotificationIconColor[] = [')[1]?.split('\n];')[0];
  if (!body) throw new Error(`Could not find NOTIFICATION_ICON_COLORS array in ${REGISTRY}`);

  const colors = [];
  for (const line of body.split('\n')) {
    const m = line.match(/\bslug:\s*'([^']+)'.*\bfrom:\s*'(#[0-9A-Fa-f]{6})'.*\bto:\s*'(#[0-9A-Fa-f]{6})'/);
    if (m) colors.push({ slug: m[1], from: m[2], to: m[3] });
    else if (/\bslug:\s*'/.test(line)) throw new Error(`Cannot parse colour: ${line.trim()}`);
  }
  if (!colors.length) throw new Error('Parsed no colours — the parser is wrong');

  const dflt = src.match(/DEFAULT_NOTIFICATION_ICON_COLOR = '([^']+)'/)?.[1];
  if (!dflt || !colors.some((c) => c.slug === dflt)) {
    throw new Error(`DEFAULT_NOTIFICATION_ICON_COLOR "${dflt}" is not in the palette`);
  }
  return { colors, dflt };
}

function tile(glyphSvgBody, from, to) {
  return Buffer.from(`<svg xmlns="http://www.w3.org/2000/svg" width="${SIZE}" height="${SIZE}" viewBox="0 0 ${SIZE} ${SIZE}">
  <defs><linearGradient id="bg" x1="0" y1="0" x2="1" y2="1">
    <stop offset="0%" stop-color="${from}"/><stop offset="100%" stop-color="${to}"/>
  </linearGradient></defs>
  <rect width="${SIZE}" height="${SIZE}" rx="${CORNER}" ry="${CORNER}" fill="url(#bg)"/>
  <g transform="translate(${(SIZE - GLYPH) / 2}, ${(SIZE - GLYPH) / 2}) scale(${GLYPH / 24})"
     fill="none" stroke="#ffffff" stroke-width="2" stroke-linecap="round" stroke-linejoin="round">
    ${glyphSvgBody}
  </g>
</svg>`);
}

/** Strip lucide's wrapper, keeping just the drawing. */
function glyph(lucide, slug) {
  const svgPath = join(LUCIDE_DIR, `${lucide}.svg`);
  let raw;
  try {
    raw = readFileSync(svgPath, 'utf8');
  } catch {
    throw new Error(`${slug}: lucide-static has no icon "${lucide}" (${svgPath})`);
  }
  // The tile supplies white stroke at the right scale, so the wrapper's own
  // stroke/size attributes go with it.
  const body = raw.replace(/^[\s\S]*?<svg[^>]*>/, '').replace(/<\/svg>\s*$/, '').trim();
  if (!body) throw new Error(`${slug}: empty glyph parsed from ${lucide}.svg`);
  return body;
}

async function render(body, color, outPath) {
  // Rasterise above target and scale down: `density` is DPI against the SVG's
  // declared size, so it oversamples rather than resizes, and the explicit
  // resize is what actually pins the output to SIZE.
  await sharp(tile(body, color.from, color.to), { density: 288 })
    .resize(SIZE, SIZE)
    .png({ compressionLevel: 9, palette: true })
    .toFile(outPath);
}

const icons = readRegistry();
const { colors, dflt } = readPalette();
mkdirSync(OUT_DIR, { recursive: true });

let count = 0;
for (const { slug, lucide } of icons) {
  const body = glyph(lucide, slug);

  for (const color of colors) {
    const dir = join(OUT_DIR, color.slug);
    mkdirSync(dir, { recursive: true });
    await render(body, color, join(dir, `${slug}.png`));
    count++;
  }

  // The root path is the pre-colour URL. Every automation created before
  // colours existed points at `/notification-icons/{slug}.png`, and those
  // notifications are already out in the world — so it stays, and it stays the
  // default colour so they keep looking the way they did.
  await render(body, colors.find((c) => c.slug === dflt), join(OUT_DIR, `${slug}.png`));
  count++;
}

writeFileSync(
  join(OUT_DIR, 'index.json'),
  JSON.stringify(
    {
      slugs: icons.map((i) => i.slug).sort(),
      colors: colors.map((c) => c.slug),
      defaultColor: dflt,
    },
    null,
    2,
  ) + '\n',
);

// A slug renamed out of the registry leaves its PNGs behind, still reachable and
// still pointed at by automations nobody updated. Say so rather than let the
// directory quietly diverge.
const known = new Set(icons.map((i) => `${i.slug}.png`));
const stale = readdirSync(OUT_DIR).filter((f) => f.endsWith('.png') && !known.has(f));

console.log(`Wrote ${count} PNGs — ${icons.length} icons x ${colors.length} colours, plus the default at the root`);
if (stale.length) {
  console.warn(`\nWARNING — ${stale.length} root PNG(s) not in the registry: ${stale.join(', ')}`);
  console.warn('Automations may still reference them. Delete only if you are sure.');
}
