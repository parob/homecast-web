// A deep link is handed to the app as a URL and loaded straight into the
// WKWebView. The host was allow-listed; the path was not — so Safari's "Open in
// the Homecast app" banner on the marketing site opened the app on our own
// advertising. handleDeepLink now collapses anything that is not a screen of
// the app to /portal.
//
// That leaves two lists that have to disagree with each other forever: the
// marketing paths here, and the app path segments in Swift. The Mac app has no
// test target, so the pin lives here.

import { describe, it, expect } from 'vitest';
import { existsSync, readFileSync } from 'node:fs';
import { join } from 'node:path';
import { MARKETING_PATHS } from '../marketing-routes';

const APP_PATH = join(
  __dirname, '..', '..', '..', '..',
  'app-ios-macos', 'Sources', 'App', 'HomecastApp.swift',
);

// Standalone checkouts of the app-web repo don't have the Mac app sources.
const hasSource = existsSync(APP_PATH);

describe.skipIf(!hasSource)('Swift handleDeepLink pins', () => {
  const source = hasSource ? readFileSync(APP_PATH, 'utf8') : '';
  const body = source.slice(
    source.indexOf('private static let appPathSegments'),
    source.indexOf('private func handleAutoReload'),
  );

  it('owns the screens the web route table treats as app surfaces', () => {
    for (const segment of ['portal', 'login', 'signup', 'oauth', 's', 'delete-account']) {
      expect(body).toContain(`"${segment}"`);
    }
  });

  it('never claims a marketing path as a screen of the app', () => {
    // The drift guard. "/" yields no segment and is skipped — that is the
    // point: the bare root can never be an app path, which is what makes the
    // banner land on the dashboard instead of the landing page.
    const claimed = MARKETING_PATHS
      .map(path => path.split('/').filter(Boolean)[0])
      .filter(Boolean)
      .filter(segment => body.includes(`"${segment}"`));
    expect(claimed).toEqual([]);
  });

  it('collapses anything else to the portal instead of loading it verbatim', () => {
    expect(body).toContain('components.path = "/portal"');
    // The old behaviour: trust the host, load whatever path came with it.
    expect(body).not.toMatch(/\btarget = url\b/);
  });

  it('keeps the query, which is the reason the link was tapped', () => {
    expect(body).not.toContain('components.query = nil');
  });
});
