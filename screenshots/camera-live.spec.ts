import { test, expect } from '@playwright/test';

test('opened camera shows full-frame live video, queues the third and releases on close', async ({ page }) => {
  await page.goto('/screenshots/fixtures/camera-live.html');
  const first = page.locator('[data-camera="0"]');
  const third = page.locator('[data-camera="2"]');
  await expect(first.getByText('Live · No audio')).toBeVisible();
  await expect(third.getByText(/Waiting for a camera slot/)).toBeVisible();
  await expect(page.getByRole('switch')).toHaveCount(0);
  const image = first.getByAltText('Camera 1 live view');
  await expect(image).toBeVisible();
  const geometry = await image.evaluate(img => {
    const r = img.getBoundingClientRect();
    return { ratio: r.width / r.height, fit: getComputedStyle(img).objectFit, width: r.width, height: r.height };
  });
  expect(geometry.fit).toBe('contain');
  expect(geometry.ratio).toBeCloseTo(540 / 960, 2);
  expect(geometry.height).toBeGreaterThan(200);
  await first.getByRole('button', { name: 'Close viewer 1' }).click();
  await expect(third.getByText('Live · No audio')).toBeVisible();
  await expect(third.getByAltText('Camera 3 live view')).toBeVisible();
});
