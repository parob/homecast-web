import { useMemo, useState } from 'react';
import { useQuery, useMutation, useLazyQuery } from '@apollo/client/react';
import { ChevronDown, ChevronRight, Download, Loader2 } from 'lucide-react';
import { GET_HISTORY_STORAGE_STATS, GET_HISTORY_SERIES, EXPORT_HISTORY } from '@/lib/graphql/queries';
import {
  SET_HOME_HISTORY_ENABLED,
  SET_HISTORY_SERIES_CONFIG,
  PURGE_HISTORY,
} from '@/lib/graphql/mutations';
import { isCommunity } from '@/lib/config';
import { charLabel } from '@/components/automations/format';
import { useAccessoriesForHomes } from '@/hooks/useHomeKitData';
import { useHistory } from '@/contexts/HistoryContext';
import { Switch } from '@/components/ui/switch';
import { Button } from '@/components/ui/button';
import type { HomeKitHome, HistoryStorageStatsData, HistorySeriesInfo } from '@/lib/graphql/types';

/**
 * Settings → History. Opt-in per home, retention control, storage figures,
 * and the delete-everything button the privacy story requires. History is a
 * privacy feature first: OFF until the user turns it on, and everything here
 * says plainly where the data lives.
 */

function formatBytes(bytes: number): string {
  if (bytes < 1024 * 1024) return `${Math.max(1, Math.round(bytes / 1024))} KB`;
  if (bytes < 1024 * 1024 * 1024) return `${(bytes / (1024 * 1024)).toFixed(1)} MB`;
  return `${(bytes / (1024 * 1024 * 1024)).toFixed(2)} GB`;
}

interface HistorySectionProps {
  homes: HomeKitHome[];
}

/**
 * The per-device prune list: every recorded characteristic in the home,
 * grouped by accessory, each with its own recording toggle. What the
 * "fully configurable per device/per characteristic" promise looks like.
 */
function DeviceSeriesList({ home, onChanged }: { home: HomeKitHome; onChanged: () => void }) {
  const { data, refetch } = useQuery<{ historySeries: HistorySeriesInfo[] }>(GET_HISTORY_SERIES, {
    variables: { homeId: home.id },
    fetchPolicy: 'cache-and-network',
  });
  const { data: accessories } = useAccessoriesForHomes([home.id]);
  const [setSeriesConfig] = useMutation(SET_HISTORY_SERIES_CONFIG);
  const [expanded, setExpanded] = useState<Set<string>>(new Set());
  const [busySeries, setBusySeries] = useState<string | null>(null);

  const nameById = useMemo(() => {
    const map = new Map<string, string>();
    for (const acc of accessories ?? []) map.set(acc.id.toUpperCase(), acc.name);
    return map;
  }, [accessories]);

  const byAccessory = useMemo(() => {
    const groups = new Map<string, HistorySeriesInfo[]>();
    for (const s of data?.historySeries ?? []) {
      const key = s.accessoryId.toUpperCase();
      const list = groups.get(key) ?? [];
      list.push(s);
      groups.set(key, list);
    }
    return [...groups.entries()].sort((a, b) =>
      (nameById.get(a[0]) ?? a[0]).localeCompare(nameById.get(b[0]) ?? b[0]));
  }, [data, nameById]);

  if (byAccessory.length === 0) {
    return (
      <p className="text-xs text-muted-foreground py-2">
        No characteristics recorded yet — accessories appear here as they report changes.
      </p>
    );
  }

  return (
    <div className="space-y-1">
      <p className="text-[10px] font-semibold uppercase tracking-wider text-muted-foreground pt-1">Accessories</p>
      {byAccessory.map(([accessoryId, seriesList]) => {
        const isOpen = expanded.has(accessoryId);
        const recording = seriesList.filter(s => s.enabled).length;
        return (
          <div key={accessoryId}>
            <button
              className="w-full flex items-center justify-between py-1.5 text-sm hover:bg-muted/50 rounded px-1"
              onClick={() => {
                const next = new Set(expanded);
                if (isOpen) next.delete(accessoryId); else next.add(accessoryId);
                setExpanded(next);
              }}
            >
              <span className="flex items-center gap-1.5 min-w-0">
                {isOpen ? <ChevronDown className="h-3.5 w-3.5 shrink-0" /> : <ChevronRight className="h-3.5 w-3.5 shrink-0" />}
                <span className="truncate">{nameById.get(accessoryId) ?? `Accessory ${accessoryId.slice(0, 8).toLowerCase()}`}</span>
              </span>
              <span className="text-xs text-muted-foreground shrink-0">
                {recording} of {seriesList.length} recording
              </span>
            </button>
            {isOpen && (
              <div className="ml-6 space-y-1 pb-1">
                {seriesList.map(s => (
                  <div key={s.characteristicType} className="flex items-center justify-between gap-2">
                    <div className="min-w-0">
                      <p className="text-xs truncate">{charLabel(s.characteristicType)}</p>
                      <p className="text-[10px] text-muted-foreground">
                        {s.sampleCount.toLocaleString()} samples
                        {s.minIntervalS ? ` · ≥${s.minIntervalS >= 3600 ? `${s.minIntervalS / 3600}h` : `${s.minIntervalS}s`} apart` : ' · every change'}
                      </p>
                    </div>
                    <Switch
                      checked={s.enabled}
                      disabled={busySeries === `${accessoryId}|${s.characteristicType}`}
                      onCheckedChange={async (checked) => {
                        const key = `${accessoryId}|${s.characteristicType}`;
                        setBusySeries(key);
                        try {
                          await setSeriesConfig({
                            variables: {
                              homeId: home.id,
                              accessoryId: s.accessoryId,
                              characteristicType: s.characteristicType,
                              enabled: checked,
                            },
                          });
                          await refetch();
                          onChanged();
                        } catch (e) {
                          console.error('[HistorySection] series toggle failed', e);
                        } finally {
                          setBusySeries(null);
                        }
                      }}
                    />
                  </div>
                ))}
              </div>
            )}
          </div>
        );
      })}
    </div>
  );
}

function HomeHistoryRow({ home }: { home: HomeKitHome }) {
  const [busy, setBusy] = useState(false);
  const [confirmDelete, setConfirmDelete] = useState(false);

  const { data, refetch } = useQuery<{ historyStorageStats: HistoryStorageStatsData }>(
    GET_HISTORY_STORAGE_STATS,
    { variables: { homeId: home.id }, fetchPolicy: 'cache-and-network' },
  );
  const stats = data?.historyStorageStats;

  const [setEnabled] = useMutation(SET_HOME_HISTORY_ENABLED);
  const [purge] = useMutation(PURGE_HISTORY);
  const [exportHistory, { loading: exporting }] = useLazyQuery<{ exportHistory: string }>(EXPORT_HISTORY, {
    fetchPolicy: 'network-only',
  });

  const handleExport = async () => {
    try {
      const result = await exportHistory({ variables: { homeId: home.id } });
      const csv = result.data?.exportHistory;
      if (!csv) return;
      const blob = new Blob([csv], { type: 'text/csv' });
      const url = URL.createObjectURL(blob);
      const a = document.createElement('a');
      a.href = url;
      a.download = `homecast-history-${home.name.toLowerCase().replace(/\s+/g, '-')}.csv`;
      a.click();
      URL.revokeObjectURL(url);
    } catch (e) {
      console.error('[HistorySection] export failed', e);
    }
  };

  const run = async (fn: () => Promise<unknown>) => {
    setBusy(true);
    try {
      await fn();
      await refetch();
    } catch (e) {
      console.error('[HistorySection] mutation failed', e);
    } finally {
      setBusy(false);
    }
  };

  if (!stats) {
    return (
      <div className="py-3 flex items-center gap-2 text-sm text-muted-foreground">
        <Loader2 className="h-4 w-4 animate-spin" /> {home.name}
      </div>
    );
  }

  return (
    <div className="py-3 space-y-3 border-b last:border-b-0">
      <div className="flex items-center justify-between">
        <div>
          <p className="text-sm font-medium">{home.name}</p>
          <p className="text-xs text-muted-foreground">
            {stats.enabled
              ? `${stats.seriesCount} characteristics · ${stats.sampleRows.toLocaleString()} samples · ~${formatBytes(stats.estBytes)}`
              : 'Not recording'}
          </p>
        </div>
        <Switch
          checked={stats.enabled}
          disabled={busy}
          onCheckedChange={(checked) =>
            run(() => setEnabled({ variables: { homeId: home.id, enabled: checked } }))
          }
        />
      </div>

      {stats.enabled && (
        <>
          <DeviceSeriesList home={home} onChanged={() => void refetch()} />

          <div className="flex items-center justify-between gap-3 pt-1">
            <Button
              variant="outline"
              size="sm"
              className="h-7 text-xs"
              disabled={busy || exporting}
              onClick={handleExport}
            >
              <Download className="h-3 w-3 mr-1.5" />
              {exporting ? 'Exporting…' : 'Export CSV'}
            </Button>
          </div>

          <div className="flex items-center justify-between gap-3">
            <p className="text-xs text-muted-foreground">
              Deleting history removes every recorded sample and summary for
              this home. This cannot be undone.
            </p>
            {confirmDelete ? (
              <div className="flex gap-2 shrink-0">
                <Button
                  variant="destructive"
                  size="sm"
                  className="h-7 text-xs"
                  disabled={busy}
                  onClick={() =>
                    run(async () => {
                      await purge({ variables: { homeId: home.id } });
                      setConfirmDelete(false);
                    })
                  }
                >
                  Delete all
                </Button>
                <Button
                  variant="outline"
                  size="sm"
                  className="h-7 text-xs"
                  disabled={busy}
                  onClick={() => setConfirmDelete(false)}
                >
                  Cancel
                </Button>
              </div>
            ) : (
              <Button
                variant="outline"
                size="sm"
                className="h-7 text-xs shrink-0"
                disabled={busy}
                onClick={() => setConfirmDelete(true)}
              >
                Delete history…
              </Button>
            )}
          </div>
        </>
      )}
    </div>
  );
}

export function HistorySection({ homes }: HistorySectionProps) {
  const { openAnalytics } = useHistory();
  return (
    <div className="space-y-4">
      <div>
        <h3 className="text-sm font-medium mb-1">Accessory History</h3>
        <p className="text-xs text-muted-foreground">
          Record how your accessories change over time and see charts of
          temperature, humidity, activity and more. Off unless you turn it
          on.{' '}
          {isCommunity
            ? 'History is stored only on this Mac and never leaves your home.'
            : 'History is stored in your Homecast Cloud account. You can delete it at any time.'}
        </p>
      </div>

      <div>
        {homes.map(home => (
          <HomeHistoryRow key={home.id} home={home} />
        ))}
        {homes.length === 0 && (
          <p className="text-sm text-muted-foreground py-4">No homes found.</p>
        )}
      </div>

      <p className="text-[10px] text-muted-foreground">
        Once a home is recording, open any accessory's context menu →
        Accessory Analytics for its charts, or{' '}
        <button className="underline hover:text-foreground" onClick={() => openAnalytics()}>Home Analytics</button>{' '}
        to compare sensors and rooms on one graph.
      </p>
    </div>
  );
}
