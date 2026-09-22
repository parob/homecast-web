import { defineConfig } from '@playwright/test';
import base from './playwright.config';

const port = Number(process.env.PLAYWRIGHT_PORT ?? 8098);

// Functional and rendered-geometry regressions. Marketing captures remain in
// the full screenshot suite and do not need regenerating on every commit.
export default defineConfig({
  ...base,
  testMatch: [
    'attachment-preview.spec.ts',
    'expanded-overlay.spec.ts',
    // The panel's action cluster: Size removed, and every remaining action
    // readable as a word rather than a glyph. homecast-cloud#162.
    'expanded-actions.spec.ts',
    // What resolves a reported issue, from the Feedback sheet. homecast-cloud#169.
    'resolution-view.spec.ts',
    // Saying something back from it, and which one place it goes. homecast-cloud#179.
    'resolution-feedback.spec.ts',
    // And reading what came back: the answer on the screen, newest first, its
    // markdown read rather than reprinted. homecast-cloud#182. In from day one
    // — #192 and #193 are what a spec no check runs turns into.
    'issue-182-updates.spec.ts',
    'camera-live.spec.ts',
    'camera-viewer-fit.spec.ts',
    'camera-cache-reload.spec.ts',
    'camera-tile-layout.spec.ts',
    'automation-editor.spec.ts',
    'initial-home-selection.spec.ts',
    'login-flows.spec.ts',
    'tutorial.spec.ts',
    'action-failure-sheet-overflow.spec.ts',
    'status-popover-overflow.spec.ts',
    'home-availability.spec.ts',
    'edit-layout-header.spec.ts',
    'edit-layout-scroll-anchor.spec.ts',
    'toast-alignment.spec.ts',
    'tab-bar-label-centring.spec.ts',
    'request-log-minimised.spec.ts',
    'status-bar-under-fullscreen-dialog.spec.ts',
    'room-visibility-surfaces.spec.ts',
    // New guard for a new feature, so it runs from day one. #193 is what a
    // spec that no check runs turns into: red on main since the commit that
    // created it, found only by a hand-run months later.
    'widget-sizes.spec.ts',
    'scenes-dim-in-edit-layout.spec.ts',
    'hidden-pill-vs-unhide-badge.spec.ts',
    'wallpaper-edge-colour.spec.ts',
    'sidebar-width.spec.ts',
    'phone-back-button.spec.ts',
    'native-backdrop-colour.spec.ts',
    'lock-battery-ink.spec.ts',
    'overlay-band-colour.spec.ts',
    // A room entered from a scrolled home opens at the top. homecast-cloud#175.
    // In the CI subset from day one on purpose: #192 and #193 are both specs
    // that no check ran, found red months later by a hand-run.
    'room-opens-scrolled.spec.ts',
    // The background picker fills the dialog and still scrolls to its end,
    // and each slider is one line. homecast-cloud#178.
    'background-dialog-space.spec.ts',
    'heading-native-metrics.spec.ts',
  ],
  projects: base.projects?.filter(project => project.name !== 'ipad-screenshots'),
  workers: 2,
  use: {
    ...base.use,
    baseURL: `http://localhost:${port}`,
    screenshot: 'only-on-failure',
    trace: 'retain-on-failure',
  },
  webServer: {
    ...base.webServer,
    command: `npm run dev -- --port ${port} --strictPort`,
    port,
    reuseExistingServer: false,
  },
});
