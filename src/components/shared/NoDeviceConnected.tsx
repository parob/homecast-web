import { useState, useEffect, useRef } from 'react';
import { WifiOff, Laptop, Wifi, Loader2 } from 'lucide-react';
import { Card, CardContent } from '@/components/ui/card';
import { apolloClient } from '@/lib/apollo';
import { GET_SESSIONS } from '@/lib/graphql/queries';
import { cn } from '@/lib/utils';

interface Session {
  sessionType: 'device' | 'web';
}

interface NoDeviceConnectedProps {
  /** 'card' shows full card with session info, 'inline' shows minimal text */
  variant?: 'card' | 'inline';
  /** Sessions data for showing connection status (only used with 'card' variant) */
  sessions?: Session[];
  /** Function to refetch sessions - only called when a device is found */
  onRefetch?: () => Promise<unknown>;
  /** Whether the background is dark (for light text mode) */
  isDarkBackground?: boolean;
}

export function NoDeviceConnected({ variant = 'inline', sessions = [], onRefetch, isDarkBackground }: NoDeviceConnectedProps) {
  const [checking, setChecking] = useState(false);
  const refetchRef = useRef(onRefetch);
  refetchRef.current = onRefetch;

  // Poll every 10 seconds with silent check (pause when tab is hidden)
  useEffect(() => {
    let intervalId: ReturnType<typeof setInterval> | null = null;

    const doCheck = async () => {
      setChecking(true);
      try {
        const result = await apolloClient.query<{ sessions: Session[] }>({
          query: GET_SESSIONS,
          fetchPolicy: 'no-cache',
        });
        const hasDevice = result.data?.sessions?.some(
          (s: Session) => s.sessionType === 'device'
        );
        if (hasDevice && refetchRef.current) {
          refetchRef.current();
        }
      } catch {
        // Ignore errors during silent check
      }
      setTimeout(() => setChecking(false), 2000);
    };

    const startPolling = () => {
      if (intervalId) return;
      intervalId = setInterval(doCheck, 10000);
    };

    const stopPolling = () => {
      if (intervalId) {
        clearInterval(intervalId);
        intervalId = null;
      }
    };

    const handleVisibilityChange = () => {
      if (document.visibilityState === 'visible') {
        doCheck();
        startPolling();
      } else {
        stopPolling();
      }
    };

    if (document.visibilityState === 'visible') {
      startPolling();
    }

    document.addEventListener('visibilitychange', handleVisibilityChange);

    return () => {
      stopPolling();
      document.removeEventListener('visibilitychange', handleVisibilityChange);
    };
  }, []);

  const Icon = checking ? Loader2 : WifiOff;

  if (variant === 'inline') {
    return (
      <div className={cn("flex flex-col items-center justify-center py-12 text-center", isDarkBackground && "text-white")}>
        <Icon className={cn("mb-4 h-12 w-12", checking ? 'animate-spin' : '', isDarkBackground ? "text-white/60" : "text-muted-foreground")} />
        <p className="font-semibold mb-2">No Device Connected</p>
        <p className={cn("text-sm max-w-md", isDarkBackground ? "text-white/70" : "text-muted-foreground")}>
          Open the Homecast app on your Mac to control your accessories remotely.
        </p>
      </div>
    );
  }

  const deviceSessions = sessions.filter(s => s.sessionType === 'device');
  const webSessions = sessions.filter(s => s.sessionType === 'web');

  return (
    <div className="flex flex-1 items-center justify-center py-12">
      <Card className={cn("max-w-md", isDarkBackground && "bg-black/30 border-white/20")}>
        <CardContent className={cn("flex flex-col items-center py-12", isDarkBackground && "text-white")}>
          <Icon className={cn("mb-4 h-16 w-16", checking ? 'animate-spin' : '', isDarkBackground ? "text-white/60" : "text-muted-foreground")} />
          <h2 className="mb-2 text-xl font-semibold">No Device Connected</h2>
          <p className={cn("mb-6 text-center", isDarkBackground ? "text-white/70" : "text-muted-foreground")}>
            Open the Homecast app on your Mac to control your accessories remotely.
          </p>
          <div className={cn("flex flex-col items-center gap-1 text-sm", isDarkBackground ? "text-white/70" : "text-muted-foreground")}>
            <div className="flex items-center gap-2">
              <Laptop className="h-4 w-4" />
              <span>
                {deviceSessions.length === 0
                  ? 'No servers registered'
                  : `${deviceSessions.length} ${deviceSessions.length === 1 ? 'server' : 'servers'} offline`}
              </span>
            </div>
            <div className="flex items-center gap-2">
              <Wifi className="h-4 w-4" />
              <span>
                {webSessions.length} web {webSessions.length === 1 ? 'client' : 'clients'} connected
              </span>
            </div>
          </div>
        </CardContent>
      </Card>
    </div>
  );
}
