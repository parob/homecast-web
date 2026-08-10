import { useState } from 'react';
import { useQuery, useMutation } from '@apollo/client/react';
import { Loader2 } from 'lucide-react';
import { GET_HISTORY_STORAGE_STATS } from '@/lib/graphql/queries';
import {
  SET_HOME_HISTORY_ENABLED,
  SET_HOME_HISTORY_RETENTION,
  PURGE_HISTORY,
} from '@/lib/graphql/mutations';
import { isCommunity } from '@/lib/config';
import { Switch } from '@/components/ui/switch';
import { Button } from '@/components/ui/button';
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@/components/ui/select';
import type { HomeKitHome, HistoryStorageStatsData } from '@/lib/graphql/types';

/**
 * Settings → History. Opt-in per home, retention control, storage figures,
 * and the delete-everything button the privacy story requires. History is a
 * privacy feature first: OFF until the user turns it on, and everything here
 * says plainly where the data lives.
 */

const RETENTION_OPTIONS = [
  { value: 7, label: '7 days' },
  { value: 30, label: '30 days' },
  { value: 90, label: '90 days' },
  { value: 365, label: '1 year' },
  { value: 0, label: 'Summaries only' },
] as const;

function formatBytes(bytes: number): string {
  if (bytes < 1024 * 1024) return `${Math.max(1, Math.round(bytes / 1024))} KB`;
  if (bytes < 1024 * 1024 * 1024) return `${(bytes / (1024 * 1024)).toFixed(1)} MB`;
  return `${(bytes / (1024 * 1024 * 1024)).toFixed(2)} GB`;
}

interface HistorySectionProps {
  homes: HomeKitHome[];
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
  const [setRetention] = useMutation(SET_HOME_HISTORY_RETENTION);
  const [purge] = useMutation(PURGE_HISTORY);

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
          <div className="flex items-center justify-between gap-3">
            <div>
              <p className="text-sm">Keep detailed samples for</p>
              <p className="text-xs text-muted-foreground">
                Older data is summarised to hourly and daily values and kept.
              </p>
            </div>
            <Select
              value={String(stats.rawRetentionDays)}
              disabled={busy}
              onValueChange={(value) =>
                run(() => setRetention({ variables: { homeId: home.id, rawRetentionDays: Number(value) } }))
              }
            >
              <SelectTrigger className="w-[150px] h-8 text-xs">
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                {RETENTION_OPTIONS.map(o => (
                  <SelectItem key={o.value} value={String(o.value)} className="text-xs">
                    {o.label}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
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
  return (
    <div className="space-y-4">
      <div>
        <h3 className="text-sm font-medium mb-1">Device History</h3>
        <p className="text-xs text-muted-foreground">
          Record how your devices change over time and see charts of
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
        Once a home is recording, open any device's context menu → History to
        see its charts. Per-characteristic controls live there too.
      </p>
    </div>
  );
}
