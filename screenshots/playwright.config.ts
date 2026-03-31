import { defineConfig } from '@playwright/test';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));

export default defineConfig({
  testDir: '.',
  testMatch: ['capture.spec.ts', 'automation-editor.spec.ts'],
  timeout: 60_000,
  retries: 0,
  workers: 1,
  use: {
    baseURL: 'http://localhost:8080',
    viewport: { width: 1280, height: 800 },
    colorScheme: 'dark',
    screenshot: 'off',
  },
  webServer: {
    command: 'npm run dev',
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
  ],
});
