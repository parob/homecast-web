import { useMemo } from 'react';
import { SlidersHorizontal } from 'lucide-react';
import type { AccessoryInfoEntry, OrganizedCategory } from '@/history/categories';
import ChartPanel from './ChartPanel';
import { buildSels, roundRobinByRoom } from './selBuilder';
import { Button } from '@/components/ui/button';
import type { ExplorerView } from './types';

const ALL_ROOMS_CAP = 24;

/**
 * Activity is timelines, not lines: motion, doors, locks as state strips
 * grouped by room — three per room up front, the rest behind "show more".
 * A room chip narrows to that room's full sensor list.
 */
export default function ActivityView({
  homeId,
  mock,
  category,
  room,
  accessoryInfo,
  onRoomChange,
  onCustomize,
}: {
  homeId: string | null;
  mock: boolean;
  category: OrganizedCategory;
  room?: string | null;
  accessoryInfo: Map<string, AccessoryInfoEntry>;
  onRoomChange: (room: string | null) => void;
  onCustomize: (view: ExplorerView) => void;
}) {
  const rooms = useMemo(() => {
    const named = [...category.byRoom.keys()].filter((r): r is string => r !== null).sort();
    if (category.byRoom.has(null)) named.push('Elsewhere');
    return named;
  }, [category]);

  const { sels, truncatedNote } = useMemo(() => {
    const infos = room
      ? (room === 'Elsewhere' ? category.byRoom.get(null) : category.byRoom.get(room)) ?? []
      : category.series;
    const all = buildSels(infos, accessoryInfo);
    const { taken, dropped } = roundRobinByRoom(all, ALL_ROOMS_CAP);
    return {
      sels: taken,
      truncatedNote: dropped > 0 ? `Showing ${taken.length} of ${all.length} sensors — pick a room for the rest` : undefined,
    };
  }, [category, room, accessoryInfo]);

  return (
    <div className="space-y-4">
      {rooms.length > 1 && (
        <div className="flex flex-wrap gap-1.5">
          <button
            onClick={() => onRoomChange(null)}
            className={`text-[11px] px-2.5 py-1 rounded-full border transition-colors ${
              !room ? 'bg-primary text-primary-foreground border-primary' : 'text-muted-foreground hover:bg-muted'
            }`}
          >
            All rooms
          </button>
          {rooms.map(r => (
            <button
              key={r}
              onClick={() => onRoomChange(r)}
              className={`text-[11px] px-2.5 py-1 rounded-full border transition-colors ${
                room === r ? 'bg-primary text-primary-foreground border-primary' : 'text-muted-foreground hover:bg-muted'
              }`}
            >
              {r}
            </button>
          ))}
        </div>
      )}

      {sels.length > 0 ? (
        <ChartPanel
          homeId={homeId}
          mock={mock}
          series={sels}
          groupStripsByRoom={!room}
          stripsMaxPerRoom={room ? undefined : 3}
          truncatedNote={truncatedNote}
          extraControls={
            <Button
              variant="outline"
              size="sm"
              className="h-7 text-xs"
              onClick={() => onCustomize({ title: 'Custom view', series: sels, aggregate: false })}
            >
              <SlidersHorizontal className="h-3 w-3 mr-1" /> Customize
            </Button>
          }
        />
      ) : (
        <div className="py-12 text-center">
          <p className="text-sm text-muted-foreground">
            Nothing recorded here yet — timelines build as sensors report
            activity.
          </p>
        </div>
      )}
    </div>
  );
}
