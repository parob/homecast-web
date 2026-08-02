import { describe, it, expect } from 'vitest';
import { walkActions, automationContainsActionType } from '../utils/actionWalker';
import type { Action, Automation } from '../types/automation';

const notify = (id: string): Action => ({ id, type: 'notify', message: 'hi' } as Action);
const delay = (id: string): Action => ({ id, type: 'delay', duration: { seconds: 1 } } as Action);

function automationWith(actions: Action[]): Automation {
  return { id: 'a1', name: 'Test', homeId: 'h1', enabled: true, triggers: [], actions } as unknown as Automation;
}

describe('walkActions', () => {
  it('yields top-level actions in order', () => {
    const actions = [delay('d1'), notify('n1')];
    expect([...walkActions(actions)].map((a) => a.id)).toEqual(['d1', 'n1']);
  });

  it('recurses into if_then_else then and else', () => {
    const actions: Action[] = [{
      id: 'if1', type: 'if_then_else', condition: { conditions: [] },
      then: [notify('n-then')],
      else: [delay('d-else'), notify('n-else')],
    } as unknown as Action];
    const ids = [...walkActions(actions)].map((a) => a.id);
    expect(ids).toEqual(['if1', 'n-then', 'd-else', 'n-else']);
  });

  it('recurses into choose branches and default', () => {
    const actions: Action[] = [{
      id: 'c1', type: 'choose',
      choices: [
        { conditions: { conditions: [] }, actions: [notify('n-a')] },
        { conditions: { conditions: [] }, actions: [delay('d-b')] },
      ],
      default: [notify('n-default')],
    } as unknown as Action];
    const ids = [...walkActions(actions)].map((a) => a.id);
    expect(ids).toEqual(['c1', 'n-a', 'd-b', 'n-default']);
  });

  it('recurses into repeat sequences and parallel branches', () => {
    const actions: Action[] = [
      { id: 'r1', type: 'repeat', mode: 'count', count: 2, sequence: [notify('n-loop')] } as unknown as Action,
      { id: 'p1', type: 'parallel', branches: [[delay('d-p')], [notify('n-p')]] } as unknown as Action,
    ];
    const ids = [...walkActions(actions)].map((a) => a.id);
    expect(ids).toEqual(['r1', 'n-loop', 'p1', 'd-p', 'n-p']);
  });

  it('finds a notify nested several levels deep', () => {
    const actions: Action[] = [{
      id: 'if1', type: 'if_then_else', condition: { conditions: [] },
      then: [{
        id: 'r1', type: 'repeat', mode: 'while', sequence: [{
          id: 'p1', type: 'parallel', branches: [[notify('n-deep')]],
        } as unknown as Action],
      } as unknown as Action],
    } as unknown as Action];
    expect(automationContainsActionType(automationWith(actions), 'notify')).toBe(true);
  });

  it('does not follow call_script actions', () => {
    const actions: Action[] = [
      { id: 's1', type: 'call_script', scriptId: 'other' } as unknown as Action,
    ];
    expect(automationContainsActionType(automationWith(actions), 'notify')).toBe(false);
  });

  it('tolerates malformed input without throwing', () => {
    const actions = [
      null,
      42,
      { id: 'no-type' },
      { id: 'if-broken', type: 'if_then_else', then: 'not-an-array', else: null },
      { id: 'choose-broken', type: 'choose', choices: [null, { actions: 'nope' }] },
      { id: 'parallel-broken', type: 'parallel', branches: 'nope' },
      notify('n1'),
    ] as unknown as Action[];
    const ids = [...walkActions(actions)].map((a) => a.id);
    expect(ids).toContain('n1');
    expect(automationContainsActionType(automationWith(actions), 'notify')).toBe(true);
  });

  it('handles missing actions arrays', () => {
    expect([...walkActions(undefined)]).toEqual([]);
    expect([...walkActions(null)]).toEqual([]);
    expect(automationContainsActionType(null, 'notify')).toBe(false);
    expect(automationContainsActionType({} as Automation, 'notify')).toBe(false);
  });
});
