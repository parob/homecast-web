import { defineConfig, chromium, webkit } from '@playwright/test';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { IPHONE_APP } from './native-shell';

const __dirname = path.dirname(fileURLToPath(import.meta.url));

const exists = (file: () => string) => { try { return fs.existsSync(file()); } catch { return false; } };

/**
 * The Chromium to launch, when it is not the one this Playwright expects.
 * A sandbox can ship browsers for another revision under /opt/pw-browsers and
 * be unable to download the right one; its shell also forgets environment
 * variables between commands, so the config finds them itself.
 * PW_CHROMIUM_EXECUTABLE wins; otherwise undefined means Playwright's own.
 */
function chromiumExecutable(): string | undefined {
  if (process.env.PW_CHROMIUM_EXECUTABLE) return process.env.PW_CHROMIUM_EXECUTABLE;
  const root = '/opt/pw-browsers';
  if (exists(() => chromium.executablePath()) || !fs.existsSync(root)) return undefined;
  if (fs.statSync(path.join(root, 'chromium'), { throwIfNoEntry: false })?.isFile()) return path.join(root, 'chromium');
  // Newest revision first; the binary's folder was renamed along the way.
  return fs.readdirSync(root).filter(d => /^chromium-\d+$/.test(d))
    .sort((a, b) => b.localeCompare(a, undefined, { numeric: true }))
    .flatMap(d => ['chrome-linux64/chrome', 'chrome-linux/chrome'].map(bin => path.join(root, d, bin)))
    .find(bin => fs.existsSync(bin));
}
const executablePath = chromiumExecutable();

/** WebKit is opt-in: `npx playwright install webkit`. See README.md. */
const hasWebKit = exists(() => webkit.executablePath());

export default defineConfig({
  testDir: '.',
  testMatch: [
    'capture.spec.ts',
    'automation-editor.spec.ts',
    'initial-home-selection.spec.ts',
    'login-flows.spec.ts',
    'tutorial.spec.ts',
    'cross-room-drag.spec.ts',
    'room-visibility-surfaces.spec.ts',
    'edit-layout-header.spec.ts',
    'toast-alignment.spec.ts',
    'accessory-visibility-surfaces.spec.ts',
    'room-heading-context-menu.spec.ts',
    'reveal-during-lift.spec.ts',
    'sharing-settings.spec.ts',
    'hidden-items-exit.spec.ts',
    'hidden-items-enter.spec.ts',
    'edit-layout-scroll-anchor.spec.ts',
    'reveal-before-commit.spec.ts',
    'edit-layout-exit-motion.spec.ts',
    'automation-dialog-close.spec.ts',
    'automation-toggle-centring.spec.ts',
    'report-sheet.spec.ts',
    'issue-181-status.spec.ts',
    'resolution-view.spec.ts',
    'resolution-feedback.spec.ts',
    'tab-bar-unpin-badge.spec.ts',
    'edit-badge-hit-target.spec.ts',
    'tab-bar-label-centring.spec.ts',
    'action-failure-sheet-overflow.spec.ts',
    'status-popover-overflow.spec.ts',
    'header-control-chrome.spec.ts',
    'accessory-picker-row-overlap.spec.ts',
    'request-log-minimised.spec.ts',
    'widget-sizes.spec.ts',
    'status-bar-under-fullscreen-dialog.spec.ts',
    'scenes-dim-in-edit-layout.spec.ts',
    'hidden-pill-vs-unhide-badge.spec.ts',
    'wallpaper-edge-colour.spec.ts',
    'sidebar-width.spec.ts',
    'phone-back-button.spec.ts',
    'native-backdrop-colour.spec.ts',
    // Specs that run against the fake iOS shell (native-shell.ts), in every
    // project here and in WebKit too.
    /\.ios\.spec\.ts$/,
    'lock-battery-ink.spec.ts',
    'widget-contrast.spec.ts',
    'overlay-band-colour.spec.ts',
    'room-opens-scrolled.spec.ts',
    'background-dialog-space.spec.ts',
    'issue-182-updates.spec.ts',
    'background-slow-swap.spec.ts',
    'heading-native-metrics.spec.ts',
  ],
  timeout: 60_000,
  retries: 0,
  workers: 1,
  use: {
    // `localhost`, not 127.0.0.1: the app derives its API origin from the
    // page's hostname, and the mocks (and specs' own routes) match localhost.
    baseURL: 'http://localhost:8080',
    viewport: { width: 1280, height: 800 },
    colorScheme: 'dark',
    screenshot: 'off',
    ...(executablePath ? { launchOptions: { executablePath } } : {}),
  },
  webServer: {
    // IPv4 explicitly: vite.config.ts binds `::`, which fails with
    // EAFNOSUPPORT on a host without IPv6. localhost still resolves here.
    command: 'npm run dev -- --host 127.0.0.1',
    cwd: path.resolve(__dirname, '..'),
    port: 8080,
    reuseExistingServer: true,
    timeout: 30_000,
  },
  outputDir: path.resolve(__dirname, 'test-results'),
  projects: [
    {
      name: 'screenshots',
      use: {
        browserName: 'chromium',
        deviceScaleFactor: 2,
      },
    },
    {
      name: 'iphone-screenshots',
      use: {
        browserName: 'chromium',
        viewport: { width: 428, height: 926 },
        deviceScaleFactor: 3,
        isMobile: true,
        hasTouch: true,
      },
    },
    {
      name: 'ipad-screenshots',
      use: {
        browserName: 'chromium',
        viewport: { width: 1024, height: 1366 },
        deviceScaleFactor: 2,
      },
    },
    // The iOS app's engine. Only `*.ios.spec.ts`, and only where WebKit is
    // installed, so CI (Chromium only) and every other spec are unaffected.
    ...(hasWebKit ? [{
      name: 'iphone-webkit',
      testMatch: /\.ios\.spec\.ts$/,
      use: { browserName: 'webkit' as const, launchOptions: {}, ...IPHONE_APP },
    }] : []),
  ],
});
