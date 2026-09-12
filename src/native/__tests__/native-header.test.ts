// @vitest-environment jsdom
/**
 * The native top chrome's handshake with the page (parob/homecast-cloud#120).
 *
 * Two things are worth pinning here, and neither is the happy path.
 *
 * **Feature detection.** The iOS app loads its UI from `homecast.cloud` at
 * runtime, so an installed build is routinely older than the page it renders.
 * Every predicate must answer `false` on a build that predates this preview
 * rather than throwing into a bridge that isn't there — that is the repo's
 * standing rule for new bridge methods, and it is the one this module could
 * break silently.
 *
 * **Exactly one header on screen.** The native bar and the web row draw the
 * same four controls. `isNativeHeaderEnabled()` is the single predicate that
 * decides which, so the `available && enabled` conjunction is asserted from
 * both sides: an older build that somehow carries a stale `enabled` flag must
 * still render the web row, or a user on that build gets no header at all.
 */

import { describe, it, expect, beforeEach, afterEach } from 'vitest';

import {
  isNativeHeaderAvailable,
  isNativeHeaderEnabled,
  setNativeHeaderPreview,
  publishHeaderState,
  installNativeHeaderBridge,
  findHeaderTarget,
  activateHeaderControl,
  statusDotHex,
  NATIVE_HEADER_TARGET_ATTR,
  type NativeHeaderControl,
} from '@/native/native-header';

interface TestWindow {
  homecastNativeHeaderAvailable?: boolean;
  homecastNativeHeaderEnabled?: boolean;
  __homecastNativeHeader?: { tap: (c: string) => void; setEnabled: (e: boolean) => void };
  webkit?: { messageHandlers?: { homecast?: { postMessage: (m: unknown) => void } } };
}

const w = () => window as unknown as TestWindow;

/** Stand in for the iOS build: both globals, and a handler that records. */
function installNativeBuild(): unknown[] {
  const sent: unknown[] = [];
  w().homecastNativeHeaderAvailable = true;
  w().webkit = { messageHandlers: { homecast: { postMessage: (m) => sent.push(m) } } };
  return sent;
}

beforeEach(() => {
  delete w().homecastNativeHeaderAvailable;
  delete w().homecastNativeHeaderEnabled;
  delete w().__homecastNativeHeader;
  delete w().webkit;
  document.body.innerHTML = '';
});

afterEach(() => {
  document.body.innerHTML = '';
});

describe('an older build, which is the common case', () => {
  it('reports the bar unavailable when neither global is set', () => {
    expect(isNativeHeaderAvailable()).toBe(false);
    expect(isNativeHeaderEnabled()).toBe(false);
  });

  it('does not throw when asked to publish or toggle with no bridge at all', () => {
    // A browser tab: no `webkit`, no handler. This is most of the traffic.
    expect(() => publishHeaderState({ title: 'Home' })).not.toThrow();
    expect(publishHeaderState({ title: 'Home' })).toBe(false);
    expect(setNativeHeaderPreview(true)).toBe(false);
  });

  it('swallows a postMessage that throws rather than taking the header down', () => {
    w().homecastNativeHeaderAvailable = true;
    w().webkit = {
      messageHandlers: {
        homecast: {
          postMessage: () => {
            throw new Error('no such handler');
          },
        },
      },
    };
    expect(() => publishHeaderState({ title: 'Home' })).not.toThrow();
    expect(publishHeaderState({ title: 'Home' })).toBe(false);
  });
});

describe('which header is on screen', () => {
  it('needs BOTH available and enabled — a stale enabled flag alone is not enough', () => {
    w().homecastNativeHeaderEnabled = true;
    // `available` never set: an older build. The web row must still draw, or
    // this user has no header at all.
    expect(isNativeHeaderEnabled()).toBe(false);
  });

  it('is the web row while the preview is off on a capable build', () => {
    installNativeBuild();
    expect(isNativeHeaderAvailable()).toBe(true);
    expect(isNativeHeaderEnabled()).toBe(false);
  });

  it('is the native bar once native says so', () => {
    installNativeBuild();
    installNativeHeaderBridge({ onTap: () => {} });
    w().__homecastNativeHeader!.setEnabled(true);
    expect(isNativeHeaderEnabled()).toBe(true);
  });

  it('hands the web row back when native turns the preview off', () => {
    installNativeBuild();
    const seen: boolean[] = [];
    installNativeHeaderBridge({ onTap: () => {}, onEnabledChange: (e) => seen.push(e) });

    w().__homecastNativeHeader!.setEnabled(true);
    w().__homecastNativeHeader!.setEnabled(false);

    // Without a reload — which is what makes it usable as a preview.
    expect(seen).toEqual([true, false]);
    expect(isNativeHeaderEnabled()).toBe(false);
  });
});

describe('what the page publishes down', () => {
  it('sends ONLY the keys the caller set, so two publishers do not erase each other', () => {
    const sent = installNativeBuild();
    // `AppHeader` owns the title; `StatusBadge` owns the dot. Native merges, so
    // a title publish carrying `statusColor: undefined` would blank the dot on
    // every render — which during a pod handoff is several times a second.
    publishHeaderState({ title: 'County Hall' });
    expect(sent).toEqual([{ action: 'header.setState', title: 'County Hall' }]);
    expect(Object.keys(sent[0] as object)).not.toContain('statusColor');
  });

  it('sends an explicit null status colour, which means hide rather than unchanged', () => {
    const sent = installNativeBuild();
    publishHeaderState({ statusColor: null });
    expect(sent).toEqual([{ action: 'header.setState', statusColor: null }]);
  });

  it('carries the status colour and per-control visibility through', () => {
    const sent = installNativeBuild();
    publishHeaderState({ title: 'Kitchen', statusColor: '#22c55e', showOverflow: false });
    expect(sent[0]).toEqual({
      action: 'header.setState',
      title: 'Kitchen',
      statusColor: '#22c55e',
      showOverflow: false,
    });
  });

  it('publishes while the preview is still off, so the bar is never blank when it appears', () => {
    const sent = installNativeBuild();
    expect(isNativeHeaderEnabled()).toBe(false);
    expect(publishHeaderState({ title: 'Home' })).toBe(true);
    expect(sent).toHaveLength(1);
  });

  it('translates the web dot class to a colour UIKit can draw', () => {
    // Matched on the colour name, not the exact class, so the opacity variant
    // the good state actually uses does not fall through to grey.
    expect(statusDotHex('bg-emerald-500/60')).toBe('#10b981');
    expect(statusDotHex('bg-emerald-500')).toBe('#10b981');
    expect(statusDotHex('bg-amber-500')).toBe('#f59e0b');
    expect(statusDotHex('bg-red-500')).toBe('#ef4444');
    // A real state, not an error: connected to nothing in particular.
    expect(statusDotHex('bg-muted-foreground/40')).toBe('#8e8e93');
    expect(statusDotHex(null)).toBeNull();
    expect(statusDotHex(undefined)).toBeNull();
  });

  it('asks native to write the preference when the switch is flipped', () => {
    const sent = installNativeBuild();
    expect(setNativeHeaderPreview(true)).toBe(true);
    expect(sent).toEqual([{ action: 'settings.setNativeHeaderPreview', enabled: true }]);
  });
});

describe('a native tap reaching the real web control', () => {
  function addControl(control: NativeHeaderControl): { el: HTMLButtonElement; clicks: number[] } {
    const el = document.createElement('button');
    el.setAttribute(NATIVE_HEADER_TARGET_ATTR, control);
    const clicks: number[] = [];
    el.addEventListener('click', () => clicks.push(1));
    document.body.appendChild(el);
    return { el, clicks };
  }

  it('clicks the trigger, so Radix opens exactly as it does for a web tap', () => {
    const menu = addControl('menu');
    expect(activateHeaderControl('menu')).toBe(true);
    expect(menu.clicks).toHaveLength(1);
  });

  it('routes each of the four to its own control and nothing else', () => {
    const controls: NativeHeaderControl[] = ['menu', 'status', 'search', 'overflow'];
    const added = controls.map((c) => ({ control: c, ...addControl(c) }));

    activateHeaderControl('search');

    expect(added.filter((a) => a.clicks.length > 0).map((a) => a.control)).toEqual(['search']);
  });

  it('answers false on a screen that has no such control instead of throwing', () => {
    // A share link or the login page: no ⋮ anywhere. Not a failure.
    expect(findHeaderTarget('overflow')).toBeNull();
    expect(activateHeaderControl('overflow')).toBe(false);
  });

  it('ignores a control name it has never heard of', () => {
    installNativeBuild();
    const seen: string[] = [];
    installNativeHeaderBridge({ onTap: (c) => seen.push(c) });

    // A newer build talking to this page. Throwing here would surface inside an
    // `evaluateJavaScript` whose result nothing reads.
    expect(() => w().__homecastNativeHeader!.tap('teleport')).not.toThrow();
    w().__homecastNativeHeader!.tap('status');

    expect(seen).toEqual(['status']);
  });

  it('removes its global on teardown', () => {
    installNativeBuild();
    const teardown = installNativeHeaderBridge({ onTap: () => {} });
    expect(w().__homecastNativeHeader).toBeDefined();
    teardown();
    expect(w().__homecastNativeHeader).toBeUndefined();
  });
});
