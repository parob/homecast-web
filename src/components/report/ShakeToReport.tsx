/**
 * Shake to report, for admin accounts.
 *
 * Mount once, near the root. It listens for a shake, grabs a screenshot of what
 * is on screen at that instant, and opens the report sheet with it attached.
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
import { useShake } from '@/lib/report/use-shake';

import { ReportSheet } from './ReportSheet';

export function ShakeToReport() {
  const { isAdmin } = useAuth();
  const [open, setOpen] = useState(false);
  const [screenshot, setScreenshot] = useState<CapturedMedia | null>(null);
  const capturing = useRef(false);

  const onShake = useCallback(() => {
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

  // Held off while the sheet is up: shaking a phone to dismiss a dialog is a
  // natural reflex, and re-triggering on top of it would be maddening.
  useShake(onShake, isAdmin && !open);

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
