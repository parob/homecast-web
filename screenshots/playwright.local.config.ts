// Local-only: the sandbox ships chromium 1194 at a fixed path.
import base from './playwright.config';
import { defineConfig } from '@playwright/test';
export default defineConfig({
  ...base,
  webServer: undefined,
  use: { ...base.use, launchOptions: { executablePath: '/opt/pw-browsers/chromium' } },
  projects: (base.projects || []).map(p => ({
    ...p,
    use: { ...p.use, launchOptions: { executablePath: '/opt/pw-browsers/chromium' } },
  })),
});
