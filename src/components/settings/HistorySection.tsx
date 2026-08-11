import { useState } from 'react';
import { useQuery, useMutation, useLazyQuery } from '@apollo/client/react';
import { Download, Loader2 } from 'lucide-react';
import { GET_HISTORY_STORAGE_STATS, EXPORT_HISTORY } from '@/lib/graphql/queries';
import { SET_HOME_HISTORY_ENABLED, PURGE_HISTORY } from '@/lib/graphql/mutations';
import { isCommunity } from '@/lib/config';
import { Switch } from '@/components/ui/switch';
import { Button } from '@/components/ui/button';
import type { HistoryStorageStatsData } from '@/lib/graphql/types';

/**
 * Per-home History settings — ONE toggle, storage figures, export and the
 * delete-everything button the privacy story requires. Lives on the home's
 * own settings page (Settings → Homes → home), where a per-home switch
 * belongs. The old standalone History tab listed every accessory and
 * characteristic with its own switch — hundreds of rows on a real home;
 * per-characteristic control remains available through the API.
 */

function formatBytes(bytes: number): string {
  if (bytes < 1024 * 1024) return `${Math.max(1, Math.round(bytes / 1024))} KB`;
  if (bytes < 1024 * 1024 * 1024) return `${(bytes / (1024 * 1024)).toFixed(1)} MB`;
  return `${(bytes / (1024 * 1024 * 1024)).toFixed(2)} GB`;
}

export function HomeHistorySettings({ home }: { home: { id: string; name: string } }) {
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
      console.error('[HomeHistorySettings] export failed', e);
    }
  };

  const run = async (fn: () => Promise<unknown>) => {
    setBusy(true);
    try {
      await fn();
      await refetch();
    } catch (e) {
      console.error('[HomeHistorySettings] mutation failed', e);
    } finally {
      setBusy(false);
    }
  };

  return (
    <div className="space-y-2">
      <p className="text-[10px] font-semibold uppercase tracking-wider text-muted-foreground">History</p>

      {!stats ? (
        <div className="py-2 flex items-center gap-2 text-sm text-muted-foreground">
          <Loader2 className="h-4 w-4 animate-spin" /> Loading…
        </div>
      ) : (
        <>
          <div className="flex items-center justify-between gap-3">
            <div className="min-w-0">
              <p className="text-sm">Record history</p>
              <p className="text-xs text-muted-foreground">
                {stats.enabled
                  ? `${stats.seriesCount} characteristics · ${stats.sampleRows.toLocaleString()} samples · ~${formatBytes(stats.estBytes)}`
                  : isCommunity
                    ? 'Off. When on, recordings stay on this Mac and never leave your home.'
                    : 'Off. When on, recordings are stored in your Homecast Cloud account.'}
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
            <div className="flex items-center gap-2 pt-1">
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
              {confirmDelete ? (
                <>
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
                    Delete all history
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
                </>
              ) : (
                <Button
                  variant="outline"
                  size="sm"
                  className="h-7 text-xs"
                  disabled={busy}
                  onClick={() => setConfirmDelete(true)}
                >
                  Delete history…
                </Button>
              )}
            </div>
          )}
        </>
      )}
    </div>
  );
}
