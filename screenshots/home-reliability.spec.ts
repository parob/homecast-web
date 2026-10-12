import { test, expect } from '@playwright/test';

test('separates unavailable checks from connection time on the owner and admin surface', async ({ page }) => {
  for (const admin of [false, true]) {
    await page.goto(`/dev/reliability?case=unavailable${admin ? '&admin=1' : ''}`);
    const reliability = page.getByRole('region', {name:'Home reliability'});
    await expect(reliability.getByText(/Live check unavailable/)).toBeVisible();
    await expect(reliability.getByText('100%', {exact:true})).toHaveCount(3);
    await expect(reliability.getByText(/No disconnections recorded during observed time/)).toBeVisible();
    await reliability.getByRole('button', {name:/^Connection, /}).last().click();
    await expect(reliability.getByRole('button', {name:'Close',exact:true})).toBeVisible();
    await expect(reliability.getByText(/connected · 0s disconnected/)).toBeVisible();
    expect(await page.evaluate(()=>document.documentElement.scrollWidth<=innerWidth)).toBe(true);
  }
});

test('no-history and offline homes cannot look like verified homes', async ({page}) => {
  await page.goto('/dev/reliability?case=no-history');
  await expect(page.getByText(/No recorded history yet/)).toBeVisible();
  await expect(page.getByText('—', {exact:true})).toHaveCount(3);
  await page.getByLabel('Scenario', {exact:true}).selectOption('offline');
  await expect(page.getByText('Relay offline', {exact:true})).toBeVisible();
  await expect(page.getByText(/→ ongoing/)).toBeVisible();
});
