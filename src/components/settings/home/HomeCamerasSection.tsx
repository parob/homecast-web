import { useCallback, useEffect, useState } from 'react';
import { Camera, RefreshCw, ShieldCheck, ShieldAlert } from 'lucide-react';
import { useMutation, useQuery } from '@apollo/client/react';
import { Button } from '@/components/ui/button';
import { Badge } from '@/components/ui/badge';
import { Switch } from '@/components/ui/switch';
import { serverConnection } from '@/server/connection';
import { isRelayCapable } from '@/native/homekit-bridge';
import { GET_HOME_CAMERAS_ENABLED } from '@/lib/graphql/queries';
import { SET_HOME_CAMERAS_ENABLED } from '@/lib/graphql/mutations';
import type { HomeKitHome } from '@/lib/graphql/types';

interface HomeCamerasEnabledResponse { homeCamerasEnabled: boolean | null }

interface CameraCapabilities {
  supported: boolean;
  engineWindow: boolean;
  screenRecording: 'granted' | 'denied';
  maxStreamsPerHome: number;
  activeStreams: number;
  fps: number;
}

interface Props {
  home: HomeKitHome;
  relayOnline: boolean;
  isAdmin: boolean;
}

/**
 * What this home's relay can do for cameras, and the one thing a person has
 * to do for it: grant Screen Recording on the relay Mac. Everything here is a
 * read of the relay; the switch that turns camera images on for a home lives
 * with the cloud settings and arrives with the server half.
 */
export function HomeCamerasSection({ home, relayOnline, isAdmin }: Props) {
  const { data: enabledData, refetch: refetchEnabled } = useQuery<HomeCamerasEnabledResponse>(GET_HOME_CAMERAS_ENABLED, {
    variables: { homeId: home.id },
    fetchPolicy: 'network-only',
    errorPolicy: 'ignore',
  });
  const [setEnabledMut, { loading: saving }] = useMutation(SET_HOME_CAMERAS_ENABLED);
  const enabled = enabledData?.homeCamerasEnabled === true;
  const setEnabled = async (next: boolean) => {
    await setEnabledMut({ variables: { homeId: home.id, enabled: next } });
    await refetchEnabled();
  };

  const [caps, setCaps] = useState<CameraCapabilities | null>(null);
  const [error, setError] = useState<{ code: string; message: string } | null>(null);
  const [loading, setLoading] = useState(false);

  const load = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      const result = await serverConnection.request<CameraCapabilities>('camera.capabilities', { homeId: home.id });
      setCaps(result);
    } catch (err) {
      const e = err as { code?: string; message?: string };
      setCaps(null);
      setError({ code: e.code || 'INTERNAL_ERROR', message: e.message || String(err) });
    } finally {
      setLoading(false);
    }
  }, [home.id]);

  useEffect(() => {
    if (relayOnline) void load();
  }, [relayOnline, load]);

  const requestPermission = async () => {
    try {
      await serverConnection.request('camera.requestScreenRecording', { homeId: home.id });
    } finally {
      void load();
    }
  };

  const granted = caps?.screenRecording === 'granted';

  return (
    <div className="space-y-4">
      <div className="flex items-start gap-3">
        <Camera className="mt-0.5 h-5 w-5 text-muted-foreground" />
        <div className="space-y-1">
          <p className="text-sm">
            View snapshots from your HomeKit cameras. Your relay Mac needs to stay on and connected.
          </p>
          <p className="text-sm text-muted-foreground">
            That needs Screen Recording permission for Homecast on the relay Mac, granted once in System Settings →
            Privacy &amp; Security.
          </p>
        </div>
      </div>

      <div className="rounded-lg border p-4">
        <div className="flex items-center justify-between gap-3">
          <div>
            <div className="text-sm font-medium">Camera images</div>
            <p className="text-sm text-muted-foreground">
              Stills in camera tiles for everyone in this home. Off by default: the images leave the house over the relay.
            </p>
          </div>
          <Switch checked={enabled} onCheckedChange={(v) => void setEnabled(v)} disabled={!isAdmin || saving} aria-label="Camera images" />
        </div>
      </div>

      <div className="rounded-lg border p-4 space-y-3">
        <div className="flex items-center justify-between gap-3">
          <div className="text-sm font-medium">Camera access</div>
          <div className="flex items-center gap-2">
            {!relayOnline ? (
              <Badge variant="secondary">Relay offline</Badge>
            ) : error ? (
              <Badge variant="destructive">{error.code === 'UNKNOWN_ACTION' ? 'Server update needed' : error.code === 'UNKNOWN_METHOD' ? 'Relay update needed' : error.code}</Badge>
            ) : caps ? (
              granted ? (
                <Badge className="gap-1"><ShieldCheck className="h-3 w-3" /> Ready</Badge>
              ) : (
                <Badge variant="destructive" className="gap-1"><ShieldAlert className="h-3 w-3" /> Screen Recording needed</Badge>
              )
            ) : (
              <Badge variant="secondary">Checking…</Badge>
            )}
            <Button variant="ghost" size="icon" onClick={() => void load()} disabled={!relayOnline || loading} aria-label="Refresh">
              <RefreshCw className={`h-4 w-4 ${loading ? 'animate-spin' : ''}`} />
            </Button>
          </div>
        </div>

        {caps && (
          <dl className="grid grid-cols-2 gap-x-4 gap-y-1 text-sm">
            <dt className="text-muted-foreground">Camera capture</dt>
            <dd>{caps.engineWindow ? 'Running' : 'Not running'}</dd>
            <dt className="text-muted-foreground">Screen Recording</dt>
            <dd>{granted ? 'Granted' : 'Not granted'}</dd>
          </dl>
        )}

        {caps && !granted && (
          <div className="space-y-2">
            <p className="text-sm text-muted-foreground">
              {isRelayCapable()
                ? 'Ask macOS now. If the prompt does not appear, enable Homecast under Screen & System Audio Recording in System Settings.'
                : 'On the relay Mac, open Settings → Cameras and ask macOS, or enable Homecast under Screen & System Audio Recording in System Settings.'}
            </p>
            {isRelayCapable() && (
              <Button size="sm" onClick={() => void requestPermission()}>Request Screen Recording</Button>
            )}
          </div>
        )}

        {error && error.code !== 'UNKNOWN_ACTION' && error.code !== 'UNKNOWN_METHOD' && (
          <p className="text-sm text-destructive">{error.message}</p>
        )}
      </div>
    </div>
  );
}
