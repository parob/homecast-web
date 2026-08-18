// @vitest-environment jsdom
import { describe, it, expect, afterEach } from 'vitest';
import { checkIsInMacApp, isInNativeAppShell } from '../platform';

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
