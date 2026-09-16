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
  isNativeHomeSwipeEnabled,
  setNativeHeaderPreview,
  publishHeaderState,
  installNativeHeaderBridge,
  findHeaderTarget,
  activateHeaderControl,
  statusDotHex,
  nativeHeaderInsets,
  watchNativeHeaderCover,
  NATIVE_HEADER_COVER_ATTR,
  publishRefreshDone,
  nativeHeaderRowCenter,
  nativeHeaderContentInset,
  isNativePageHeading,
  NATIVE_HEADER_EVENT,
  NATIVE_HEADER_TARGET_ATTR,
  type NativeHeaderControl,
} from '@/native/native-header';

interface TestWindow {
  homecastNativeHeaderAvailable?: boolean;
  homecastNativeHeaderEnabled?: boolean;
  homecastNativeHomeSwipeAvailable?: boolean;
  __homecastNativeHeader?: {
    tap: (c: string) => void;
    setEnabled: (e: boolean, bar?: number, status?: number, base?: number, eyebrow?: number) => void;
    selectHome?: (id: string) => void;
    refresh?: (kind: string) => void;
  };
  homecastNativeHeaderInsets?: { bar: number; status: number; base?: number; eyebrow?: number };
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
  delete w().homecastNativeHomeSwipeAvailable;
  delete w().__homecastNativeHeader;
  delete w().homecastNativeHeaderInsets;
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
  it('only hands home swipes to an enabled shell that supports them', () => {
    installNativeBuild();
    w().homecastNativeHeaderEnabled = true;
    expect(isNativeHomeSwipeEnabled()).toBe(false);
    w().homecastNativeHomeSwipeAvailable = true;
    expect(isNativeHomeSwipeEnabled()).toBe(true);
    w().homecastNativeHeaderEnabled = false;
    expect(isNativeHomeSwipeEnabled()).toBe(false);
    w().homecastNativeHeaderEnabled = true;
    delete w().homecastNativeHeaderAvailable;
    expect(isNativeHomeSwipeEnabled()).toBe(false);
  });
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

describe('the Home-app-shaped bar (large title, title menu, native ⋯)', () => {
  it('publishes homes, the current home, the menu and the appearance', () => {
    const sent = installNativeBuild();
    publishHeaderState({
      homes: [{ id: 'h1', name: 'George Street' }],
      currentHomeId: 'h1',
      menu: [{ id: 'home', title: 'George Street', items: [{ id: 'home:share', label: 'Share', symbol: 'square.and.arrow.up' }] }],
      appearance: 'dark',
    });
    expect(sent).toHaveLength(1);
    const message = sent[0] as Record<string, unknown>;
    expect(message.action).toBe('header.setState');
    expect(message.homes).toEqual([{ id: 'h1', name: 'George Street' }]);
    expect(message.currentHomeId).toBe('h1');
    expect(message.appearance).toBe('dark');
    expect(message.menu).toHaveLength(1);
    // Absent keys stay absent — the native side merges.
    expect('title' in message).toBe(false);
  });

  it('routes a native home pick and a native menu pick to the page', () => {
    installNativeBuild();
    const homes: string[] = [];
    const actions: string[] = [];
    installNativeHeaderBridge({
      onTap: () => {},
      onSelectHome: (id) => homes.push(id),
      onMenuAction: (id) => actions.push(id),
    });
    w().__homecastNativeHeader!.selectHome!('h2');
    (w().__homecastNativeHeader as unknown as { menuAction: (id: string) => void }).menuAction('home:share');
    expect(homes).toEqual(['h2']);
    expect(actions).toEqual(['home:share']);
  });

  it('remembers the insets the shell reports and announces the change', () => {
    installNativeBuild();
    installNativeHeaderBridge({ onTap: () => {} });
    const seen: boolean[] = [];
    window.addEventListener(NATIVE_HEADER_EVENT, ((e: CustomEvent) => seen.push(e.detail.enabled)) as EventListener);
    w().__homecastNativeHeader!.setEnabled(true, 168, 62);
    expect(nativeHeaderInsets()).toEqual({ bar: 168, status: 62 });
    expect(seen).toEqual([true]);
    // Off again: the flag flips, the last insets are kept for the next on.
    w().__homecastNativeHeader!.setEnabled(false);
    expect(isNativeHeaderEnabled()).toBe(false);
    expect(nativeHeaderInsets()).toEqual({ bar: 168, status: 62 });
  });

  it('pads for the eyebrow itself when the shell reports the base band, and falls back to the whole bar when it does not', () => {
    installNativeBuild();
    installNativeHeaderBridge({ onTap: () => {} });
    // A newer shell, on a room page: the whole band is 186 (base 168 + an
    // 18pt eyebrow). The page pads by the base plus the line only while IT
    // is on a page — so a pop to the home repads in the same render.
    w().__homecastNativeHeader!.setEnabled(true, 186, 62, 168, 18);
    expect(nativeHeaderContentInset(true)).toBe(186);
    expect(nativeHeaderContentInset(false)).toBe(168);
    // The row's centre line comes from the base, so it does not move by 18
    // between the home and a room.
    expect(nativeHeaderRowCenter()).toBe(62 + (168 - 52 - 62) / 2);
    // An older shell says only what it measured, eyebrow included or not.
    w().__homecastNativeHeader!.setEnabled(true, 186, 62);
    expect(nativeHeaderContentInset(false)).toBe(186);
    expect(isNativePageHeading('Front Door', 'George Street')).toBe(true);
    expect(isNativePageHeading('George Street', 'George Street')).toBe(false);
    expect(isNativePageHeading('  ', 'George Street')).toBe(false);
  });

  it('tells the shell the page is ready once the bridge is installed', () => {
    const sent = installNativeBuild();
    installNativeHeaderBridge({ onTap: () => {} });
    expect(sent).toContainEqual({ action: 'header.ready' });
  });
});

describe('the native pull-to-refresh', () => {
  it('routes a refresh to the page and lets the page report done', () => {
    const sent = installNativeBuild();
    const kinds: string[] = [];
    installNativeHeaderBridge({ onTap: () => {}, onRefresh: (kind) => kinds.push(kind) });
    w().__homecastNativeHeader!.refresh!('soft');
    w().__homecastNativeHeader!.refresh!('hard');
    w().__homecastNativeHeader!.refresh!('sideways');
    expect(kinds).toEqual(['soft', 'hard', 'soft']);
    expect(publishRefreshDone()).toBe(true);
    expect(sent.at(-1)).toEqual({ action: 'header.refreshDone' });
  });
});

describe("where the bar's controls sit", () => {
  it('derives the bar row centre from the reported insets', () => {
    installNativeBuild();
    w().homecastNativeHeaderInsets = { bar: 165, status: 59 };
    // compact bar 59..113, centred at 86
    expect(nativeHeaderRowCenter()).toBe(86);
    // sidebar layout: no band, a standard 54pt row of buttons
    w().homecastNativeHeaderInsets = { bar: 59, status: 59 };
    expect(nativeHeaderRowCenter()).toBe(86);
  });
});

describe('stepping aside for web overlays', () => {
  it('reports covered while a Radix dialog or sheet is open, and once per change', async () => {
    const sent = installNativeBuild();
    const stop = watchNativeHeaderCover(document.body);
    // The initial check publishes the resting state exactly once (with the
    // dim flag, which rests alongside it).
    expect(sent.filter((m) => (m as { covered?: boolean }).covered !== undefined)).toEqual([
      { action: 'header.setState', covered: false, dimmed: false },
    ]);

    const sheet = document.createElement('div');
    sheet.setAttribute('role', 'dialog');
    sheet.setAttribute('data-state', 'open');
    document.body.appendChild(sheet);
    await Promise.resolve(); // MutationObserver delivers as a microtask
    expect(sent.at(-1)).toEqual({ action: 'header.setState', covered: true });

    sheet.setAttribute('data-state', 'closed');
    await Promise.resolve();
    expect(sent.at(-1)).toEqual({ action: 'header.setState', covered: false });

    stop();
  });

  it('reports covered while a web bar declares itself one — Edit Layout\'s toolbar', async () => {
    const sent = installNativeBuild();
    const bar = document.createElement('div');
    bar.setAttribute(NATIVE_HEADER_COVER_ATTR, 'false');
    document.body.appendChild(bar);
    const stop = watchNativeHeaderCover(document.body);
    expect(sent.at(-1)).toEqual({ action: 'header.setState', covered: false, dimmed: false });

    bar.setAttribute(NATIVE_HEADER_COVER_ATTR, 'true');
    await Promise.resolve();
    expect(sent.at(-1)).toEqual({ action: 'header.setState', covered: true });

    bar.setAttribute(NATIVE_HEADER_COVER_ATTR, 'false');
    await Promise.resolve();
    expect(sent.at(-1)).toEqual({ action: 'header.setState', covered: false });

    stop();
  });

  it('reports dimmed while a widget is expanded, and not covered', async () => {
    const sent = installNativeBuild();
    const stop = watchNativeHeaderCover(document.body);
    const panel = document.createElement('div');
    panel.setAttribute('data-expanded-overlay', 'open');
    document.body.appendChild(panel);
    await Promise.resolve();
    expect(sent.at(-1)).toEqual({ action: 'header.setState', dimmed: true });
    panel.setAttribute('data-expanded-overlay', 'closing');
    await Promise.resolve();
    expect(sent.at(-1)).toEqual({ action: 'header.setState', dimmed: false });
    panel.remove();
    stop();
  });

  it('does nothing at all on a build without the bar', () => {
    const stop = watchNativeHeaderCover(document.body);
    const sheet = document.createElement('div');
    sheet.setAttribute('role', 'dialog');
    sheet.setAttribute('data-state', 'open');
    document.body.appendChild(sheet);
    expect(() => stop()).not.toThrow();
  });
});
