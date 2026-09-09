// @vitest-environment jsdom
import { describe, it, expect, afterEach } from 'vitest';
import { checkIsInMacApp, isInNativeAppShell, thisDeviceNoun } from '../platform';

const FLAGS = [
  'isHomecastApp',
  'isHomecastMacApp',
  'isHomecastIOSApp',
  'isHomecastAndroidApp',
] as const;

afterEach(() => {
  for (const flag of FLAGS) delete (window as unknown as Record<string, unknown>)[flag];
});

describe('isInNativeAppShell vs checkIsInMacApp', () => {
  it('is true on iPhone, where checkIsInMacApp is deliberately false', () => {
    // The distinction that caused the bug. checkIsInMacApp excludes iOS on
    // purpose — right for relay duty, wrong for "which shell am I in".
    window.isHomecastApp = true;
    window.isHomecastIOSApp = true;

    expect(isInNativeAppShell()).toBe(true);
    expect(checkIsInMacApp()).toBe(false);
  });

  it('is true in the Mac Catalyst app, like checkIsInMacApp', () => {
    window.isHomecastApp = true;
    window.isHomecastMacApp = true;

    expect(isInNativeAppShell()).toBe(true);
    expect(checkIsInMacApp()).toBe(true);
  });

  it('is false in a plain browser', () => {
    expect(isInNativeAppShell()).toBe(false);
    expect(checkIsInMacApp()).toBe(false);
  });

  it('is false in the Tauri shell, which never sets the flag', () => {
    // Android/Windows/Linux must not set isHomecastApp: the web app also reads
    // it as "App Store build" for Apple's anti-steering rules. Widen the rule
    // here rather than setting the flag over there.
    (window as unknown as Record<string, unknown>).isHomecastAndroidApp = true;

    expect(isInNativeAppShell()).toBe(false);
  });
});

describe('thisDeviceNoun', () => {
  const ua = (s: string) => Object.defineProperty(navigator, 'userAgent', { value: s, configurable: true });
  const touches = (n: number) => Object.defineProperty(navigator, 'maxTouchPoints', { value: n, configurable: true });
  afterEach(() => { ua(''); touches(0); delete (window as unknown as Record<string, unknown>).isHomeKitRelayCapable; });

  it('knows an iPhone and an iPad', () => {
    ua('Mozilla/5.0 (iPhone; CPU iPhone OS 26_6_1 like Mac OS X)');
    expect(thisDeviceNoun()).toBe('iPhone');
    ua('Mozilla/5.0 (iPad; CPU OS 17_0 like Mac OS X)');
    expect(thisDeviceNoun()).toBe('iPad');
  });

  it('sees through iPadOS pretending to be a Mac', () => {
    ua('Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/605.1.15');
    touches(5);
    expect(thisDeviceNoun()).toBe('iPad');
  });

  it('is a Mac only where it could be the relay', () => {
    ua('Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/605.1.15');
    expect(thisDeviceNoun()).toBe('device');
    (window as unknown as Record<string, unknown>).isHomeKitRelayCapable = true;
    expect(thisDeviceNoun()).toBe('Mac');
  });
});
