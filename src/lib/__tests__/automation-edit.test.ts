import { describe, it, expect } from 'vitest';
import { changedAutomationParts, type AutomationEditParts } from '../automation-edit';

const base: AutomationEditParts = {
  name: 'Evening lights',
  trigger: JSON.stringify({ type: 'event', events: [{ type: 'significantTime', significantEvent: 'sunset' }] }),
  actions: JSON.stringify([{ accessoryId: 'A', characteristicType: 'power_state', targetValue: true }]),
};

describe('changedAutomationParts', () => {
  it('sends nothing when nothing changed', () => {
    expect(changedAutomationParts(base, { ...base })).toEqual({});
  });

  it('sends only the name for a rename', () => {
    expect(changedAutomationParts(base, { ...base, name: 'Dusk lights' })).toEqual({ name: 'Dusk lights' });
  });

  it('leaves the trigger out when only the actions changed', () => {
    const actions = JSON.stringify([{ accessoryId: 'A', characteristicType: 'power_state', targetValue: false }]);
    expect(changedAutomationParts(base, { ...base, actions })).toEqual({ actions });
  });

  it('leaves the actions out when only the trigger changed', () => {
    const trigger = JSON.stringify({ type: 'event', events: [{ type: 'significantTime', significantEvent: 'sunrise' }] });
    expect(changedAutomationParts(base, { ...base, trigger })).toEqual({ trigger });
  });

  it('sends everything without a baseline', () => {
    expect(changedAutomationParts(null, base)).toEqual(base);
  });
});
