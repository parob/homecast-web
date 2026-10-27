import { useState, useEffect, useRef, useCallback } from 'react';
import { useMutation, useQuery } from '@apollo/client/react';
import { config } from '@/lib/config';
import { useLocation } from 'react-router-dom';
import { Popover, PopoverContent, PopoverTrigger } from '@/components/ui/popover';
import { Button } from '@/components/ui/button';
import { cn } from '@/lib/utils';
import { GET_STAGING_ENVIRONMENT, GET_VERSION } from '@/lib/graphql/queries';
import { WAKE_STAGING } from '@/lib/graphql/mutations';
import { appVersionLabel } from '@/lib/app-version';
import { isMarketingPath } from '@/lib/marketing-routes';
import { switchEnvironment } from '@/lib/environment-switch';
import { useStagingWake } from '@/hooks/useStagingWake';

interface VersionEntry {
  label: string;
  staging?: string;
  prod?: string;
  deployedAt?: string;
  prodDeployedAt?: string;
}

interface StagingVersionInfo {
  synced: boolean;
  entries: VersionEntry[];
}

function formatDeployTime(iso: string | undefined): string | undefined {
  if (!iso) return undefined;
  try {
    const d = new Date(iso);
    const now = new Date();
    const diffMs = now.getTime() - d.getTime();
    const diffMins = Math.floor(diffMs / 60000);
    if (diffMins < 1) return 'just now';
    if (diffMins < 60) return `${diffMins}m ago`;
    const diffHours = Math.floor(diffMins / 60);
    if (diffHours < 24) return `${diffHours}h ago`;
    const diffDays = Math.floor(diffHours / 24);
    return `${diffDays}d ago`;
  } catch {
    return undefined;
  }
}

function useStagingVersionInfo(): { info: StagingVersionInfo | undefined; serverDown: boolean } {
  const [prodData, setProdData] = useState<{
    server?: string; serverDeployedAt?: string;
    web?: string; webDeployedAt?: string;
  }>({});
  const [stagingWebDeployedAt, setStagingWebDeployedAt] = useState<string>();
  const [fetched, setFetched] = useState(false);
  const { data: versionData, error: versionError } = useQuery<{ version: string; deployedAt?: string }>(GET_VERSION, {
    fetchPolicy: 'cache-first',
    skip: !config.isStaging,
  });
  // Staging's server is scaled to zero between deploys, so this failing is
  // the normal state, not an outage — and it is why signing in fails.
  const serverDown = !!versionError && !versionData;

  useEffect(() => {
    if (!config.isStaging) return;
    Promise.allSettled([
      // Prod server version + deployedAt
      fetch('https://api.homecast.cloud/', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ query: '{ version deployedAt }' }),
      }).then(r => r.json()).then(d => ({
        version: d?.data?.version as string | undefined,
        deployedAt: d?.data?.deployedAt as string | undefined,
      })),
      // Prod web version + deployedAt
      fetch('https://homecast.cloud/version.json')
        .then(r => r.json()).then(d => ({
          version: d?.version as string | undefined,
          deployedAt: d?.deployedAt as string | undefined,
        })),
      // Staging web version.json deployedAt
      fetch(config.webUrl + '/version.json')
        .then(r => r.json()).then(d => d?.deployedAt as string | undefined),
    ]).then(([srv, web, stagingWeb]) => {
      const srvVal = srv.status === 'fulfilled' ? srv.value : undefined;
      const webVal = web.status === 'fulfilled' ? web.value : undefined;
      setProdData({
        server: srvVal?.version,
        serverDeployedAt: srvVal?.deployedAt,
        web: webVal?.version,
        webDeployedAt: webVal?.deployedAt,
      });
      if (stagingWeb.status === 'fulfilled') setStagingWebDeployedAt(stagingWeb.value);
      setFetched(true);
    });
  }, []);

  if (!fetched) return { info: undefined, serverDown };

  const stagingServer = versionData?.version && versionData.version !== 'dev' ? versionData.version : undefined;
  const stagingServerDeployedAt = versionData?.deployedAt || undefined;
  const webVer = config.version !== 'dev' ? config.version : undefined;
  const appVer = appVersionLabel(window);

  const entries: VersionEntry[] = [];
  let allSynced = true;

  if (stagingServer) {
    const synced = prodData.server ? stagingServer === prodData.server : undefined;
    if (synced === false) allSynced = false;
    entries.push({
      label: 'server',
      staging: stagingServer,
      prod: prodData.server,
      deployedAt: stagingServerDeployedAt,
      prodDeployedAt: prodData.serverDeployedAt,
    });
  }

  if (webVer) {
    const synced = prodData.web ? webVer === prodData.web : undefined;
    if (synced === false) allSynced = false;
    entries.push({
      label: 'web',
      staging: webVer,
      prod: prodData.web,
      deployedAt: stagingWebDeployedAt,
      prodDeployedAt: prodData.webDeployedAt,
    });
  }

  if (appVer) {
    entries.push({ label: 'app', staging: appVer });
  }

  if (entries.length === 0) return { info: undefined, serverDown };

  return { info: { synced: allSynced, entries }, serverDown };
}

function VersionLine({ entry }: { entry: VersionEntry }) {
  if (entry.label === 'app') {
    return <div>{entry.label}: {entry.staging}</div>;
  }
  const synced = entry.prod ? entry.staging === entry.prod : undefined;
  const deployTime = formatDeployTime(entry.deployedAt);
  const prodDeployTime = formatDeployTime(entry.prodDeployedAt);

  let status: string;
  if (synced === true) {
    status = 'in sync';
  } else if (synced === false) {
    status = `ahead (staging:${entry.staging} prod:${entry.prod})`;
  } else {
    status = entry.staging || 'unknown';
  }

  return (
    <div className="space-y-0.5">
      <div>{entry.label}: {status}</div>
      {(deployTime || prodDeployTime) && (
        <div className="text-muted-foreground/50 pl-2">
          {deployTime && <span>staging: {deployTime}</span>}
          {deployTime && prodDeployTime && <span> · </span>}
          {prodDeployTime && <span>prod: {prodDeployTime}</span>}
        </div>
      )}
    </div>
  );
}

interface StagingEnvironment {
  available: boolean;
  running: boolean;
  starting: boolean;
  awakeUntil: string | null;
  error: string | null;
}

/**
 * While staging is up: when it goes back to sleep, and a way to push that
 * out. Absent when the server predates the field or can't read its state.
 */
function StagingAwakeLine() {
  const { data, refetch } = useQuery<{ stagingEnvironment: StagingEnvironment }>(GET_STAGING_ENVIRONMENT, {
    fetchPolicy: 'network-only',
  });
  const [wake, { loading }] = useMutation<{ wakeStaging: StagingEnvironment }>(WAKE_STAGING, {
    onCompleted: () => { void refetch(); },
  });
  const env = data?.stagingEnvironment;
  if (!env?.available) return null;

  const until = env.awakeUntil
    ? new Date(env.awakeUntil).toLocaleTimeString(undefined, { hour: '2-digit', minute: '2-digit' })
    : null;
  return (
    <div className="flex items-center justify-between gap-3 text-[11px] text-muted-foreground">
      {/* No wake recorded means a deploy started it, and the deploy stops it. */}
      <span>{until ? `Awake until ${until}` : 'Up for a deploy'}</span>
      <button
        className="font-medium text-foreground hover:underline disabled:opacity-50"
        disabled={loading}
        onClick={() => { void wake(); }}
      >
        {until ? 'Extend to 6h' : 'Keep awake 6h'}
      </button>
    </div>
  );
}

interface StagingSyncLabelProps {
  isDarkBackground?: boolean;
}

export function StagingSyncLabel({ isDarkBackground }: StagingSyncLabelProps = {}) {
  const { info, serverDown } = useStagingVersionInfo();
  const [isOpen, setIsOpen] = useState(false);
  const openTimeRef = useRef(0);
  // Woken in place: this page is staging, so once it answers, reload into it.
  const reload = useCallback(() => window.location.reload(), []);
  const { phase: wakePhase, error: wakeError, wake } = useStagingWake(reload);
  if (!config.isStaging) return null;

  const waking = wakePhase === 'starting';
  const dotColor = waking
    ? 'bg-amber-500 animate-pulse'
    : serverDown
      ? 'bg-zinc-400'
      : !info ? 'bg-amber-500 animate-pulse' : info.synced ? 'bg-green-500' : 'bg-red-500';

  const pill = (
    <button
      className={cn(
        "flex items-center gap-1.5 px-2 py-1 rounded-full text-[13px] font-medium transition-colors duration-300 window-no-drag",
        isDarkBackground
          ? "bg-black/40 backdrop-blur-xl hover:bg-black/50 text-white"
          : "bg-transparent hover:bg-black/10 text-foreground"
      )}
    >
      <span className={cn("h-2 w-2 rounded-full shrink-0", dotColor)} />
      Staging
    </button>
  );

  // Always openable, even before the versions load and when staging's
  // server is down: it carries the way back to production, and the dashboard
  // menu that also does is unreachable when staging can't sign you in.
  return (
    <Popover open={isOpen} onOpenChange={(open) => {
      if (open) openTimeRef.current = Date.now();
      setIsOpen(open);
    }}>
      <PopoverTrigger asChild>
        {pill}
      </PopoverTrigger>
      <PopoverContent align="end" sideOffset={8} className="w-auto p-0 window-no-drag"
        onPointerDownOutside={(e) => {
          if (Date.now() - openTimeRef.current < 300) e.preventDefault();
        }}
      >
        <div className="p-3 space-y-2 max-w-[16rem]">
          <div className="flex items-center justify-between gap-4">
            <span className="text-xs font-semibold">Staging</span>
            {serverDown ? (
              <span className="flex items-center gap-1.5 text-[11px] font-medium px-1.5 py-0.5 rounded-full bg-zinc-500/10 text-muted-foreground">
                <span className="h-1.5 w-1.5 rounded-full bg-zinc-400" />
                Server Offline
              </span>
            ) : info && (
              <span className={cn(
                "flex items-center gap-1.5 text-[11px] font-medium px-1.5 py-0.5 rounded-full",
                info.synced ? "bg-green-500/10 text-green-600" : "bg-red-500/10 text-red-600"
              )}>
                <span className={cn("h-1.5 w-1.5 rounded-full", info.synced ? 'bg-green-500' : 'bg-red-500')} />
                {info.synced ? 'In Sync' : 'Out of Sync'}
              </span>
            )}
          </div>
          {serverDown && (
            <p className="text-[11px] text-muted-foreground">
              {waking
                ? "Starting staging. It usually takes about three minutes, and this page reloads when it's ready."
                : "Staging's server is asleep, so you can't sign in here. It runs during deploys, or for six hours when woken."}
            </p>
          )}
          {serverDown && wakePhase === 'failed' && wakeError && (
            <p className="text-[11px] text-red-600">{wakeError}</p>
          )}
          {!serverDown && <StagingAwakeLine />}
          {info && !serverDown && (
            <>
              <div className="border-t" />
              <div className="text-[11px] text-muted-foreground select-text selectable space-y-1">
                {info.entries.map((entry, i) => <VersionLine key={i} entry={entry} />)}
              </div>
            </>
          )}
          <div className="border-t" />
          {serverDown && (
            <Button size="sm" className="w-full" disabled={waking} onClick={() => { void wake(); }}>
              {waking ? 'Starting…' : wakePhase === 'failed' ? 'Try again' : 'Wake for 6 hours'}
            </Button>
          )}
          <Button size="sm" variant="secondary" className="w-full" onClick={() => switchEnvironment('production')}>
            Switch to Production
          </Button>
        </div>
      </PopoverContent>
    </Popover>
  );
}

// Community mode badge — always visible in the dashboard, dark theme
export function CommunityBadge({ isDarkBackground }: { isDarkBackground?: boolean } = {}) {
  if (!config.isCommunity) return null;
  return (
    <span
      className={cn(
        "flex items-center px-2.5 py-1 rounded-full text-[13px] font-medium transition-colors duration-300 window-no-drag",
        "bg-[hsl(222,47%,8%)] text-[hsl(210,40%,98%)] border border-[hsl(217,32%,17%)]"
      )}
    >
      Community
    </span>
  );
}

export function StagingBanner() {
  const { pathname } = useLocation();
  if (!config.isStaging || pathname.startsWith('/portal') || isMarketingPath(pathname)) return null;

  const isMqtt = pathname === '/mqtt' || location.hostname.startsWith('mqtt.') || location.hostname.startsWith('staging.mqtt.');
  return (
    <div className="fixed left-0 right-0 z-[10002] flex justify-center pointer-events-none" style={{ top: isMqtt ? 'calc(var(--safe-area-top, 0px) + 8px)' : 'calc(var(--safe-area-top, 0px) + 30px)' }}>
      <span className="pointer-events-auto shadow-sm">
        <StagingSyncLabel />
      </span>
    </div>
  );
}
