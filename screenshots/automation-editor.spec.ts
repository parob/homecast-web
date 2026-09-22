/** Browser checks for the current desktop palette and phone Add Node flow. */
import { test, expect, type Page } from '@playwright/test';
import { setupMocks, waitForDashboard } from './mocks';

const palette = (page: Page) => page.getByTestId('node-palette').filter({ visible: true });
const config = (page: Page) => page.getByTestId('config-panel');
const nodes = (page: Page) => page.locator('.react-flow__node');

/** Automations lives behind the home's overflow menu now, not a summary pill. */
async function openAutomations(page: Page) {
  await page.locator('[data-tour="header-menu"]').click();
  await page.getByRole('menuitem', { name: 'Automations', exact: true }).click();
  await expect(page.getByRole('heading', { name: 'Automations', exact: true })).toBeVisible();
}

async function openEditor(page: Page) {
  await openAutomations(page);
  await page.getByTestId('new-automation-button').click();
  await page.getByTestId('new-advanced-automation').click();
  await expect(page.getByTestId('automation-editor')).toBeVisible();
}

async function openPalette(page: Page) {
  if (!(await palette(page).count())) await page.getByTestId('mobile-palette-button').click();
  await expect(palette(page)).toBeVisible();
  return palette(page);
}

async function addNode(page: Page, type: string) {
  const count = await nodes(page).count();
  await (await openPalette(page)).getByTestId(`palette-node-${type}`).getByRole('button').first().click();
  await expect(nodes(page)).toHaveCount(count + 1);
}

async function configureNode(page: Page) {
  await nodes(page).first().click();
  await expect(config(page)).toBeVisible();
}

test.describe('Automation Editor', () => {
  test.beforeEach(async ({ page }) => {
    await setupMocks(page);
    await page.goto('/portal');
    await waitForDashboard(page);
  });

  test('offers HomeKit and Homecast in the creation dialog', async ({ page }) => {
    await openAutomations(page);
    await page.getByTestId('new-automation-button').click();
    await expect(page.getByRole('dialog', { name: 'Create Automation' })).toBeVisible();
    await expect(page.getByTestId('new-homekit-automation')).toBeVisible();
    await expect(page.getByTestId('new-advanced-automation')).toBeVisible();
  });

  test('opens the palette through the control provided by this viewport', async ({ page }) => {
    await openEditor(page);
    const p = await openPalette(page);
    for (const category of ['trigger', 'action', 'logic']) {
      await expect(p.getByTestId(`palette-category-${category}`)).toBeVisible();
    }
  });

  test('adds a node and opens its configuration with a click', async ({ page }) => {
    await openEditor(page);
    await addNode(page, 'trigger-device_changed');
    await configureNode(page);
  });

  test('adds several kinds of node', async ({ page }) => {
    await openEditor(page);
    for (const type of ['trigger-schedule', 'action-set_device', 'logic-if']) await addNode(page, type);
    await expect(nodes(page)).toHaveCount(3);
  });

  test('opens the device picker from a Set Device node', async ({ page }) => {
    await openEditor(page);
    await addNode(page, 'action-set_device');
    await configureNode(page);
    await page.getByTestId('select-device-button').click();
    const picker = page.getByRole('dialog', { name: 'Select Device or Group', exact: true });
    await expect(picker).toBeVisible();
    await picker.getByText('Ceiling Light', { exact: true }).click();
    await expect(picker).not.toBeVisible();
    await expect(page.getByTestId('select-device-button')).toContainText('Ceiling Light');
    await expect(config(page)).toBeVisible();
  });

  test('collapses and restores a palette category', async ({ page }) => {
    await openEditor(page);
    const p = await openPalette(page);
    const category = p.getByTestId('palette-category-trigger');
    const node = p.getByTestId('palette-node-trigger-schedule');
    await expect(node).toBeVisible();
    await category.locator('button').first().click();
    await expect(node).toHaveCount(0);
    await category.locator('button').first().click();
    await expect(node).toBeVisible();
  });

  test('can add another node while configuration is open', async ({ page }) => {
    await openEditor(page);
    await addNode(page, 'trigger-device_changed');
    await configureNode(page);
    await addNode(page, 'action-delay');
    await expect(nodes(page)).toHaveCount(2);
  });

  test('saves the authored name and graph', async ({ page }) => {
    await openEditor(page);
    await page.getByTestId('automation-name-input').fill('My Test Automation');
    await addNode(page, 'trigger-schedule');
    const saved = page.waitForRequest(request => {
      if (request.method() !== 'POST') return false;
      try { return request.postDataJSON().operationName === 'SaveHcAutomation'; } catch { return false; }
    });
    await page.getByTestId('save-button').click();
    const automation = JSON.parse((await saved).postDataJSON().variables.data);
    expect(automation.name).toBe('My Test Automation');
    expect(automation.triggers).toHaveLength(1);
    await expect(page.getByTestId('automation-editor')).not.toBeVisible();
    await expect(page.getByText('Automation saved', { exact: true })).toBeVisible();
  });

  test('opens an existing automation with its name and nodes', async ({ page }) => {
    await openAutomations(page);
    await page.getByText('Motion Light - Living Room', { exact: true }).click();
    await expect(page.getByTestId('automation-name-input')).toHaveValue('Motion Light - Living Room');
    await expect(nodes(page)).not.toHaveCount(0);
  });

  test('deletes a node from its configuration', async ({ page }) => {
    await openEditor(page);
    await addNode(page, 'trigger-schedule');
    await configureNode(page);
    await config(page).getByRole('button', { name: 'Delete node', exact: true }).click();
    await expect(nodes(page)).toHaveCount(0);
  });

  test('configures a schedule time', async ({ page }) => {
    await openEditor(page);
    await addNode(page, 'trigger-schedule');
    await configureNode(page);
    await config(page).locator('input[type="time"]').fill('07:30');
    await expect(nodes(page).first()).toContainText('07:30');
  });

  test('configures a delay duration', async ({ page }) => {
    await openEditor(page);
    await addNode(page, 'action-delay');
    await configureNode(page);
    await config(page).locator('input[type="number"]').first().fill('5');
    await expect(nodes(page).first()).toContainText('5m');
  });

  test('warns before discarding unsaved changes', async ({ page }) => {
    await openEditor(page);
    await addNode(page, 'trigger-schedule');
    await page.getByTestId('close-editor-button').click();
    await expect(page.getByTestId('discard-changes-button')).toBeVisible();
    await page.getByTestId('discard-changes-button').click();
    await expect(page.getByTestId('automation-editor')).not.toBeVisible();
  });

  test('requires a nonblank name to save', async ({ page }) => {
    await openEditor(page);
    await addNode(page, 'trigger-schedule');
    await page.getByTestId('automation-name-input').fill('   ');
    await expect(page.getByTestId('save-button')).toBeDisabled();
    await page.getByTestId('automation-name-input').fill('Test');
    await expect(page.getByTestId('save-button')).toBeEnabled();
  });
});
