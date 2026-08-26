// @vitest-environment jsdom
import { describe, it, expect, afterEach } from 'vitest';
import { render, screen, cleanup } from '@testing-library/react';
import { RecordingOverlay } from '../RecordingOverlay';
import { DIALOG_Z } from '@/lib/overlay-elevation';

/**
 * The stop control is the only way out of a recording, and the reason to be
 * recording at all is to walk to the problem — which in this app usually means
 * opening a dialog. At `z-[10002]` (enough to clear the mobile tab bar, and
 * nothing more) the pill went under the whole dialog band: dialogs at 10050,
 * alert dialogs / menus / selects at 10060, the background-settings dialog at
 * 10100. Opening Analytics mid-recording hid it and its scrim swallowed the tap.
 *
 * jsdom paints nothing, so what is pinned here is the number.
 */

const RAISED_ABOVE = 10100; // the highest dialog-ish surface in the app

function zOf(el: HTMLElement): number {
  const match = el.className.match(/z-\[(\d+)\]/);
  return match ? Number(match[1]) : NaN;
}

describe('recording overlay elevation', () => {
  afterEach(cleanup);

  it('sits above every dialog surface', () => {
    render(<RecordingOverlay elapsedMs={7_000} maxMs={60_000} onStop={() => {}} />);

    const frame = screen.getByRole('status');
    expect(zOf(frame)).toBeGreaterThan(DIALOG_Z);
    expect(zOf(frame)).toBeGreaterThan(RAISED_ABOVE);
  });

  it('keeps the pill tappable through a modal scrim', () => {
    render(<RecordingOverlay elapsedMs={7_000} maxMs={60_000} onStop={() => {}} />);

    // The frame spans the screen, so it must not eat taps meant for the app;
    // the button takes them back — which is also what survives the
    // `pointer-events: none` a modal dialog puts on the body.
    expect(screen.getByRole('status').className).toContain('pointer-events-none');
    expect(screen.getByRole('button', { name: /Stop recording/ }).className)
      .toContain('pointer-events-auto');
  });
});
