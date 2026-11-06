import { test, expect, type Page } from '@playwright/test';
import { setupMocks } from './mocks';

const TOPIC = 'homecast/test-home-1111/bedroom-2222/bedroom-lights-3333';
const MEMBER = 'homecast/test-home-1111/bedroom-2222/lamp-4444';
type Broker = { state: (value: object, topic?: string, retained?: boolean) => void; failNext: boolean; writes: { topic: string; payload: string }[] };
const inspector = (page: Page) => page.locator('[data-mqtt-inspector]:visible');
const state = (page: Page, value: object, topic = TOPIC, retained = false) =>
  page.evaluate(({ value, topic, retained }) => (window as unknown as { mqttTest: Broker }).mqttTest.state(value, topic, retained), { value, topic, retained });

test.beforeEach(async ({ page }) => {
  await setupMocks(page);
  await page.route('https://api.homecast.cloud/', route => {
    if (route.request().postData()?.includes('createMqttToken')) {
      return route.fulfill({ contentType: 'application/json', body: JSON.stringify({ data: { createMqttToken: 'test-broker-token' } }) });
    }
    return route.fallback();
  });
  // Exercise the real publish/message handlers. A broker send callback is
  // immediate, while device state is deliberately held until the test sends it.
  await page.route('https://unpkg.com/mqtt@*/dist/mqtt.min.js', route => route.fulfill({
    contentType: 'application/javascript',
    body: `
      const topic = ${JSON.stringify(TOPIC)}, member = ${JSON.stringify(MEMBER)};
      const handlers = {};
      const emit = (name, ...args) => (handlers[name] || []).forEach(fn => fn(...args));
      window.mqttTest = {
        writes: [], failNext: false,
        state(value, target = topic, retained = false) {
          emit('message', target, { toString: () => JSON.stringify(value) }, { retain: retained });
        }
      };
      window.mqtt = { connect() {
        const client = {
          on(name, fn) { (handlers[name] ||= []).push(fn); return client; },
          subscribe() { queueMicrotask(() => {
            window.mqttTest.state(['lamp-4444'], topic + '/members', true);
            window.mqttTest.state({on:true, brightness:60}, member, true);
            window.mqttTest.state({on:true, brightness:60}, topic, true);
          }); },
          publish(topic, payload, options, callback) {
            window.mqttTest.writes.push({ topic, payload });
            const failed = window.mqttTest.failNext;
            window.mqttTest.failNext = false;
            callback?.(failed ? new Error('test publish failed') : undefined);
          },
          end() { emit('close'); }
        };
        setTimeout(() => emit('connect'), 0);
        return client;
      } };
    `,
  }));
  await page.goto('/mqtt?topic=' + encodeURIComponent(TOPIC));
  await expect(inspector(page).getByRole('switch')).toHaveAttribute('aria-checked', 'true');
});

test('holds a group off through delayed and partial state until confirmation', async ({ page }, testInfo) => {
  const panel = inspector(page), toggle = panel.getByRole('switch');
  await toggle.click();
  await expect(toggle).toHaveAttribute('aria-checked', 'false');
  await expect(panel.getByRole('status')).toHaveText('Updating…');
  await state(page, { on: false }, MEMBER); // one member finishing is not group confirmation
  await state(page, { on: true, brightness: 60 }); // intermediate aggregate
  await state(page, { on: false, brightness: 60 }, TOPIC, true); // old retained snapshot
  await expect(toggle).toHaveAttribute('aria-checked', 'false');
  await expect(panel.getByRole('status')).toHaveText('Updating…');
  await expect(panel.locator('[aria-busy="true"]')).toHaveCount(2); // controls and icon ring
  await page.screenshot({ path: testInfo.outputPath('mqtt-pending.png') });
  await state(page, { on: false, brightness: 60 });
  await expect(panel.getByRole('status')).toHaveCount(0);
  await expect(toggle).toHaveAttribute('aria-checked', 'false');
  expect(await page.evaluate(() => (window as unknown as { mqttTest: Broker }).mqttTest.writes))
    .toEqual([{ topic: TOPIC + '/set', payload: '{"on":false}' }]);
});

test('keeps the latest toggle and reports a publish failure', async ({ page }) => {
  const panel = inspector(page), toggle = panel.getByRole('switch');
  await toggle.click();
  await toggle.click();
  await state(page, { on: false });
  await expect(toggle).toHaveAttribute('aria-checked', 'true');
  await expect(panel.getByRole('status')).toHaveText('Updating…');
  await state(page, { on: true });
  await expect(panel.getByRole('status')).toHaveCount(0);
  await page.evaluate(() => { (window as unknown as { mqttTest: Broker }).mqttTest.failNext = true; });
  await toggle.click();
  await expect(panel.getByRole('alert')).toContainText('Could not send the change');
  await expect(toggle).toHaveAttribute('aria-checked', 'true');
});

test('JSON publishes wait for every field, then time out visibly', async ({ page, isMobile }) => {
  const panel = inspector(page);
  if (isMobile) await panel.getByRole('button', { name: 'JSON', exact: true }).click();
  await page.clock.install();
  await panel.locator('textarea').fill('{"on":false,"brightness":25}');
  await panel.getByRole('button', { name: 'Publish', exact: true }).click();
  await state(page, { on: false, brightness: 60 });
  await expect(panel.getByRole('status')).toHaveText('Updating…');
  await page.clock.fastForward(30_001);
  await expect(panel.getByRole('alert')).toContainText('No matching update received');
  await expect(panel.getByRole('status')).toHaveCount(0);
  await expect(panel.locator('textarea')).toHaveValue(/"brightness": 60/);
  if (isMobile) await panel.getByRole('button', { name: 'Controls', exact: true }).click();
  await expect(panel.getByRole('switch')).toHaveAttribute('aria-checked', 'false');
});
