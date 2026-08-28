import { useMemo } from 'react';
import { Switch } from '@/components/ui/switch';
import { BellOff } from 'lucide-react';
import { useQuery } from '@apollo/client/react';
import { HC_AUTOMATIONS } from '@/lib/graphql/queries';
import { isCommunity } from '@/lib/config';
import { useNotificationMutes } from '@/hooks/useNotificationMutes';
import { automationContainsActionType } from '@/automation/utils/actionWalker';
import type { Automation } from '@/automation/types/automation';

/**
 * This home's notification mutes, for the device the screen is open on.
 *
 * These switches used to live on the top-level Notifications page, which
 * listed every home inline — so a home's settings were split across two
 * unrelated places, and the list ran one automations query per home whether or
 * not you cared about any of them. Here it is one home, queried when you open
 * it.
 *
 * Mutes are per-device (a `NotificationMute` row means muted, absence means
 * on); the device-wide switch stays on the top-level page, because it isn't
 * about any one home.
 */
export function HomeNotificationsSection({ home }: { home: { id: string; name: string } }) {
  const { deviceMuted, isSaving, setMute, isMuted } = useNotificationMutes();

  const { data: hcData } = useQuery(HC_AUTOMATIONS, {
    variables: { homeId: home.id },
    skip: isCommunity,
    fetchPolicy: 'cache-first',
    errorPolicy: 'all',
  });

  // Automations that can actually notify — detected by walking each
  // automation's action tree for a Notify action.
  const notifyAutomations = useMemo(() => {
    const entities = (hcData as { hcAutomations?: { entityId: string; dataJson: string }[] } | undefined)?.hcAutomations ?? [];
    const automations: Automation[] = [];
    for (const e of entities) {
      try {
        const automation = JSON.parse(e.dataJson) as Automation;
        if (automationContainsActionType(automation, 'notify')) {
          automations.push(automation);
        }
      } catch {
        // Unparseable definitions can't be shown; they also can't notify meaningfully.
      }
    }
    return automations.sort((a, b) => (a.name || '').localeCompare(b.name || ''));
  }, [hcData]);

  if (isCommunity) {
    return (
      <div className="text-sm text-muted-foreground p-4">
        Push notifications are available in Homecast Cloud.
      </div>
    );
  }

  const homeMuted = isMuted('home', home.id);

  return (
    <div className="space-y-3">
      <p className="text-[10px] font-semibold uppercase tracking-wider text-muted-foreground">Notifications</p>
      {/* Every row below is a name and a switch, which is also what the
          Automations page looks like — where the switch does something else.
          So this line has to say what these ones silence, and what they leave
          alone; "turn off individual automations" was read as turning the
          automation off, which is the one thing it does not do. */}
      <p className="text-xs text-muted-foreground">
        Applies to this device only. Turning one off silences its notifications — the automation
        keeps running.
      </p>

      {/* The device-wide switch lives on a different screen now, so say why
          everything here is inert rather than leaving it a mystery. */}
      {deviceMuted && (
        <div className="flex items-start gap-2 rounded-lg border bg-muted/30 p-3 text-xs text-muted-foreground">
          <BellOff className="h-4 w-4 shrink-0 mt-0.5" />
          <span>
            Notifications are turned off for this device entirely, so nothing here is delivered.
            Turn them back on under Settings → Notifications.
          </span>
        </div>
      )}

      <div className="flex items-center justify-between gap-3">
        <p className="min-w-0 break-words text-sm">{home.name}</p>
        <Switch
          checked={!homeMuted}
          onCheckedChange={(on) => setMute('home', home.id, !on)}
          disabled={isSaving || deviceMuted}
          className="shrink-0"
        />
      </div>

      {notifyAutomations.length > 0 ? (
        <div className="ml-6 space-y-2 border-l pl-3">
          {notifyAutomations.map((automation) => (
            <div key={automation.id} className="flex items-center justify-between gap-3">
              <p className="min-w-0 break-words text-sm text-muted-foreground">{automation.name || 'Unnamed automation'}</p>
              <Switch
                checked={!isMuted('automation', automation.id)}
                onCheckedChange={(on) => setMute('automation', automation.id, !on)}
                disabled={isSaving || deviceMuted || homeMuted}
                className="shrink-0"
              />
            </div>
          ))}
        </div>
      ) : (
        <p className="text-xs text-muted-foreground">
          No automations in this home send notifications yet.
        </p>
      )}
    </div>
  );
}
