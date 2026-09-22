/**
 * Every full-viewport scrim answers the browser's own bars.
 *
 * The rule this enforces is one line long: **if a component paints a scrim
 * over the whole viewport, it renders `EdgeSampleSlivers` too.** The slivers
 * hand iOS 26 Safari's bar sampler the scrimmed colour, and register the dim
 * so `useCanvasTint` darkens the canvas behind everything the slivers cannot
 * reach. Skip them and the bands keep the wallpaper's undimmed brightness
 * while the page goes dark — two lit bars around a dark screen.
 *
 * This is a test rather than a code comment because the comment already
 * existed and did not work. The slivers were opt-in at four call sites; a
 * fifth scrim (`AreaSummary`'s status panel) never opted in, and the bands
 * measured rgb(37,166,185) against rgb(22,98,108) of the page beneath them —
 * parob/homecast-cloud#165, which is the third report of the same class.
 * Nothing about adding a new overlay makes you read EdgeSampleSlivers first,
 * so the reminder has to arrive as a failing test instead.
 *
 * It is a source scan, deliberately. The alternative — mounting every overlay
 * in jsdom — tests only the ones someone remembered to add to the list, which
 * is the exact failure being guarded against. A grep over `src/` sees the file
 * that was added this morning.
 */
import { describe, expect, it } from 'vitest';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const SRC = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..', '..', '..');

/** A box fixed to the whole viewport. */
const FULL_VIEWPORT = /fixed inset-0|fixed-full-screen/;

/** ...that dims what is behind it. Both the literal and the shared helpers. */
const DIMS_THE_PAGE = /bg-black\/\d|OVERLAY_SCRIM|overlayScrim\(/;

/**
 * Files that match the two patterns without being a scrim.
 *
 * Every entry needs a reason, and "it is annoying" is not one — an exemption
 * here is a screen whose bands nobody is watching. Prefer rendering the
 * slivers; they cost two divs and nothing at all off iOS.
 */
const ALLOWED = new Map<string, string>([
  [
    'components/shared/EdgeSampleSlivers.tsx',
    'the slivers themselves',
  ],
  [
    'components/BackgroundImage.tsx',
    'the wallpaper, not a scrim — it matches on prose in its own comments',
  ],
]);

function sourceFiles(dir: string, out: string[] = []): string[] {
  for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
    const full = path.join(dir, entry.name);
    if (entry.isDirectory()) {
      if (entry.name === '__tests__' || entry.name === 'node_modules') continue;
      sourceFiles(full, out);
    } else if (entry.name.endsWith('.tsx') && !entry.name.includes('.test.')) {
      out.push(full);
    }
  }
  return out;
}

describe('edge-sample coverage', () => {
  const files = sourceFiles(SRC);

  it('finds the components to check', () => {
    // A scan that silently matches nothing passes forever. This is the canary:
    // if the class names change, this number goes to zero and says so.
    expect(files.length).toBeGreaterThan(100);
  });

  it('every full-viewport scrim renders EdgeSampleSlivers', () => {
    const missing: string[] = [];
    for (const file of files) {
      const rel = path.relative(SRC, file).split(path.sep).join('/');
      if (ALLOWED.has(rel)) continue;
      const source = fs.readFileSync(file, 'utf8');
      if (!FULL_VIEWPORT.test(source) || !DIMS_THE_PAGE.test(source)) continue;
      // The ELEMENT, not the word. Half these files already name the
      // component in a comment explaining why the bands behave as they do,
      // and a substring check reads those as coverage — which is how the
      // first draft of this test passed against the very bug it was written
      // for.
      if (/<EdgeSampleSlivers[\s/>]/.test(source)) continue;
      missing.push(rel);
    }
    expect(
      missing,
      `These paint a full-viewport scrim and tell the browser's bars nothing about it.\n` +
        `Render <EdgeSampleSlivers dim={...} zIndex={...} /> beside the scrim, with the same\n` +
        `dim the scrim uses (bg-black/40 → 0.4). See components/shared/EdgeSampleSlivers.tsx.`,
    ).toEqual([]);
  });
});
