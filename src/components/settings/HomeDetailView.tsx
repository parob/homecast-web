import { useState, useEffect, useCallback } from 'react';
import {
  AlertDialog,
  AlertDialogAction,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
  AlertDialogTrigger,
} from '@/components/ui/alert-dialog';
import { Button } from '@/components/ui/button';
import { Badge } from '@/components/ui/badge';
import { Switch } from '@/components/ui/switch';
import { Plus, Pencil, Trash2, Bell, Mail, Home as HomeIcon, Radio, Wifi, WifiOff, Cloud, Monitor, Users, ExternalLink } from 'lucide-react';
import { isCommunity } from '@/lib/config';
import { formatRelativeAgo } from '@/lib/relay-last-seen';
import { useQuery, useMutation } from '@apollo/client/react';
import { GET_NOTIFICATION_PREFERENCES, GET_HOME_MQTT_ENABLED, GET_HOME_MQTT_BROKERS } from '@/lib/graphql/queries';
import { SET_NOTIFICATION_PREFERENCE, DELETE_NOTIFICATION_PREFERENCE, SET_HOME_MQTT_ENABLED, ADD_HOME_MQTT_BROKER, REMOVE_HOME_MQTT_BROKER } from '@/lib/graphql/mutations';
import type { GetNotificationPreferencesResponse, SetNotificationPreferenceResponse } from '@/lib/graphql/types';
import { isMQTTAvailable } from '@/lib/mqtt-bridge';
import type { MQTTBrokerConfig } from '@/lib/mqtt-bridge';
import { AddBrokerDialog } from './AddBrokerDialog';
import type { HomeKitHome } from '@/lib/graphql/types';
import { toast } from 'sonner';
import { useHomes } from '@/hooks/useHomeKitData';

interface HomeDetailViewProps {
  home: HomeKitHome;
  developerMode?: boolean;
}

function statusBadge(status: string | undefined) {
  switch (status) {
    case 'connected':
      return <Badge variant="default" className="text-[10px] px-1.5 py-0 bg-green-600">Connected</Badge>;
    case 'connecting':
      return <Badge variant="secondary" className="text-[10px] px-1.5 py-0 bg-yellow-500/20 text-yellow-700 dark:text-yellow-400">Connecting</Badge>;
    case 'disconnected':
      return <Badge variant="outline" className="text-[10px] px-1.5 py-0">Disconnected</Badge>;
    default:
      if (status?.startsWith('error')) {
        return <Badge variant="destructive" className="text-[10px] px-1.5 py-0">Error</Badge>;
      }
      return <Badge variant="outline" className="text-[10px] px-1.5 py-0">{status || 'Unknown'}</Badge>;
  }
}

function BrokerCard({ broker, homeId, onRefresh, onRemove }: { broker: MQTTBrokerConfig; homeId: string; onRefresh: () => void; onRemove: (id: string) => void }) {
  const [editOpen, setEditOpen] = useState(false);

  return (
    <>
      <div className="rounded-lg border bg-muted/30 p-3 space-y-1.5">
        <div className="flex items-center justify-between">
          <div className="flex items-center gap-2 min-w-0">
            <Radio className="h-4 w-4 text-muted-foreground shrink-0" />
            <span className="text-sm font-medium truncate">{broker.name}</span>
          </div>
          {statusBadge(broker.status)}
        </div>
        <p className="text-xs text-muted-foreground">
          {broker.host}:{broker.port}{broker.useTLS ? ' (TLS)' : ''}
          {broker.haDiscovery ? ' · HA Discovery' : ''}
        </p>
        <div className="flex gap-1.5 justify-end">
          <Button variant="ghost" size="sm" className="h-6 text-xs gap-1" onClick={() => setEditOpen(true)}>
            <Pencil className="h-3 w-3" /> Edit
          </Button>
          <AlertDialog>
            <AlertDialogTrigger asChild>
              <Button variant="ghost" size="sm" className="h-6 text-xs text-destructive hover:text-destructive gap-1">
                <Trash2 className="h-3 w-3" /> Remove
              </Button>
            </AlertDialogTrigger>
            <AlertDialogContent style={{ zIndex: 10060 }}>
              <AlertDialogHeader>
                <AlertDialogTitle>Remove broker?</AlertDialogTitle>
                <AlertDialogDescription>
                  This will disconnect from {broker.name} and stop publishing state for this home.
                </AlertDialogDescription>
              </AlertDialogHeader>
              <AlertDialogFooter>
                <AlertDialogCancel>Cancel</AlertDialogCancel>
                <AlertDialogAction onClick={() => onRemove(broker.id)} className="bg-destructive text-destructive-foreground hover:bg-destructive/90">
                  Remove
                </AlertDialogAction>
              </AlertDialogFooter>
            </AlertDialogContent>
          </AlertDialog>
        </div>
      </div>

      <AddBrokerDialog
        open={editOpen}
        onOpenChange={setEditOpen}
        homeId={homeId}
        editBroker={broker}
        onSaved={onRefresh}
      />
    </>
  );
}

export function HomeDetailView({ home: homeProp, developerMode }: HomeDetailViewProps) {
  // Keep the detail view fresh so relayLastSeenAt / relayConnected reflect the
  // live server state instead of a frozen snapshot taken at settings-open time.
  const { data: liveHomes, refetch: refetchHomes } = useHomes();
  useEffect(() => {
    const id = setInterval(() => { refetchHomes(); }, 15_000);
    return () => clearInterval(id);
  }, [refetchHomes]);
  const home = liveHomes?.find(h => h.id === homeProp.id) ?? homeProp;
  // Tick every second so the "ago" label updates without waiting for a refetch.
  const [, setNow] = useState(0);
  useEffect(() => {
    const id = setInterval(() => setNow(n => n + 1), 1_000);
    return () => clearInterval(id);
  }, []);

  const [addOpen, setAddOpen] = useState(false);
  const [mqttToggling, setMqttToggling] = useState(false);
  const [setHomeMqttEnabledMut] = useMutation(SET_HOME_MQTT_ENABLED);
  const isAdmin = !home.role || home.role === 'owner' || home.role === 'admin';
  const [removeHomeMqttBrokerMut] = useMutation(REMOVE_HOME_MQTT_BROKER);

  // Load mqtt_enabled state from server (cloud only)
  const { data: mqttData, refetch: refetchMqtt } = useQuery(GET_HOME_MQTT_ENABLED, {
    variables: { homeId: home.id },
    skip: isCommunity,
    fetchPolicy: 'network-only',
  });
  const mqttEnabled = mqttData?.homeMqttEnabled ?? false;

  // Load custom brokers from server
  const { data: brokersData, refetch: refetchBrokers, loading: brokersLoading } = useQuery(GET_HOME_MQTT_BROKERS, {
    variables: { homeId: home.id },
    skip: isCommunity,
    fetchPolicy: 'network-only',
  });
  const brokers: MQTTBrokerConfig[] = brokersData?.homeMqttBrokers ?? [];

  const handleToggleMqtt = async (enabled: boolean) => {
    setMqttToggling(true);
    try {
      await setHomeMqttEnabledMut({ variables: { homeId: home.id, enabled } });
      await refetchMqtt();
      toast.success(enabled ? 'MQTT broker enabled' : 'MQTT broker disabled');
    } catch (e: any) {
      const msg = e?.graphQLErrors?.[0]?.message || e?.message || 'Failed to update MQTT broker';
      toast.error(msg);
    }
    finally { setMqttToggling(false); }
  };

  const handleRemoveBroker = async (brokerId: string) => {
    try {
      await removeHomeMqttBrokerMut({ variables: { homeId: home.id, brokerId } });
      await refetchBrokers();
      toast.success('Broker removed');
    } catch (e: any) {
      const msg = e?.graphQLErrors?.[0]?.message || e?.message || 'Failed to remove broker';
      toast.error(msg);
    }
  };

  const isOwner = !home.role || home.role === 'owner';
  const isShared = !isOwner;
  const isCloudManaged = home.isCloudManaged === true;
  const relayKindLabel = isCloudManaged ? 'Cloud Relay' : 'Self-hosted relay';
  const RelayKindIcon = isCloudManaged ? Cloud : Monitor;
  const roleLabel = isShared
    ? (home.role === 'admin' ? 'Admin'
       : home.role === 'view' ? 'View'
       : home.role === 'control' ? 'Control'
       : 'Shared')
    : null;
  const relayOnline = home.relayConnected === true;

  return (
    <div className="space-y-4">
      <div className="flex items-center gap-2.5">
        <HomeIcon className="h-5 w-5 text-muted-foreground" />
        <h3 className="text-base font-semibold">{home.name}</h3>
        {home.isPrimary && (
          <Badge variant="outline" className="text-[10px] px-1.5 py-0">Primary</Badge>
        )}
        {isShared && (
          <Badge variant="outline" className="text-[10px] px-1.5 py-0">Shared</Badge>
        )}
      </div>

      {/* Connection */}
      <div className="space-y-2">
        <p className="text-[10px] font-semibold uppercase tracking-wider text-muted-foreground">Connection</p>
        <div className="rounded-lg border bg-muted/30 p-3 space-y-2 text-xs">
          <div className="flex items-center justify-between">
            <div className="flex items-center gap-2">
              <RelayKindIcon className="h-3.5 w-3.5 text-muted-foreground" />
              <span className="font-medium">{relayKindLabel}</span>
            </div>
            <span className={`flex items-center gap-1.5 font-medium px-1.5 py-0.5 rounded-full ${
              relayOnline
                ? 'bg-green-500/10 text-green-600'
                : 'bg-red-500/10 text-red-600'
            }`}>
              {relayOnline ? <Wifi className="h-3 w-3" /> : <WifiOff className="h-3 w-3" />}
              {relayOnline ? 'Online' : 'Offline'}
            </span>
          </div>

          <div className="flex justify-between">
            <span className="text-muted-foreground">Last online</span>
            <span className="font-medium">
              {home.relayLastSeenAt ? formatRelativeAgo(home.relayLastSeenAt) : 'Never'}
            </span>
          </div>

          {roleLabel && (
            <div className="flex justify-between">
              <span className="text-muted-foreground">Your access</span>
              <span className="font-medium">{roleLabel}</span>
            </div>
          )}

          {isShared && home.ownerEmail && (
            <div className="flex justify-between gap-2">
              <span className="text-muted-foreground shrink-0">Home owner</span>
              <span className="font-medium truncate max-w-[180px]" title={home.ownerEmail}>{home.ownerEmail}</span>
            </div>
          )}

          {home.relayOwnerEmail && home.relayOwnerEmail !== home.ownerEmail && (
            <div className="flex justify-between gap-2">
              <span className="text-muted-foreground shrink-0 flex items-center gap-1">
                <Users className="h-3 w-3" /> Relay operator
              </span>
              <span className="font-medium break-all text-right">{home.relayOwnerEmail}</span>
            </div>
          )}

          <div className="flex justify-between">
            <span className="text-muted-foreground">Accessories</span>
            <span className="font-medium">{home.accessoryCount ?? 0}</span>
          </div>
          <div className="flex justify-between">
            <span className="text-muted-foreground">Rooms</span>
            <span className="font-medium">{home.roomCount ?? 0}</span>
          </div>

          {home.relayId && (
            <div className="flex justify-between gap-2">
              <span className="text-muted-foreground shrink-0">Relay ID</span>
              <span className="font-mono text-[10px] truncate max-w-[180px]" title={home.relayId}>{home.relayId}</span>
            </div>
          )}

          {developerMode && (
            <div className="flex justify-between gap-2">
              <span className="text-muted-foreground shrink-0">Home ID</span>
              <span className="font-mono text-[10px] truncate max-w-[180px]" title={home.id}>{home.id}</span>
            </div>
          )}
        </div>
      </div>

      {/* MQTT (developer mode only) */}
      {developerMode && <div className="space-y-2">
        <p className="text-[10px] font-semibold uppercase tracking-wider text-muted-foreground">MQTT</p>

        {/* Homecast MQTT Broker (cloud only) */}
        {!isCommunity && (() => {
          const mqttUrl = `https://${location.hostname.includes('staging') ? 'staging.mqtt.homecast.cloud' : 'mqtt.homecast.cloud'}`;
          return (
            <div className="flex items-center justify-between py-1">
              <div>
                <a
                  href={mqttUrl}
                  target="_blank"
                  rel="noopener noreferrer"
                  onClick={(e) => {
                    const w = window as any;
                    if (w.webkit?.messageHandlers?.homecast) {
                      e.preventDefault();
                      w.webkit.messageHandlers.homecast.postMessage({ action: 'openUrl', url: mqttUrl });
                    }
                  }}
                  className="inline-flex items-center gap-1 text-sm font-medium hover:underline"
                >
                  Homecast MQTT Broker
                  <ExternalLink className="h-3 w-3 text-muted-foreground" />
                </a>
                <p className="text-xs text-muted-foreground">Publish device state to the managed MQTT broker</p>
              </div>
              <Switch
                checked={mqttEnabled}
                disabled={mqttToggling || !isAdmin}
                onCheckedChange={handleToggleMqtt}
              />
            </div>
          );
        })()}

        {/* Custom MQTT Brokers */}
        {!isCommunity && (
          <>
            <div className="flex items-center justify-between pt-2">
              <p className="text-[10px] font-semibold uppercase tracking-wider text-muted-foreground">Custom MQTT Brokers</p>
              {isAdmin && <Button variant="ghost" size="sm" className="h-6 text-xs" onClick={() => setAddOpen(true)}>
                <Plus className="h-3.5 w-3.5 mr-1" /> Add
              </Button>}
            </div>

            {brokersLoading ? (
              <p className="text-xs text-muted-foreground py-2 text-center">Loading...</p>
            ) : brokers.length === 0 ? (
              <p className="text-xs text-muted-foreground py-2 text-center">No custom brokers configured.</p>
            ) : (
              brokers.map((broker: any) => (
                <BrokerCard key={broker.id} broker={broker} homeId={home.id} onRefresh={() => refetchBrokers()} onRemove={handleRemoveBroker} />
              ))
            )}
          </>
        )}
      </div>}

      {/* Notification Preferences (cloud only) */}
      {!isCommunity && <HomeNotificationPreferences homeId={home.id} />}

      <AddBrokerDialog
        open={addOpen}
        onOpenChange={setAddOpen}
        homeId={home.id}
        onSaved={() => refetchBrokers()}
      />
    </div>
  );
}

function HomeNotificationPreferences({ homeId }: { homeId: string }) {
  const { data, refetch } = useQuery<GetNotificationPreferencesResponse>(GET_NOTIFICATION_PREFERENCES);
  const [setPrefMutation] = useMutation<SetNotificationPreferenceResponse>(SET_NOTIFICATION_PREFERENCE);
  const [deletePrefMutation] = useMutation(DELETE_NOTIFICATION_PREFERENCE);
  const [saving, setSaving] = useState(false);

  const homePref = data?.notificationPreferences?.find(p => p.scope === 'home' && p.scopeId === homeId);
  const hasOverride = !!homePref;

  const handleToggle = async (field: 'pushEnabled' | 'emailEnabled', value: boolean) => {
    setSaving(true);
    try {
      await setPrefMutation({
        variables: {
          scope: 'home',
          scopeId: homeId,
          pushEnabled: field === 'pushEnabled' ? value : (homePref?.pushEnabled ?? true),
          emailEnabled: field === 'emailEnabled' ? value : (homePref?.emailEnabled ?? false),
          localEnabled: true,
        },
      });
      refetch();
    } finally {
      setSaving(false);
    }
  };

  const handleReset = async () => {
    setSaving(true);
    try {
      await deletePrefMutation({ variables: { scope: 'home', scopeId: homeId } });
      refetch();
    } finally {
      setSaving(false);
    }
  };

  return (
    <div className="space-y-2">
      <div className="flex items-center justify-between">
        <p className="text-[10px] font-semibold uppercase tracking-wider text-muted-foreground">Notifications</p>
        {hasOverride && (
          <button
            onClick={handleReset}
            className="text-[10px] text-muted-foreground hover:text-foreground transition-colors"
            disabled={saving}
          >
            Reset to global
          </button>
        )}
      </div>
      {hasOverride && <p className="text-xs text-muted-foreground">Custom settings for this home.</p>}
      <div className="space-y-2">
        <div className="flex items-center justify-between">
          <div className="flex items-center gap-2">
            <Bell className="h-3.5 w-3.5 text-muted-foreground" />
            <span className="text-sm">Push</span>
          </div>
          <Switch
            checked={homePref?.pushEnabled ?? true}
            onCheckedChange={(v) => handleToggle('pushEnabled', v)}
            disabled={saving}
          />
        </div>
        <div className="flex items-center justify-between">
          <div className="flex items-center gap-2">
            <Mail className="h-3.5 w-3.5 text-muted-foreground" />
            <span className="text-sm">Email</span>
          </div>
          <Switch
            checked={homePref?.emailEnabled ?? false}
            onCheckedChange={(v) => handleToggle('emailEnabled', v)}
            disabled={saving}
          />
        </div>
      </div>
    </div>
  );
}
