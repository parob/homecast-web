import { useState, useCallback, useEffect } from 'react';
import { Switch } from '@/components/ui/switch';
import { Button } from '@/components/ui/button';
import { Badge } from '@/components/ui/badge';
import { Bell, BellOff, Smartphone, Mail, Trash2, Loader2, Clock, ChevronDown, CheckCircle2, Globe } from 'lucide-react';
import { isCommunity } from '@/lib/config';
import { usePushNotifications } from '@/hooks/usePushNotifications';
import { toast } from 'sonner';
import { useQuery, useMutation } from '@apollo/client/react';
import { GET_NOTIFICATION_HISTORY } from '@/lib/graphql/queries';
import { CLEAR_NOTIFICATION_HISTORY } from '@/lib/graphql/mutations';
import type { GetNotificationHistoryResponse, NotificationLogInfo } from '@/lib/graphql/types';

interface PushTokenInfo {
  id: string;
  platform: string;
  deviceName: string | null;
  deviceFingerprint: string;
  createdAt: string;
  lastUsedAt: string | null;
}

interface NotificationPreferenceInfo {
  id: string;
  scope: string;
  scopeId: string | null;
  pushEnabled: boolean;
  emailEnabled: boolean;
  localEnabled: boolean;
}

interface NotificationsSectionProps {
  pushTokens: PushTokenInfo[];
  preferences: NotificationPreferenceInfo[];
  refetch: () => void;
  registerPushToken: (vars: {
    token: string;
    platform: string;
    deviceFingerprint: string;
    deviceName: string;
  }) => Promise<unknown>;
  unregisterPushToken: (vars: { deviceFingerprint: string }) => Promise<unknown>;
  setNotificationPreference: (vars: {
    scope: string;
    scopeId?: string;
    pushEnabled: boolean;
    emailEnabled: boolean;
    localEnabled: boolean;
  }) => Promise<unknown>;
  sendTestNotification: () => Promise<unknown>;
  userEmail?: string;
}

export function NotificationsSection({
  pushTokens,
  preferences,
  refetch,
  registerPushToken,
  unregisterPushToken,
  setNotificationPreference,
  sendTestNotification,
  userEmail,
}: NotificationsSectionProps) {
  const {
    permission,
    isAvailable,
    isRegistering,
    requestPermission,
    unregister,
  } = usePushNotifications(registerPushToken, unregisterPushToken);

  const [isSendingTest, setIsSendingTest] = useState(false);
  const [isSavingPref, setIsSavingPref] = useState(false);
  const [historyRefresh, setHistoryRefresh] = useState(0);

  const globalPref = preferences.find(p => p.scope === 'global') ?? {
    pushEnabled: true,
    emailEnabled: false,
    localEnabled: true,
  };

  const handleEnablePush = useCallback(async () => {
    const success = await requestPermission();
    if (success) refetch();
  }, [requestPermission, refetch]);

  const handleRemoveDevice = useCallback(async (fingerprint: string) => {
    await unregisterPushToken({ deviceFingerprint: fingerprint });
    refetch();
  }, [unregisterPushToken, refetch]);

  const handleTestNotification = useCallback(async () => {
    setIsSendingTest(true);
    try {
      const result = await sendTestNotification();
      setHistoryRefresh((n) => n + 1);
      if (result) {
        toast.success('Test notification sent');
      } else {
        toast.error('No notifications delivered — check your channel settings and registered devices');
      }
    } catch {
      toast.error('Failed to send test notification');
    } finally {
      setIsSendingTest(false);
    }
  }, [sendTestNotification]);

  const handleTogglePref = useCallback(async (
    field: 'pushEnabled' | 'emailEnabled',
    value: boolean,
  ) => {
    setIsSavingPref(true);
    try {
      await setNotificationPreference({
        scope: 'global',
        pushEnabled: field === 'pushEnabled' ? value : globalPref.pushEnabled,
        emailEnabled: field === 'emailEnabled' ? value : globalPref.emailEnabled,
        localEnabled: true, // always on — relay alerts are automatic
      });
      refetch();
    } finally {
      setIsSavingPref(false);
    }
  }, [setNotificationPreference, globalPref, refetch]);

  if (isCommunity) {
    return (
      <div className="text-sm text-muted-foreground p-4">
        Push notifications are available in Homecast Cloud.
      </div>
    );
  }

  const currentFingerprint = localStorage.getItem('homecast-push-fingerprint');
  const thisBrowserRegistered = pushTokens.some(t => t.deviceFingerprint === currentFingerprint);
  const otherDevices = pushTokens.filter(t => t.deviceFingerprint !== currentFingerprint);

  return (
    <div className="space-y-6">
      {/* This Browser */}
      <div>
        <p className="text-[10px] font-semibold uppercase tracking-wider text-muted-foreground mb-2">This Browser</p>
        {thisBrowserRegistered ? (
          <div className="flex items-center gap-2 py-2 px-3 rounded-md border bg-green-50 dark:bg-green-950/20 border-green-200 dark:border-green-900">
            <CheckCircle2 className="h-4 w-4 text-green-600 dark:text-green-400 shrink-0" />
            <div className="min-w-0 flex-1">
              <p className="text-sm">Registered for notifications</p>
              <p className="text-xs text-muted-foreground">
                {pushTokens.find(t => t.deviceFingerprint === currentFingerprint)?.deviceName || 'This browser'}
              </p>
            </div>
          </div>
        ) : isAvailable ? (
          <div className="rounded-lg border border-blue-200 bg-blue-50 dark:border-blue-900 dark:bg-blue-950/30 p-4">
            <div className="flex items-start gap-3">
              <Globe className="h-5 w-5 text-blue-600 dark:text-blue-400 mt-0.5 shrink-0" />
              <div className="flex-1">
                <p className="text-sm font-medium">This browser isn&apos;t receiving notifications</p>
                <p className="text-xs text-muted-foreground mt-1">
                  Allow notifications so this browser shows alerts when your automations fire.
                </p>
                <Button
                  size="sm"
                  className="mt-3"
                  onClick={handleEnablePush}
                  disabled={isRegistering || permission === 'denied'}
                >
                  {isRegistering ? (
                    <><Loader2 className="h-3 w-3 animate-spin mr-1.5" /> Registering...</>
                  ) : permission === 'denied' ? (
                    'Blocked by browser'
                  ) : (
                    'Allow Browser Notifications'
                  )}
                </Button>
                {permission === 'denied' && (
                  <p className="text-xs text-destructive mt-2">
                    Notifications are blocked. Reset in your browser&apos;s site settings.
                  </p>
                )}
              </div>
            </div>
          </div>
        ) : (
          <p className="text-xs text-muted-foreground py-2">
            Browser notifications are not supported in this context.
          </p>
        )}
      </div>

      {/* Delivery Channels */}
      <div>
        <p className="text-[10px] font-semibold uppercase tracking-wider text-muted-foreground mb-2">Delivery Channels</p>
        <p className="text-xs text-muted-foreground mb-3">
          Global defaults. Override per-home or per-automation in their settings.
        </p>
        <div className="space-y-4">
          <div className="flex items-start justify-between gap-3">
            <div className="flex items-start gap-2">
              <Bell className="h-4 w-4 text-muted-foreground mt-0.5 shrink-0" />
              <div>
                <p className="text-sm">Push</p>
                <p className="text-xs text-muted-foreground">
                  Web Push to registered browsers (via FCM) and native notifications to the Homecast Mac and iOS apps (via APNs).
                </p>
              </div>
            </div>
            <Switch
              checked={globalPref.pushEnabled}
              onCheckedChange={(v) => handleTogglePref('pushEnabled', v)}
              disabled={isSavingPref}
              className="shrink-0"
            />
          </div>

          <div className="flex items-start justify-between gap-3">
            <div className="flex items-start gap-2">
              <Mail className="h-4 w-4 text-muted-foreground mt-0.5 shrink-0" />
              <div>
                <p className="text-sm">Email</p>
                <p className="text-xs text-muted-foreground">
                  Sends to {userEmail || 'your account email'} when an automation fires a Notify action.
                </p>
              </div>
            </div>
            <Switch
              checked={globalPref.emailEnabled}
              onCheckedChange={(v) => handleTogglePref('emailEnabled', v)}
              disabled={isSavingPref}
              className="shrink-0"
            />
          </div>
        </div>
      </div>

      {/* Registered Devices */}
      <div>
        <div className="flex items-center justify-between mb-2">
          <p className="text-[10px] font-semibold uppercase tracking-wider text-muted-foreground">Registered Devices</p>
          {pushTokens.length > 0 && (
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
          )}
        </div>
        <p className="text-xs text-muted-foreground mb-3">
          Devices that receive push notifications when the toggle above is enabled.
        </p>

        {pushTokens.length === 0 ? (
          <div className="flex items-center gap-2 text-xs text-muted-foreground py-3">
            <BellOff className="h-4 w-4" />
            <span>No browsers or apps registered. Enable browser notifications above, or open Homecast on your Mac to register automatically.</span>
          </div>
        ) : (
          <div className="space-y-2">
            {pushTokens.map((token) => {
              const isThisBrowser = token.deviceFingerprint === currentFingerprint;
              return (
                <div
                  key={token.id}
                  className="flex items-center justify-between py-2 px-3 rounded-md border bg-muted/30"
                >
                  <div className="flex items-center gap-2 min-w-0">
                    <Smartphone className="h-4 w-4 text-muted-foreground shrink-0" />
                    <div className="min-w-0">
                      <p className="text-sm truncate">
                        {token.deviceName || token.platform}
                        {isThisBrowser && (
                          <span className="ml-1.5 text-xs text-blue-600 dark:text-blue-400">(this browser)</span>
                        )}
                      </p>
                      <p className="text-xs text-muted-foreground">
                        {token.platform === 'web' ? 'Web Push' : token.platform === 'macos' ? 'APNs (macOS)' : token.platform === 'ios' ? 'APNs (iOS)' : token.platform}
                        {' '}&middot; registered {new Date(token.createdAt).toLocaleDateString()}
                      </p>
                    </div>
                  </div>
                  <Button
                    variant="ghost"
                    size="sm"
                    className="h-7 w-7 p-0 text-muted-foreground hover:text-destructive shrink-0"
                    onClick={() => handleRemoveDevice(token.deviceFingerprint)}
                  >
                    <Trash2 className="h-3.5 w-3.5" />
                  </Button>
                </div>
              );
            })}
          </div>
        )}
      </div>

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
        {channels.map((ch) => (
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
        {channels.length === 0 && !log.rateLimited && (
          <Badge variant="outline" className="text-[10px] px-1.5 py-0 text-muted-foreground">
            none sent
          </Badge>
        )}
      </div>
    </div>
  );
}
