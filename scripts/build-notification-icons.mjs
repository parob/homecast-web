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
const BRAND = '#3B82F6';
const BRAND_DARK = '#2563EB';

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

function tile(glyphSvgBody) {
  return Buffer.from(`<svg xmlns="http://www.w3.org/2000/svg" width="${SIZE}" height="${SIZE}" viewBox="0 0 ${SIZE} ${SIZE}">
  <defs><linearGradient id="bg" x1="0" y1="0" x2="1" y2="1">
    <stop offset="0%" stop-color="${BRAND}"/><stop offset="100%" stop-color="${BRAND_DARK}"/>
  </linearGradient></defs>
  <rect width="${SIZE}" height="${SIZE}" rx="${CORNER}" ry="${CORNER}" fill="url(#bg)"/>
  <g transform="translate(${(SIZE - GLYPH) / 2}, ${(SIZE - GLYPH) / 2}) scale(${GLYPH / 24})"
     fill="none" stroke="#ffffff" stroke-width="2" stroke-linecap="round" stroke-linejoin="round">
    ${glyphSvgBody}
  </g>
</svg>`);
}

const icons = readRegistry();
mkdirSync(OUT_DIR, { recursive: true });

const written = new Set();
for (const { slug, lucide } of icons) {
  const svgPath = join(LUCIDE_DIR, `${lucide}.svg`);
  let raw;
  try {
    raw = readFileSync(svgPath, 'utf8');
  } catch {
    throw new Error(`${slug}: lucide-static has no icon "${lucide}" (${svgPath})`);
  }

  // Keep only the drawing, and drop the wrapper's own stroke/size attributes —
  // the tile above supplies white stroke at the right scale.
  const body = raw.replace(/^[\s\S]*?<svg[^>]*>/, '').replace(/<\/svg>\s*$/, '').trim();
  if (!body) throw new Error(`${slug}: empty glyph parsed from ${lucide}.svg`);

  // Rasterise above target and scale down: `density` is DPI against the SVG's
  // declared size, so it oversamples rather than resizes, and the explicit
  // resize is what actually pins the output to SIZE.
  await sharp(tile(body), { density: 288 })
    .resize(SIZE, SIZE)
    .png({ compressionLevel: 9, palette: true })
    .toFile(join(OUT_DIR, `${slug}.png`));
  written.add(`${slug}.png`);
}

// A slug that was renamed leaves its old PNG behind, still reachable, still
// pointed at by automations that were never updated. Say so rather than let the
// directory quietly diverge from the registry.
const stale = readdirSync(OUT_DIR).filter((f) => f.endsWith('.png') && !written.has(f));

writeFileSync(
  join(OUT_DIR, 'index.json'),
  JSON.stringify({ slugs: icons.map((i) => i.slug).sort() }, null, 2) + '\n',
);

console.log(`Wrote ${written.size} icons to public/notification-icons/`);
if (stale.length) {
  console.warn(`\nWARNING — ${stale.length} PNG(s) no longer in the registry: ${stale.join(', ')}`);
  console.warn('Automations may still reference them. Delete only if you are sure.');
}
