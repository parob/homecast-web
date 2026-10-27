import { useCallback, useEffect, useRef } from 'react';
import { useMutation } from '@apollo/client/react';
import { toast } from 'sonner';
import { useAuth } from '@/contexts/AuthContext';
import { WAKE_STAGING } from '@/lib/graphql/mutations';
import { config } from '@/lib/config';
import { stagingServerIsUp, switchEnvironment, takeStagingWakeRequest } from '@/lib/environment-switch';

interface WakeStagingResponse {
  wakeStaging: { available: boolean; running: boolean; starting: boolean; awakeUntil: string | null; error: string | null };
}

// A cold start schedules a pod, pulls the image and boots the server: 3m20s
// on 26 Oct. Ten minutes is the point at which something is wrong, not slow.
const WAKE_POLL_MS = 5000;
const WAKE_GIVE_UP_MS = 10 * 60 * 1000;

function sleepFor(ms: number) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

/**
 * Production's half of waking staging: start it for six hours, wait until it
 * answers, then switch to it.
 *
 * Reached two ways: "Switch to Staging" in the menu when staging is asleep,
 * and the staging badge's "Wake for 6 hours", which can't wake staging itself
 * (a sleeping staging can't sign you in) and hands the request here in a
 * cookie. Production is where you are signed in, so it is where the wake can
 * be authorised.
 */
export function useStagingWake() {
  const { isAuthenticated, hasStagingAccess } = useAuth();
  const [wakeStaging] = useMutation<WakeStagingResponse>(WAKE_STAGING);
  const running = useRef(false);

  const wakeAndSwitch = useCallback(async () => {
    if (running.current) return;
    running.current = true;
    const id = toast.loading('Waking staging for 6 hours…', { description: 'Usually takes about three minutes.' });
    try {
      const { data } = await wakeStaging();
      const result = data?.wakeStaging;
      if (!result?.available) {
        toast.error("Couldn't wake staging", { id, description: result?.error ?? undefined });
        return;
      }
      const deadline = Date.now() + WAKE_GIVE_UP_MS;
      while (!(await stagingServerIsUp())) {
        if (Date.now() > deadline) {
          toast.error("Staging didn't come up", { id, description: 'It is still starting; try switching again shortly.' });
          return;
        }
        await sleepFor(WAKE_POLL_MS);
      }
      toast.success('Staging is awake for 6 hours', { id });
      switchEnvironment('staging');
    } catch (e) {
      toast.error("Couldn't wake staging", { id, description: e instanceof Error ? e.message : undefined });
    } finally {
      running.current = false;
    }
  }, [wakeStaging]);

  // A wake asked for from staging's badge, picked up once signed in here.
  useEffect(() => {
    if (config.isStaging || !isAuthenticated) return;
    if (!takeStagingWakeRequest()) return;
    if (!hasStagingAccess) {
      toast.error("Your account can't wake staging");
      return;
    }
    void wakeAndSwitch();
  }, [isAuthenticated, hasStagingAccess, wakeAndSwitch]);

  return { wakeAndSwitch };
}
