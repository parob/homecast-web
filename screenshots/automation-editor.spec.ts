/**
 * Playwright tests for the Homecast Automation Editor.
 * Tests the key UX flows of the visual flow editor.
 *
 * Editor UX: Node-RED style
 * - Left palette always visible with 3 categories (Triggers, Actions, Logic)
 * - Single-click selects node, double-click opens config tray on right
 * - Simplified types: device_changed, schedule, webhook, set_device, run_scene, delay, notify, http_request, if, wait
 */

import { test, expect } from '@playwright/test';
import { setupMocks } from './mocks';

// Helper: open the editor directly (no template picker)
async function openEditor(page: import('@playwright/test').Page) {
  await page.locator('text=Automations').first().click();
  await page.waitForTimeout(500);
  await page.getByTestId('new-automation-button').click();
  await page.getByTestId('new-advanced-automation').click();
  await page.waitForTimeout(800);
}

test.describe('Automation Editor', () => {
  test.beforeEach(async ({ page }) => {
    await setupMocks(page);
    await page.goto('/portal');
    await page.waitForTimeout(2000);
  });

  // ============================================================
  // Flow 1: Open the editor from the "New" button
  // ============================================================

  test('opens "New" menu with HomeKit and Homecast options', async ({ page }) => {
    const automationsHeader = page.locator('text=Automations').first();
    await automationsHeader.click();
    await page.waitForTimeout(500);

    const newButton = page.getByTestId('new-automation-button');
    await expect(newButton).toBeVisible();
    await newButton.click();

    const menu = page.getByTestId('new-automation-menu');
    await expect(menu).toBeVisible();
    await expect(page.getByTestId('new-homekit-automation')).toBeVisible();
    await expect(page.getByTestId('new-advanced-automation')).toBeVisible();
  });

  test('opens flow editor dialog with left palette visible', async ({ page }) => {
    await openEditor(page);

    const editor = page.getByTestId('automation-editor');
    await expect(editor).toBeVisible();

    // Palette should be visible immediately (always-on left sidebar)
    await expect(page.getByTestId('node-palette')).toBeVisible();
    await expect(page.getByTestId('palette-search')).toBeVisible();
  });

  // ============================================================
  // Flow 2: Add nodes from the palette
  // ============================================================

  test('adds a node by clicking in the palette', async ({ page }) => {
    await openEditor(page);

    const canvas = page.locator('.react-flow');
    await expect(canvas).toBeVisible();

    // Click a trigger node in the palette
    await page.getByTestId('palette-node-trigger-device_changed').click();
    await page.waitForTimeout(300);

    // A node should appear on the canvas
    const nodes = page.locator('.react-flow__node');
    await expect(nodes).toHaveCount(1);

    // Single-click should NOT open config panel (only double-click does)
    const configPanel = page.getByTestId('config-panel');
    await expect(configPanel).not.toBeVisible();
  });

  test('adds multiple node types from palette', async ({ page }) => {
    await openEditor(page);

    // Add a trigger
    await page.getByTestId('palette-node-trigger-schedule').click();
    await page.waitForTimeout(200);

    // Add an action
    await page.getByTestId('palette-node-action-set_device').click();
    await page.waitForTimeout(200);

    // Add a logic node
    await page.getByTestId('palette-node-logic-if').click();
    await page.waitForTimeout(200);

    // Should have 3 nodes on canvas
    const nodes = page.locator('.react-flow__node');
    await expect(nodes).toHaveCount(3);
  });

  // ============================================================
  // Flow 3: Double-click opens config tray
  // ============================================================

  test('double-click opens config tray for Set Device', async ({ page }) => {
    await openEditor(page);

    // Add a Set Device action node
    await page.getByTestId('palette-node-action-set_device').click();
    await page.waitForTimeout(300);

    // Double-click the node to open config
    const node = page.locator('.react-flow__node').first();
    await node.dblclick();
    await page.waitForTimeout(300);

    // Config panel should now be open with "Select a device..." button
    const configPanel = page.getByTestId('config-panel');
    await expect(configPanel).toBeVisible();

    const selectDeviceBtn = page.getByTestId('select-device-button');
    await expect(selectDeviceBtn).toBeVisible();
    await expect(selectDeviceBtn).toContainText('Select a device');
  });

  test('opens device picker from config tray', async ({ page }) => {
    await openEditor(page);

    await page.getByTestId('palette-node-action-set_device').click();
    await page.waitForTimeout(300);

    // Double-click to open config
    await page.locator('.react-flow__node').first().dblclick();
    await page.waitForTimeout(300);

    // Click device picker button
    await page.getByTestId('select-device-button').click();
    await page.waitForTimeout(500);

    // AccessoryPicker dialog should appear
    const pickerDialog = page.locator('[role="dialog"]').last();
    await expect(pickerDialog).toBeVisible();
  });

  // ============================================================
  // Flow 4: Palette categories and search
  // ============================================================

  test('palette shows all categories', async ({ page }) => {
    await openEditor(page);

    await expect(page.getByTestId('palette-category-trigger')).toBeVisible();
    await expect(page.getByTestId('palette-category-action')).toBeVisible();
    await expect(page.getByTestId('palette-category-logic')).toBeVisible();

    const palette = page.getByTestId('node-palette');
    await expect(palette).toBeVisible();
  });

  test('filters nodes when searching in palette', async ({ page }) => {
    await openEditor(page);

    const searchInput = page.getByTestId('palette-search');
    await searchInput.fill('delay');
    await page.waitForTimeout(200);

    // Only the "Delay" node should be visible
    const visibleNodes = page.locator('[data-testid^="palette-node-"]');
    await expect(visibleNodes).toHaveCount(1);
    await expect(page.getByTestId('palette-node-action-delay')).toBeVisible();
  });

  // ============================================================
  // Flow 5: Can add nodes while config tray is open
  // ============================================================

  test('palette stays visible while config tray is open', async ({ page }) => {
    await openEditor(page);

    // Add and double-click a node
    await page.getByTestId('palette-node-trigger-device_changed').click();
    await page.waitForTimeout(300);
    await page.locator('.react-flow__node').first().dblclick();
    await page.waitForTimeout(300);

    // Config tray should be open
    await expect(page.getByTestId('config-panel')).toBeVisible();

    // Palette should STILL be visible
    await expect(page.getByTestId('node-palette')).toBeVisible();

    // Can add another node while config is open
    await page.getByTestId('palette-node-action-delay').click();
    await page.waitForTimeout(300);

    const nodes = page.locator('.react-flow__node');
    await expect(nodes).toHaveCount(2);
  });

  // ============================================================
  // Flow 6: Name and save automation
  // ============================================================

  test('saves an automation with a name', async ({ page }) => {
    await openEditor(page);

    const nameInput = page.getByTestId('automation-name-input');
    await nameInput.fill('My Test Automation');

    // Add a node to make it dirty
    await page.getByTestId('palette-node-trigger-schedule').click();
    await page.waitForTimeout(300);

    const saveButton = page.getByTestId('save-button');
    await expect(saveButton).toBeEnabled();
    await saveButton.click();
    await page.waitForTimeout(500);

    const isStillVisible = await saveButton.isVisible().catch(() => false);
    if (isStillVisible) {
      await expect(saveButton).toBeDisabled();
    }
  });

  // ============================================================
  // Flow 7: Existing Homecast automation
  // ============================================================

  test('shows existing Homecast automations in the section', async ({ page }) => {
    await page.locator('text=Automations').first().click();
    await page.waitForTimeout(500);

    const hcCard = page.locator('text=Motion Light - Living Room');
    await expect(hcCard).toBeVisible();
  });

  test('clicking an existing Homecast automation opens the editor', async ({ page }) => {
    await page.locator('text=Automations').first().click();
    await page.waitForTimeout(500);

    await page.locator('text=Motion Light - Living Room').click();
    await page.waitForTimeout(500);

    const editor = page.getByTestId('automation-editor');
    await expect(editor).toBeVisible();

    const nameInput = page.getByTestId('automation-name-input');
    await expect(nameInput).toHaveValue('Motion Light - Living Room');

    const nodes = page.locator('.react-flow__node');
    const count = await nodes.count();
    expect(count).toBeGreaterThan(0);
  });

  // ============================================================
  // Flow 8: Delete a node from config tray
  // ============================================================

  test('deletes a node from the config tray', async ({ page }) => {
    await openEditor(page);

    await page.getByTestId('palette-node-trigger-schedule').click();
    await page.waitForTimeout(300);
    await expect(page.locator('.react-flow__node')).toHaveCount(1);

    // Double-click to open config
    await page.locator('.react-flow__node').first().dblclick();
    await page.waitForTimeout(300);

    // Click the delete button in config tray
    const deleteBtn = page.getByTestId('config-panel').locator('button.text-destructive').first();
    await deleteBtn.click();
    await page.waitForTimeout(300);

    await expect(page.locator('.react-flow__node')).toHaveCount(0);
  });

  // ============================================================
  // Flow 9: Configure a schedule trigger
  // ============================================================

  test('configures a schedule trigger with time mode', async ({ page }) => {
    await openEditor(page);

    await page.getByTestId('palette-node-trigger-schedule').click();
    await page.waitForTimeout(300);

    // Double-click to open config
    await page.locator('.react-flow__node').first().dblclick();
    await page.waitForTimeout(300);

    // Config panel should show schedule tabs
    const configPanel = page.getByTestId('config-panel');
    await expect(configPanel).toBeVisible();

    // "Time" tab should be active by default — time input should be visible
    const timeInput = configPanel.locator('input[type="time"]');
    await expect(timeInput).toBeVisible();

    await timeInput.fill('07:30');
    await page.waitForTimeout(200);

    // The node on canvas should update its summary
    const nodeText = page.locator('.react-flow__node').first();
    await expect(nodeText).toContainText('07:30');
  });

  // ============================================================
  // Flow 10: Configure a delay action
  // ============================================================

  test('configures a delay action node', async ({ page }) => {
    await openEditor(page);

    await page.getByTestId('palette-node-action-delay').click();
    await page.waitForTimeout(300);

    // Double-click to open config
    await page.locator('.react-flow__node').first().dblclick();
    await page.waitForTimeout(300);

    const configPanel = page.getByTestId('config-panel');
    await expect(configPanel).toBeVisible();

    // Fill in minutes
    const minutesInput = configPanel.locator('input[type="number"]').nth(1);
    await minutesInput.fill('5');
    await page.waitForTimeout(200);

    const node = page.locator('.react-flow__node').first();
    await expect(node).toContainText('5m');
  });

  // ============================================================
  // Flow 11: Config tray Done/Cancel
  // ============================================================

  test('config tray Done closes the tray', async ({ page }) => {
    await openEditor(page);

    await page.getByTestId('palette-node-trigger-schedule').click();
    await page.waitForTimeout(300);
    await page.locator('.react-flow__node').first().dblclick();
    await page.waitForTimeout(300);

    await expect(page.getByTestId('config-panel')).toBeVisible();

    // Click Done
    await page.getByTestId('config-done-button').click();
    await page.waitForTimeout(200);

    await expect(page.getByTestId('config-panel')).not.toBeVisible();
  });

  // ============================================================
  // Flow 12: Unsaved changes warning
  // ============================================================

  test('warns when closing with unsaved changes', async ({ page }) => {
    await openEditor(page);

    // Make a change
    await page.getByTestId('palette-node-trigger-schedule').click();
    await page.waitForTimeout(300);

    // Click close button
    await page.getByTestId('close-editor-button').click();
    await page.waitForTimeout(300);

    const discardButton = page.getByTestId('discard-changes-button');
    await expect(discardButton).toBeVisible();
  });

  // ============================================================
  // Flow 13: Save button disabled without name
  // ============================================================

  test('save button is disabled without a name', async ({ page }) => {
    await openEditor(page);

    await page.getByTestId('palette-node-trigger-schedule').click();
    await page.waitForTimeout(200);

    const saveButton = page.getByTestId('save-button');
    await expect(saveButton).toBeDisabled();

    await page.getByTestId('automation-name-input').fill('Test');
    await page.waitForTimeout(100);

    await expect(saveButton).toBeEnabled();
  });

  // ============================================================
  // Flow 14: HC automation card has toggle and delete
  // ============================================================

  test('HC automation card shows enable toggle and delete button', async ({ page }) => {
    await page.locator('text=Automations').first().click();
    await page.waitForTimeout(500);

    const card = page.locator('[data-testid^="hc-automation-"]').first();
    await expect(card).toBeVisible();

    const toggle = card.locator('[role="switch"]');
    await expect(toggle).toBeVisible();

    const deleteBtn = card.locator('button').last();
    await expect(deleteBtn).toBeVisible();
  });
});
