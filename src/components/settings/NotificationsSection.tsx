import { useState, useCallback } from 'react';
import { Switch } from '@/components/ui/switch';
import { Button } from '@/components/ui/button';
import { Badge } from '@/components/ui/badge';
import { Bell, BellOff, Smartphone, Mail, Monitor, Trash2, Loader2, Clock, ChevronDown } from 'lucide-react';
import { isCommunity } from '@/lib/config';
import { usePushNotifications } from '@/hooks/usePushNotifications';
import { useQuery } from '@apollo/client/react';
import { GET_NOTIFICATION_HISTORY } from '@/lib/graphql/queries';
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
  /** Fetched push tokens for the user */
  pushTokens: PushTokenInfo[];
  /** Fetched notification preferences */
  preferences: NotificationPreferenceInfo[];
  /** Refetch data after mutations */
  refetch: () => void;
  /** GraphQL mutations */
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
}

export function NotificationsSection({
  pushTokens,
  preferences,
  refetch,
  registerPushToken,
  unregisterPushToken,
  setNotificationPreference,
  sendTestNotification,
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

  // Find global preference (or use defaults)
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
      await sendTestNotification();
    } finally {
      setIsSendingTest(false);
    }
  }, [sendTestNotification]);

  const handleToggleGlobalPref = useCallback(async (
    field: 'pushEnabled' | 'emailEnabled' | 'localEnabled',
    value: boolean,
  ) => {
    setIsSavingPref(true);
    try {
      await setNotificationPreference({
        scope: 'global',
        pushEnabled: field === 'pushEnabled' ? value : globalPref.pushEnabled,
        emailEnabled: field === 'emailEnabled' ? value : globalPref.emailEnabled,
        localEnabled: field === 'localEnabled' ? value : globalPref.localEnabled,
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

  return (
    <div className="space-y-6">
      {/* Push Permission */}
      {isAvailable && permission !== 'granted' && (
        <div className="rounded-lg border border-blue-200 bg-blue-50 dark:border-blue-900 dark:bg-blue-950/30 p-4">
          <div className="flex items-start gap-3">
            <Bell className="h-5 w-5 text-blue-600 dark:text-blue-400 mt-0.5 shrink-0" />
            <div className="flex-1">
              <p className="text-sm font-medium">Enable Push Notifications</p>
              <p className="text-xs text-muted-foreground mt-1">
                Receive alerts when your automations trigger notification actions.
              </p>
              <Button
                size="sm"
                className="mt-3"
                onClick={handleEnablePush}
                disabled={isRegistering || permission === 'denied'}
              >
                {isRegistering ? (
                  <><Loader2 className="h-3 w-3 animate-spin mr-1.5" /> Enabling...</>
                ) : permission === 'denied' ? (
                  'Blocked by browser'
                ) : (
                  'Enable Notifications'
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
      )}

      {/* Global Channel Preferences */}
      <div>
        <h3 className="text-sm font-medium mb-3">Notification Channels</h3>
        <p className="text-xs text-muted-foreground mb-3">
          Global defaults. Override per-home or per-automation in their settings.
        </p>
        <div className="space-y-3">
          <div className="flex items-center justify-between">
            <div className="flex items-center gap-2">
              <Bell className="h-4 w-4 text-muted-foreground" />
              <div>
                <p className="text-sm">Push Notifications</p>
                <p className="text-xs text-muted-foreground">Browser and app notifications</p>
              </div>
            </div>
            <Switch
              checked={globalPref.pushEnabled}
              onCheckedChange={(v) => handleToggleGlobalPref('pushEnabled', v)}
              disabled={isSavingPref}
            />
          </div>

          <div className="flex items-center justify-between">
            <div className="flex items-center gap-2">
              <Mail className="h-4 w-4 text-muted-foreground" />
              <div>
                <p className="text-sm">Email Notifications</p>
                <p className="text-xs text-muted-foreground">Sent to your account email</p>
              </div>
            </div>
            <Switch
              checked={globalPref.emailEnabled}
              onCheckedChange={(v) => handleToggleGlobalPref('emailEnabled', v)}
              disabled={isSavingPref}
            />
          </div>

          <div className="flex items-center justify-between">
            <div className="flex items-center gap-2">
              <Monitor className="h-4 w-4 text-muted-foreground" />
              <div>
                <p className="text-sm">Local Notifications</p>
                <p className="text-xs text-muted-foreground">macOS/iOS native alerts on the relay</p>
              </div>
            </div>
            <Switch
              checked={globalPref.localEnabled}
              onCheckedChange={(v) => handleToggleGlobalPref('localEnabled', v)}
              disabled={isSavingPref}
            />
          </div>
        </div>
      </div>

      {/* Registered Devices */}
      <div>
        <div className="flex items-center justify-between mb-3">
          <h3 className="text-sm font-medium">Registered Devices</h3>
          {pushTokens.length > 0 && (
            <Button
              variant="outline"
              size="sm"
              className="h-7 text-xs"
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

        {pushTokens.length === 0 ? (
          <div className="flex items-center gap-2 text-xs text-muted-foreground py-3">
            <BellOff className="h-4 w-4" />
            <span>No devices registered for push notifications.</span>
          </div>
        ) : (
          <div className="space-y-2">
            {pushTokens.map((token) => (
              <div
                key={token.id}
                className="flex items-center justify-between py-2 px-3 rounded-md border bg-muted/30"
              >
                <div className="flex items-center gap-2 min-w-0">
                  <Smartphone className="h-4 w-4 text-muted-foreground shrink-0" />
                  <div className="min-w-0">
                    <p className="text-sm truncate">
                      {token.deviceName || token.platform}
                      {token.deviceFingerprint === currentFingerprint && (
                        <span className="ml-1.5 text-xs text-blue-600 dark:text-blue-400">(this device)</span>
                      )}
                    </p>
                    <p className="text-xs text-muted-foreground">
                      {token.platform} &middot; registered {new Date(token.createdAt).toLocaleDateString()}
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
            ))}
          </div>
        )}
      </div>

      {/* Notification History */}
      <NotificationHistory />

      {/* Rate Limits Info */}
      <div className="rounded-md border border-muted p-3">
        <p className="text-xs text-muted-foreground">
          <strong>Rate limits:</strong> Push notifications are limited to 30/hour per automation and 200/day per user.
          Email notifications are limited to 5/hour per automation and 50/day per user.
        </p>
      </div>
    </div>
  );
}

function NotificationHistory() {
  const [limit, setLimit] = useState(10);
  const { data, loading } = useQuery<GetNotificationHistoryResponse>(GET_NOTIFICATION_HISTORY, {
    variables: { limit },
    fetchPolicy: 'cache-and-network',
  });

  const logs = data?.notificationHistory ?? [];

  return (
    <div>
      <div className="flex items-center justify-between mb-3">
        <h3 className="text-sm font-medium">Recent Notifications</h3>
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
