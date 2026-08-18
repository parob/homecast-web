// Safari draws its "Open in the Homecast app" banner wherever the site claims a
// path, and that banner sits inside the viewport — it moves the layout out from
// under any fixed layer as it scrolls away. The claim is therefore a layout
// decision as much as a linking one, and it is deliberately narrow: the portal
// only. The bare root used to be claimed so email CTAs would open the app; those
// now link to /portal directly (homecast-cloud/server/homecast/email.py).

import { describe, it, expect } from 'vitest';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';

const AASA = JSON.parse(
  readFileSync(join(__dirname, '..', '..', '..', 'public', '.well-known', 'apple-app-site-association'), 'utf8'),
);

const components = AASA.applinks.details[0].components as Array<Record<string, unknown>>;
const claimed = components.filter(c => !c.exclude).map(c => c['/']);
const excluded = components.filter(c => c.exclude).map(c => c['/']);

describe('apple-app-site-association', () => {
  it('claims the portal', () => {
    expect(claimed).toContain('/portal');
    expect(claimed).toContain('/portal/*');
  });

  it('does not claim the bare root', () => {
    // The root serves the marketing landing page. Claiming it put Safari's
    // banner on the website and clipped the wallpaper behind it.
    expect(claimed).not.toContain('/');
  });

  it('claims nothing outside the portal', () => {
    for (const path of claimed) {
      expect(String(path).startsWith('/portal')).toBe(true);
    }
  });

  it('keeps both escape hatches', () => {
    expect(excluded).toContain('/*');          // ?browser=1
    expect(excluded).toContain('/portal/admin/*');
    const browserHatch = components.find(c => c['/'] === '/*' && c.exclude);
    expect((browserHatch as { '?': Record<string, string> })['?']).toEqual({ browser: '1' });
  });

  it('still binds the app id for webcredentials', () => {
    expect(AASA.webcredentials.apps).toContain('3HMH4559WD.cloud.homecast.app');
  });
});
