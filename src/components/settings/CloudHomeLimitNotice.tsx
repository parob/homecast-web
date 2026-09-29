import { Info, Mail } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { homeLimitTitle } from '@/lib/relay-picker';

const CONTACT_EMAIL = 'rob@homecast.cloud';

/**
 * What the add-home dialog says to a customer already at their cloud-home
 * limit. The button stays put so they learn why here, rather than finding it
 * missing with no reason given.
 */
export function CloudHomeLimitNotice({ limit, homeNames, onClose }: {
  limit: number;
  homeNames: string[];
  onClose: () => void;
}) {
  const mailto = `mailto:${CONTACT_EMAIL}?subject=${encodeURIComponent('Another home on a cloud relay')}`;
  const openMail = (e: React.MouseEvent) => {
    const w = window as any;
    if (w.webkit?.messageHandlers?.homecast) {
      e.preventDefault();
      w.webkit.messageHandlers.homecast.postMessage({ action: 'openUrl', url: mailto });
    }
  };

  return (
    <div className="space-y-4 py-2">
      <div className="rounded-lg border border-amber-500/30 bg-amber-500/5 p-4 space-y-3">
        <p className="flex items-center gap-2 text-sm font-medium">
          <Info className="h-4 w-4 text-amber-600 dark:text-amber-400 shrink-0" />
          {homeLimitTitle(limit)}
        </p>
        <p className="text-xs text-muted-foreground">
          A cloud relay is a Mac we run for you. Each one joins Apple Home with its own Apple ID,
          and Apple lets an Apple ID be part of at most 10 homes — so space on our relays is
          limited while we add more.
        </p>
        <p className="text-xs text-muted-foreground">
          So that everyone who signs up gets a place, each Cloud plan includes{' '}
          {limit === 1 ? 'one home' : `${limit} homes`} for now.
          {homeNames.length === 1 && <> You already have <strong className="text-foreground">{homeNames[0]}</strong> on a cloud relay.</>}
          {homeNames.length > 1 && <> You already have {homeNames.length} homes on cloud relays.</>}
        </p>
        <p className="text-xs text-muted-foreground">
          Need another home? Email us and we'll add it to your account as soon as there's room.
        </p>
      </div>
      <div className="flex gap-2 justify-end">
        <Button variant="outline" size="sm" onClick={onClose}>Close</Button>
        <Button size="sm" asChild>
          <a href={mailto} onClick={openMail}>
            <Mail className="h-3.5 w-3.5 mr-1.5" /> Email us
          </a>
        </Button>
      </div>
    </div>
  );
}
