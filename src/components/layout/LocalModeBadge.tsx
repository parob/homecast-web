// The always-visible sign that this device is serving HomeKit itself.
//
// Local Mode is a genuinely different thing from normal operation — automations
// are not running, history is not being recorded, and nobody else can see what
// this device can. That is fine as a rescue, and unacceptable as a surprise, so
// the badge is permanent while it is on and explains itself on tap.

import { useState, useRef } from 'react';
import { Popover, PopoverContent, PopoverTrigger } from '@/components/ui/popover';
import { Check, X } from 'lucide-react';
import { cn } from '@/lib/utils';
import { useLocalMode } from '@/hooks/useLocalMode';
import type { LocalModeReason } from '@/server/local-mode';

interface LocalModeBadgeProps {
  isDarkBackground?: boolean;
  /** Opens Settings → Local Mode. */
  onOpenSettings?: () => void;
}

const REASON_TEXT: Record<LocalModeReason, string> = {
  'manual': 'Local Mode is switched on in Settings.',
  'no-relay-ever': "You haven't set up a home relay yet.",
  'relay-offline': 'Your home relay is offline.',
  'socket-down': "This device can't reach Homecast's servers.",
};

const WORKS = ['Lights, switches and plugs', 'Sensors and thermostats', 'Locks and blinds', 'Scenes and rooms'];
const DOESNT = ['Automations', 'Notifications', 'History recording', 'Sharing with other people'];

export function LocalModeBadge({ isDarkBackground, onOpenSettings }: LocalModeBadgeProps) {
  const { active, reason, identityState, matched, reported } = useLocalMode();
  const [isOpen, setIsOpen] = useState(false);
  const openTimeRef = useRef(0);

  if (!active) return null;

  const isPhone = /iPhone|iPad/i.test(navigator.userAgent) || (window as Window & { isHomecastIOSApp?: boolean }).isHomecastIOSApp === true;
  const deviceWord = isPhone ? 'device' : 'Mac';
  const unmapped = identityState === 'unmapped';

  return (
    <Popover open={isOpen} onOpenChange={(open) => {
      if (open) openTimeRef.current = Date.now();
      setIsOpen(open);
    }}>
      <PopoverTrigger asChild>
        <button
          aria-label="Local Mode — this device is controlling HomeKit directly"
          className={cn(
            "flex items-center gap-1.5 px-2 py-1 rounded-full text-[13px] font-medium transition-colors duration-300 window-no-drag",
            isDarkBackground
              ? "bg-black/40 backdrop-blur-xl hover:bg-black/50 text-white"
              : "bg-transparent hover:bg-black/10 text-foreground"
          )}
        >
          <span className={cn("h-2 w-2 rounded-full shrink-0", unmapped ? "bg-amber-500" : "bg-green-500")} />
          Local Mode
        </button>
      </PopoverTrigger>
      <PopoverContent align="end" sideOffset={8} className="w-[280px] p-0 window-no-drag"
        onPointerDownOutside={(e) => {
          // Radix closes on pointerdown, which on touch fires before the tap
          // that opened it has finished — without this the popover flickers shut.
          if (Date.now() - openTimeRef.current < 300) e.preventDefault();
        }}
      >
        <div className="p-3 space-y-3">
          <div className="flex items-center justify-between">
            <span className="text-xs font-semibold">Local Mode</span>
            <span className="flex items-center gap-1.5 text-[11px] font-medium px-1.5 py-0.5 rounded-full bg-green-500/10 text-green-600">
              <span className="h-1.5 w-1.5 rounded-full bg-green-500" />
              Active
            </span>
          </div>

          <div className="border-t" />

          <p className="text-xs text-muted-foreground">
            This {deviceWord} is talking to your Apple Home directly.
            {reason ? ` ${REASON_TEXT[reason]}` : ''}
          </p>

          <div className="space-y-1.5">
            {WORKS.map((w) => (
              <div key={w} className="flex items-center gap-1.5 text-[11px]">
                <Check className="h-3 w-3 text-green-600 shrink-0" />
                <span>{w}</span>
              </div>
            ))}
            {DOESNT.map((d) => (
              <div key={d} className="flex items-center gap-1.5 text-[11px] text-muted-foreground">
                <X className="h-3 w-3 shrink-0" />
                <span>{d}</span>
              </div>
            ))}
          </div>

          {/* Only worth saying when it is not the whole story. */}
          {identityState === 'partial' && (
            <p className="text-[11px] text-muted-foreground border-t pt-2">
              {matched} of {reported} accessories matched your Homecast layout. The rest
              show their Apple Home names.
            </p>
          )}
          {unmapped && (
            <p className="text-[11px] text-amber-600 border-t pt-2">
              Your custom names and layout will come back when this {deviceWord} is next online.
            </p>
          )}

          <p className="text-[11px] text-muted-foreground border-t pt-2">
            Automations keep running on your relay when it comes back.
            {isPhone ? ' This works while the app is open.' : ''}
          </p>

          {onOpenSettings && (
            <button
              onClick={() => { setIsOpen(false); onOpenSettings(); }}
              className="w-full text-[11px] text-primary hover:underline text-left"
            >
              Local Mode settings
            </button>
          )}
        </div>
      </PopoverContent>
    </Popover>
  );
}
