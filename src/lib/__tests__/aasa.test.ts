// Safari draws its "Open in the Homecast app" banner on whatever the app
// claims, and that banner is chrome inside the layout viewport — it followed
// people around the site and clipped the wallpaper behind it.
//
// The fix is indirection, not amputation: the claim is one doormat path that
// nobody browses to. Emails point at /open, so tapping one still opens the app,
// while every page anyone actually reads claims nothing and gets no banner.
//
// The rule this file exists to hold: a page people read must never be claimed.

import { describe, it, expect } from 'vitest';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';

const AASA = JSON.parse(
  readFileSync(join(__dirname, '..', '..', '..', 'public', '.well-known', 'apple-app-site-association'), 'utf8'),
);

const components = AASA.applinks.details[0].components as Array<Record<string, unknown>>;
const claimed = components.filter(c => !c.exclude).map(c => String(c['/']));
const excluded = components.filter(c => c.exclude).map(c => String(c['/']));

describe('apple-app-site-association', () => {
  it('claims the doormat, so an emailed link still opens the app', () => {
    expect(claimed).toContain('/open');
  });

  it('claims nothing anyone browses to', () => {
    // Every one of these is a page with a reader. A banner on any of them is
    // the bug: it moves the viewport out from under the fixed wallpaper.
    const readable = [
      '/', '/portal', '/portal/*', '/pricing', '/how-it-works',
      '/terms', '/privacy', '/cookies', '/login', '/signup', '/delete-account',
    ];
    for (const path of readable) {
      expect(claimed).not.toContain(path);
    }
  });

  it('claims only paths under /open', () => {
    for (const path of claimed) {
      expect(path === '/open' || path.startsWith('/open/')).toBe(true);
    }
  });

  it('keeps the ?browser=1 escape hatch', () => {
    expect(excluded).toContain('/*');
    const hatch = components.find(c => c['/'] === '/*' && c.exclude);
    expect((hatch as { '?': Record<string, string> })['?']).toEqual({ browser: '1' });
  });

  it('still binds the app id for webcredentials', () => {
    // Password AutoFill is a separate key and draws no banner — keep it.
    expect(AASA.webcredentials.apps).toContain('3HMH4559WD.cloud.homecast.app');
  });
});
