// A wallpaper is fetched on every switch to a home or room you have not
// visited this session, and nothing is on screen behind it while it arrives.
// So its weight is not a nice-to-have: it is how long the app looks broken for.
//
// homecast-cloud#183 was this budget being ~2.9 MB. The twelve presets were
// PNGs totalling 25.7 MB, and on a 4 Mbit/s link a switch to a home carrying
// one took about 5.9 s — past BackgroundImage's 2 s deadline, which then
// dropped the outgoing wallpaper and revealed an incoming one that had not
// painted. What the user saw was a blank screen, then a picture streaming in.
//
// The ceiling is what a switch can cost, not what an encoder happens to
// produce: 600 KB is ~1.2 s on that same link, comfortably inside the deadline
// with the whole set (2.1 MB) still under what one PNG used to be.

import { describe, it, expect } from 'vitest';
import { statSync } from 'node:fs';
import { join } from 'node:path';
import { PRESET_IMAGES } from '../colorUtils';

const PUBLIC_DIR = join(__dirname, '..', '..', '..', 'public');
const MAX_BYTES_PER_WALLPAPER = 600 * 1024;
const MAX_BYTES_FOR_THE_SET = 3 * 1024 * 1024;

const entries = Object.entries(PRESET_IMAGES);

describe('preset wallpaper weight', () => {
  it('has presets to check', () => {
    expect(entries.length).toBeGreaterThan(0);
  });

  it.each(entries)('%s is served, and is small enough to swap in', (_id, url) => {
    // A relative path under public/ — an absolute URL would not be ours to size.
    expect(url.startsWith('/')).toBe(true);
    const bytes = statSync(join(PUBLIC_DIR, url)).size;
    expect(bytes).toBeLessThanOrEqual(MAX_BYTES_PER_WALLPAPER);
  });

  it('the whole set costs less than one of the PNGs it replaced', () => {
    const total = entries.reduce((n, [, url]) => n + statSync(join(PUBLIC_DIR, url)).size, 0);
    expect(total).toBeLessThanOrEqual(MAX_BYTES_FOR_THE_SET);
  });
});
