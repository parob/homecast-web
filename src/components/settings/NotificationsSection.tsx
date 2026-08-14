/**
 * Notification settings for the device this screen is open on (like iOS
 * notification settings): the master toggle, a test send, and the delivery
 * history. Muting writes a NotificationMute row keyed by this device's
 * fingerprint; the server drops the device from the fan-out. There are no
 * account-wide preferences — other devices configure themselves.
 *
 * Silencing one home, or one automation, is a per-home setting and lives on
 * the home's own page (Settings → Homes → a home → Notifications). This screen
 * used to list every home inline, which put half of a home's settings here and
 * half over there, and ran an automations query per home to do it.
 */
import { useCallback, useEffect, useState } from 'react';
import { Switch } from '@/components/ui/switch';
import { Button } from '@/components/ui/button';
import { Badge } from '@/components/ui/badge';
import { Bell, BellOff, Loader2, Clock, ChevronDown, Apple, AppWindow, Laptop, Smartphone, Tablet } from 'lucide-react';
import { isCommunity } from '@/lib/config';
import { toast } from 'sonner';
import { useQuery, useMutation } from '@apollo/client/react';
import { GET_NOTIFICATION_HISTORY } from '@/lib/graphql/queries';
import { SEND_TEST_NOTIFICATION, CLEAR_NOTIFICATION_HISTORY } from '@/lib/graphql/mutations';
import type {
  GetNotificationHistoryResponse,
  NotificationLogInfo,
  SendTestNotificationResponse,
} from '@/lib/graphql/types';
import { useNotificationMutes } from '@/hooks/useNotificationMutes';

export function NotificationsSection() {
  const [isSendingTest, setIsSendingTest] = useState(false);
  const [historyRefresh, setHistoryRefresh] = useState(0);

  const { platform, fingerprint, deviceMuted, isSaving: isSavingMute, setMute } = useNotificationMutes();

  const [sendTestMutation] = useMutation<SendTestNotificationResponse>(SEND_TEST_NOTIFICATION);

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

      {/* Where the narrower switches went. The per-home and per-automation
          mutes belong with the home, not in a list of every home. */}
      {fingerprint && (
        <p className="text-xs text-muted-foreground">
          To silence one home or automation, open that home in Settings &rarr; Homes &rarr; Notifications.
        </p>
      )}

      {/* Notification History */}
      <NotificationHistory refreshTrigger={historyRefresh} />

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
