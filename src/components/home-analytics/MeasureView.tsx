import { useMemo, useState } from 'react';
import { SlidersHorizontal } from 'lucide-react';
import { measuresIn, SETPOINT_STATE_TYPES, type AccessoryInfoEntry, type OrganizedCategory } from '@/history/categories';
import { canonicalHistoryType } from '@/history/keys';
import ChartPanel from './ChartPanel';
import RoomStackView from './RoomStackView';
import { buildSels, roundRobinByRoom } from './selBuilder';
import { Button } from '@/components/ui/button';
import type { ExplorerView } from './types';

const ALL_ROOMS_CAP = 30;
const ROOM_CAP = 12;

/**
 * The measure-first chart view: one physical quantity per chart, chosen by
 * tab (Temperature | Humidity | …). All-rooms collapses each room's sensors
 * into one averaged line behind a home-wide band; picking a room shows its
 * individual sensors (and that room's state strips). This is the shape the
 * user chose over per-sensor spaghetti: aggregate by default, drill for
 * detail — with the provenance stated under the tabs.
 */
export default function MeasureView({
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
  const measures = useMemo(() => measuresIn(category.series), [category.series]);
  const [measureId, setMeasureId] = useState<string | null>(null);
  const activeMeasure = measures.find(m => m.id === measureId) ?? measures[0];

  const rooms = useMemo(() => {
    const named = [...category.byRoom.keys()].filter((r): r is string => r !== null).sort();
    if (category.byRoom.has(null)) named.push('Elsewhere');
    return named;
  }, [category]);

  const { sels, provenance, truncatedNote } = useMemo(() => {
    if (!activeMeasure) return { sels: [], provenance: '', truncatedNote: undefined };
    const typeSet = new Set(activeMeasure.types);
    const inMeasure = category.series.filter(s => typeSet.has(canonicalHistoryType(s.characteristicType)));

    const all = buildSels(inMeasure, accessoryInfo);
    const { taken, dropped } = roundRobinByRoom(all, ALL_ROOMS_CAP);
    const roomCount = new Set(taken.map(s => s.room ?? 'Elsewhere')).size;
    return {
      sels: taken,
      provenance: `${roomCount} room${roomCount === 1 ? '' : 's'} · averaged from ${taken.length} sensor${taken.length === 1 ? '' : 's'}`,
      truncatedNote: dropped > 0
        ? `Aggregating ${taken.length} of ${inMeasure.length} sensors — pick a room for full detail`
        : undefined,
    };
  }, [activeMeasure, category.series, room, accessoryInfo]);

  if (measures.length === 0) return null;

  if (room) {
    // Drill-down: the room's whole story stacked on one time axis —
    // measure tabs make no sense when every measure is visible at once.
    return (
      <div className="space-y-4">
        {rooms.length > 1 && (
          <div className="flex flex-wrap gap-1.5">
            <button
              onClick={() => onRoomChange(null)}
              className="text-[11px] px-2.5 py-1 rounded-full border transition-colors text-muted-foreground hover:bg-muted"
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
        <RoomStackView
          homeId={homeId}
          mock={mock}
          category={category}
          room={room}
          accessoryInfo={accessoryInfo}
          onCustomize={onCustomize}
        />
      </div>
    );
  }

  return (
    <div className="space-y-4">
      <div className="flex flex-wrap items-center gap-2">
        {measures.length > 1 && (
          <div className="inline-flex items-center rounded-lg bg-muted p-0.5 flex-wrap">
            {measures.map(m => (
              <button
                key={m.id}
                onClick={() => setMeasureId(m.id)}
                className={`text-[11px] px-2.5 py-1 rounded-md transition-colors ${
                  activeMeasure?.id === m.id
                    ? 'bg-background text-foreground shadow-sm font-medium'
                    : 'text-muted-foreground hover:text-foreground'
                }`}
              >
                {m.title}
              </button>
            ))}
          </div>
        )}
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
      </div>

      {provenance && (
        <p className="text-[11px] text-muted-foreground -mt-2">{provenance}</p>
      )}

      {sels.length > 0 ? (
        <ChartPanel
          homeId={homeId}
          mock={mock}
          series={sels}
          roomAggregate={!room}
          groupStripsByRoom={false}
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
            Nothing recorded here yet — charts build as accessories report changes.
          </p>
        </div>
      )}
    </div>
  );
}
