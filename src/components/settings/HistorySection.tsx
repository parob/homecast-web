import { useState } from 'react';
import { useQuery, useMutation, useLazyQuery } from '@apollo/client/react';
import { Download, Loader2 } from 'lucide-react';
import { GET_HISTORY_STORAGE_STATS, EXPORT_HISTORY } from '@/lib/graphql/queries';
import {
  SET_HOME_HISTORY_ENABLED, SET_HOME_SHARED_ANALYTICS_ENABLED, PURGE_HISTORY,
} from '@/lib/graphql/mutations';
import { isCommunity } from '@/lib/config';
import { Switch } from '@/components/ui/switch';
import { Button } from '@/components/ui/button';
import { saveTextFile } from '@/lib/saveFile';
import { toast } from 'sonner';
import type { HistoryStorageStatsData } from '@/lib/graphql/types';

/**
 * Per-home Analytics settings — ONE toggle, storage figures, export and the
 * delete-everything button the privacy story requires. Lives on the home's
 * own settings page (Settings → Homes → home), where a per-home switch
 * belongs. "History" survives only in the API and storage layer (get_history,
 * historyStorageStats, history_sample) — everything a person reads says
 * Analytics.
 */

function formatBytes(bytes: number): string {
  if (bytes < 1024 * 1024) return `${Math.max(1, Math.round(bytes / 1024))} KB`;
  if (bytes < 1024 * 1024 * 1024) return `${(bytes / (1024 * 1024)).toFixed(1)} MB`;
  return `${(bytes / (1024 * 1024 * 1024)).toFixed(2)} GB`;
}

export function HomeHistorySettings({
  home, isAdmin = true,
}: {
  home: { id: string; name: string };
  /**
   * Both mutations here require home-admin server-side. The master toggle has
   * always been admin-only and the UI simply never said so; a member with
   * control rights got a switch that failed on click.
   */
  isAdmin?: boolean;
}) {
  const [busy, setBusy] = useState(false);
  const [confirmDelete, setConfirmDelete] = useState(false);

  const { data, refetch } = useQuery<{ historyStorageStats: HistoryStorageStatsData }>(
    GET_HISTORY_STORAGE_STATS,
    { variables: { homeId: home.id }, fetchPolicy: 'cache-and-network' },
  );
  const stats = data?.historyStorageStats;

  const [setEnabled] = useMutation(SET_HOME_HISTORY_ENABLED);
  const [setSharedAnalytics] = useMutation(SET_HOME_SHARED_ANALYTICS_ENABLED);
  const [purge] = useMutation(PURGE_HISTORY);
  const [exportHistory, { loading: exporting }] = useLazyQuery<{ exportHistory: string }>(EXPORT_HISTORY, {
    fetchPolicy: 'network-only',
  });

  const handleExport = async () => {
    try {
      const result = await exportHistory({ variables: { homeId: home.id } });
      const csv = result.data?.exportHistory;
      if (!csv) {
        toast('Nothing to export', { description: 'No data recorded for this home yet.' });
        return;
      }
      const filename = `homecast-analytics-${home.name.toLowerCase().replace(/\s+/g, '-')}.csv`;
      // A blob download silently does nothing in the Mac app's WebView —
      // the helper picks a path that actually works there.
      const outcome = await saveTextFile(filename, csv, 'text/csv');
      if (outcome === 'copied') {
        toast('Copied to clipboard', { description: 'This app build can\'t save files directly — paste into a spreadsheet or text file.' });
      } else if (outcome === 'failed') {
        toast.error('Export failed', { description: 'Could not save or copy the data.' });
      }
    } catch (e) {
      console.error('[HomeHistorySettings] export failed', e);
      toast.error('Export failed', { description: String(e) });
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
      <p className="text-[10px] font-semibold uppercase tracking-wider text-muted-foreground">Analytics</p>

      {!stats ? (
        <div className="py-2 flex items-center gap-2 text-sm text-muted-foreground">
          <Loader2 className="h-4 w-4 animate-spin" /> Loading…
        </div>
      ) : (
        <>
          <div className="flex items-center justify-between gap-3">
            <div className="min-w-0">
              <p className="text-sm">Analytics</p>
              <p className="text-xs text-muted-foreground">
                Record how accessories change over time to chart and analyse.{' '}
                {stats.enabled
                  ? `${stats.seriesCount} characteristics · ${stats.sampleRows.toLocaleString()} readings · ~${formatBytes(stats.estBytes)}`
                  : isCommunity
                    ? 'Recordings stay on this Mac and never leave your home.'
                    : 'Recordings are stored in your Homecast Cloud account.'}
              </p>
            </div>
            <Switch
              checked={stats.enabled}
              disabled={busy || !isAdmin}
              onCheckedChange={(checked) =>
                run(() => setEnabled({ variables: { homeId: home.id, enabled: checked } }))
              }
            />
          </div>

          {/*
            Shown only while recording is on, and nested under it, because
            there is nothing to share when nothing is being recorded — the
            same reason Export and Delete live inside this branch. Turning
            recording off does NOT clear this flag server-side: the two are
            ANDed at read time, so switching recording back on cannot silently
            re-publish, and a deliberate choice is not destroyed by an
            unrelated one.
          */}
          {stats.enabled && (
            <div className="flex items-center justify-between gap-3 pt-1">
              <div className="min-w-0">
                <p className="text-sm">Analytics on shared links</p>
                <p className="text-xs text-muted-foreground">
                  Anyone with a share link for this home can open Analytics for
                  what that link shows — nothing else. Off by default.
                </p>
              </div>
              <Switch
                checked={stats.sharedAnalyticsEnabled ?? false}
                disabled={busy || !isAdmin}
                onCheckedChange={(checked) =>
                  run(() => setSharedAnalytics({ variables: { homeId: home.id, enabled: checked } }))
                }
              />
            </div>
          )}

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
                    Delete all data
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
                  Delete data…
                </Button>
              )}
            </div>
          )}
        </>
      )}
    </div>
  );
}
