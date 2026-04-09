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
import { ArrowLeft, Plus, Pencil, Trash2, Radio, Bell, Mail } from 'lucide-react';
import { isCommunity } from '@/lib/config';
import { useQuery, useMutation } from '@apollo/client/react';
import { GET_NOTIFICATION_PREFERENCES, GET_HOME_MQTT_ENABLED, GET_HOME_MQTT_BROKERS } from '@/lib/graphql/queries';
import { SET_NOTIFICATION_PREFERENCE, DELETE_NOTIFICATION_PREFERENCE, SET_HOME_MQTT_ENABLED, ADD_HOME_MQTT_BROKER, REMOVE_HOME_MQTT_BROKER } from '@/lib/graphql/mutations';
import type { GetNotificationPreferencesResponse, SetNotificationPreferenceResponse } from '@/lib/graphql/types';
import { isMQTTAvailable } from '@/lib/mqtt-bridge';
import type { MQTTBrokerConfig } from '@/lib/mqtt-bridge';
import { AddBrokerDialog } from './AddBrokerDialog';
import type { HomeKitHome } from '@/lib/graphql/types';
import { toast } from 'sonner';

interface HomeDetailViewProps {
  home: HomeKitHome;
  onBack: () => void;
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

export function HomeDetailView({ home, onBack, developerMode }: HomeDetailViewProps) {
  const [addOpen, setAddOpen] = useState(false);
  const [mqttToggling, setMqttToggling] = useState(false);
  const [setHomeMqttEnabledMut] = useMutation(SET_HOME_MQTT_ENABLED);
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
    } catch { toast.error('Failed to update MQTT broker'); }
    finally { setMqttToggling(false); }
  };

  const handleRemoveBroker = async (brokerId: string) => {
    try {
      await removeHomeMqttBrokerMut({ variables: { homeId: home.id, brokerId } });
      await refetchBrokers();
      toast.success('Broker removed');
    } catch { toast.error('Failed to remove broker'); }
  };

  return (
    <div className="space-y-4">
      <button
        onClick={onBack}
        className="flex items-center gap-1.5 text-sm text-muted-foreground hover:text-foreground transition-colors"
      >
        <ArrowLeft className="h-4 w-4" />
        {home.name}
      </button>

      {/* MQTT (developer mode only) */}
      {developerMode && <div className="space-y-2">
        <p className="text-[10px] font-semibold uppercase tracking-wider text-muted-foreground">MQTT</p>

        {/* Homecast Broker (cloud only) */}
        {!isCommunity && (
          <>
            <div className="flex items-center justify-between py-1">
              <div>
                <p className="text-sm font-medium">Homecast Broker</p>
                <p className="text-xs text-muted-foreground">
                  {mqttEnabled ? 'mqtt.homecast.cloud:8883 · Use API token as password' : 'Publish device state to mqtt.homecast.cloud'}
                </p>
              </div>
              <Switch
                checked={mqttEnabled}
                disabled={mqttToggling}
                onCheckedChange={handleToggleMqtt}
              />
            </div>
            {mqttEnabled && (
              <a
                href={location.hostname.includes('staging') ? 'https://mqtt.staging.homecast.cloud' : 'https://mqtt.homecast.cloud'}
                target="_blank"
                rel="noopener noreferrer"
                className="flex items-center gap-1.5 text-xs text-primary hover:underline"
              >
                <Radio className="h-3 w-3" /> Open MQTT Browser
              </a>
            )}
          </>
        )}

        {/* Custom Brokers */}
        {!isCommunity && (
          <>
            <div className="flex items-center justify-between py-1">
              <p className="text-sm font-medium">Custom Brokers</p>
              <Button variant="ghost" size="sm" className="h-6 text-xs" onClick={() => setAddOpen(true)}>
                <Plus className="h-3.5 w-3.5 mr-1" /> Add
              </Button>
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
      <p className="text-xs text-muted-foreground">
        {hasOverride ? 'Custom settings for this home.' : 'Using global notification settings.'}
      </p>
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
