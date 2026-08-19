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
import { Plus, Pencil, Trash2, Radio, ExternalLink } from 'lucide-react';
import { isCommunity } from '@/lib/config';
import { formatRelativeAgo } from '@/lib/relay-last-seen';
import { useQuery, useMutation } from '@apollo/client/react';
import { GET_HOME_MQTT_ENABLED, GET_HOME_MQTT_BROKERS, GET_HOME_MQTT_STATUS } from '@/lib/graphql/queries';
import { SET_HOME_MQTT_ENABLED, REMOVE_HOME_MQTT_BROKER } from '@/lib/graphql/mutations';
import { isMQTTAvailable, getMQTTBrokers, removeMQTTBroker } from '@/lib/mqtt-bridge';
import type { MQTTBrokerConfig } from '@/lib/mqtt-bridge';
import { AddBrokerDialog } from '../AddBrokerDialog';
import { toast } from 'sonner';

/**
 * Per-home MQTT — the managed broker toggle (Cloud) and custom brokers
 * (Cloud over GraphQL, Community over the native bridge).
 *
 * This lived inline in HomeDetailView, which meant its three queries — one of
 * them a 15s status poll, and a 5s bridge poll in Community — ran for anyone
 * who opened any home, whether or not developer mode was even on. Now they run
 * only while this page is open.
 */

/**
 * These three fields are JSON scalars on the schema — they have no selection
 * set, so there is no generated shape to import. Declared here so the queries
 * are typed at their only call site rather than read off `unknown`.
 */
interface HomeMqttStatus {
  enabled: boolean;
  brokerConnected: boolean;
  serving: boolean;
  subscribed: boolean;
  lastPublishAt: number | null;
}
interface HomeMqttEnabledResponse { homeMqttEnabled: boolean | null }
interface HomeMqttStatusResponse { homeMqttStatus: HomeMqttStatus | null }
interface HomeMqttBrokersResponse { homeMqttBrokers: MQTTBrokerConfig[] | null }

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
            <span className="text-sm font-medium break-words">{broker.name}</span>
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

export function HomeMQTTSection({
  home,
  isAdmin,
  relayOnline,
}: {
  home: { id: string; name: string };
  isAdmin: boolean;
  relayOnline: boolean;
}) {
  const [addOpen, setAddOpen] = useState(false);
  const [mqttToggling, setMqttToggling] = useState(false);
  const [setHomeMqttEnabledMut] = useMutation(SET_HOME_MQTT_ENABLED);
  const [removeHomeMqttBrokerMut] = useMutation(REMOVE_HOME_MQTT_BROKER);

  // Load mqtt_enabled state from server (cloud only)
  const { data: mqttData, refetch: refetchMqtt } = useQuery<HomeMqttEnabledResponse>(GET_HOME_MQTT_ENABLED, {
    variables: { homeId: home.id },
    skip: isCommunity,
    fetchPolicy: 'network-only',
  });
  const mqttEnabled = mqttData?.homeMqttEnabled ?? false;

  // Live managed-broker status (cloud only). Polls while the section is open so
  // the pill reflects current publishing state. Only meaningful when enabled.
  const { data: mqttStatusData } = useQuery<HomeMqttStatusResponse>(GET_HOME_MQTT_STATUS, {
    variables: { homeId: home.id },
    skip: isCommunity || !mqttEnabled,
    fetchPolicy: 'network-only',
    pollInterval: 15000,
  });
  const mqttStatus = mqttStatusData?.homeMqttStatus ?? undefined;

  // Load custom brokers — server (Cloud) or native bridge (Community).
  const { data: brokersData, refetch: refetchBrokers, loading: cloudBrokersLoading } = useQuery<HomeMqttBrokersResponse>(GET_HOME_MQTT_BROKERS, {
    variables: { homeId: home.id },
    skip: isCommunity,
    fetchPolicy: 'network-only',
  });
  const [communityBrokers, setCommunityBrokers] = useState<MQTTBrokerConfig[]>([]);
  const [communityBrokersLoaded, setCommunityBrokersLoaded] = useState(false);
  const [communityBrokersError, setCommunityBrokersError] = useState<string | null>(null);

  const refetchCommunityBrokers = useCallback(async () => {
    if (!isCommunity || !isMQTTAvailable()) {
      setCommunityBrokersLoaded(true);
      return;
    }
    try {
      const all = await getMQTTBrokers();
      setCommunityBrokers((all && all[home.id]) ?? []);
      setCommunityBrokersError(null);
    } catch (e: any) {
      // A failed read is not an empty one. Reporting "no custom brokers" for a
      // bridge that never answered hides the fault behind the right-looking
      // empty state, and hands the user a list they can add to but that will
      // never save.
      console.warn('[HomeMQTTSection] getMQTTBrokers failed', e);
      setCommunityBrokersError(e?.message || 'Could not reach the MQTT bridge');
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
  const brokersError = isCommunity ? communityBrokersError : null;
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

  return (
    <div className="space-y-2">
      {/* Community has only one thing under MQTT — its own brokers — so this
          outer heading would sit directly above a second one saying the same.
          Cloud earns it: the managed broker and custom brokers are two
          different things that both belong under it. */}
      {!isCommunity && (
        <p className="text-[10px] font-semibold uppercase tracking-wider text-muted-foreground">MQTT</p>
      )}

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
          <div className={`flex items-center justify-between ${isCommunity ? '' : 'pt-2'}`}>
            {/* "Custom" only means something next to the managed broker, which
                Community doesn't have. There, these are simply the brokers. */}
            <p className="text-[10px] font-semibold uppercase tracking-wider text-muted-foreground">
              {isCommunity ? 'MQTT' : 'Custom MQTT Brokers'}
            </p>
            {isAdmin && <Button variant="ghost" size="sm" className="h-6 text-xs" onClick={() => setAddOpen(true)}>
              <Plus className="h-3.5 w-3.5 mr-1" /> Add
            </Button>}
          </div>

          {brokersLoading ? (
            <p className="text-xs text-muted-foreground py-2 text-center">Loading...</p>
          ) : brokersError ? (
            <p className="text-xs text-destructive py-2 text-center">{brokersError}</p>
          ) : brokers.length === 0 ? (
            <p className="text-xs text-muted-foreground py-2 text-center">
              {isAdmin ? 'Add a broker with + to publish this home to MQTT.' : 'No MQTT brokers configured.'}
            </p>
          ) : (
            brokers.map((broker: any) => (
              <BrokerCard key={broker.id} broker={broker} homeId={home.id} onRefresh={() => refetchBrokersAny()} onRemove={handleRemoveBroker} />
            ))
          )}
        </>
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
