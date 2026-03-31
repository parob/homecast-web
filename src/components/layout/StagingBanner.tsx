import { useState, useEffect, useRef } from 'react';
import { useQuery } from '@apollo/client/react';
import { config } from '@/lib/config';
import { useLocation } from 'react-router-dom';
import { Popover, PopoverContent, PopoverTrigger } from '@/components/ui/popover';
import { cn } from '@/lib/utils';
import { GET_VERSION } from '@/lib/graphql/queries';

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

function useStagingVersionInfo(): StagingVersionInfo | undefined {
  const [prodData, setProdData] = useState<{
    server?: string; serverDeployedAt?: string;
    web?: string; webDeployedAt?: string;
  }>({});
  const [stagingWebDeployedAt, setStagingWebDeployedAt] = useState<string>();
  const [fetched, setFetched] = useState(false);
  const { data: versionData } = useQuery<{ version: string; deployedAt?: string }>(GET_VERSION, {
    fetchPolicy: 'cache-first',
    skip: !config.isStaging,
  });

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

  if (!fetched) return undefined;

  const stagingServer = versionData?.version && versionData.version !== 'dev' ? versionData.version : undefined;
  const stagingServerDeployedAt = versionData?.deployedAt || undefined;
  const webVer = config.version !== 'dev' ? config.version : undefined;
  const appVer = window.homecastAppVersion;
  const appHash = window.homecastAppBuild && window.homecastAppBuild !== 'unknown' ? window.homecastAppBuild : null;

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
    entries.push({
      label: 'app',
      staging: `${appVer}${appHash ? ` (${appHash})` : ''}`,
    });
  }

  if (entries.length === 0) return undefined;

  return { synced: allSynced, entries };
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

interface StagingSyncLabelProps {
  isDarkBackground?: boolean;
}

export function StagingSyncLabel({ isDarkBackground }: StagingSyncLabelProps = {}) {
  const info = useStagingVersionInfo();
  const [isOpen, setIsOpen] = useState(false);
  const openTimeRef = useRef(0);
  if (!config.isStaging) return null;

  const dotColor = !info ? 'bg-amber-500 animate-pulse' : info.synced ? 'bg-green-500' : 'bg-red-500';

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

  if (!info) return pill;

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
        <div className="p-3 space-y-2">
          <div className="flex items-center justify-between gap-4">
            <span className="text-xs font-semibold">Staging</span>
            <span className={cn(
              "flex items-center gap-1.5 text-[11px] font-medium px-1.5 py-0.5 rounded-full",
              info.synced ? "bg-green-500/10 text-green-600" : "bg-red-500/10 text-red-600"
            )}>
              <span className={cn("h-1.5 w-1.5 rounded-full", info.synced ? 'bg-green-500' : 'bg-red-500')} />
              {info.synced ? 'In Sync' : 'Out of Sync'}
            </span>
          </div>
          <div className="border-t" />
          <div className="text-[11px] text-muted-foreground select-text selectable space-y-1">
            {info.entries.map((entry, i) => <VersionLine key={i} entry={entry} />)}
          </div>
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

const MARKETING_PATHS = ['/', '/how-it-works', '/pricing', '/terms', '/privacy', '/cookies'];

export function StagingBanner() {
  const { pathname } = useLocation();
  if (!config.isStaging || pathname.startsWith('/portal') || MARKETING_PATHS.includes(pathname)) return null;

  return (
    <div className="fixed left-0 right-0 z-[10002] flex justify-center pointer-events-none" style={{ top: 'calc(var(--safe-area-top, 0px) + 30px)' }}>
      <span className="pointer-events-auto shadow-sm">
        <StagingSyncLabel />
      </span>
    </div>
  );
}
