import { defineConfig } from '@playwright/test';
import base from './playwright.config';

const port = Number(process.env.PLAYWRIGHT_PORT ?? 8098);

// Functional and rendered-geometry regressions. Marketing captures remain in
// the full screenshot suite and do not need regenerating on every commit.
export default defineConfig({
  ...base,
  testMatch: [
    'automation-editor.spec.ts',
    'action-failure-sheet-overflow.spec.ts',
    'status-popover-overflow.spec.ts',
    'edit-layout-header.spec.ts',
    'toast-alignment.spec.ts',
    'tab-bar-label-centring.spec.ts',
    'request-log-minimised.spec.ts',
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
