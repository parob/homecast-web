/**
 * Report a problem, for admin accounts.
 *
 * Mount once, near the root. It listens for a shake — or, where there is no
 * accelerometer to shake, the ⌥⇧R hotkey — grabs a screenshot of what is on
 * screen at that instant, and opens the report sheet with it attached.
 *
 * The screenshot is taken BEFORE the sheet opens, which is the whole reason
 * this component exists rather than the sheet capturing on demand: once the
 * dialog is up, the thing the user was complaining about is behind it.
 *
 * Admin-only, matching the server. The gate here is for the interface; the
 * server enforces it again, because a client-side check is a courtesy rather
 * than a control.
 */

import { useCallback, useRef, useState } from 'react';

import { useAuth } from '@/contexts/AuthContext';
import { captureScreenshot, type CapturedMedia } from '@/lib/report/capture';
import { useReportHotkey } from '@/lib/report/use-report-hotkey';
import { useShake } from '@/lib/report/use-shake';

import { ReportSheet } from './ReportSheet';

export function ShakeToReport() {
  const { isAdmin } = useAuth();
  const [open, setOpen] = useState(false);
  const [screenshot, setScreenshot] = useState<CapturedMedia | null>(null);
  const capturing = useRef(false);

  const onTrigger = useCallback(() => {
    // A shake is easy to repeat by accident; ignore one while we are already
    // acting on the last.
    if (capturing.current || open) return;
    capturing.current = true;

    void (async () => {
      try {
        setScreenshot(await captureScreenshot());
      } finally {
        capturing.current = false;
        setOpen(true);
      }
    })();
  }, [open]);

  // Both held off while the sheet is up: shaking a phone to dismiss a dialog is
  // a natural reflex, and re-triggering on top of it would be maddening.
  useShake(onTrigger, isAdmin && !open);

  // Desktop and Mac Catalyst have no accelerometer, so the gesture is a hotkey
  // there. Registered unconditionally rather than behind a platform check: a
  // key combination nobody presses costs nothing, and guessing the platform
  // from the user agent is how an iPad with a keyboard ends up with neither.
  useReportHotkey(onTrigger, isAdmin && !open);

  if (!isAdmin) return null;

  return (
    <ReportSheet
      open={open}
      onOpenChange={(next) => {
        setOpen(next);
        if (!next) setScreenshot(null);
      }}
      initialScreenshot={screenshot}
    />
  );
}
