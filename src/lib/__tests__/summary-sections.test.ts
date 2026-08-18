import { describe, it, expect } from 'vitest';
import {
  SUMMARY_SECTION_ORDER,
  SUMMARY_PILL_ORDER,
  isScenesSectionVisible,
  isSummarySectionVisible,
  isHomeActionVisible,
  withSummarySectionVisibility,
  withHomeActionVisibility,
  type HomeActionId,
} from '../summary-sections';

const ACTION_ORDER: HomeActionId[] = [
  'lights', 'blinds', 'locks', 'fans', 'switches', 'climate-off', 'security', 'everything-off',
];

describe('absent means shown', () => {
  it('treats a missing layout, a bare layout and a bare visibility as fully visible', () => {
    for (const layout of [null, undefined, {}, { visibility: {} }]) {
      for (const id of SUMMARY_SECTION_ORDER) {
        expect(isSummarySectionVisible(layout, id)).toBe(true);
      }
      for (const id of ACTION_ORDER) {
        expect(isHomeActionVisible(layout, id)).toBe(true);
      }
    }
  });

  it('hides only what is listed', () => {
    const layout = { visibility: { hiddenSummarySections: ['scenes'], hiddenActions: ['locks'] } };
    expect(isSummarySectionVisible(layout, 'scenes')).toBe(false);
    expect(isSummarySectionVisible(layout, 'actions')).toBe(true);
    expect(isHomeActionVisible(layout, 'locks')).toBe(false);
    expect(isHomeActionVisible(layout, 'lights')).toBe(true);
  });
});

describe('withSummarySectionVisibility', () => {
  it('round-trips a hide then a show', () => {
    const hidden = withSummarySectionVisibility(undefined, 'status', false);
    expect(hidden).toEqual(['status']);
    expect(withSummarySectionVisibility(hidden, 'status', true)).toEqual([]);
  });

  it('normalises to canonical order regardless of insertion order', () => {
    let hidden = withSummarySectionVisibility(undefined, 'status', false);
    hidden = withSummarySectionVisibility(hidden, 'actions', false);
    hidden = withSummarySectionVisibility(hidden, 'scenes', false);
    expect(hidden).toEqual(['actions', 'scenes', 'status']);
  });

  it('dedupes a repeated hide', () => {
    let hidden = withSummarySectionVisibility(undefined, 'scenes', false);
    hidden = withSummarySectionVisibility(hidden, 'scenes', false);
    expect(hidden).toEqual(['scenes']);
  });

  it('drops ids it does not recognise rather than carrying them forward', () => {
    const hidden = withSummarySectionVisibility(['scenes', 'from-a-newer-build'], 'status', false);
    expect(hidden).toEqual(['scenes', 'status']);
  });

  it('is a no-op when showing something already shown', () => {
    expect(withSummarySectionVisibility(['scenes'], 'status', true)).toEqual(['scenes']);
  });
});

describe('withHomeActionVisibility', () => {
  it('orders by the catalog order it is handed', () => {
    let hidden = withHomeActionVisibility(ACTION_ORDER, undefined, 'everything-off', false);
    hidden = withHomeActionVisibility(ACTION_ORDER, hidden, 'lights', false);
    expect(hidden).toEqual(['lights', 'everything-off']);
  });

  it('round-trips and dedupes like the section variant', () => {
    let hidden = withHomeActionVisibility(ACTION_ORDER, undefined, 'security', false);
    hidden = withHomeActionVisibility(ACTION_ORDER, hidden, 'security', false);
    expect(hidden).toEqual(['security']);
    expect(withHomeActionVisibility(ACTION_ORDER, hidden, 'security', true)).toEqual([]);
  });
});

describe('merging into an existing layout', () => {
  it('leaves roomOrder and hiddenRooms untouched', () => {
    const prev = {
      roomOrder: ['r1', 'r2'],
      visibility: { hiddenRooms: ['r3'] },
      background: { type: 'color', value: '#fff' },
    };
    const next = {
      ...prev,
      visibility: {
        ...prev.visibility,
        hiddenSummarySections: withSummarySectionVisibility(undefined, 'status', false),
      },
    };
    expect(next.roomOrder).toEqual(['r1', 'r2']);
    expect(next.visibility.hiddenRooms).toEqual(['r3']);
    expect(next.background).toEqual(prev.background);
    expect(next.visibility.hiddenSummarySections).toEqual(['status']);
  });
});

describe('the merged Scenes section', () => {
  it('renders three pills, with Scenes leading', () => {
    expect(SUMMARY_PILL_ORDER).toEqual(['scenes', 'automations', 'status']);
  });

  it('keeps `actions` in the canonical order even though it has no pill', () => {
    // toggleIn filters every write through SUMMARY_SECTION_ORDER. Drop the id
    // and the next toggle of anything silently un-hides a user's shortcuts.
    expect(SUMMARY_SECTION_ORDER).toContain('actions');
  });

  it('shows the section while either half is on', () => {
    expect(isScenesSectionVisible(null)).toBe(true);
    expect(isScenesSectionVisible({ visibility: { hiddenSummarySections: ['scenes'] } })).toBe(true);
    expect(isScenesSectionVisible({ visibility: { hiddenSummarySections: ['actions'] } })).toBe(true);
  });

  it('hides the section only when both halves are off', () => {
    expect(isScenesSectionVisible({ visibility: { hiddenSummarySections: ['scenes', 'actions'] } })).toBe(false);
  });

  it('leaves a pre-merge blob that hid Actions hiding only the shortcuts', () => {
    const layout = { visibility: { hiddenSummarySections: ['actions'] } };

    expect(isSummarySectionVisible(layout, 'actions')).toBe(false);
    expect(isSummarySectionVisible(layout, 'scenes')).toBe(true);
    expect(isScenesSectionVisible(layout)).toBe(true);
  });

  it('survives a round trip through a write', () => {
    // The regression this guards: normalising through an order that had lost
    // `actions` returned [] and turned the shortcuts back on.
    const hidden = withSummarySectionVisibility(['actions'], 'status', false);

    expect(hidden).toContain('actions');
    expect(hidden).toContain('status');
  });
});
