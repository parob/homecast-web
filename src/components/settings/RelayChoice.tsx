import { useState } from 'react';
import { Check, MapPin } from 'lucide-react';
import { cn } from '@/lib/utils';
import type { CloudRelayOption } from '@/lib/graphql/types';
import { availabilityLabel, isFull, recommendationReason } from '@/lib/relay-picker';

/**
 * Which relay the home will go to, inside the add-home dialog.
 *
 * Collapsed by default to one line — the server's recommendation is already
 * selected, and most customers should just continue. "Change" opens the full
 * list with each relay's region, how much space it has and whether it's up.
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
          <MapPin className="h-4 w-4 text-muted-foreground shrink-0" />
          <div className="min-w-0 flex-1">
            <p className="text-sm truncate">{selected.label}</p>
            <RelayStatusLine relay={selected} />
          </div>
          {relays.length > 1 && (
            <button
              type="button"
              className="text-xs font-medium text-primary hover:underline shrink-0"
              onClick={() => setExpanded(true)}
            >
              Change
            </button>
          )}
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
            <button
              key={r.id}
              type="button"
              role="radio"
              aria-checked={isSelected}
              disabled={full}
              onClick={() => { onSelect(r.id); setExpanded(false); }}
              className={cn(
                'w-full flex items-start gap-3 rounded-md border px-3 py-2 text-left transition-colors',
                isSelected ? 'border-primary bg-primary/5' : 'hover:bg-muted/50',
                full && 'opacity-50 cursor-not-allowed hover:bg-transparent',
              )}
            >
              <MapPin className="h-4 w-4 text-muted-foreground shrink-0 mt-0.5" />
              <div className="min-w-0 flex-1 space-y-0.5">
                <div className="flex items-center gap-2">
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
          );
        })}
      </div>
    </div>
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
