/**
 * Notification settings — per-device mutes.
 *
 * This screen configures the device it is open on (like iOS notification
 * settings): a master toggle, a toggle per home, and a toggle per automation
 * that contains a Notify action. Muting writes a NotificationMute row keyed by
 * this device's fingerprint; the server drops the device from the fan-out.
 * There are no account-wide preferences — other devices configure themselves.
 */
import { useCallback, useEffect, useMemo, useState } from 'react';
import { Switch } from '@/components/ui/switch';
import { Button } from '@/components/ui/button';
import { Badge } from '@/components/ui/badge';
import { Bell, BellOff, Loader2, Clock, ChevronDown, Apple, AppWindow, Laptop, Smartphone, Tablet, Home as HomeIcon } from 'lucide-react';
import { isCommunity } from '@/lib/config';
import { toast } from 'sonner';
import { useQuery, useMutation } from '@apollo/client/react';
import { GET_HOMES, GET_NOTIFICATION_MUTES, GET_NOTIFICATION_HISTORY, HC_AUTOMATIONS } from '@/lib/graphql/queries';
import { SET_NOTIFICATION_MUTE, SEND_TEST_NOTIFICATION, CLEAR_NOTIFICATION_HISTORY } from '@/lib/graphql/mutations';
import type {
  GetHomesResponse,
  GetNotificationMutesResponse,
  GetNotificationHistoryResponse,
  NotificationLogInfo,
  NotificationMuteInfo,
  SendTestNotificationResponse,
  SetNotificationMuteResponse,
} from '@/lib/graphql/types';
import { useDeviceIdentity } from '@/lib/device-identity';
import { automationContainsActionType } from '@/automation/utils/actionWalker';
import type { Automation } from '@/automation/types/automation';

export function NotificationsSection() {
  const [isSendingTest, setIsSendingTest] = useState(false);
  const [historyRefresh, setHistoryRefresh] = useState(0);

  const { platform, fingerprint } = useDeviceIdentity();

  const { data: mutesData, refetch: refetchMutes } = useQuery<GetNotificationMutesResponse>(
    GET_NOTIFICATION_MUTES,
    { skip: isCommunity || !fingerprint, fetchPolicy: 'cache-and-network' },
  );
  const { data: homesData } = useQuery<GetHomesResponse>(GET_HOMES, {
    skip: isCommunity || !fingerprint,
    fetchPolicy: 'cache-first',
    errorPolicy: 'ignore',
  });
  const [setMuteMutation, { loading: isSavingMute }] = useMutation<SetNotificationMuteResponse>(SET_NOTIFICATION_MUTE);
  const [sendTestMutation] = useMutation<SendTestNotificationResponse>(SEND_TEST_NOTIFICATION);

  // Only this device's mutes matter here; other devices configure themselves.
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

  const handleTestNotification = useCallback(async () => {
    setIsSendingTest(true);
    try {
      const { data } = await sendTestMutation({
        variables: { deviceFingerprint: fingerprint },
      });
      setHistoryRefresh((n) => n + 1);
      if (data?.sendTestNotification) {
        toast.success('Test notification sent to this device');
      } else {
        toast.error('Not delivered — this device may not be registered for push yet');
      }
    } catch {
      toast.error('Failed to send test notification');
    } finally {
      setIsSendingTest(false);
    }
  }, [sendTestMutation, fingerprint]);

  if (isCommunity) {
    return (
      <div className="text-sm text-muted-foreground p-4">
        Push notifications are available in Homecast Cloud.
      </div>
    );
  }

  const w = window as unknown as {
    isHomecastMacApp?: boolean;
    isHomecastIOSApp?: boolean;
    isHomecastAndroidApp?: boolean;
    isHomecastTauriApp?: boolean;
    isHomecastDesktopApp?: boolean;
    homecastDeviceModel?: string;
  };
  // Tauri desktop shells (Windows/Linux/macOS) are native apps with no push path
  // of their own — they belong in the "not available here" branch, not the
  // "install the app" one.
  const isNativeApp = !!w.isHomecastMacApp || !!w.isHomecastIOSApp || !!w.isHomecastAndroidApp
    || !!w.isHomecastTauriApp || !!w.isHomecastDesktopApp;
  const isIpad = !!w.homecastDeviceModel?.startsWith('iPad') || /iPad/.test(navigator.userAgent);
  const deviceLabel = platform === 'android' ? 'phone'
    : platform === 'ios' ? (isIpad ? 'iPad' : 'iPhone')
    : 'Mac';
  const DeviceIcon = platform === 'android' ? Smartphone
    : platform === 'ios' ? (isIpad ? Tablet : Smartphone)
    : Laptop;
  const homes = homesData?.homes ?? [];

  return (
    <div className="space-y-6">
      {/* Install-app prompt — shown in a regular browser (or a desktop Tauri shell without push). */}
      {!isNativeApp && !fingerprint && (
        <div className="rounded-lg border border-blue-200 bg-blue-50 dark:border-blue-900 dark:bg-blue-950/30 p-4">
          <div className="flex items-start gap-3">
            <Bell className="h-5 w-5 text-blue-600 dark:text-blue-400 mt-0.5 shrink-0" />
            <div className="flex-1 min-w-0">
              <p className="text-sm font-medium">Get push notifications</p>
              <p className="text-xs text-muted-foreground mt-1">
                Install the Homecast app on your Mac, iPhone, or Android phone to receive push notifications. Push isn&apos;t supported in the browser.
              </p>
              <div className="flex flex-wrap gap-2 mt-3">
                <Button size="sm" variant="outline" asChild>
                  <a
                    href="https://apps.apple.com/us/app/homecast-app/id6759559232"
                    target="_blank"
                    rel="noreferrer"
                  >
                    <Apple className="h-3.5 w-3.5 mr-1.5" />
                    Mac &amp; iOS
                  </a>
                </Button>
                <Button size="sm" variant="outline" asChild>
                  <a
                    href="https://play.google.com/store/apps/details?id=cloud.homecast.app"
                    target="_blank"
                    rel="noreferrer"
                  >
                    <AppWindow className="h-3.5 w-3.5 mr-1.5" />
                    Android
                  </a>
                </Button>
              </div>
            </div>
          </div>
        </div>
      )}

      {/* Native app without a push path: an iOS build older than the push
          release, or a Tauri desktop shell which has none at all. */}
      {isNativeApp && !fingerprint && (
        <div className="flex items-center gap-2 text-xs text-muted-foreground py-2">
          <BellOff className="h-4 w-4" />
          <span>
            {w.isHomecastIOSApp
              ? `Update the Homecast app to receive push notifications on this ${isIpad ? 'iPad' : 'iPhone'}.`
              : 'Push isn’t available on this device. Notifications go to your other Homecast apps.'}
          </span>
        </div>
      )}

      {/* This device */}
      {fingerprint && (
        <div>
          <div className="flex items-center justify-between mb-2">
            <p className="text-[10px] font-semibold uppercase tracking-wider text-muted-foreground">This Device</p>
            <Button
              variant="outline"
              size="sm"
              className="h-6 text-[10px] px-2"
              onClick={handleTestNotification}
              disabled={isSendingTest}
            >
              {isSendingTest ? (
                <><Loader2 className="h-3 w-3 animate-spin mr-1" /> Sending...</>
              ) : (
                'Send Test'
              )}
            </Button>
          </div>
          <div className="flex items-start justify-between gap-3">
            <div className="flex items-start gap-2">
              <DeviceIcon className="h-4 w-4 text-muted-foreground mt-0.5 shrink-0" />
              <div>
                <p className="text-sm">Notifications on this {deviceLabel}</p>
                <p className="text-xs text-muted-foreground">
                  Push from automation Notify actions. Test notifications are always delivered.
                </p>
              </div>
            </div>
            <Switch
              checked={!deviceMuted}
              onCheckedChange={(on) => setMute('device', null, !on)}
              disabled={isSavingMute}
              className="shrink-0"
            />
          </div>
        </div>
      )}

      {/* Per-home and per-automation mutes */}
      {fingerprint && homes.length > 0 && (
        <div>
          <p className="text-[10px] font-semibold uppercase tracking-wider text-muted-foreground mb-2">Homes &amp; Automations</p>
          <p className="text-xs text-muted-foreground mb-3">
            Turn off a home to silence everything in it on this device, or turn off individual automations that send notifications.
          </p>
          <div className="space-y-4">
            {homes.map((home) => (
              <HomeMuteGroup
                key={home.id}
                homeId={home.id}
                homeName={home.name}
                myMutes={myMutes}
                deviceMuted={deviceMuted}
                isSaving={isSavingMute}
                setMute={setMute}
              />
            ))}
          </div>
        </div>
      )}

      {/* Notification History */}
      <NotificationHistory refreshTrigger={historyRefresh} />

    </div>
  );
}

function HomeMuteGroup({
  homeId,
  homeName,
  myMutes,
  deviceMuted,
  isSaving,
  setMute,
}: {
  homeId: string;
  homeName: string;
  myMutes: NotificationMuteInfo[];
  deviceMuted: boolean;
  isSaving: boolean;
  setMute: (scope: string, scopeId: string | null, muted: boolean) => Promise<void>;
}) {
  const { data: hcData } = useQuery(HC_AUTOMATIONS, {
    variables: { homeId },
    fetchPolicy: 'cache-first',
    errorPolicy: 'all',
  });

  // Automations that can actually notify — the mute list detects them by
  // walking each automation's action tree for a Notify action.
  const notifyAutomations = useMemo(() => {
    const entities = (hcData as { hcAutomations?: { entityId: string; dataJson: string }[] } | undefined)?.hcAutomations ?? [];
    const automations: Automation[] = [];
    for (const e of entities) {
      try {
        const automation = JSON.parse(e.dataJson) as Automation;
        if (automationContainsActionType(automation, 'notify')) {
          automations.push(automation);
        }
      } catch {
        // Unparseable definitions can't be shown; they also can't notify meaningfully.
      }
    }
    return automations.sort((a, b) => (a.name || '').localeCompare(b.name || ''));
  }, [hcData]);

  const homeMuted = myMutes.some(
    (m) => m.scope === 'home' && m.scopeId?.toLowerCase() === homeId.toLowerCase(),
  );
  const automationMuted = (automationId: string) => myMutes.some(
    (m) => m.scope === 'automation' && m.scopeId?.toLowerCase() === automationId.toLowerCase(),
  );

  return (
    <div>
      <div className="flex items-center justify-between gap-3">
        <div className="flex items-center gap-2 min-w-0">
          <HomeIcon className="h-4 w-4 text-muted-foreground shrink-0" />
          <p className="text-sm truncate">{homeName}</p>
        </div>
        <Switch
          checked={!homeMuted}
          onCheckedChange={(on) => setMute('home', homeId, !on)}
          disabled={isSaving || deviceMuted}
          className="shrink-0"
        />
      </div>
      {notifyAutomations.length > 0 && (
        <div className="mt-2 ml-6 space-y-2 border-l pl-3">
          {notifyAutomations.map((automation) => (
            <div key={automation.id} className="flex items-center justify-between gap-3">
              <p className="text-sm text-muted-foreground truncate">{automation.name || 'Unnamed automation'}</p>
              <Switch
                checked={!automationMuted(automation.id)}
                onCheckedChange={(on) => setMute('automation', automation.id, !on)}
                disabled={isSaving || deviceMuted || homeMuted}
                className="shrink-0"
              />
            </div>
          ))}
        </div>
      )}
    </div>
  );
}

function NotificationHistory({ refreshTrigger }: { refreshTrigger: number }) {
  const [limit, setLimit] = useState(10);
  const { data, loading, refetch } = useQuery<GetNotificationHistoryResponse>(GET_NOTIFICATION_HISTORY, {
    variables: { limit },
    fetchPolicy: 'cache-and-network',
  });
  const [clearHistory] = useMutation(CLEAR_NOTIFICATION_HISTORY);

  // Refetch when triggered (e.g., after sending a test notification)
  useEffect(() => {
    if (refreshTrigger > 0) {
      const timer = setTimeout(() => refetch(), 500);
      return () => clearTimeout(timer);
    }
  }, [refreshTrigger, refetch]);

  const logs = data?.notificationHistory ?? [];

  const handleClear = async () => {
    await clearHistory();
    refetch();
  };

  return (
    <div>
      <div className="flex items-center justify-between mb-3">
        <p className="text-[10px] font-semibold uppercase tracking-wider text-muted-foreground">Recent Notifications</p>
        {logs.length > 0 && (
          <button onClick={handleClear} className="text-[10px] text-muted-foreground hover:text-foreground transition-colors">
            Clear
          </button>
        )}
      </div>

      {loading && logs.length === 0 ? (
        <div className="flex items-center gap-2 text-xs text-muted-foreground py-3">
          <Loader2 className="h-3.5 w-3.5 animate-spin" />
          <span>Loading history...</span>
        </div>
      ) : logs.length === 0 ? (
        <div className="flex items-center gap-2 text-xs text-muted-foreground py-3">
          <Clock className="h-4 w-4" />
          <span>No notifications sent yet.</span>
        </div>
      ) : (
        <div className="space-y-1.5">
          {logs.map((log) => (
            <NotificationLogEntry key={log.id} log={log} />
          ))}
          {logs.length >= limit && (
            <Button
              variant="ghost"
              size="sm"
              className="w-full h-7 text-xs text-muted-foreground"
              onClick={() => setLimit((l) => l + 20)}
            >
              <ChevronDown className="h-3 w-3 mr-1" />
              Load more
            </Button>
          )}
        </div>
      )}
    </div>
  );
}

function NotificationLogEntry({ log }: { log: NotificationLogInfo }) {
  const channels = log.channelsSent.split(',').filter(Boolean);
  const failed = log.channelsFailed?.split(',').filter(Boolean) ?? [];
  const time = new Date(log.createdAt);
  const timeStr = time.toLocaleString(undefined, {
    month: 'short', day: 'numeric', hour: '2-digit', minute: '2-digit',
  });

  return (
    <div className="rounded-md border bg-muted/20 p-2.5">
      <div className="flex items-start justify-between gap-2">
        <div className="min-w-0 flex-1">
          {log.title && (
            <p className="text-xs font-medium truncate">{log.title}</p>
          )}
          <p className="text-xs text-muted-foreground truncate">{log.message}</p>
        </div>
        <span className="text-[10px] text-muted-foreground shrink-0">{timeStr}</span>
      </div>
      <div className="flex items-center gap-1.5 mt-1.5">
        {channels.filter((ch) => ch !== 'none').map((ch) => (
          <Badge key={ch} variant="secondary" className="text-[10px] px-1.5 py-0">
            {ch}
          </Badge>
        ))}
        {log.rateLimited && (
          <Badge variant="outline" className="text-[10px] px-1.5 py-0 text-yellow-600 dark:text-yellow-400">
            rate limited
          </Badge>
        )}
        {failed.map((f) => (
          <Badge key={f} variant="outline" className="text-[10px] px-1.5 py-0 text-destructive">
            {f}
          </Badge>
        ))}
        {channels.filter((ch) => ch !== 'none').length === 0 && !log.rateLimited && (
          <Badge variant="outline" className="text-[10px] px-1.5 py-0 text-muted-foreground">
            none sent
          </Badge>
        )}
      </div>
    </div>
  );
}
