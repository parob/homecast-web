/**
 * The desktop way in.
 *
 * A shake needs an accelerometer, so on a Mac — Catalyst app or browser — there
 * is no gesture to make. Settings is the wrong home for the replacement: by the
 * time a dialog is open, the thing you were about to report is behind it, and
 * the screenshot is taken *before* the sheet appears precisely so it isn't.
 *
 * A hotkey keeps that property. Option+Shift+R is free on both platforms and in
 * every browser we support, and it is ignored while the user is typing so it
 * cannot eat a keystroke meant for a field.
 */

import { useEffect, useRef } from 'react';

/** Whether the keystroke belongs to something the user is typing into. */
function isTyping(target: EventTarget | null): boolean {
  if (!(target instanceof HTMLElement)) return false;
  if (target.isContentEditable) return true;
  const tag = target.tagName;
  return tag === 'INPUT' || tag === 'TEXTAREA' || tag === 'SELECT';
}

/** Option+Shift+R. Named once so the UI can show the same thing it listens for. */
export const REPORT_HOTKEY_LABEL = '⌥⇧R';

export function useReportHotkey(onFire: () => void, enabled = true): void {
  const handler = useRef(onFire);
  handler.current = onFire;

  useEffect(() => {
    if (!enabled) return;

    const onKeyDown = (event: KeyboardEvent) => {
      if (!event.altKey || !event.shiftKey || event.metaKey || event.ctrlKey) return;
      // `event.key` is the composed character with Option held (on macOS ⌥⇧R is
      // "Â"), so match the physical key instead — `code` is layout-independent.
      if (event.code !== 'KeyR') return;
      if (isTyping(event.target)) return;

      event.preventDefault();
      handler.current();
    };

    window.addEventListener('keydown', onKeyDown);
    return () => window.removeEventListener('keydown', onKeyDown);
  }, [enabled]);
}
