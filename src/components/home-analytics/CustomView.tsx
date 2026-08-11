import { useMemo } from 'react';
import { Plus, X } from 'lucide-react';
import { charLabel } from '@/components/automations/format';
import { getRecordableCharacteristics } from '@/components/automations/characteristics';
import { getProfile } from '@/history/policy';
import { canonicalHistoryType } from '@/history/keys';
import { CATEGORIES, categoryOf, type CategoryId } from '@/history/categories';
import { stripRoomPrefix } from '@/history/labels';
import { mockAccessories } from '@/history/mock';
import ChartPanel from './ChartPanel';
import { seriesColor } from './ExplorerChart';
import { Button } from '@/components/ui/button';
import {
  DropdownMenu, DropdownMenuContent, DropdownMenuItem, DropdownMenuLabel, DropdownMenuTrigger,
} from '@/components/ui/dropdown-menu';
import type { ExplorerView, SeriesSel } from './types';
import type { HistorySeriesInfo, HomeKitAccessory } from '@/lib/graphql/types';

/**
 * The free-form view: any mix of series on one chart, edited via wrapping
 * chips. Add-series offers EVERY recordable characteristic in the home —
 * grouped by category, unrecorded entries marked "no data yet" — not just
 * what already has data (the old menu made silent sensors unfindable).
 */

interface AddableEntry {
  accessoryId: string;
  accessoryName: string;
  room: string | null;
  characteristicType: string;
  unit: string | null;
  kind: 'numeric' | 'bool' | 'enum' | 'string';
  category: CategoryId;
  hasData: boolean;
}

function profileKind(type: string): 'numeric' | 'bool' | 'enum' | 'string' {
  return getProfile(canonicalHistoryType(type))?.kind ?? 'numeric';
}

export default function CustomView({
  homeId,
  mock,
  view,
  onViewChange,
  accessories,
  recorded,
}: {
  homeId: string | null;
  mock: boolean;
  view: ExplorerView;
  onViewChange: (view: ExplorerView) => void;
  accessories: HomeKitAccessory[] | null;
  recorded: HistorySeriesInfo[];
}) {
  const addable = useMemo<AddableEntry[]>(() => {
    const used = new Set(view.series.map(s => `${s.accessoryId.toUpperCase()}|${canonicalHistoryType(s.characteristicType)}`));
    const recordedKeys = new Set(recorded.filter(s => s.enabled)
      .map(s => `${s.accessoryId.toUpperCase()}|${s.characteristicType}`));
    const out: AddableEntry[] = [];

    if (mock) {
      for (const acc of mockAccessories()) {
        for (const type of acc.recordable) {
          const canonical = canonicalHistoryType(type);
          const key = `${acc.accessoryId.toUpperCase()}|${canonical}`;
          if (used.has(key)) continue;
          const profile = getProfile(canonical);
          out.push({
            accessoryId: acc.accessoryId,
            accessoryName: acc.name,
            room: acc.room,
            characteristicType: canonical,
            unit: profile?.unit ?? null,
            kind: profileKind(canonical),
            category: categoryOf(canonical, { isVirtualAccessory: acc.isVirtual }),
            hasData: recordedKeys.has(key),
          });
        }
      }
    } else {
      for (const acc of accessories ?? []) {
        for (const char of getRecordableCharacteristics(acc)) {
          const canonical = canonicalHistoryType(char.type);
          const key = `${acc.id.toUpperCase()}|${canonical}`;
          if (used.has(key)) continue;
          out.push({
            accessoryId: acc.id,
            accessoryName: acc.name,
            room: acc.roomName ?? null,
            characteristicType: canonical,
            unit: char.unit ?? null,
            kind: profileKind(canonical),
            category: categoryOf(canonical, { isVirtualAccessory: (acc as { isVirtual?: boolean }).isVirtual }),
            hasData: recordedKeys.has(key),
          });
        }
      }
    }

    out.sort((a, b) =>
      CATEGORIES[a.category].order - CATEGORIES[b.category].order
      || (a.room ?? '~').localeCompare(b.room ?? '~')
      || a.accessoryName.localeCompare(b.accessoryName));
    return out.slice(0, 200);
  }, [mock, accessories, recorded, view.series]);

  const byCategory = useMemo(() => {
    const map = new Map<CategoryId, AddableEntry[]>();
    for (const entry of addable) {
      const list = map.get(entry.category) ?? [];
      list.push(entry);
      map.set(entry.category, list);
    }
    return map;
  }, [addable]);

  const addSeries = (entry: AddableEntry) => {
    const shortName = stripRoomPrefix(entry.accessoryName, entry.room);
    const sel: SeriesSel = {
      accessoryId: entry.accessoryId,
      characteristicType: entry.characteristicType,
      label: `${shortName} · ${charLabel(entry.characteristicType)}`,
      fullLabel: [entry.room, shortName, charLabel(entry.characteristicType)].filter(Boolean).join(' · '),
      room: entry.room,
      unit: entry.unit,
      kind: entry.kind,
    };
    onViewChange({ ...view, series: [...view.series, sel], aggregate: false });
  };

  const numericIndex = (sel: SeriesSel) =>
    view.series.filter(s => s.kind === 'numeric').findIndex(s => s === sel);

  return (
    <div className="space-y-4">
      <div className="flex flex-wrap items-center gap-1.5">
        {view.series.map((sel) => (
          <span
            key={`${sel.accessoryId}|${sel.characteristicType}`}
            className="inline-flex items-center gap-1.5 text-[11px] border rounded-full pl-2 pr-1 py-0.5"
          >
            <span
              className="h-2 w-2 rounded-full shrink-0"
              style={{
                backgroundColor: sel.kind === 'numeric'
                  ? seriesColor(numericIndex(sel))
                  : 'hsl(var(--muted-foreground))',
              }}
            />
            <span className="whitespace-normal break-words" title={sel.fullLabel ?? sel.label}>{sel.label}</span>
            <button
              className="p-0.5 rounded-full hover:bg-muted"
              onClick={() => onViewChange({ ...view, series: view.series.filter(s => s !== sel) })}
              aria-label={`Remove ${sel.label}`}
            >
              <X className="h-3 w-3" />
            </button>
          </span>
        ))}
        <DropdownMenu>
          <DropdownMenuTrigger asChild>
            <Button variant="outline" size="sm" className="h-6 text-[11px] rounded-full px-2" disabled={addable.length === 0}>
              <Plus className="h-3 w-3 mr-1" /> Add series
            </Button>
          </DropdownMenuTrigger>
          <DropdownMenuContent className="max-h-[320px] w-[300px] overflow-y-auto">
            {[...byCategory.entries()].map(([categoryId, entries]) => (
              <div key={categoryId}>
                <DropdownMenuLabel className="text-xs">{CATEGORIES[categoryId].title}</DropdownMenuLabel>
                {entries.map(entry => (
                  <DropdownMenuItem
                    key={`${entry.accessoryId}|${entry.characteristicType}`}
                    className="text-xs"
                    onClick={() => addSeries(entry)}
                  >
                    <span className="min-w-0 flex-1 truncate">
                      {entry.room ? `${entry.room} · ` : ''}{entry.accessoryName} · {charLabel(entry.characteristicType)}
                    </span>
                    {!entry.hasData && (
                      <span className="ml-2 shrink-0 text-[10px] text-muted-foreground">no data yet</span>
                    )}
                  </DropdownMenuItem>
                ))}
              </div>
            ))}
          </DropdownMenuContent>
        </DropdownMenu>
      </div>

      {view.series.length > 0 ? (
        <ChartPanel
          homeId={homeId}
          mock={mock}
          series={view.series}
          aggregate={view.aggregate}
        />
      ) : (
        <div className="py-12 text-center">
          <p className="text-sm text-muted-foreground">
            Add series to build a view — mix any accessories and characteristics
            on one chart.
          </p>
        </div>
      )}
    </div>
  );
}
