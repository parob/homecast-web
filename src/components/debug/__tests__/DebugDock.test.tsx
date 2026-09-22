// @vitest-environment jsdom
//
// The dock squashes the app into a fixed, overflow-hidden box so the request
// log sits beneath it rather than over it. Under the iOS native header that
// box is exactly wrong: the document is what scrolls there, and boxed in it
// could not scroll at all. So the squash is skipped while the header is on.
import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { render, cleanup } from '@testing-library/react';
import { DebugDock } from '../DebugDock';
import { setRequestPanelEnabled } from '@/lib/request-log';

type NativeWindow = Window & { homecastNativeHeaderAvailable?: boolean; homecastNativeHeaderEnabled?: boolean };

function setNativeHeader(on: boolean) {
  const w = window as NativeWindow;
  if (on) {
    w.homecastNativeHeaderAvailable = true;
    w.homecastNativeHeaderEnabled = true;
  } else {
    delete w.homecastNativeHeaderAvailable;
    delete w.homecastNativeHeaderEnabled;
  }
}

describe('DebugDock', () => {
  beforeEach(() => setRequestPanelEnabled(true));
  afterEach(() => {
    cleanup();
    setRequestPanelEnabled(false);
    setNativeHeader(false);
  });

  it('squashes the app into a fixed box when the log is on', () => {
    const { getByText } = render(<DebugDock><div>dashboard</div></DebugDock>);
    expect(getByText('dashboard').closest('.fixed.inset-0')).not.toBeNull();
  });

  it('leaves the document free to scroll under the iOS native header', () => {
    setNativeHeader(true);
    const { getByText } = render(<DebugDock><div>dashboard</div></DebugDock>);
    expect(getByText('dashboard').closest('.fixed.inset-0')).toBeNull();
  });
});
