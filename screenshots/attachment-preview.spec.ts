import { test, expect } from '@playwright/test';
import { setupMocks } from './mocks';
import { MOCK_USER } from './fixtures';

test('attachment preview is above the report and dismisses without closing it', async ({ page }) => {
  await setupMocks(page);
  await page.route(/^https?:\/\/(api\.homecast\.cloud|localhost:8080)\/?$/, async route => {
    const body = route.request().postDataJSON() as { query?: string } | null;
    if (route.request().method() !== 'POST' || !body?.query?.includes('GetMe')) return route.fallback();
    await route.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify({ data: { me: { ...MOCK_USER, isAdmin: true } } }) });
  });
  await page.goto('/');
  await page.waitForTimeout(2500);
  await page.keyboard.press('Alt+Shift+KeyR');
  const report = page.getByRole('dialog', { name: 'Issues', exact: true });
  await expect(report).toBeVisible();
  await page.locator('input[type="file"]').setInputFiles({ name: 'preview.svg', mimeType: 'image/svg+xml', buffer: Buffer.from('<svg xmlns="http://www.w3.org/2000/svg" width="600" height="400"><rect width="600" height="400" fill="teal"/><text x="30" y="200" fill="white" font-size="40">Attachment preview</text></svg>') });
  await page.getByRole('button', { name: 'Open preview.svg', exact: true }).click();
  const preview = page.getByRole('dialog', { name: 'preview.svg', exact: true });
  await expect(preview).toBeVisible();
  const topmost = await preview.evaluate(el => {
    const r = el.getBoundingClientRect();
    return el.contains(document.elementFromPoint(r.x + r.width / 2, r.y + r.height / 2));
  });
  await page.screenshot({ path: test.info().outputPath('attachment-preview.png') });
  expect(topmost, 'the preview must receive taps above the reporting dialog').toBe(true);
  await page.keyboard.press('Escape');
  await expect(preview).not.toBeVisible();
  await expect(report).toBeVisible();
  await page.getByRole('button', { name: 'Open preview.svg', exact: true }).click();
  await page.getByRole('button', { name: 'Close preview', exact: true }).click();
  await expect(preview).not.toBeVisible();
  await expect(report).toBeVisible();
});
