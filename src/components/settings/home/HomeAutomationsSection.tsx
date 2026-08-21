import { useMemo } from 'react';
import { useQuery } from '@apollo/client/react';
import { Switch } from '@/components/ui/switch';
import { toast } from 'sonner';
import { useHomeLayout } from '@/hooks/useEntityLayout';
import type { HomeLayoutData } from '@/hooks/useEntityLayout';
import type { HomeKitAutomation, GetAutomationsResponse } from '@/lib/graphql/types';
import type { Automation } from '@/automation/types/automation';
import { GET_AUTOMATIONS, HC_AUTOMATIONS } from '@/lib/graphql/queries';
import {
  automationCardKey,
  isAutomationVisible,
  withAutomationVisibility,
} from '@/lib/automation-cards';
import { isSummarySectionVisible } from '@/lib/summary-sections';
import { describeError } from '@/lib/describe-error';

interface HcEntity { entityId: string; dataJson: string }

/**
 * Which automations this home shows.
 *
 * The dashboard can hide one from its card, but only inside Edit Layout — which
 * is a touch-only mode. So without this page an automation hidden on a phone
 * could never be brought back on a desktop, and a hidden card has nothing to
 * right-click either way. Exactly the hole `HomeActionsSection` fills for
 * scenes, for exactly the same reason.
 *
 * Hiding is a home-screen choice only: the automation keeps running, and stays
 * in Apple Home or the Homecast engine as it was. Both engines are listed here
 * because they share one grid on the dashboard.
 *
 * Stored as a *hidden* list in the home layout blob, so a home that predates the
 * feature shows everything with no migration. Writes are optimistic —
 * `useHomeLayout` writes the Apollo cache before it mutates — so a flip lands on
 * the dashboard behind the dialog in the same tick. Don't add a refetch.
 */
export function HomeAutomationsSection({ home }: { home: { id: string; name: string } }) {
  const { layout, updateLayout, loading } = useHomeLayout(home.id);

  const { data } = useQuery<GetAutomationsResponse>(GET_AUTOMATIONS, {
    variables: { homeId: home.id },
    skip: !home.id,
    fetchPolicy: 'cache-first',
    errorPolicy: 'ignore',
  });
  const { data: hcData } = useQuery<{ hcAutomations: HcEntity[] }>(HC_AUTOMATIONS, {
    variables: { homeId: home.id },
    skip: !home.id,
    fetchPolicy: 'cache-first',
    errorPolicy: 'all',
  });

  // Older relays answer this sentinel instead of a list; the dashboard drops it
  // the same way rather than rendering a row for an error.
  const hkAutomations = useMemo(
    () => (data?.automations ?? []).filter((a: HomeKitAutomation) => a.id !== '__relay_update_required__'),
    [data],
  );

  const hcAutomations = useMemo(() => (hcData?.hcAutomations ?? []).map((e) => {
    try {
      return JSON.parse(e.dataJson) as Automation;
    } catch {
      return { id: e.entityId, name: 'Unnamed', enabled: true } as Automation;
    }
  }), [hcData]);

  type Visibility = HomeLayoutData['visibility'];
  const save = (mutate: (visibility: Visibility) => Visibility) =>
    updateLayout(prev => ({ ...prev, visibility: mutate(prev?.visibility) }))
      .catch(e => toast.error('Could not save', { description: describeError(e) }));

  const set = (key: string, visible: boolean) =>
    save(v => ({ ...v, hiddenAutomations: withAutomationVisibility(v?.hiddenAutomations, key, visible) }));

  const hidden = layout?.visibility?.hiddenAutomations;
  const sectionShown = isSummarySectionVisible(layout, 'automations');

  const toggleRow = (key: string, label: string) => (
    <div key={key} className="flex items-center justify-between gap-3 py-1">
      <p className="min-w-0 truncate text-sm">{label}</p>
      <Switch
        checked={isAutomationVisible(hidden, key)}
        disabled={loading}
        onCheckedChange={(checked) => set(key, checked)}
      />
    </div>
  );

  const empty = hkAutomations.length === 0 && hcAutomations.length === 0;

  return (
    <div className="space-y-5">
      <div className="space-y-2">
        <p className="text-xs text-muted-foreground">
          Turning one off here only hides its card on the home screen — the automation keeps running.
        </p>

        {!sectionShown && (
          <p className="rounded-lg border bg-muted/30 p-3 text-xs text-muted-foreground">
            Automations are turned off for this home, so none of these appear on the home screen.
            Turn them back on under Home Screen.
          </p>
        )}

        {empty ? (
          <p className="py-2 text-xs text-muted-foreground">
            No automations yet. Create one from the Automations section on the home screen.
          </p>
        ) : (
          <>
            {hkAutomations.map((a: HomeKitAutomation) => toggleRow(automationCardKey('hk', a.id), a.name))}
            {hcAutomations.map((a: Automation) => toggleRow(automationCardKey('hc', a.id), a.name || 'Unnamed automation'))}
          </>
        )}
      </div>
    </div>
  );
}
