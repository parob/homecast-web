// @vitest-environment jsdom
//
// The dock squashes the app into a fixed, overflow-hidden box so the request
// log sits beneath it rather than over it. That only works where the app
// scrolls an inner container — the Mac and mobile shells. Wherever the
// document scrolls (a browser, or under the iOS native header) the box left
// nothing to scroll at all, so the squash is skipped there.
import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { render, cleanup } from '@testing-library/react';
import { MemoryRouter } from 'react-router-dom';
import { DebugDock } from '../DebugDock';
import { setRequestPanelEnabled } from '@/lib/request-log';

type NativeWindow = Window & { homecastNativeHeaderAvailable?: boolean; homecastNativeHeaderEnabled?: boolean; isHomecastMacApp?: boolean; isHomecastIOSApp?: boolean };

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
    delete (window as NativeWindow).isHomecastMacApp;
    delete (window as NativeWindow).isHomecastIOSApp;
  });

  it('squashes the app into a fixed box in a shell that scrolls its own container', () => {
    (window as NativeWindow).isHomecastMacApp = true;
    const { getByText } = render(<MemoryRouter initialEntries={['/portal']}><DebugDock><div>dashboard</div></DebugDock></MemoryRouter>);
    expect(getByText('dashboard').closest('.fixed.inset-0')).not.toBeNull();
  });

  it('leaves the document free to scroll in a browser, and still shows the log', async () => {
    const { getByText, findByText } = render(<MemoryRouter initialEntries={['/portal']}><DebugDock><div>dashboard</div></DebugDock></MemoryRouter>);
    expect(getByText('dashboard').closest('.fixed.inset-0')).toBeNull();
    expect(await findByText('Requests')).toBeTruthy();
  });

  it('leaves the document free to scroll under the iOS native header', () => {
    setNativeHeader(true);
    (window as NativeWindow).isHomecastIOSApp = true;
    const { getByText } = render(<MemoryRouter initialEntries={['/portal']}><DebugDock><div>dashboard</div></DebugDock></MemoryRouter>);
    expect(getByText('dashboard').closest('.fixed.inset-0')).toBeNull();
  });
});
