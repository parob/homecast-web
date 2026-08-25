/**
 * Opening the report sheet without a shake.
 *
 * Desktop has no accelerometer, and on iOS Safari the motion permission may
 * have been refused — a gesture nobody can perform is not a feature, so the
 * sheet is always reachable from Settings too.
 */

import { useCallback, useState } from 'react';

import { useAuth } from '@/contexts/AuthContext';
import { captureScreenshot, type CapturedMedia } from '@/lib/report/capture';

import { ReportSheet } from './ReportSheet';

export function useReportSheet() {
  const { isAdmin } = useAuth();
  const [open, setOpen] = useState(false);
  const [screenshot, setScreenshot] = useState<CapturedMedia | null>(null);

  const openSheet = useCallback(async () => {
    setScreenshot(await captureScreenshot());
    setOpen(true);
  }, []);

  return {
    isAdmin,
    open,
    openSheet,
    sheet: (
      <ReportSheet
        open={open}
        onOpenChange={(next) => {
          setOpen(next);
          if (!next) setScreenshot(null);
        }}
        initialScreenshot={screenshot}
      />
    ),
  };
}
