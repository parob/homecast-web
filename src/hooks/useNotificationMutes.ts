/**
 * This device's notification mutes.
 *
 * Muting is per-device by design (see NotificationsSection's header comment):
 * a `NotificationMute` row keyed by this device's fingerprint means muted, and
 * the absence of a row means on. There are no account-wide preferences.
 *
 * The state lives in a hook because two screens now write it — the top-level
 * Notifications page owns the device-wide switch, while each home's own
 * Notifications page owns that home's switch and its automations'. Both read
 * the same `GET_NOTIFICATION_MUTES` document, so Apollo's cache serves the
 * second mount without a second round trip and a write from either screen is
 * reflected on the other.
 */
import { useCallback, useMemo } from 'react';
import { toast } from 'sonner';
import { useQuery, useMutation } from '@apollo/client/react';
import { GET_NOTIFICATION_MUTES } from '@/lib/graphql/queries';
import { SET_NOTIFICATION_MUTE } from '@/lib/graphql/mutations';
import type { GetNotificationMutesResponse, NotificationMuteInfo, SetNotificationMuteResponse } from '@/lib/graphql/types';
import { useDeviceIdentity, type DevicePlatform } from '@/lib/device-identity';
import { isCommunity } from '@/lib/config';

export interface NotificationMutesState {
  platform: DevicePlatform | null;
  /** Stable per-device id. Null until resolved — every write is a no-op without it. */
  fingerprint: string | null;
  /** Only this device's rows; other devices configure themselves. */
  myMutes: NotificationMuteInfo[];
  /** Muted device-wide, which disables every narrower switch. */
  deviceMuted: boolean;
  isSaving: boolean;
  setMute: (scope: string, scopeId: string | null, muted: boolean) => Promise<void>;
  isMuted: (scope: string, scopeId: string) => boolean;
}

export function useNotificationMutes(): NotificationMutesState {
  const { platform, fingerprint } = useDeviceIdentity();

  const { data: mutesData, refetch: refetchMutes } = useQuery<GetNotificationMutesResponse>(
    GET_NOTIFICATION_MUTES,
    { skip: isCommunity || !fingerprint, fetchPolicy: 'cache-and-network' },
  );
  const [setMuteMutation, { loading: isSaving }] = useMutation<SetNotificationMuteResponse>(SET_NOTIFICATION_MUTE);

  const myMutes = useMemo(
    () => (mutesData?.notificationMutes ?? []).filter((m) => m.deviceFingerprint === fingerprint),
    [mutesData, fingerprint],
  );
  const deviceMuted = myMutes.some((m) => m.scope === 'device');

  const setMute = useCallback(async (scope: string, scopeId: string | null, muted: boolean) => {
    if (!fingerprint) return;
    try {
      await setMuteMutation({
        variables: { deviceFingerprint: fingerprint, scope, scopeId, muted },
      });
      await refetchMutes();
    } catch {
      toast.error('Failed to update notification setting');
    }
  }, [fingerprint, setMuteMutation, refetchMutes]);

  // HomeKit ids disagree on case between the relay, the dashboard cache and the
  // server, so a scope lookup that respects case silently reads "not muted".
  const isMuted = useCallback(
    (scope: string, scopeId: string) => myMutes.some(
      (m) => m.scope === scope && m.scopeId?.toLowerCase() === scopeId.toLowerCase(),
    ),
    [myMutes],
  );

  return { platform, fingerprint, myMutes, deviceMuted, isSaving, setMute, isMuted };
}
