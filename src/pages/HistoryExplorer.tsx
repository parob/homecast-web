import { useState } from 'react';
import { useNavigate, useSearchParams } from 'react-router-dom';
import { LineChart as LineChartIcon, ArrowLeft } from 'lucide-react';
import { useHomes, useAccessoriesForHomes } from '@/hooks/useHomeKitData';
import { isMockHistoryEnabled } from '@/history/mock';
import HistoryExplorerContent from '@/components/history-explorer/HistoryExplorerContent';
import {
  Select, SelectContent, SelectItem, SelectTrigger, SelectValue,
} from '@/components/ui/select';

/**
 * Standalone /history page — a thin host around HistoryExplorerContent for
 * deep links, bookmarks, and the screenshot capture. The primary way to
 * reach the Explorer is the dialog on the Dashboard (HistoryContext.
 * openExplorer), which reuses the dashboard's already-loaded data; this
 * page fetches its own homes/accessories for the standalone case.
 */
export default function HistoryExplorer() {
  const mock = isMockHistoryEnabled();
  const navigate = useNavigate();
  const [searchParams, setSearchParams] = useSearchParams();

  const { data: homes } = useHomes({ skip: mock });
  const [homeId, setHomeId] = useState<string | null>(searchParams.get('home'));
  const effectiveHomeId = mock ? 'MOCK-HOME' : (homeId ?? homes?.[0]?.id ?? null);

  const { data: accessories } = useAccessoriesForHomes(
    effectiveHomeId && !mock ? [effectiveHomeId] : [],
  );

  return (
    <div className="min-h-screen bg-background text-foreground">
      <header className="border-b px-4 py-3 flex items-center justify-between gap-3">
        <div className="flex items-center gap-2 min-w-0">
          <button className="p-1 rounded hover:bg-muted" onClick={() => navigate('/portal')} aria-label="Back">
            <ArrowLeft className="h-4 w-4" />
          </button>
          <LineChartIcon className="h-4 w-4 text-muted-foreground shrink-0" />
          <h1 className="text-sm font-semibold truncate">History Explorer</h1>
        </div>
        {!mock && (homes?.length ?? 0) > 1 && (
          <Select value={effectiveHomeId ?? ''} onValueChange={(v) => setHomeId(v)}>
            <SelectTrigger className="w-[180px] h-8 text-xs">
              <SelectValue placeholder="Home" />
            </SelectTrigger>
            <SelectContent>
              {(homes ?? []).map(h => (
                <SelectItem key={h.id} value={h.id} className="text-xs">{h.name}</SelectItem>
              ))}
            </SelectContent>
          </Select>
        )}
      </header>

      <main className="p-4 max-w-5xl mx-auto">
        <HistoryExplorerContent
          homeId={effectiveHomeId}
          accessories={accessories ?? null}
          initialPresetId={searchParams.get('preset')}
          onViewChange={(presetId) => {
            const params: Record<string, string> = {};
            if (effectiveHomeId && !mock) params.home = effectiveHomeId;
            if (presetId) params.preset = presetId;
            if (mock) params.mockHistory = '1';
            setSearchParams(params, { replace: true });
          }}
        />
      </main>
    </div>
  );
}
