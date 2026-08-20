import { describe, it, expect } from 'vitest';
import { scrimCutout, SCRIM_HOLE_RADIUS, OVERLAY_SCRIM, overlayScrim } from '../overlay-scrim';

const rect = (left: number, top: number, width: number, height: number) => ({ left, top, width, height });

describe('scrimCutout', () => {
  /**
   * Even-odd is the whole mechanism: two rings in one path, the inner one
   * subtracted. Without the fill rule the second ring is just more coverage and
   * the trigger stays buried — which is the bug this exists to fix.
   */
  it('uses the even-odd fill rule', () => {
    expect(scrimCutout(1000, 800, rect(100, 100, 30, 30))).toMatch(/^path\(evenodd, "/);
  });

  it('covers the whole viewport with the outer ring', () => {
    expect(scrimCutout(1000, 800, rect(100, 100, 30, 30))).toContain('M0,0 H1000 V800 H0 Z');
  });

  /**
   * The hole is the trigger's box, not a padded box around it. The 5px of
   * "breathing room" it used to leave was a ring of undimmed, still-blurred
   * wallpaper — visible precisely because it was a different shape from the
   * button lit inside it.
   */
  it('cuts the trigger\'s own box, with no padding around it', () => {
    const path = scrimCutout(1000, 800, rect(100, 200, 30, 40), 0)!;
    expect(path).toContain('M100,200');
    expect(path).toContain('H130');
    expect(path).toContain('V240');
  });

  /**
   * A round button gets a round hole. `rounded-full` computes to 9999px, so
   * the clamp to half the box is what turns it into a circle — without it the
   * header's 40px circle sat inside an 11px squircle.
   */
  it('rounds the hole the way the trigger is rounded', () => {
    const path = scrimCutout(1000, 800, rect(0, 0, 40, 40), 9999)!;
    expect(path).toContain('A20,20');
  });

  it('clamps the corner radius so a short trigger cannot invert its own corners', () => {
    const path = scrimCutout(1000, 800, rect(0, 0, 200, 8), 16)!;
    expect(path).toContain('A4,4');
    expect(path).not.toContain('A16,16');
  });

  it('falls back to the default rounding when the trigger\'s is unreadable', () => {
    const path = scrimCutout(1000, 800, rect(0, 0, 200, 40))!;
    expect(path).toContain(`A${SCRIM_HOLE_RADIUS},${SCRIM_HOLE_RADIUS}`);
  });

  /**
   * A caller with nothing to measure must get an uncut scrim, not an empty
   * clip — an empty clip would hide the scrim entirely and silently drop the
   * dim rather than merely failing to cut it.
   */
  it('declines to clip when there is nothing to cut around', () => {
    expect(scrimCutout(1000, 800, null)).toBeUndefined();
    expect(scrimCutout(1000, 800, undefined)).toBeUndefined();
    expect(scrimCutout(1000, 800, rect(10, 10, 0, 30))).toBeUndefined();
    expect(scrimCutout(1000, 800, rect(10, 10, 30, 0))).toBeUndefined();
  });
});

describe('scrim classes', () => {
  it('uses one blur everywhere, so the surfaces read as one system', () => {
    expect(OVERLAY_SCRIM).toContain('backdrop-blur-[2px]');
    expect(overlayScrim(true)).toContain('backdrop-blur-[2px]');
    expect(overlayScrim(false)).toContain('backdrop-blur-[2px]');
  });

  it('dims harder over a dark wallpaper, where a black wash barely registers', () => {
    expect(overlayScrim(true)).toContain('bg-black/40');
    expect(overlayScrim(false)).toContain('bg-black/20');
  });
});

/**
 * `scrimCutout` is no longer how the widget overlay leaves its trigger lit.
 *
 * `clip-path` removes an element's background but NOT its `backdrop-filter` —
 * the filter applies across the whole border box whatever the clip says. So a
 * clipped scrim left the chip undimmed and still *blurred*, which is what "the
 * tab bar item is still behind the blurred background" looked like. The overlay
 * draws four panes around the trigger instead; nothing overlaps it, so nothing
 * can blur it.
 *
 * The path is kept for the card menus, whose trigger goes solid white — an
 * opaque fill hides the residual blur behind it — and this pins the geometry
 * contract that bit at us: the numbers are the scrim's, not the window's.
 */
describe('scrimCutout coordinate frame', () => {
  it('sizes the outer ring to the scrim it is given, not the viewport', () => {
    // A `.fixed-full-screen` scrim on a notched phone is taller than the
    // viewport and starts above it. Handing it window numbers cut the bottom
    // off — and an unpainted scrim is one taps go straight through.
    const path = scrimCutout(390, 900, { left: 10, top: 10, width: 40, height: 40 })!;
    expect(path).toContain('M0,0 H390 V900 H0 Z');
    expect(path).not.toContain('V844');
  });
});
