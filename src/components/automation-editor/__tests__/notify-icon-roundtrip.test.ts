/**
 * The Notify node's icon has to survive the editor.
 *
 * `graphToAutomation` used to build the notify action's `data` from action
 * buttons and nothing else, and `automationToGraph` read back exactly three
 * keys — so any field not explicitly carried through both was dropped the next
 * time the automation was opened and saved. An icon that quietly disappears on
 * the second edit is worse than one that never worked, so pin the round trip.
 */

import { describe, it, expect } from 'vitest';
import { automationToGraph } from '../serialization/automationToGraph';
import { graphToAutomation } from '../serialization/graphToAutomation';
import type { Automation, NotifyAction } from '@/automation/types/automation';

function automationWithNotify(overrides: Partial<NotifyAction>): Automation {
  return {
    id: 'auto-1',
    name: 'Notify',
    homeId: 'home-1',
    enabled: true,
    mode: 'single',
    triggers: [{
      type: 'state',
      id: 'trig-1',
      accessoryId: 'sensor-1',
      characteristicType: 'contact_state',
      to: 1,
    }],
    conditions: { operator: 'and', conditions: [] },
    actions: [{
      type: 'notify',
      id: 'notify-1',
      message: 'Front door opened',
      title: 'Door',
      ...overrides,
    } as NotifyAction],
    metadata: { createdAt: '2026-07-29T00:00:00.000Z', updatedAt: '2026-07-29T00:00:00.000Z', triggerCount: 0 },
  };
}

/** Open the automation in the editor and save it again, untouched. */
function roundTrip(automation: Automation): NotifyAction {
  const { nodes, edges } = automationToGraph(automation);
  const saved = graphToAutomation(nodes, edges, automation.name, automation.homeId, automation.id);
  const notify = saved.actions.find((a) => a.type === 'notify');
  return notify as NotifyAction;
}

describe('notify icon round trip', () => {
  it('keeps a built-in slug', () => {
    expect(roundTrip(automationWithNotify({ icon: 'door-open' })).icon).toBe('door-open');
  });

  it('keeps an https URL', () => {
    const url = 'https://example.com/snapshot.png';
    expect(roundTrip(automationWithNotify({ icon: url })).icon).toBe(url);
  });

  it('keeps a template, which is only a URL at run time', () => {
    const tpl = '{{ nodes.snapshot.data.url }}';
    expect(roundTrip(automationWithNotify({ icon: tpl })).icon).toBe(tpl);
  });

  it('leaves the icon unset when there is none', () => {
    expect(roundTrip(automationWithNotify({})).icon).toBeUndefined();
  });

  it('keeps the icon alongside action buttons', () => {
    const action = roundTrip(automationWithNotify({
      icon: 'alert',
      data: { actions: [{ action: 'ack', title: 'Acknowledge' }] },
    }));

    expect(action.icon).toBe('alert');
    expect(action.data?.actions).toEqual([{ action: 'ack', title: 'Acknowledge' }]);
  });

  it('survives being opened and saved twice', () => {
    // One pass proves the two functions agree; two proves the result of a save
    // is itself re-openable, which is the shape of the bug this guards against.
    const once = automationWithNotify({ icon: 'leak' });
    const { nodes, edges } = automationToGraph(once);
    const saved = graphToAutomation(nodes, edges, once.name, once.homeId, once.id);

    expect(roundTrip(saved).icon).toBe('leak');
  });

  it('drops an icon that could escape the icon URL path', () => {
    // A blueprint or an imported automation reaches the serializer without ever
    // passing through the config panel's validation.
    for (const evil of ['../../etc/passwd', 'http://example.com/x.png', 'javascript:alert(1)']) {
      expect(roundTrip(automationWithNotify({ icon: evil })).icon, evil).toBeUndefined();
    }
  });
});
