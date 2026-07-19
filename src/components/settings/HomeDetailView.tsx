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
import { HOMEKIT_EDIT_PERMISSION_FIX } from '@/lib/homekit-errors';
import { useQuery, useMutation } from '@apollo/client/react';
import { GET_NOTIFICATION_PREFERENCES, GET_HOME_MQTT_ENABLED, GET_HOME_MQTT_BROKERS, GET_HOME_MQTT_STATUS, GET_MY_ENROLLMENTS } from '@/lib/graphql/queries';
import { SET_NOTIFICATION_PREFERENCE, DELETE_NOTIFICATION_PREFERENCE, SET_HOME_MQTT_ENABLED, ADD_HOME_MQTT_BROKER, REMOVE_HOME_MQTT_BROKER, CANCEL_CLOUD_MANAGED_ENROLLMENT } from '@/lib/graphql/mutations';
import type { GetNotificationPreferencesResponse, SetNotificationPreferenceResponse } from '@/lib/graphql/types';
import { isMQTTAvailable, getMQTTBrokers, removeMQTTBroker } from '@/lib/mqtt-bridge';
import type { MQTTBrokerConfig } from '@/lib/mqtt-bridge';
import { AddBrokerDialog } from './AddBrokerDialog';
import { UptimeSection } from './UptimeSection';
import type { HomeKitHome, MyCloudManagedEnrollmentsResponse } from '@/lib/graphql/types';
import { toast } from 'sonner';
import { useHomes } from '@/hooks/useHomeKitData';

interface HomeDetailViewProps {
  /** Called after this home's cloud relay enrollment is removed (navigates back). */
  onCloudRelayRemoved?: () => void;
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

export function HomeDetailView({ home: homeProp, developerMode, onCloudRelayRemoved }: HomeDetailViewProps) {
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

  // Live managed-broker status (cloud only). Polls while the section is open so
  // the pill reflects current publishing state. Only meaningful when enabled.
  const { data: mqttStatusData } = useQuery(GET_HOME_MQTT_STATUS, {
    variables: { homeId: home.id },
    skip: isCommunity || !mqttEnabled,
    fetchPolicy: 'network-only',
    pollInterval: 15000,
  });
  const mqttStatus = mqttStatusData?.homeMqttStatus as
    | { enabled: boolean; brokerConnected: boolean; serving: boolean; subscribed: boolean; lastPublishAt: number | null }
    | undefined;

  // Load custom brokers — server (Cloud) or native bridge (Community).
  const { data: brokersData, refetch: refetchBrokers, loading: cloudBrokersLoading } = useQuery(GET_HOME_MQTT_BROKERS, {
    variables: { homeId: home.id },
    skip: isCommunity,
    fetchPolicy: 'network-only',
  });
  const [communityBrokers, setCommunityBrokers] = useState<MQTTBrokerConfig[]>([]);
  const [communityBrokersLoaded, setCommunityBrokersLoaded] = useState(false);

  const refetchCommunityBrokers = useCallback(async () => {
    if (!isCommunity || !isMQTTAvailable()) {
      setCommunityBrokersLoaded(true);
      return;
    }
    try {
      const all = await getMQTTBrokers();
      setCommunityBrokers((all && all[home.id]) ?? []);
    } catch (e) {
      console.warn('[HomeDetailView] getMQTTBrokers failed', e);
    } finally {
      setCommunityBrokersLoaded(true);
    }
  }, [home.id]);

  useEffect(() => {
    if (isCommunity) {
      refetchCommunityBrokers();
      const id = setInterval(refetchCommunityBrokers, 5_000);
      return () => clearInterval(id);
    }
  }, [refetchCommunityBrokers]);

  const communityBrokersLoading = isCommunity && !communityBrokersLoaded;

  const brokers: MQTTBrokerConfig[] = isCommunity ? communityBrokers : (brokersData?.homeMqttBrokers ?? []);
  const brokersLoading = isCommunity ? communityBrokersLoading : cloudBrokersLoading;
  const refetchBrokersAny = isCommunity ? refetchCommunityBrokers : refetchBrokers;

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
      if (isCommunity) {
        await removeMQTTBroker(home.id, brokerId);
        await refetchCommunityBrokers();
      } else {
        await removeHomeMqttBrokerMut({ variables: { homeId: home.id, brokerId } });
        await refetchBrokers();
      }
      toast.success('Broker removed');
    } catch (e: any) {
      const msg = e?.graphQLErrors?.[0]?.message || e?.message || 'Failed to remove broker';
      toast.error(msg);
    }
  };

  const isOwner = !home.role || home.role === 'owner';
  const isShared = !isOwner;
  const isCloudManaged = home.isCloudManaged === true;

  // Active cloud-managed enrollment backing this home (removal lives here on
  // the individual home page, not in the homes list).
  const { data: enrollmentsData } = useQuery<MyCloudManagedEnrollmentsResponse>(GET_MY_ENROLLMENTS, {
    skip: !isCloudManaged || isCommunity,
    fetchPolicy: 'cache-and-network',
  });
  const cloudEnrollment = (enrollmentsData?.myCloudManagedEnrollments || []).find(
    e => e.status === 'active' && (
      (e.matchedHomeId && e.matchedHomeId.toUpperCase() === home.id.toUpperCase()) ||
      (e.matchedHomeName || e.homeName).toLowerCase() === home.name.toLowerCase()
    )
  );
  const [cancelEnrollment] = useMutation(CANCEL_CLOUD_MANAGED_ENROLLMENT);
  const [removingRelay, setRemovingRelay] = useState(false);
  const handleRemoveFromCloudRelay = async () => {
    if (!cloudEnrollment) return;
    setRemovingRelay(true);
    try {
      await cancelEnrollment({ variables: { enrollmentId: cloudEnrollment.id } });
      toast.success(`${home.name} removed from cloud relay`);
      onCloudRelayRemoved?.();
    } catch {
      toast.error('Failed to remove home from cloud relay');
    } finally {
      setRemovingRelay(false);
    }
  };
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

      {/* Connection / Home */}
      <div className="space-y-2">
        <p className="text-[10px] font-semibold uppercase tracking-wider text-muted-foreground">{isCommunity ? 'Home' : 'Connection'}</p>
        <div className="rounded-lg border bg-muted/30 p-3 space-y-2 text-xs">
          {!isCommunity && (
            <>
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
            </>
          )}

          {/* Relay's Apple Home permission level (reported by relay 1.1.2+; hidden when unknown) */}
          {typeof home.isAdmin === 'boolean' && (
            <div className="space-y-1">
              <div className="flex justify-between">
                <span className="text-muted-foreground">Apple Home access</span>
                <span className="font-medium">{home.isAdmin ? 'Full access' : 'View-only'}</span>
              </div>
              {!home.isAdmin && (
                <p className="text-[11px] text-muted-foreground/70 leading-snug">
                  HomeKit automations are read-only from Homecast. To let Homecast manage them, {HOMEKIT_EDIT_PERMISSION_FIX}
                </p>
              )}
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

          {!isCommunity && home.relayId && (
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

      {/* Reliability — relay + per-home uptime with end-to-end probe results.
          Cloud-only because Community mode has no cloud backend to record samples. */}
      {!isCommunity && <UptimeSection homeId={home.id} />}

      {/* MQTT (developer mode only). Community: custom brokers via native bridge. Cloud: managed broker + custom brokers via server. */}
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
              <div className="flex items-center gap-2 shrink-0">
                {mqttEnabled && (() => {
                  // Three states:
                  //  • Active — relay's-pod bridge is serving + broker-connected
                  //  • Awaiting relay — relay is online but the bridge hasn't
                  //    started serving this home yet (just enabled; takes up to
                  //    ~1 min) — also the loading state while the relay is up
                  //  • Relay offline — relay is genuinely down, nothing publishes
                  const active = !!(mqttStatus?.serving && mqttStatus?.brokerConnected);
                  const last = mqttStatus?.lastPublishAt;
                  const tone = active
                    ? { cls: 'bg-green-500/10 text-green-600 dark:text-green-400', dot: 'bg-green-500',
                        label: 'Active',
                        tip: last ? `Last published ${formatRelativeAgo(new Date(last * 1000).toISOString())}` : 'Publishing device state' }
                    : relayOnline
                    ? { cls: 'bg-sky-500/10 text-sky-600 dark:text-sky-400', dot: 'bg-sky-500 animate-pulse',
                        label: 'Awaiting relay',
                        tip: 'Broker enabled — waiting for the relay to start publishing (up to a minute)' }
                    : { cls: 'bg-amber-500/10 text-amber-600 dark:text-amber-400', dot: 'bg-amber-500',
                        label: 'Relay offline',
                        tip: 'Enabled, but the relay is offline so no state is being published' };
                  return (
                    <span className={`flex items-center gap-1 text-[10px] font-medium px-1.5 py-0.5 rounded-full ${tone.cls}`} title={tone.tip}>
                      <span className={`h-1.5 w-1.5 rounded-full ${tone.dot}`} />
                      {tone.label}
                    </span>
                  );
                })()}
                <Switch
                  checked={mqttEnabled}
                  disabled={mqttToggling || !isAdmin}
                  onCheckedChange={handleToggleMqtt}
                />
              </div>
            </div>
          );
        })()}

        {/* Custom MQTT Brokers */}
        {(!isCommunity || isMQTTAvailable()) && (
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
                <BrokerCard key={broker.id} broker={broker} homeId={home.id} onRefresh={() => refetchBrokersAny()} onRemove={handleRemoveBroker} />
              ))
            )}
          </>
        )}
      </div>}

      {/* Notification Preferences (cloud only) */}
      {!isCommunity && <HomeNotificationPreferences homeId={home.id} />}

      {/* Remove from cloud relay — only for the enrollment owner of a cloud-managed home */}
      {isCloudManaged && cloudEnrollment && (
        <div className="flex justify-end pt-2">
          <AlertDialog>
            <AlertDialogTrigger asChild>
              <Button variant="ghost" size="sm" className="text-xs text-destructive hover:text-destructive" disabled={removingRelay}>
                {removingRelay ? 'Removing…' : 'Remove Home from Cloud Relay'}
              </Button>
            </AlertDialogTrigger>
            <AlertDialogContent style={{ zIndex: 10050 }}>
              <AlertDialogHeader>
                <AlertDialogTitle>Remove "{home.name}" from the cloud relay?</AlertDialogTitle>
                <AlertDialogDescription asChild>
                  <div className="space-y-2">
                    <p>
                      This disconnects the home from Homecast — remote access, API, and automations
                      through Homecast stop working. Your Apple Home itself is untouched, and you
                      can re-enroll at any time.
                    </p>
                    {cloudEnrollment?.inviteEmail && (
                      <p>
                        We recommend also removing the relay from your home: in the Apple Home app,
                        open <strong>Home Settings</strong>, tap{' '}
                        <strong className="font-mono text-xs">{cloudEnrollment.inviteEmail}</strong>{' '}
                        and choose <strong>Remove</strong>. (Optional — but tidiest.)
                      </p>
                    )}
                  </div>
                </AlertDialogDescription>
              </AlertDialogHeader>
              <AlertDialogFooter>
                <AlertDialogCancel>Keep</AlertDialogCancel>
                <AlertDialogAction
                  onClick={() => { void handleRemoveFromCloudRelay(); }}
                  className="bg-destructive text-destructive-foreground hover:bg-destructive/90"
                >
                  Remove
                </AlertDialogAction>
              </AlertDialogFooter>
            </AlertDialogContent>
          </AlertDialog>
        </div>
      )}

      <AddBrokerDialog
        open={addOpen}
        onOpenChange={setAddOpen}
        homeId={home.id}
        onSaved={() => refetchBrokersAny()}
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
