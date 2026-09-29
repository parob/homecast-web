import { useState } from 'react';
import { Check, Info, Server } from 'lucide-react';
import { cn } from '@/lib/utils';
import type { CloudRelayOption } from '@/lib/graphql/types';
import { Popover, PopoverContent, PopoverTrigger } from '@/components/ui/popover';
import { availabilityLabel, isFull, recommendationReason, relayRegionCode } from '@/lib/relay-picker';

/**
 * Which relay the home will go to, inside the add-home dialog.
 *
 * Collapsed by default to one line — the server's recommendation is already
 * selected, and most customers should just continue. "Change" opens the full
 * list with how much space each relay has and whether it's up.
 *
 * Where a relay is sits behind its info button, not in its name: see
 * `relayRegionCode`.
 */
export function RelayChoice({ relays, selectedId, onSelect, regionHint }: {
  relays: CloudRelayOption[];
  selectedId: string | null;
  onSelect: (id: string) => void;
  regionHint: string;
}) {
  const [expanded, setExpanded] = useState(false);
  const selected = relays.find(r => r.id === selectedId) ?? null;

  if (!selected) return null;

  if (!expanded) {
    return (
      <div className="space-y-2">
        <label className="text-xs font-medium">Relay</label>
        <div className="flex items-center gap-3 rounded-md border px-3 py-2">
          <Server className="h-4 w-4 text-muted-foreground shrink-0" />
          <div className="min-w-0 flex-1">
            <div className="flex items-center gap-1">
              <p className="text-sm truncate">{selected.label}</p>
              <RelayInfo relay={selected} />
            </div>
            <RelayStatusLine relay={selected} />
          </div>
          <button
            type="button"
            className="text-xs font-medium text-primary hover:underline shrink-0"
            onClick={() => setExpanded(true)}
          >
            Change
          </button>
        </div>
      </div>
    );
  }

  return (
    <div className="space-y-2">
      <label className="text-xs font-medium" id="relay-choice-label">Choose a relay</label>
      <div role="radiogroup" aria-labelledby="relay-choice-label" className="space-y-1.5">
        {relays.map(r => {
          const full = isFull(r);
          const isSelected = r.id === selectedId;
          return (
            // The info button sits beside the radio, not inside it: a button
            // within a button is invalid, and a tap on it must not pick the relay.
            <div
              key={r.id}
              className={cn(
                'relative flex items-start rounded-md border transition-colors',
                isSelected ? 'border-primary bg-primary/5' : !full && 'hover:bg-muted/50',
                full && 'opacity-50',
              )}
            >
              <button
                type="button"
                role="radio"
                aria-checked={isSelected}
                disabled={full}
                onClick={() => { onSelect(r.id); setExpanded(false); }}
                className={cn(
                  'flex-1 min-w-0 flex items-start gap-3 px-3 py-2 text-left',
                  full && 'cursor-not-allowed',
                )}
              >
                <Server className="h-4 w-4 text-muted-foreground shrink-0 mt-0.5" />
                <div className="min-w-0 flex-1 space-y-0.5">
                  <div className="flex items-center gap-2 pr-6">
                    <span className="text-sm truncate">{r.label}</span>
                    {r.recommended && (
                      <span className="text-[10px] font-medium rounded px-1.5 py-0.5 bg-primary/10 text-primary shrink-0">
                        Recommended
                      </span>
                    )}
                  </div>
                  <RelayStatusLine relay={r} />
                  {r.recommended && (
                    <p className="text-xs text-muted-foreground">{recommendationReason(r, regionHint)}</p>
                  )}
                </div>
                {isSelected && <Check className="h-4 w-4 text-primary shrink-0 mt-0.5" />}
              </button>
              <div className={cn('absolute top-1.5', isSelected ? 'right-8' : 'right-2')}>
                <RelayInfo relay={r} />
              </div>
            </div>
          );
        })}
      </div>
    </div>
  );
}

/** The relay's region, on request. Absent when the server doesn't say. */
function RelayInfo({ relay }: { relay: CloudRelayOption }) {
  const region = relayRegionCode(relay);
  if (!region) return null;
  return (
    <Popover>
      <PopoverTrigger asChild>
        <button
          type="button"
          aria-label={`About ${relay.label}`}
          className="p-1 rounded text-muted-foreground hover:text-foreground hover:bg-muted/60 shrink-0"
        >
          <Info className="h-3.5 w-3.5" />
        </button>
      </PopoverTrigger>
      <PopoverContent side="top" className="z-[10040] w-auto px-3 py-2">
        <p className="text-xs"><span className="text-muted-foreground">Region</span> <span className="font-medium">{region}</span></p>
      </PopoverContent>
    </Popover>
  );
}

function RelayStatusLine({ relay }: { relay: CloudRelayOption }) {
  const dot = !relay.online
    ? 'bg-muted-foreground/40'
    : relay.availability === 'plenty'
      ? 'bg-green-500'
      : relay.availability === 'limited'
        ? 'bg-amber-500'
        : 'bg-muted-foreground/40';
  return (
    <p className="flex items-center gap-1.5 text-xs text-muted-foreground">
      <span className={cn('h-1.5 w-1.5 rounded-full shrink-0', dot)} aria-hidden />
      {relay.online ? availabilityLabel(relay.availability) : `Offline · ${availabilityLabel(relay.availability)}`}
    </p>
  );
}
