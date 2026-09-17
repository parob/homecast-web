import { defineConfig } from '@playwright/test';
import base from './playwright.config';

/**
 * The mocks, which are not tests.
 *
 * Separate from `playwright.config.ts` because that file's `testMatch` is the
 * suite CI runs, and a mock that renders a proposal has no business failing a
 * build. See `evidence/issue-154/README.md`.
 *
 * `CHROMIUM_PATH` is for a sandbox whose Playwright browsers are installed
 * somewhere other than the version this package pins; unset, Playwright finds
 * its own.
 */
const executablePath = process.env.CHROMIUM_PATH;

export default defineConfig({
  ...base,
  testMatch: ['widget-span-mock.spec.ts'],
  projects: [{
    name: 'mock',
    use: {
      browserName: 'chromium',
      deviceScaleFactor: 2,
      ...(executablePath ? { launchOptions: { executablePath } } : {}),
    },
  }],
});
