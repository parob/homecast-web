import { useEffect, useState } from 'react';
import { useNavigate, useSearchParams } from 'react-router-dom';
import { LineChart as LineChartIcon, ArrowLeft } from 'lucide-react';
import { useHomes, useAccessoriesForHomes, useServiceGroups } from '@/hooks/useHomeKitData';
import { isMockHistoryEnabled, mockHistoryVariant } from '@/history/mock';
import AnalyticsContent from '@/components/home-analytics/AnalyticsContent';
import { useAnalyticsScope, type AnalyticsScope } from '@/components/home-analytics/scope';
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

/**
 * ?room= / ?accessory= / ?group= → where to open.
 *
 * Legacy ?category= and ?preset= links land on the room they named, or on the
 * home: the category level no longer exists, and a link is better honoured
 * approximately than 404'd.
 */
function initialScopeFromParams(params: URLSearchParams): AnalyticsScope | undefined {
  const accessory = params.get('accessory');
  if (accessory) return { level: 'accessory', accessoryId: accessory };
  const group = params.get('group');
  if (group) return { level: 'group', groupId: group };
  const room = params.get('room');
  if (room) return { level: 'room', room };
  const preset = params.get('preset');
  if (preset?.startsWith('climate:')) return { level: 'room', room: preset.slice('climate:'.length) };
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
  const nav = useAnalyticsScope(initialScopeFromParams(searchParams));

  // Mirror the location to the URL so category views are linkable. Custom
  // views aren't serialized (deferred) — they keep the current params.
  const current = nav.scope;
  useEffect(() => {
    if (current.level === 'custom') return;
    const params: Record<string, string> = {};
    if (effectiveHomeId && !mock) params.home = effectiveHomeId;
    if (current.level === 'room' && current.room) params.room = current.room;
    if (current.level === 'accessory') params.accessory = current.accessoryId;
    if (current.level === 'group') params.group = current.groupId;
    // Preserve the variant — rewriting ?mockHistory=big to =1 flipped the
    // catalogue to the small home mid-session and orphaned every lookup.
    if (mock) params.mockHistory = mockHistoryVariant() === 'big' ? 'big' : '1';
    setSearchParams(params, { replace: true });
  }, [current, effectiveHomeId, mock, setSearchParams]);

  return (
    <div className="min-h-screen bg-background text-foreground">
      <header className="border-b px-4 py-3 flex items-center justify-between gap-3">
        <div className="flex items-center gap-2 min-w-0">
          <button
            className="p-1 rounded hover:bg-muted"
            onClick={() => (nav.canGoBack ? nav.back() : navigate('/portal'))}
            aria-label="Back"
          >
            <ArrowLeft className="h-4 w-4" />
          </button>
          <LineChartIcon className="h-4 w-4 text-muted-foreground shrink-0" />
          <h1 className="text-sm font-semibold truncate">Analytics</h1>
        </div>
      </header>

      <main className="mx-auto flex h-[calc(100vh-53px)] max-w-6xl flex-col p-4">
        <AnalyticsContent
          homeId={effectiveHomeId}
          homeName={(homes ?? []).find(h => h.id === effectiveHomeId)?.name ?? 'Home'}
          homes={(homes ?? []).map(h => ({ id: h.id, name: h.name }))}
          onSelectHome={(id) => { setHomeId(id); nav.setScope({ level: 'home' }); }}
          accessories={accessories ?? null}
          serviceGroups={serviceGroups ?? null}
          nav={nav}
        />
      </main>
    </div>
  );
}
