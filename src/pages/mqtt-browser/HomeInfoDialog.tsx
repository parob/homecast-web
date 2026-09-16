import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogDescription } from '@/components/ui/dialog';
import { useHomeServing } from '@/hooks/useHomeServing';
import { homeRelayStatus } from './home-relay-status';
import { cn } from '@/lib/utils';

type Home = {
  id: string;
  name: string;
  role?: string;
  mqttEnabled?: boolean;
  relayConnected?: boolean;
  ownerEmail?: string | null;
};

export function HomeInfoDialog({ open, onOpenChange, home, slug, topicCount, roomCount, managed = false }: {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  home: Home | null;
  slug: string | null;
  topicCount: number;
  roomCount: number;
  managed?: boolean;
}) {
  const serving = useHomeServing(home?.id, 'cloud');
  if (!home) return null;
  const relay = homeRelayStatus(home.name, serving, managed);
  const mqtt = home.mqttEnabled ? 'enabled' : 'off';
  const role = home.role || 'owner';
  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-w-sm">
        <DialogHeader>
          <DialogTitle>{home.name}</DialogTitle>
          <DialogDescription className="font-mono text-xs">{slug ?? '—'}</DialogDescription>
        </DialogHeader>
        <dl className="grid grid-cols-[auto_1fr] gap-x-4 gap-y-1.5 text-xs">
          <dt className="text-muted-foreground">Role</dt>
          <dd>{role}{home.ownerEmail ? ` (shared by ${home.ownerEmail})` : ''}</dd>
          <dt className="text-muted-foreground">MQTT</dt>
          <dd>
            <span className={home.mqttEnabled ? 'text-green-600 dark:text-green-400' : 'text-muted-foreground'}>{mqtt}</span>
          </dd>
          <dt className="text-muted-foreground">Relay</dt>
          <dd>
            <span className="inline-flex items-center gap-1.5"><span className={cn('h-1.5 w-1.5 rounded-full', relay.dotClass, relay.pulse && 'animate-pulse')} />{relay.label}</span>
            {relay.explanation && <p className="text-muted-foreground mt-1">{relay.explanation}</p>}
          </dd>
          <dt className="text-muted-foreground">Topics</dt>
          <dd className="tabular-nums">{topicCount}</dd>
          <dt className="text-muted-foreground">Rooms</dt>
          <dd className="tabular-nums">{roomCount || '—'}</dd>
        </dl>
        {!home.mqttEnabled && (
          <p className="text-xs text-muted-foreground border-t pt-3">
            Enable in Settings → Homes → <span className="font-medium">{home.name}</span> → MQTT (requires Developer Mode).
          </p>
        )}
      </DialogContent>
    </Dialog>
  );
}
