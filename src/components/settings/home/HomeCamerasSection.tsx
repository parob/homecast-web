import { useCallback, useEffect, useRef, useState } from 'react';
import { Camera, RefreshCw, ShieldCheck, ShieldAlert } from 'lucide-react';
import { useMutation, useQuery } from '@apollo/client/react';
import { Button } from '@/components/ui/button';
import { Badge } from '@/components/ui/badge';
import { Switch } from '@/components/ui/switch';
import { serverConnection } from '@/server/connection';
import type { CameraCapabilities } from '@/native/homekit-bridge';
import { GET_HOME_CAMERAS_ENABLED } from '@/lib/graphql/queries';
import { SET_HOME_CAMERAS_ENABLED } from '@/lib/graphql/mutations';
import type { HomeKitHome } from '@/lib/graphql/types';
import { useHomeServing } from '@/hooks/useHomeServing';
import { useWebSocket } from '@/contexts/WebSocketContext';
import { HomeConnectionSummary } from '@/components/layout/status/HomeConnectionSummary';

interface HomeCamerasEnabledResponse { homeCamerasEnabled: boolean | null }

interface Props {
  home: HomeKitHome;
  isAdmin: boolean;
}

/**
 * What this home's relay can capture, and the owner's opt-in for camera
 * images. Capturing the app's own window requires no Screen Recording grant.
 */
export function HomeCamerasSection({ home, isAdmin }: Props) {
  const serving = useHomeServing(home.id, 'cloud');
  const { quality } = useWebSocket();
  const canCheck = serving?.state === 'served' && quality !== 'offline' && quality !== 'connecting';
  const requestKey = canCheck ? `${home.id}:${serving.by ?? ''}` : null;
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

  const [result, setResult] = useState<{
    key: string; loading: boolean; caps?: CameraCapabilities;
    error?: { code: string; message: string };
  } | null>(null);
  const sequence = useRef(0);
  const current = result?.key === requestKey ? result : null;
  const caps = current?.caps;
  const error = current?.error;
  const loading = current?.loading ?? false;

  const load = useCallback(async () => {
    if (!requestKey) return;
    const attempt = ++sequence.current;
    setResult({ key: requestKey, loading: true });
    try {
      const caps = await serverConnection.request<CameraCapabilities>('camera.capabilities', { homeId: home.id });
      if (attempt === sequence.current) setResult({ key: requestKey, loading: false, caps });
    } catch (err) {
      const e = err as { code?: string; message?: string };
      if (attempt === sequence.current) setResult({ key: requestKey, loading: false,
        error: { code: e.code || 'INTERNAL_ERROR', message: e.message || String(err) } });
    }
  }, [home.id, requestKey]);

  useEffect(() => {
    void load();
    return () => { ++sequence.current; };
  }, [load]);

  // Build 70's screenRecording field was a capture probe, not permission.
  const captureAvailable = caps?.supported === true && caps.engineWindow &&
    (caps.captureAvailable ?? (caps.screenRecording === 'granted'));

  return (
    <div className="space-y-4">
      <div className="flex items-start gap-3">
        <Camera className="mt-0.5 h-5 w-5 text-muted-foreground" />
        <div className="space-y-1">
          <p className="text-sm">
            View snapshots from your HomeKit cameras. Your relay Mac needs to stay on and connected.
          </p>
          <p className="text-sm text-muted-foreground">
            Homecast captures its own camera window. Screen Recording permission is not required for camera images.
          </p>
        </div>
      </div>

      <HomeConnectionSummary home={home} scope="cloud" surface="camera_relay" />

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
            {error ? (
              <Badge variant="destructive">{error.code === 'UNKNOWN_ACTION' ? 'Server update needed' : error.code === 'UNKNOWN_METHOD' ? 'Relay update needed' : error.code}</Badge>
            ) : caps ? (
              captureAvailable ? (
                <Badge className="gap-1"><ShieldCheck className="h-3 w-3" /> Ready</Badge>
              ) : (
                <Badge variant="destructive" className="gap-1"><ShieldAlert className="h-3 w-3" /> Capture unavailable</Badge>
              )
            ) : (
              <Badge variant="secondary">{loading ? 'Checking…' : 'Not checked'}</Badge>
            )}
            <Button variant="ghost" size="icon" onClick={() => void load()} disabled={!canCheck || loading} aria-label="Refresh">
              <RefreshCw className={`h-4 w-4 ${loading ? 'animate-spin' : ''}`} />
            </Button>
          </div>
        </div>

        {caps && (
          <dl className="grid grid-cols-2 gap-x-4 gap-y-1 text-sm">
            <dt className="text-muted-foreground">Camera capture</dt>
            <dd>{captureAvailable ? 'Available' : 'Unavailable'}</dd>
          </dl>
        )}

        {caps && !captureAvailable && (
          <div className="space-y-2">
            <p className="text-sm text-muted-foreground">
              Restart Homecast on the relay Mac, then check camera access again.
            </p>
          </div>
        )}

        {error && error.code !== 'UNKNOWN_ACTION' && error.code !== 'UNKNOWN_METHOD' && (
          <p className="text-sm text-destructive">{error.message}</p>
        )}
      </div>
    </div>
  );
}
