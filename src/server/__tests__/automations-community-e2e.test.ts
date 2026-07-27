/**
 * End-to-end coverage for the Community-mode automation path.
 *
 * Drives `handleGraphQL` — the same entry point the in-process Apollo link and
 * the LAN HTTP front-end use — against a REAL IndexedDB (fake-indexeddb), with
 * only the native HomeKit bridge mocked.
 *
 * Every assertion here is a regression guard for a bug that shipped:
 *  - the client document is `HcAutomations`, the resolver switched on
 *    `GetHcAutomations`, so the query fell through to `default: return {}` and
 *    automations vanished the moment the editor closed
 *  - the resolver returned raw IndexedDB columns (`data`/`createdAt`) while the
 *    UI reads the cloud's StoredEntityInfo shape (`dataJson`/`entityId`)
 *  - `getHcAutomations()` ignored homeId, leaking other homes' automations
 *  - `GetAutomations` and the automation mutations had no resolver case at all
 *  - execution history was returned as `executionHistory`, not
 *    `hcExecutionTraces`
 */

import 'fake-indexeddb/auto';
import { vi, describe, it, expect, beforeEach } from 'vitest';

const HOME_A = 'HOME-AAAA';
const HOME_B = 'HOME-BBBB';

const relayCalls: Array<{ action: string; payload: any }> = [];

// The relay layer is exercised for its contract, not HomeKit itself.
vi.mock('@/relay/local-handler', () => ({
  executeHomeKitAction: vi.fn(async (action: string, payload: any) => {
    relayCalls.push({ action, payload });
    switch (action) {
      case 'automations.list':
        return {
          automations: [
            {
              id: 'hk-1',
              name: 'Porch at sunset',
              isEnabled: true,
              trigger: { type: 'event', events: [{ type: 'significantTime' }], conditions: [] },
              actions: [{ accessoryId: 'acc-1', characteristicType: 'power_state', targetValue: 'true' }],
            },
          ],
        };
      case 'automation.create':
        return { id: 'hk-new', name: payload.name, isEnabled: true, trigger: { type: 'event', events: [] }, actions: [] };
      case 'automation.update':
        return { id: payload.automationId, name: payload.name ?? 'Renamed', isEnabled: true, trigger: { type: 'event', events: [] }, actions: [] };
      case 'automation.delete':
        return { success: true };
      case 'automation.enable':
      case 'automation.disable':
        return { id: payload.automationId, name: 'Porch at sunset', isEnabled: action === 'automation.enable' };
      case 'scenes.list':
        return { scenes: [{ id: 'scene-1', name: 'Movie Night', actionCount: 2 }] };
      default:
        return null;
    }
  }),
}));

vi.mock('@/server/connection', () => ({ communityRequest: vi.fn(async () => null) }));

// The engine reload is fire-and-forget; keep it out of these tests.
vi.mock('@/server/community-automation', () => ({
  reloadCommunityAutomations: vi.fn(async () => {}),
  initCommunityAutomationEngine: vi.fn(async () => {}),
}));

import { handleGraphQL } from '@/server/local-graphql';
import * as db from '@/server/local-db';

function automation(id: string, name: string) {
  return JSON.stringify({
    id,
    name,
    homeId: HOME_A,
    enabled: true,
    mode: 'single',
    triggers: [],
    conditions: { operator: 'and', conditions: [] },
    actions: [],
    metadata: { createdAt: '', updatedAt: '', triggerCount: 0 },
  });
}

async function gql(operationName: string, variables: Record<string, unknown> = {}) {
  const res: any = await handleGraphQL({ operationName, variables });
  return res?.data ?? res;
}

describe('Community mode — Homecast automations', () => {
  beforeEach(async () => {
    relayCalls.length = 0;
    for (const row of await db.getHcAutomations()) {
      await db.deleteHcAutomation(row.id);
    }
  });

  it('round-trips a saved automation back out of the list query', async () => {
    await gql('SaveHcAutomation', { homeId: HOME_A, automationId: 'auto-1', data: automation('auto-1', 'Evening lights') });

    const data = await gql('HcAutomations', { homeId: HOME_A });

    expect(data.hcAutomations).toHaveLength(1);
    expect(JSON.parse(data.hcAutomations[0].dataJson).name).toBe('Evening lights');
  });

  it('returns the field names the UI actually reads', async () => {
    await gql('SaveHcAutomation', { homeId: HOME_A, automationId: 'auto-1', data: automation('auto-1', 'Evening lights') });

    const [row] = (await gql('HcAutomations', { homeId: HOME_A })).hcAutomations;

    // AutomationsSection maps over { entityId, dataJson, updatedAt }
    expect(row.entityId).toBe('auto-1');
    expect(typeof row.dataJson).toBe('string');
    expect(typeof row.updatedAt).toBe('string');
    expect(row.parentId).toBe(HOME_A);
  });

  it('scopes the list to the requested home', async () => {
    await gql('SaveHcAutomation', { homeId: HOME_A, automationId: 'a', data: automation('a', 'In home A') });
    await gql('SaveHcAutomation', { homeId: HOME_B, automationId: 'b', data: automation('b', 'In home B') });

    const forA = await gql('HcAutomations', { homeId: HOME_A });

    expect(forA.hcAutomations.map((r: any) => r.entityId)).toEqual(['a']);
  });

  it('returns the stored shape from the save mutation too', async () => {
    const data = await gql('SaveHcAutomation', {
      homeId: HOME_A, automationId: 'auto-1', data: automation('auto-1', 'Evening lights'),
    });

    expect(data.saveHcAutomation.entityId).toBe('auto-1');
    expect(typeof data.saveHcAutomation.dataJson).toBe('string');
  });

  it('advances updatedAt when an automation is edited', async () => {
    await gql('SaveHcAutomation', { homeId: HOME_A, automationId: 'auto-1', data: automation('auto-1', 'First') });
    const first = (await gql('HcAutomations', { homeId: HOME_A })).hcAutomations[0].updatedAt;

    await new Promise(r => setTimeout(r, 5));
    await gql('SaveHcAutomation', { homeId: HOME_A, automationId: 'auto-1', data: automation('auto-1', 'Second') });
    const second = (await gql('HcAutomations', { homeId: HOME_A })).hcAutomations[0].updatedAt;

    expect(Date.parse(second)).toBeGreaterThanOrEqual(Date.parse(first));
  });

  it('deletes an automation', async () => {
    await gql('SaveHcAutomation', { homeId: HOME_A, automationId: 'auto-1', data: automation('auto-1', 'Doomed') });
    await gql('DeleteHcAutomation', { automationId: 'auto-1' });

    expect((await gql('HcAutomations', { homeId: HOME_A })).hcAutomations).toHaveLength(0);
  });
});

describe('Community mode — HomeKit-native automations', () => {
  beforeEach(() => { relayCalls.length = 0; });

  it('lists HomeKit automations instead of silently returning nothing', async () => {
    const data = await gql('GetAutomations', { homeId: HOME_A });

    expect(data.automations).toHaveLength(1);
    expect(data.automations[0].name).toBe('Porch at sunset');
    expect(relayCalls[0]).toEqual({ action: 'automations.list', payload: { homeId: HOME_A } });
  });

  it('stamps __typename through the nested trigger so Apollo can normalize it', async () => {
    const [a] = (await gql('GetAutomations', { homeId: HOME_A })).automations;

    expect(a.__typename).toBe('HomeKitAutomation');
    expect(a.trigger.__typename).toBe('AutomationTrigger');
    expect(a.trigger.events[0].__typename).toBe('AutomationEvent');
    expect(a.actions[0].__typename).toBe('AutomationAction');
  });

  it('parses the JSON-string trigger/actions the wizard sends before hitting the relay', async () => {
    await gql('CreateAutomation', {
      homeId: HOME_A,
      name: 'New one',
      trigger: JSON.stringify({ type: 'event', events: [{ type: 'calendar' }] }),
      actions: JSON.stringify([{ accessoryId: 'acc-1', characteristicType: 'power_state', targetValue: true }]),
    });

    const call = relayCalls.find(c => c.action === 'automation.create')!;
    expect(call.payload.trigger).toEqual({ type: 'event', events: [{ type: 'calendar' }] });
    expect(call.payload.actions).toEqual([{ accessoryId: 'acc-1', characteristicType: 'power_state', targetValue: true }]);
  });

  it('only forwards the fields an update actually changes', async () => {
    await gql('UpdateAutomation', { automationId: 'hk-1', name: 'Renamed' });

    const call = relayCalls.find(c => c.action === 'automation.update')!;
    expect(call.payload).toEqual({ automationId: 'hk-1', name: 'Renamed' });
  });

  it('deletes a HomeKit automation', async () => {
    const data = await gql('DeleteAutomation', { automationId: 'hk-1' });

    expect(data.deleteAutomation.success).toBe(true);
    expect(relayCalls.some(c => c.action === 'automation.delete')).toBe(true);
  });

  it('routes enable and disable to their separate relay actions', async () => {
    await gql('SetAutomationEnabled', { automationId: 'hk-1', enabled: false });
    expect(relayCalls.at(-1)!.action).toBe('automation.disable');

    const data = await gql('SetAutomationEnabled', { automationId: 'hk-1', enabled: true });
    expect(relayCalls.at(-1)!.action).toBe('automation.enable');
    expect(data.setAutomationEnabled.isEnabled).toBe(true);
  });
});

describe('Community mode — execution history', () => {
  it('returns traces under the field name the history panel selects', async () => {
    await db.saveExecutionTrace({
      id: 'trace-1',
      automationId: 'auto-1',
      automationName: 'Evening lights',
      status: 'success',
      startedAt: new Date().toISOString(),
      finishedAt: new Date().toISOString(),
      durationMs: 12,
      triggerSummary: 'state',
      traceJson: JSON.stringify({ id: 'trace-1', status: 'success' }),
    });

    const data = await gql('GetExecutionHistory', { automationId: 'auto-1', limit: 10 });

    // ExecutionHistoryPanel reads historyData.hcExecutionTraces[].dataJson
    expect(data.hcExecutionTraces).toHaveLength(1);
    expect(data.hcExecutionTraces[0].entityId).toBe('trace-1');
    expect(JSON.parse(data.hcExecutionTraces[0].dataJson).status).toBe('success');
  });
});

describe('Community mode — scenes', () => {
  it('lists scenes through the relay', async () => {
    const data = await gql('GetScenes', { homeId: HOME_A });

    expect(data.scenes[0].name).toBe('Movie Night');
  });
});
