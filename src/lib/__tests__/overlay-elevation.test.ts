import { describe, it, expect, beforeEach } from 'vitest';
import {
  DIALOG_Z,
  dialogElevation,
  registerPanelElevation,
  topPanelElevation,
  __resetPanelElevations,
} from '../overlay-elevation';

beforeEach(__resetPanelElevations);

describe('dialogElevation', () => {
  it('changes nothing for a panel below dialog level — the dashboard', () => {
    // ExpandedOverlay's DEFAULT_Z is 10017, so its panel sits at 10018.
    expect(dialogElevation(10018)).toBe(DIALOG_Z);
    expect(dialogElevation(0)).toBe(DIALOG_Z);
  });

  it('clears a panel that has been raised to escape a dialog', () => {
    // AccessorySearch raises its overlay to 10051, so the panel is 10052.
    expect(dialogElevation(10052)).toBe(10053);
  });

  it('clears a panel sitting exactly at dialog level', () => {
    expect(dialogElevation(DIALOG_Z)).toBe(DIALOG_Z + 1);
  });
});

describe('the open-panel register', () => {
  it('is empty until a panel opens', () => {
    expect(topPanelElevation()).toBe(0);
  });

  it('reports the highest of several, and forgets each as it closes', () => {
    const closeLow = registerPanelElevation(10018);
    const closeHigh = registerPanelElevation(10052);
    expect(topPanelElevation()).toBe(10052);

    closeHigh();
    expect(topPanelElevation()).toBe(10018);

    closeLow();
    expect(topPanelElevation()).toBe(0);
  });

  it('keeps two panels at the same level apart', () => {
    const a = registerPanelElevation(10052);
    registerPanelElevation(10052);
    a();
    // An id per registration, not a set of levels — one is still open.
    expect(topPanelElevation()).toBe(10052);
  });
});
