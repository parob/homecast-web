import { defineConfig } from '@playwright/test';
import base from './playwright.config';

const port = Number(process.env.PLAYWRIGHT_PORT ?? 8098);

// Functional and rendered-geometry regressions. Marketing captures remain in
// the full screenshot suite and do not need regenerating on every commit.
export default defineConfig({
  ...base,
  // New functional specs run automatically; a whitelist let existing guards
  // silently fall out of CI (#146). Only picture-only files are excluded.
  testMatch: '**/*.spec.ts',
  testIgnore: [
    '**/capture.spec.ts',
    '**/header-control-chrome.spec.ts',
    '**/issue-181-status.spec.ts',
    '**/report-sheet.spec.ts',
  ],
  projects: base.projects?.filter(project => project.name !== 'ipad-screenshots'),
  // Picture-only cases in otherwise functional files remain hand-run.
  grepInvert: /\bcapture$/,
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
