import { useEffect, useRef, useState } from 'react';
import { Wifi, Globe, Router } from 'lucide-react';
import { cn } from '@/lib/utils';
import { describeRoute, type RelayRoute } from '@/lib/relay-probe';

/**
 * Says so, briefly, when the app changes which address it reaches the relay on.
 *
 * The switch itself is silent and in-place — nothing reloads. But it is not
 * *nothing*: the user has walked out of the house and is now going over a mesh
 * VPN rather than the LAN, which is worth one line and worth being able to
 * explain later when something feels slower. It shows for a few seconds and
 * removes itself.
 */

const COPY: Record<RelayRoute, { icon: typeof Wifi; label: string }> = {
  lan: { icon: Wifi, label: 'Connected on your local network' },
  mesh: { icon: Router, label: 'Connected over your VPN' },
  remote: { icon: Globe, label: 'Connected remotely' },
};

export function RelayRouteBanner() {
  const [route, setRoute] = useState<RelayRoute | null>(null);
  const timer = useRef<ReturnType<typeof setTimeout> | null>(null);

  useEffect(() => {
    const onChange = (e: Event) => {
      const origin = (e as CustomEvent<{ origin: string }>).detail?.origin;
      if (!origin) return;
      setRoute(describeRoute(origin));
      if (timer.current) clearTimeout(timer.current);
      timer.current = setTimeout(() => setRoute(null), 5000);
    };
    window.addEventListener('homecast:relay-address-changed', onChange);
    return () => {
      window.removeEventListener('homecast:relay-address-changed', onChange);
      if (timer.current) clearTimeout(timer.current);
    };
  }, []);

  if (!route) return null;
  const { icon: Icon, label } = COPY[route];

  return (
    <div
      role="status"
      aria-live="polite"
      className={cn(
        'fixed left-1/2 z-50 -translate-x-1/2',
        // Below the notch, and below the header the dashboard already draws.
        'top-[calc(env(safe-area-inset-top)+0.75rem)]',
        'flex items-center gap-2 rounded-full px-3 py-1.5',
        'bg-black/70 text-white backdrop-blur-xl shadow-lg',
        'text-xs font-medium',
        'animate-in fade-in slide-in-from-top-2 duration-300',
      )}
    >
      <Icon className="h-3.5 w-3.5 shrink-0" />
      {label}
    </div>
  );
}
