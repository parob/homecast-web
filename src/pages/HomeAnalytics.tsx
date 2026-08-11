import { useEffect, useState } from 'react';
import { useNavigate, useSearchParams } from 'react-router-dom';
import { LineChart as LineChartIcon, ArrowLeft } from 'lucide-react';
import { useHomes, useAccessoriesForHomes, useServiceGroups } from '@/hooks/useHomeKitData';
import { isMockHistoryEnabled } from '@/history/mock';
import { CATEGORIES, type CategoryId } from '@/history/categories';
import AnalyticsContent from '@/components/home-analytics/AnalyticsContent';
import { useAnalyticsNav, type AnalyticsLevel } from '@/components/home-analytics/useAnalyticsNav';
import {
  Select, SelectContent, SelectItem, SelectTrigger, SelectValue,
} from '@/components/ui/select';

/**
 * Standalone /analytics page — a thin host around AnalyticsContent for deep
 * links, bookmarks, and the screenshot capture. The primary way in is the
 * dialog on the Dashboard (HistoryContext.openAnalytics), which reuses the
 * dashboard's already-loaded data; this page fetches its own homes,
 * accessories and groups for the standalone case.
 */

/** ?category=&room= (plus legacy ?preset= links) → initial level. */
function initialLevelFromParams(params: URLSearchParams): AnalyticsLevel | undefined {
  const category = params.get('category');
  if (category && category in CATEGORIES) {
    return { level: 'category', category: category as CategoryId, room: params.get('room') };
  }
  const preset = params.get('preset');
  if (preset) {
    if (preset.startsWith('climate:')) {
      return { level: 'category', category: 'climate', room: preset.slice('climate:'.length) };
    }
    if (preset === 'home-temp') return { level: 'category', category: 'climate' };
    if (preset === 'motion') return { level: 'category', category: 'activity' };
    if (preset === 'battery') return { level: 'category', category: 'battery' };
  }
  return undefined;
}

export default function HomeAnalytics() {
  const mock = isMockHistoryEnabled();
  const navigate = useNavigate();
  const [searchParams, setSearchParams] = useSearchParams();

  const { data: homes } = useHomes({ skip: mock });
  const [homeId, setHomeId] = useState<string | null>(searchParams.get('home'));
  const effectiveHomeId = mock ? 'MOCK-HOME' : (homeId ?? homes?.[0]?.id ?? null);

  const { data: accessories } = useAccessoriesForHomes(
    effectiveHomeId && !mock ? [effectiveHomeId] : [],
  );
  const { data: serviceGroups } = useServiceGroups(mock ? null : effectiveHomeId, { skip: mock });

  // eslint-disable-next-line react-hooks/exhaustive-deps
  const nav = useAnalyticsNav(initialLevelFromParams(searchParams));

  // Mirror the location to the URL so category views are linkable. Custom
  // views aren't serialized (deferred) — they keep the current params.
  const current = nav.current;
  useEffect(() => {
    if (current.level === 'custom') return;
    const params: Record<string, string> = {};
    if (effectiveHomeId && !mock) params.home = effectiveHomeId;
    if (current.level === 'category') {
      params.category = current.category;
      if (current.room) params.room = current.room;
    }
    if (mock) params.mockHistory = '1';
    setSearchParams(params, { replace: true });
  }, [current, effectiveHomeId, mock, setSearchParams]);

  return (
    <div className="min-h-screen bg-background text-foreground">
      <header className="border-b px-4 py-3 flex items-center justify-between gap-3">
        <div className="flex items-center gap-2 min-w-0">
          <button
            className="p-1 rounded hover:bg-muted"
            onClick={() => (nav.depth > 0 ? nav.back() : navigate('/portal'))}
            aria-label="Back"
          >
            <ArrowLeft className="h-4 w-4" />
          </button>
          <LineChartIcon className="h-4 w-4 text-muted-foreground shrink-0" />
          <h1 className="text-sm font-semibold truncate">{nav.title}</h1>
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

      <main className="p-4 max-w-6xl mx-auto">
        <AnalyticsContent
          homeId={effectiveHomeId}
          accessories={accessories ?? null}
          serviceGroups={serviceGroups ?? null}
          nav={nav}
        />
      </main>
    </div>
  );
}
