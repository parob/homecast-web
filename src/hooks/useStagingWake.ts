import { useCallback, useRef, useState } from 'react';
import { switchEnvironment, waitForStaging, wakeStaging } from '@/lib/environment-switch';

export type StagingWakePhase = 'idle' | 'starting' | 'failed';

/**
 * Wake staging for six hours, wait until it answers, then `onReady`.
 *
 * Used by the staging badge (which reloads into the woken staging) and by
 * "Switch to Staging" on production (which switches there). Waking asks
 * production's API and needs no sign-in, so it works from either side.
 */
export function useStagingWake(onReady: () => void = () => switchEnvironment('staging')) {
  const [phase, setPhase] = useState<StagingWakePhase>('idle');
  const [error, setError] = useState<string | null>(null);
  const inFlight = useRef(false);

  const wake = useCallback(async (): Promise<{ ok: boolean; error?: string }> => {
    if (inFlight.current) return { ok: false, error: 'Already waking staging.' };
    inFlight.current = true;
    setPhase('starting');
    setError(null);
    const fail = (message: string) => {
      setError(message);
      setPhase('failed');
      return { ok: false, error: message };
    };
    try {
      const result = await wakeStaging();
      if ('error' in result) return fail(result.error);
      if (!(await waitForStaging())) return fail("Staging didn't come up within ten minutes.");
      onReady();
      return { ok: true };
    } finally {
      inFlight.current = false;
    }
  }, [onReady]);

  return { phase, error, wake };
}
