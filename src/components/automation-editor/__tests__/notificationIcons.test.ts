/**
 * Guard for the Notify node's delivered-icon set.
 *
 * Unlike the canvas icons, these have to exist in three places at once: the
 * registry the picker reads, a committed PNG the server hands to APNs and FCM as
 * a URL, and a symbol the relay Mac renders natively. The PNG is the one this
 * repo can check, and it is the one that breaks silently — a slug with no PNG
 * produces a 404 that no client reports, so the notification simply arrives
 * without its icon and nothing anywhere says why.
 *
 * Slugs are also a public contract: `notification-icons/{slug}.png` is a URL
 * that already-shipped automations point at. Renaming one is a breaking change.
 */

import { describe, it, expect } from 'vitest';
import { existsSync, readFileSync } from 'node:fs';
import { join } from 'node:path';
import {
  NOTIFICATION_ICONS,
  NOTIFICATION_ICON_COLORS,
  DEFAULT_NOTIFICATION_ICON_COLOR,
  getNotificationIconColor,
  isNotificationIconColor,
  DEFAULT_NOTIFICATION_ICON,
  getNotificationIcon,
  isNotificationIconSlug,
  isNotificationIconUrl,
  isValidNotificationIcon,
} from '../notificationIcons';

const ICON_DIR = join(process.cwd(), 'public/notification-icons');

describe('notification icon registry', () => {
  it('has a committed PNG for every slug', () => {
    const missing = NOTIFICATION_ICONS
      .filter(({ slug }) => !existsSync(join(ICON_DIR, `${slug}.png`)))
      .map(({ slug }) => slug);

    expect(missing, 'run `npm run icons:notifications`').toEqual([]);
  });

  it('matches the generated index', () => {
    const index = JSON.parse(readFileSync(join(ICON_DIR, 'index.json'), 'utf8')) as { slugs: string[] };
    expect(index.slugs).toEqual(NOTIFICATION_ICONS.map((i) => i.slug).sort());
  });

  it('has unique slugs', () => {
    const slugs = NOTIFICATION_ICONS.map((i) => i.slug);
    expect(slugs).toEqual([...new Set(slugs)]);
  });

  it('keeps every slug URL-safe', () => {
    const bad = NOTIFICATION_ICONS
      .filter(({ slug }) => !/^[a-z0-9-]{1,40}$/.test(slug))
      .map(({ slug }) => slug);

    expect(bad).toEqual([]);
  });

  it('registers the default icon', () => {
    expect(getNotificationIcon(DEFAULT_NOTIFICATION_ICON)).toBeDefined();
  });

  it('resolves a slug to its definition and an unknown one to undefined', () => {
    expect(getNotificationIcon('leak')?.lucide).toBe('droplet');
    expect(getNotificationIcon('not-a-real-slug')).toBeUndefined();
    expect(getNotificationIcon(undefined)).toBeUndefined();
  });
});

describe('relay Mac symbol map', () => {
  // The third place the list has to exist. The relay draws the icon natively
  // rather than fetching the PNG, so a slug the Swift map has never heard of
  // silently becomes a generic bell on the one channel Community Edition has.
  //
  // Skipped when the Mac app isn't checked out beside this one — app-web is its
  // own repo and CI builds it alone.
  const SWIFT = join(process.cwd(), '../app-ios-macos/Sources/Server/NotificationManager.swift');
  const present = existsSync(SWIFT);

  it.runIf(present)('has an SF Symbol for every slug', () => {
    const src = readFileSync(SWIFT, 'utf8');
    const body = src.split('static let symbolForSlug: [String: String] = [')[1]?.split('\n    ]')[0] ?? '';
    const mapped = new Set([...body.matchAll(/"([^"]+)":\s*"[^"]+"/g)].map((m) => m[1]));

    expect(mapped.size, 'could not parse symbolForSlug').toBeGreaterThan(20);

    const missing = NOTIFICATION_ICONS.map((i) => i.slug).filter((s) => !mapped.has(s));
    expect(missing, 'add these to symbolForSlug in NotificationManager.swift').toEqual([]);

    const orphaned = [...mapped].filter((s) => !NOTIFICATION_ICONS.some((i) => i.slug === s));
    expect(orphaned, 'these slugs are no longer in the registry').toEqual([]);
  });
});

describe('notification icon validation', () => {
  it('accepts registered slugs only', () => {
    expect(isNotificationIconSlug('alert')).toBe(true);
    expect(isNotificationIconSlug('not-a-real-slug')).toBe(false);
  });

  it('rejects slugs that could escape the icon URL path', () => {
    // The server interpolates a slug straight into
    // `{origin}/notification-icons/{slug}.png`, so anything that can climb out
    // of that directory has to fail the same shape check on both sides.
    for (const evil of ['../../etc/passwd', 'a/b', 'a.b', '%2e%2e', 'a b']) {
      expect(isNotificationIconSlug(evil), evil).toBe(false);
      expect(isValidNotificationIcon(evil), evil).toBe(false);
    }
  });

  it('accepts https URLs and rejects other schemes', () => {
    expect(isNotificationIconUrl('https://example.com/snap.png')).toBe(true);
    for (const bad of [
      'http://example.com/snap.png',
      'file:///etc/passwd',
      'data:image/png;base64,AAAA',
      'javascript:alert(1)',
    ]) {
      expect(isNotificationIconUrl(bad), bad).toBe(false);
      expect(isValidNotificationIcon(bad), bad).toBe(false);
    }
  });

  it('lets templates through — they are only a URL once the automation runs', () => {
    expect(isValidNotificationIcon('{{ nodes.snapshot.data.url }}')).toBe(true);
  });

  it('treats an empty icon as valid, meaning none', () => {
    expect(isValidNotificationIcon('')).toBe(true);
  });
});

describe('notification icon colours', () => {
  it('has a PNG for every colour x slug', () => {
    const missing: string[] = [];
    for (const c of NOTIFICATION_ICON_COLORS) {
      for (const { slug } of NOTIFICATION_ICONS) {
        if (!existsSync(join(ICON_DIR, c.slug, `${slug}.png`))) missing.push(`${c.slug}/${slug}`);
      }
    }
    expect(missing, 'run `npm run icons:notifications`').toEqual([]);
  });

  it('keeps the default colour at the root path too', () => {
    // The root path is what automations written before colours existed point
    // at. It must exist AND look like the default, or every one of them changes
    // appearance the day colours ship.
    for (const { slug } of NOTIFICATION_ICONS.slice(0, 5)) {
      const root = readFileSync(join(ICON_DIR, `${slug}.png`));
      const dflt = readFileSync(join(ICON_DIR, DEFAULT_NOTIFICATION_ICON_COLOR, `${slug}.png`));
      expect(root.equals(dflt), slug).toBe(true);
    }
  });

  it('names the default colour in the palette', () => {
    expect(NOTIFICATION_ICON_COLORS.map((c) => c.slug)).toContain(DEFAULT_NOTIFICATION_ICON_COLOR);
  });

  it('keeps colour slugs URL-safe and unique', () => {
    const slugs = NOTIFICATION_ICON_COLORS.map((c) => c.slug);
    expect(slugs).toEqual([...new Set(slugs)]);
    expect(slugs.filter((s) => !/^[a-z0-9-]{1,20}$/.test(s))).toEqual([]);
  });

  it('matches the colours the server will accept', () => {
    // The server keeps its own closed set (a slug is only shape-checked, but an
    // unknown colour silently falls back), so the two lists have to agree.
    expect(NOTIFICATION_ICON_COLORS.map((c) => c.slug).sort()).toEqual(
      ['amber', 'blue', 'green', 'pink', 'purple', 'red', 'slate', 'teal'],
    );
  });

  it('resolves an unknown colour to the default rather than throwing', () => {
    expect(getNotificationIconColor('fuchsia').slug).toBe(DEFAULT_NOTIFICATION_ICON_COLOR);
    expect(getNotificationIconColor(undefined).slug).toBe(DEFAULT_NOTIFICATION_ICON_COLOR);
    expect(isNotificationIconColor('fuchsia')).toBe(false);
    expect(isNotificationIconColor('red')).toBe(true);
  });
});
