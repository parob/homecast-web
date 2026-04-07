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
import { ArrowLeft, Plus, Pencil, Trash2, Radio, Bell, Mail, Monitor } from 'lucide-react';
import { isCommunity } from '@/lib/config';
import { useQuery, useMutation } from '@apollo/client/react';
import { GET_NOTIFICATION_PREFERENCES } from '@/lib/graphql/queries';
import { SET_NOTIFICATION_PREFERENCE, DELETE_NOTIFICATION_PREFERENCE } from '@/lib/graphql/mutations';
import type { GetNotificationPreferencesResponse, SetNotificationPreferenceResponse } from '@/lib/graphql/types';
import { getMQTTBrokers, removeMQTTBroker, isMQTTAvailable } from '@/lib/mqtt-bridge';
import type { MQTTBrokerConfig } from '@/lib/mqtt-bridge';
import { AddBrokerDialog } from './AddBrokerDialog';
import type { HomeKitHome } from '@/lib/graphql/types';
import { toast } from 'sonner';

interface HomeDetailViewProps {
  home: HomeKitHome;
  onBack: () => void;
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

function BrokerCard({ broker, homeId, onRefresh }: { broker: MQTTBrokerConfig; homeId: string; onRefresh: () => void }) {
  const [editOpen, setEditOpen] = useState(false);

  const handleRemove = async () => {
    try {
      await removeMQTTBroker(homeId, broker.id);
      toast.success('Broker removed');
      onRefresh();
    } catch (e: any) {
      toast.error(e.message || 'Failed to remove broker');
    }
  };

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
                <AlertDialogAction onClick={handleRemove} className="bg-destructive text-destructive-foreground hover:bg-destructive/90">
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

export function HomeDetailView({ home, onBack }: HomeDetailViewProps) {
  const [brokers, setBrokers] = useState<MQTTBrokerConfig[]>([]);
  const [addOpen, setAddOpen] = useState(false);
  const [loading, setLoading] = useState(true);
  const available = isMQTTAvailable();

  const loadBrokers = useCallback(async () => {
    if (!available) {
      setLoading(false);
      return;
    }
    try {
      const all = await getMQTTBrokers();
      setBrokers(all[home.id] || []);
    } catch {
      // Bridge not ready yet
    } finally {
      setLoading(false);
    }
  }, [home.id, available]);

  useEffect(() => {
    loadBrokers();
    // Poll for status updates every 5s while the view is open
    const interval = setInterval(loadBrokers, 5000);
    return () => clearInterval(interval);
  }, [loadBrokers]);

  return (
    <div className="space-y-4">
      <button
        onClick={onBack}
        className="flex items-center gap-1.5 text-sm text-muted-foreground hover:text-foreground transition-colors"
      >
        <ArrowLeft className="h-4 w-4" />
        {home.name}
      </button>

      {/* Connection info */}
      <div className="space-y-1">
        <p className="text-[10px] font-semibold uppercase tracking-wider text-muted-foreground">Connection</p>
        <div className="rounded-lg border bg-muted/30 p-3">
          <p className="text-sm">
            {home.isCloudManaged ? 'Cloud Relay' : 'Self-hosted Relay'}
            <span className="text-muted-foreground"> · </span>
            <span className="text-xs text-muted-foreground">{home.isCloudManaged ? 'Hosted by Homecast' : 'Connected via your Mac'}</span>
          </p>
        </div>
      </div>

      {/* MQTT Brokers */}
      <div className="space-y-2">
        <p className="text-[10px] font-semibold uppercase tracking-wider text-muted-foreground">MQTT Brokers</p>
        <p className="text-xs text-muted-foreground">
          Homecast publishes device state and accepts commands from these brokers.
        </p>

        {!available ? (
          <p className="text-xs text-muted-foreground py-3 text-center">
            MQTT is available when running in the Mac app.
          </p>
        ) : loading ? (
          <p className="text-xs text-muted-foreground py-3 text-center">Loading...</p>
        ) : (
          <>
            {brokers.length === 0 && (
              <p className="text-xs text-muted-foreground py-3 text-center">No brokers configured for this home.</p>
            )}

            {brokers.map((broker) => (
              <BrokerCard key={broker.id} broker={broker} homeId={home.id} onRefresh={loadBrokers} />
            ))}

            <Button
              variant="outline"
              size="sm"
              className="w-full"
              onClick={() => setAddOpen(true)}
            >
              <Plus className="h-4 w-4 mr-2" />
              Add Broker
            </Button>
          </>
        )}
      </div>

      {/* Notification Preferences (cloud only) */}
      {!isCommunity && <HomeNotificationPreferences homeId={home.id} />}

      <AddBrokerDialog
        open={addOpen}
        onOpenChange={setAddOpen}
        homeId={home.id}
        onSaved={loadBrokers}
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

  const handleToggle = async (field: 'pushEnabled' | 'emailEnabled' | 'localEnabled', value: boolean) => {
    setSaving(true);
    try {
      await setPrefMutation({
        variables: {
          scope: 'home',
          scopeId: homeId,
          pushEnabled: field === 'pushEnabled' ? value : (homePref?.pushEnabled ?? true),
          emailEnabled: field === 'emailEnabled' ? value : (homePref?.emailEnabled ?? false),
          localEnabled: field === 'localEnabled' ? value : (homePref?.localEnabled ?? true),
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
        <div className="flex items-center justify-between">
          <div className="flex items-center gap-2">
            <Monitor className="h-3.5 w-3.5 text-muted-foreground" />
            <span className="text-sm">Local</span>
          </div>
          <Switch
            checked={homePref?.localEnabled ?? true}
            onCheckedChange={(v) => handleToggle('localEnabled', v)}
            disabled={saving}
          />
        </div>
      </div>
    </div>
  );
}
