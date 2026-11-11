/**
 * A fake of the iOS app's native shell, for reproducing reports that come from
 * the iPhone app rather than from a browser.
 *
 * In the app the page runs in a WKWebView, and a large part of what the user
 * sees is not the page at all: the top bar, its title menu and its ⋯ menu are
 * UIKit, drawn by `NativeHeaderBar.swift` from data the page sends through
 * `webkit.messageHandlers.homecast`. A bug like "the menu has no New Collection
 * item" is therefore invisible to a screenshot of the page. It is visible in the
 * messages, and that is what this records.
 *
 * What it does, each piece copied from the Swift side rather than guessed
 * (parob/homecast @ 975ce3f, `app-ios-macos/Sources/`):
 *
 * | piece | the real one |
 * |---|---|
 * | the iOS globals (`isHomecastIOSApp`, `isHomeKitLocalCapable`, the header flags…) | `App/HomecastApp.swift:1638-1671`, `platformScript`, `.atDocumentStart` |
 * | message handlers `homecast` and `homecastReport` only | `HomecastApp.swift:1400`, `:1414`; `localServer`/`relayWs` are Mac-only |
 * | `window.homekit` and `window.homecastReport` | `homeKitBridgeScript`, `reportBridgeScript`, same file |
 * | the header model, merged per message | `NativeHeaderModel.merge(_:)`, `App/NativeHeaderBar.swift:174` |
 * | `header.ready` → `setEnabled(enabled, bar, status, base, eyebrow)` | `syncNativeHeader`, `HomecastApp.swift:2657-2693` |
 * | the title menu and the ⋯ menu as UIKit builds them | `buildTitleMenu` / `buildMenu`, `NativeHeaderBar.swift:2494-2552` |
 * | a native pick back into the page | `tap`/`navigate`/`menuAction`/`selectHome`/`refresh`, `NativeHeaderBar.swift:289-316` |
 *
 * Usage:
 *
 *   test.use(IPHONE_APP);
 *   const shell = await installNativeShell(page);   // before page.goto
 *   await page.goto('/portal');
 *   const menu = await shell.titleMenu();           // what the title chevron offers
 *   await shell.navigate('room:<id>');              // as if the user picked it
 *
 * What it cannot do — say so in a reproduction rather than over-claiming:
 * it draws nothing. The UIKit bar, the status-bar glyphs and their colour,
 * system sheets, the keyboard and haptics do not exist here; only what the page
 * *asked* native to draw does. See README.md, "Reproducing iOS-app reports".
 */
import type { Page } from '@playwright/test';

/**
 * The user agent `HomecastApp.swift:1991` sets on the WKWebView — the same as
 * iOS Safari's, with the OS version filled in. This one is the version on the
 * reports the existing iPhone specs came from.
 */
export const IOS_APP_USER_AGENT =
  'Mozilla/5.0 (iPhone; CPU iPhone OS 26_6_1 like Mac OS X) AppleWebKit/605.1.15 ' +
  '(KHTML, like Gecko) Version/26.6.1 Mobile/15E148 Safari/604.1';

/**
 * The phone the iOS-app reports so far came from (440×956pt @3x), for
 * `test.use()` and the `iphone-webkit` project.
 */
export const IPHONE_APP = {
  viewport: { width: 440, height: 956 },
  deviceScaleFactor: 3,
  isMobile: true,
  hasTouch: true,
  userAgent: IOS_APP_USER_AGENT,
};

/**
 * What the shell reports through `setEnabled`, in points. `status` is the
 * status bar; `base` the whole band above the content with the large title
 * shown (status + 54 compact bar + 52 large title, see `nativeHeaderRowCenter`
 * in `src/native/native-header.ts`); `eyebrow` the extra line a room page adds
 * (`WebHostingLayout.eyebrowHeight`). 168 is what UIKit reported on an
 * iPhone 17 Pro simulator; pass your own for another device.
 */
export interface NativeShellInsets { status: number; base: number; eyebrow: number }
export const DEFAULT_INSETS: NativeShellInsets = { status: 62, base: 168, eyebrow: 18 };

/** An answer a fake native call settles with. */
export type NativeAnswer = { data: unknown } | { error: { code: string; message?: string } };

export interface NativeShellOptions {
  /**
   * Whether the shell draws the native bar. Every iOS build does now
   * (`AppConfig.nativeHeaderPreview` returns true on iOS); false reproduces an
   * older build that had the bar behind a preview switch.
   */
  nativeHeader?: boolean;
  insets?: NativeShellInsets;
  /** `env(safe-area-inset-*)`, which Chromium and desktop WebKit report as 0. */
  safeArea?: { top: number; bottom: number; left: number; right: number };
  /** `isNativeRecordingCapable`. False, as in the simulator, unless asked. */
  canRecordScreen?: boolean;
  /**
   * Answers for `window.homekit.call(method)`, by method. Unlisted methods are
   * rejected with `NOT_FAKED` — loudly, rather than left hanging until the
   * bridge's own timeout. The default makes this a phone with no HomeKit
   * access, which keeps Local Mode out of a test that did not ask for it.
   */
  homekit?: Record<string, NativeAnswer>;
  /** Answers for `window.homecastReport.call(method)`, by method. */
  report?: Record<string, NativeAnswer>;
}

/** One message the page posted to native, as Swift would have received it. */
export interface NativeMessage {
  handler: 'homecast' | 'homecastReport';
  /** Structured-cloned, as WKWebView does; absent if the clone threw. */
  message?: Record<string, unknown>;
  /** The page posted something WKWebView cannot carry (a function, say). */
  cloneError?: string;
}

export interface ShellNavItem { id: string; label: string; symbol?: string; selected: boolean; children: ShellNavItem[] }
export interface ShellMenuItem { id: string; label: string; symbol?: string; destructive: boolean; disabled: boolean }
export interface ShellSection<T> { id: string; title?: string; items: T[] }

/** `NativeHeaderModel`'s published state, after every merge so far. */
export interface NativeHeaderModel {
  enabled: boolean;
  title: string;
  heading: string;
  subtitle: string;
  homes: Array<{ id: string; name: string }>;
  currentHomeId: string | null;
  showMenu: boolean;
  showSearch: boolean;
  showOverflow: boolean;
  largeTitle: boolean;
  hasStatus: boolean;
  statusColor: string | null;
  menu: ShellSection<ShellMenuItem>[];
  appearance: string | null;
  covered: boolean;
  coverAppearance: string | null;
  dimmed: boolean;
  navigation: ShellSection<ShellNavItem>[];
}

/**
 * The title chevron's menu, as `buildTitleMenu` builds it: a row of homes when
 * there is more than one, then the navigation sections. Null when UIKit would
 * draw no chevron at all.
 */
export interface TitleMenu {
  homes: Array<{ id: string; name: string; selected: boolean }>;
  sections: ShellSection<ShellNavItem>[];
}

/** Where a native menu item lives, which decides how a pick is delivered. */
export interface FoundItem { menu: 'title' | 'overflow'; id: string; label: string }

export interface NativeShell {
  /** Everything posted to native since the page loaded, oldest first. */
  messages(filter?: { handler?: NativeMessage['handler']; action?: string }): Promise<NativeMessage[]>;
  /** The bar's model, merged the way Swift merges it. */
  header(): Promise<NativeHeaderModel>;
  titleMenu(): Promise<TitleMenu | null>;
  /** The ⋯ menu; null when UIKit would tap through to the page's own ⋯ instead. */
  overflowMenu(): Promise<ShellSection<ShellMenuItem>[] | null>;
  /** Search both native menus for an item whose label matches. */
  findMenuItem(label: RegExp): Promise<FoundItem | null>;
  /** Pick an item the way the user would: title menu → `navigate`, ⋯ → `menuAction`. */
  choose(item: FoundItem): Promise<boolean>;
  /**
   * The native → page calls, verbatim. Each answers whether the page had its
   * half of the bridge installed — `false` is what Swift would also have hit,
   * silently.
   */
  navigate(id: string): Promise<boolean>;
  menuAction(id: string): Promise<boolean>;
  selectHome(id: string): Promise<boolean>;
  tap(control: 'menu' | 'status' | 'search' | 'overflow'): Promise<boolean>;
  refresh(kind: 'soft' | 'hard'): Promise<boolean>;
  setEnabled(enabled: boolean): Promise<boolean>;
  /** iOS detected a shake (`ReportBridge.swift`, `_onShake`). */
  shake(): Promise<boolean>;
  /** Push a HomeKit event, as `HomeKitBridge.swift`'s `pushEvent` does. */
  homekitEvent(payload: Record<string, unknown>): Promise<void>;
}

/** A 1×1 PNG: what a fake `captureScreenshot` hands back. Not the screen. */
const PLACEHOLDER_PNG =
  'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mNkYAAAAAYAAjCB0C8AAAAASUVORK5CYII=';

/**
 * Become the iOS app. Call before `page.goto`: like the real scripts, all of
 * this has to exist before the page's first module runs.
 *
 * The record lives in the page, so a reload starts a new one — as the real
 * bridge's JS half does. (Swift's model survives a reload; this one does not.)
 */
export async function installNativeShell(page: Page, options: NativeShellOptions = {}): Promise<NativeShell> {
  const config = {
    nativeHeader: options.nativeHeader ?? true,
    insets: options.insets ?? DEFAULT_INSETS,
    safeArea: options.safeArea ?? { top: DEFAULT_INSETS.status, bottom: 34, left: 0, right: 0 },
    canRecordScreen: options.canRecordScreen ?? false,
    homekit: {
      'homekit.status': { data: { ready: true, authorized: false, restricted: false, determined: true, homeCount: 0 } },
      ...options.homekit,
    } as Record<string, NativeAnswer>,
    report: {
      captureScreenshot: { data: { data: PLACEHOLDER_PNG } },
      ...options.report,
    } as Record<string, NativeAnswer>,
  };

  await page.addInitScript((cfg) => {
    type Any = Record<string, any>; // eslint-disable-line @typescript-eslint/no-explicit-any
    const w = window as unknown as Any;

    // ── HomecastApp.swift `platformScript`, the iOS branch ──────────────────
    w.isHomecastApp = true;
    w.isHomecastIOSApp = true;
    // NOT isHomeKitRelayCapable: an iPhone never claims relay duty.
    w.isHomeKitLocalCapable = true;
    w.homecastAppVersion = '0.0.0-native-shell';
    w.homecastAppBuildNumber = '0';
    w.homecastAppBuild = 'native-shell';
    w.homecastOSVersion = '26.6.1';
    w.homecastDeviceModel = 'iPhone';
    w.homecastHostName = 'native-shell';
    w.homecastPlatform = 'ios';
    w.homecastNativeHeaderAvailable = true;
    w.homecastNativeHeaderEnabled = cfg.nativeHeader;
    // `purchaseBootstrap`, injected on every App Store build.
    w.isHomecastNativePurchaseAvailable = true;
    // A WKWebView is not a home-screen web app; WebKit on iOS says so as false.
    try { Object.defineProperty(navigator, 'standalone', { value: false, configurable: true }); } catch { /* read-only */ }

    // ── The record, and the model Swift keeps from it ───────────────────────
    const shell: Any = {
      messages: [] as Any[],
      model: {
        enabled: cfg.nativeHeader, title: '', heading: '', subtitle: '', homes: [], currentHomeId: null,
        showMenu: true, showSearch: true, showOverflow: true, largeTitle: true, hasStatus: false,
        statusColor: null, menu: [], appearance: null, covered: true, coverAppearance: null,
        dimmed: false, navigation: [],
      },
    };
    w.__nativeShell = shell;

    const has = (o: Any, k: string) => Object.prototype.hasOwnProperty.call(o, k);
    const str = (v: unknown) => (typeof v === 'string' ? v : undefined);
    const bool = (v: unknown) => (typeof v === 'boolean' ? v : undefined);
    const isPage = (heading: string, title: string) => heading.trim().length > 0 && heading.trim() !== title;
    const navItem = (raw: Any): Any | null => {
      if (typeof raw?.id !== 'string' || typeof raw?.label !== 'string') return null;
      const children = Array.isArray(raw.children) ? raw.children.map(navItem).filter(Boolean) : [];
      return { id: raw.id, label: raw.label, symbol: str(raw.symbol), selected: raw.selected === true, children };
    };

    /** `NativeHeaderModel.merge(_:)`: present keys overwrite; absent keys are unchanged. */
    const merge = (p: Any) => {
      const m = shell.model;
      const wasOnPage = isPage(m.heading, m.title);
      if (str(p.title) !== undefined) m.title = p.title;
      if (str(p.heading) !== undefined) m.heading = p.heading;
      if (has(p, 'subtitle')) m.subtitle = str(p.subtitle) ?? '';
      for (const k of ['showMenu', 'showSearch', 'showOverflow', 'largeTitle', 'covered', 'dimmed']) {
        if (bool(p[k]) !== undefined) m[k] = p[k];
      }
      if (has(p, 'statusColor')) {
        // A hex shows the dot; JSON null hides it. The one key where they differ.
        m.hasStatus = typeof p.statusColor === 'string';
        m.statusColor = str(p.statusColor) ?? null;
      }
      if (Array.isArray(p.homes)) {
        m.homes = p.homes.filter((h: Any) => typeof h?.id === 'string' && typeof h?.name === 'string')
          .map((h: Any) => ({ id: h.id, name: h.name }));
      }
      if (has(p, 'currentHomeId')) m.currentHomeId = str(p.currentHomeId) ?? null;
      if (Array.isArray(p.menu)) {
        m.menu = p.menu.filter((s: Any) => typeof s?.id === 'string' && Array.isArray(s?.items)).map((s: Any) => ({
          id: s.id,
          title: str(s.title),
          items: s.items.filter((i: Any) => typeof i?.id === 'string' && typeof i?.label === 'string').map((i: Any) => ({
            id: i.id, label: i.label, symbol: str(i.symbol), destructive: i.destructive === true, disabled: i.disabled === true,
          })),
        }));
      }
      if (str(p.appearance) !== undefined) m.appearance = p.appearance;
      if (str(p.coverAppearance) !== undefined) m.coverAppearance = p.coverAppearance;
      if (Array.isArray(p.navigation)) {
        m.navigation = p.navigation.filter((s: Any) => typeof s?.id === 'string' && Array.isArray(s?.items))
          .map((s: Any) => ({ id: s.id, title: str(s.title), items: s.items.map(navItem).filter(Boolean) }));
      }
      // The band grows by the eyebrow on a room page, and the shell re-reports
      // its insets on the next layout.
      if (m.enabled && wasOnPage !== isPage(m.heading, m.title)) setTimeout(() => shell.setEnabled(m.enabled), 0);
    };

    /** `syncNativeHeader`'s `tell`: `base` excludes the eyebrow, `bar` includes it. */
    shell.setEnabled = (enabled: boolean) => {
      const m = shell.model;
      m.enabled = enabled;
      const { status, base, eyebrow } = cfg.insets;
      const bar = enabled ? base + (isPage(m.heading, m.title) ? eyebrow : 0) : 0;
      const reportedStatus = enabled ? status : 0;
      const reportedBase = enabled ? base : 0;
      const bridge = w.__homecastNativeHeader;
      if (bridge) bridge.setEnabled(enabled, bar, reportedStatus, reportedBase, eyebrow);
      return !!bridge;
    };

    const record = (handler: string, message: unknown) => {
      try {
        // What WKWebView does to a message: the structured clone. A function in
        // it throws there, and the page's `post()` swallows the throw.
        const cloned = structuredClone(message);
        shell.messages.push({ handler, message: cloned });
        return cloned as Any;
      } catch (e) {
        shell.messages.push({ handler, cloneError: String(e) });
        throw e;
      }
    };
    const answer = (table: Any, method: string) =>
      table[method] ?? { error: { code: 'NOT_FAKED', message: `native-shell.ts has no answer for ${method}` } };

    // ── The `homecast` handler: the router in HomecastApp.swift's coordinator ─
    const homecast = {
      postMessage(message: unknown) {
        const body = record('homecast', message);
        if (!body || typeof body.action !== 'string') return;
        switch (body.action) {
          case 'header.setState':
            merge(body);
            break;
          case 'header.ready':
            // Swift answers on the main queue, after the page's call returns.
            setTimeout(() => shell.setEnabled(shell.model.enabled), 0);
            break;
          case 'homekit': {
            const a = answer(cfg.homekit, body.method);
            setTimeout(() => w.__homekit_callback?.({
              callbackId: body.callbackId,
              success: 'data' in a,
              ...('data' in a ? { data: a.data } : { error: a.error }),
            }), 0);
            break;
          }
          default:
            // header.painted, header.refreshDone, openUrl, purchase, … — recorded.
            break;
        }
      },
    };
    const homecastReport = {
      postMessage(message: unknown) {
        const body = record('homecastReport', message);
        if (!body || typeof body.method !== 'string') return;
        const a = answer(cfg.report, body.method);
        setTimeout(() => ('data' in a
          ? w.homecastReport?._resolve(body.callbackId, a.data)
          : w.homecastReport?._reject(body.callbackId, a.error.code)), 0);
      },
    };
    w.webkit = { messageHandlers: { homecast, homecastReport } };

    // ── `homeKitBridgeScript`, same shape ───────────────────────────────────
    w.__homekit_callbacks = {};
    w.__homekit_event_handlers = [];
    w.__homekit_callback = (payload: Any) => {
      const cb = w.__homekit_callbacks[payload.callbackId];
      if (!cb) return;
      delete w.__homekit_callbacks[payload.callbackId];
      if (payload.success) cb.resolve(payload.data); else cb.reject(payload.error);
    };
    w.__homekit_event = (payload: Any) => {
      for (const h of w.__homekit_event_handlers) { try { h(payload); } catch (e) { console.error(e); } }
    };
    let callbackCounter = 0;
    w.homekit = {
      call(method: string, payload?: Any) {
        return new Promise((resolve, reject) => {
          const callbackId = `hk_${++callbackCounter}_${Date.now()}`;
          w.__homekit_callbacks[callbackId] = { resolve, reject };
          homecast.postMessage({ action: 'homekit', method, payload: payload || {}, callbackId });
        });
      },
      onEvent(handler: (e: unknown) => void) {
        w.__homekit_event_handlers.push(handler);
        return () => {
          const i = w.__homekit_event_handlers.indexOf(handler);
          if (i >= 0) w.__homekit_event_handlers.splice(i, 1);
        };
      },
    };

    // ── `reportBridgeScript`, same shape ────────────────────────────────────
    w.__report_callbacks = {};
    w.__report_shake_handlers = [];
    w.isNativeCaptureCapable = true;
    w.isNativeRecordingCapable = cfg.canRecordScreen;
    w.homecastReport = {
      call(method: string, payload?: Any) {
        return new Promise((resolve, reject) => {
          const id = 'r' + Date.now() + Math.random().toString(36).slice(2);
          w.__report_callbacks[id] = { resolve, reject };
          homecastReport.postMessage({ method, payload: payload || {}, callbackId: id });
        });
      },
      onShake(handler: () => void) {
        w.__report_shake_handlers.push(handler);
        return () => {
          const i = w.__report_shake_handlers.indexOf(handler);
          if (i >= 0) w.__report_shake_handlers.splice(i, 1);
        };
      },
      _resolve(id: string, value: unknown) {
        const cb = w.__report_callbacks[id];
        if (cb) { delete w.__report_callbacks[id]; cb.resolve(value); }
      },
      _reject(id: string, code: string) {
        const cb = w.__report_callbacks[id];
        if (cb) { delete w.__report_callbacks[id]; cb.reject(new Error(code)); }
      },
      _onShake() {
        for (const h of w.__report_shake_handlers.slice()) { try { h(); } catch (e) { console.error(e); } }
      },
    };

    // ── Safe areas: the phone's env(safe-area-inset-*), which a desktop engine
    // reports as 0. Inline on <html> so it outranks index.css's `env()` rule;
    // with the bar up, useNativeHeader pins --safe-area-top over this itself.
    const applySafeArea = () => {
      const root = document.documentElement;
      if (!root) return false;
      for (const side of ['top', 'bottom', 'left', 'right'] as const) {
        root.style.setProperty(`--safe-area-${side}`, `${cfg.safeArea[side]}px`);
      }
      return true;
    };
    if (!applySafeArea()) {
      new MutationObserver((_, observer) => { if (applySafeArea()) observer.disconnect(); })
        .observe(document, { childList: true });
    }
  }, config);

  // ── Native → page: the exact scripts NativeHeaderBar.swift evaluates ───────
  const run = (js: string) => page.evaluate(js) as Promise<boolean>;
  const call = (fn: string, arg: string) =>
    run(`!!(window.__homecastNativeHeader && window.__homecastNativeHeader.${fn} && (window.__homecastNativeHeader.${fn}(${JSON.stringify([arg])}[0]), true))`);

  const shell: NativeShell = {
    async messages(filter = {}) {
      const all = await page.evaluate(() => (window as unknown as { __nativeShell: { messages: NativeMessage[] } }).__nativeShell.messages);
      return all.filter((m) => (!filter.handler || m.handler === filter.handler)
        && (!filter.action || m.message?.action === filter.action));
    },
    async header() {
      return page.evaluate(() => (window as unknown as { __nativeShell: { model: NativeHeaderModel } }).__nativeShell.model);
    },
    async titleMenu() {
      const m = await shell.header();
      if (m.homes.length === 0 && m.navigation.length === 0) return null;
      return {
        homes: m.homes.length > 1 ? m.homes.map((h) => ({ ...h, selected: h.id === m.currentHomeId })) : [],
        sections: m.navigation,
      };
    },
    async overflowMenu() {
      const m = await shell.header();
      return m.showOverflow && m.menu.length > 0 ? m.menu : null;
    },
    async findMenuItem(label) {
      const flatten = (items: ShellNavItem[]): ShellNavItem[] => items.flatMap((i) => [i, ...flatten(i.children)]);
      const title = await shell.titleMenu();
      // A submenu is not an action — only a leaf calls back into the page.
      const nav = flatten(title?.sections.flatMap((s) => s.items) ?? []).find((i) => i.children.length === 0 && label.test(i.label));
      if (nav) return { menu: 'title', id: nav.id, label: nav.label };
      const item = (await shell.overflowMenu())?.flatMap((s) => s.items).find((i) => !i.disabled && label.test(i.label));
      return item ? { menu: 'overflow', id: item.id, label: item.label } : null;
    },
    choose(item) {
      return item.menu === 'title' ? shell.navigate(item.id) : shell.menuAction(item.id);
    },
    navigate: (id) => call('navigate', id),
    menuAction: (id) => call('menuAction', id),
    selectHome: (id) => call('selectHome', id),
    refresh: (kind) => call('refresh', kind),
    tap: (control) => run(`!!(window.__homecastNativeHeader && (window.__homecastNativeHeader.tap(${JSON.stringify(control)}), true))`),
    setEnabled: (enabled) => page.evaluate((on) => (window as unknown as { __nativeShell: { setEnabled: (e: boolean) => boolean } }).__nativeShell.setEnabled(on), enabled),
    shake: () => run('!!(window.homecastReport && window.homecastReport._onShake && (window.homecastReport._onShake(), true))'),
    async homekitEvent(payload) {
      await page.evaluate((p) => (window as unknown as { __homekit_event: (p: unknown) => void }).__homekit_event(p), payload);
    },
  };
  return shell;
}
