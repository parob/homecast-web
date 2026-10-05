/**
 * Screenshots for the blog posts, from the same mock data as the docs shots
 * (My Home / Beach House) — never a real home.
 *
 *   cd app-web/screenshots && npx playwright test -c playwright.blog.config.ts
 *
 * Writes PNGs to blog-output/; the posts' WebP files under
 * public/blog/ are made from those (see blog.spec.ts). Its own port, so it
 * never reuses someone's dev server on 8080 running other code.
 */
import { defineConfig } from '@playwright/test';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));

export default defineConfig({
  testDir: '.',
  testMatch: ['blog.spec.ts'],
  timeout: 60_000,
  retries: 0,
  workers: 1,
  use: {
    baseURL: 'http://localhost:8094',
    viewport: { width: 1280, height: 800 },
    colorScheme: 'dark',
    screenshot: 'off',
    browserName: 'chromium',
    deviceScaleFactor: 2,
  },
  webServer: {
    command: 'npx vite --port 8094 --strictPort',
    cwd: path.resolve(__dirname, '..'),
    port: 8094,
    reuseExistingServer: false,
    timeout: 60_000,
  },
  outputDir: path.resolve(__dirname, 'test-results'),
});
