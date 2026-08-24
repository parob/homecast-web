// @vitest-environment jsdom
import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { render, cleanup } from '@testing-library/react';
import { Dialog, DialogContent, DialogTitle } from '../dialog';
import { registerPanelElevation, __resetPanelElevations } from '@/lib/overlay-elevation';

/**
 * An expanded panel portals to document.body, so a dialog its action bar opens
 * is a portal SIBLING — z-index alone decides which one you can see. Inside the
 * accessory-search dialog the panel is raised to 10052 to clear that dialog,
 * and the History dialog then opened at a flat 10050: underneath the panel it
 * was opened from, greyed out by that panel's own scrim.
 *
 * jsdom paints nothing, so what is pinned here is the number.
 */

const contentZ = () => {
  const el = document.body.querySelector<HTMLElement>('[role="dialog"]');
  return el ? Number(el.style.zIndex) : null;
};

function Harness({ open }: { open: boolean }) {
  return (
    <Dialog open={open}>
      <DialogContent>
        <DialogTitle>Ceiling Light</DialogTitle>
      </DialogContent>
    </Dialog>
  );
}

describe('dialog elevation over expanded panels', () => {
  beforeEach(__resetPanelElevations);
  afterEach(cleanup);

  it('rests at the shared dialog level when nothing is expanded', () => {
    render(<Harness open />);
    expect(contentZ()).toBe(10050);
  });

  it('stays at dialog level for a panel below it — the dashboard', () => {
    registerPanelElevation(10018);
    render(<Harness open />);
    expect(contentZ()).toBe(10050);
  });

  it('clears a panel that had to be raised above dialog level', () => {
    registerPanelElevation(10052);
    render(<Harness open />);
    expect(contentZ()).toBe(10053);
  });

  it('measures at open, not when its caller first renders', () => {
    // This is the whole bug: `<Dialog open={!!target}><DialogContent>` mounts
    // the wrapper on the caller's FIRST render, long before anything is
    // expanded. Reading the elevation then always answered "nothing is open".
    const { rerender } = render(<Harness open={false} />);
    expect(contentZ()).toBeNull();

    registerPanelElevation(10052);
    rerender(<Harness open />);
    expect(contentZ()).toBe(10053);
  });

  it('does not climb when a panel is later raised inside it', () => {
    // The search dialog is the one the panel is escaping. If it re-measured,
    // the two would chase each other upwards forever.
    render(<Harness open />);
    expect(contentZ()).toBe(10050);
    registerPanelElevation(10052);
    render(<Harness open />);
    expect(contentZ()).toBe(10050);
  });

  it("lets a caller's explicit z-index win", () => {
    registerPanelElevation(10052);
    render(
      <Dialog open>
        <DialogContent style={{ zIndex: 10100 }}>
          <DialogTitle>Background</DialogTitle>
        </DialogContent>
      </Dialog>,
    );
    expect(contentZ()).toBe(10100);
  });
});
