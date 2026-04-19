import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogDescription } from '@/components/ui/dialog';

type Home = {
  id: string;
  name: string;
  role?: string;
  mqttEnabled?: boolean;
  relayConnected?: boolean;
  ownerEmail?: string | null;
};

export function HomeInfoDialog({ open, onOpenChange, home, slug, topicCount, roomCount }: {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  home: Home | null;
  slug: string | null;
  topicCount: number;
  roomCount: number;
}) {
  if (!home) return null;
  const relay = home.relayConnected === undefined
    ? 'unknown'
    : home.relayConnected ? 'online' : 'offline';
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
            <span className={relay === 'online' ? 'text-green-600 dark:text-green-400' : 'text-muted-foreground'}>{relay}</span>
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
