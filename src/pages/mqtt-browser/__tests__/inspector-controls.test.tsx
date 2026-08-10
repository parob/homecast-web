// @vitest-environment jsdom
//
// The inspector renders the real Dashboard widget, so it has to wire every
// handler that widget can call. It wired the toggle and the slider but not
// onSetValue — and that is the one a string reaches: a timer's Start, a mode's
// option, a text or date value. The widget called an undefined handler and the
// press did nothing at all, silently, so every string-valued control in the
// browser was inert while looking perfectly normal.
import { describe, it, expect, vi, afterEach } from 'vitest';

// config.ts reads localStorage while its module body runs, which is before
// jsdom's copy is reachable from here. Hoisted so it exists first.
vi.hoisted(() => {
  const store = new Map<string, string>();
  (globalThis as Record<string, unknown>).localStorage = {
    getItem: (k: string) => store.get(k) ?? null,
    setItem: (k: string, v: string) => { store.set(k, String(v)); },
    removeItem: (k: string) => { store.delete(k); },
    clear: () => store.clear(),
    key: () => null,
    length: 0,
  };
  // jsdom implements no matchMedia at all, and the widget chrome asks for it.
  (globalThis as Record<string, unknown>).matchMedia = (query: string) => ({
    matches: false,
    media: query,
    onchange: null,
    addEventListener: () => {},
    removeEventListener: () => {},
    addListener: () => {},
    removeListener: () => {},
    dispatchEvent: () => false,
  });
});
import { render, screen, fireEvent, cleanup } from '@testing-library/react';
import { InspectorPanel } from '../InspectorPanel';

afterEach(cleanup);

function open(topic: string, payload: string) {
  const onPublishProp = vi.fn();
  render(
    <InspectorPanel
      topic={topic}
      message={{ payload, timestamp: Date.now(), updates: 1 }}
      effectivePayload={payload}
      rowType="accessory"
      homeOffline={false}
      rawMode={false}
      onRawModeChange={() => {}}
      publishValue=""
      onPublishValueChange={() => {}}
      onPublishToSet={() => {}}
      onPublishProp={onPublishProp}
      onClose={() => {}}
      variant="pane"
    />,
  );
  return onPublishProp;
}

describe('MQTT inspector controls', () => {
  it('starts a timer', () => {
    const publish = open('homecast/home-1111/porch-timer-2c12', '{"timer": "idle"}');

    fireEvent.click(screen.getByRole('button', { name: /start/i }));

    expect(publish).toHaveBeenCalledWith(
      'homecast/home-1111/porch-timer-2c12', 'timer', 'active');
  });

  it('cancels a running timer', () => {
    const publish = open('homecast/home-1111/porch-timer-2c12', '{"timer": "active"}');

    fireEvent.click(screen.getByRole('button', { name: /cancel/i }));

    expect(publish).toHaveBeenCalledWith(
      'homecast/home-1111/porch-timer-2c12', 'timer', 'idle');
  });

  it('selects a mode', async () => {
    const publish = open('homecast/home-1111/home-mode-80d9', '{"mode": "Home"}');

    // No options travel over MQTT, so the current value is the only one
    // offered — enough to prove the write reaches the publish path. It is a
    // menu rather than a dropdown field since the mode picker stopped using a
    // native select; a single-entry menu is as useful as a single-entry select
    // was, which is to say the payload is the limit, not the control.
    fireEvent.pointerDown(
      screen.getByRole('button', { name: 'Set Home Mode' }),
      { ctrlKey: false, button: 0 },
    );
    fireEvent.click(await screen.findByRole('menuitem', { name: 'Home' }));

    expect(publish).toHaveBeenCalledWith(
      'homecast/home-1111/home-mode-80d9', 'mode', 'Home');
  });

});
