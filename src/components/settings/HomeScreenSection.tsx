import { useMemo } from 'react';
import { Switch } from '@/components/ui/switch';
import { toast } from 'sonner';
import { useHomeLayout } from '@/hooks/useEntityLayout';
import { useAccessories } from '@/hooks/useHomeKitData';
import { deriveHomeActions, HOME_ACTION_ORDER, HOME_ACTION_NAMES } from '@/components/actions/catalog';
import type { HomeLayoutData } from '@/hooks/useEntityLayout';
import {
  SUMMARY_SECTION_ORDER,
  SUMMARY_SECTION_META,
  isSummarySectionVisible,
  isHomeActionVisible,
  withSummarySectionVisibility,
  withHomeActionVisibility,
  type SummarySectionId,
  type HomeActionId,
} from '@/lib/summary-sections';
import { describeError } from '@/lib/describe-error';

/**
 * Per-home control over the summary row at the top of the home view — which
 * pills appear, and which Actions sit inside the Actions pill.
 *
 * Both sets are stored in the home's layout blob (the same `stored_entities`
 * row as its accessory layout) as *hidden* lists, so a home that predates this
 * setting shows everything with no migration.
 *
 * Unlike the MQTT and Analytics switches beside it, these are optimistic:
 * `useHomeLayout` writes the Apollo cache before it mutates, so a flip lands
 * on the dashboard behind the dialog in the same tick. Don't add a refetch.
 */
export function HomeScreenSection({ home }: { home: { id: string; name: string } }) {
  const { layout, updateLayout, loading } = useHomeLayout(home.id);
  const { data: accessories } = useAccessories(home.id);

  // Offer a switch only for actions this home could actually show — there is
  // no point letting someone hide "Close all blinds" in a home with no blinds.
  const availableActions = useMemo(() => deriveHomeActions(accessories ?? []), [accessories]);

  type Visibility = HomeLayoutData['visibility'];
  const save = (mutate: (visibility: Visibility) => Visibility) =>
    updateLayout(prev => ({ ...prev, visibility: mutate(prev?.visibility) }))
      .catch(e => toast.error('Could not save', { description: describeError(e) }));

  const setSection = (id: SummarySectionId, visible: boolean) =>
    save(v => ({ ...v, hiddenSummarySections: withSummarySectionVisibility(v?.hiddenSummarySections, id, visible) }));

  const setAction = (id: HomeActionId, visible: boolean) =>
    save(v => ({ ...v, hiddenActions: withHomeActionVisibility(HOME_ACTION_ORDER, v?.hiddenActions, id, visible) }));

  const actionsShown = isSummarySectionVisible(layout, 'actions');

  return (
    <div className="space-y-4">
      <div className="space-y-2">
        <p className="text-[10px] font-semibold uppercase tracking-wider text-muted-foreground">Home Screen</p>
        {SUMMARY_SECTION_ORDER.map(id => (
          <div key={id} className="flex items-center justify-between gap-3 py-1">
            <div className="min-w-0">
              <p className="text-sm font-medium">{SUMMARY_SECTION_META[id].label}</p>
              <p className="text-xs text-muted-foreground">{SUMMARY_SECTION_META[id].description}</p>
            </div>
            <Switch
              checked={isSummarySectionVisible(layout, id)}
              disabled={loading}
              onCheckedChange={(checked) => setSection(id, checked)}
            />
          </div>
        ))}
      </div>

      {actionsShown && availableActions.length > 0 && (
        <div className="space-y-2">
          <p className="text-[10px] font-semibold uppercase tracking-wider text-muted-foreground">Actions</p>
          <p className="text-xs text-muted-foreground">
            Shortcuts built from what this home contains. They can't be edited — turn off the ones you don't want.
          </p>
          {availableActions.map(action => (
            <div key={action.id} className="flex items-center justify-between gap-3 py-1">
              <p className="min-w-0 text-sm">{HOME_ACTION_NAMES[action.id]}</p>
              <Switch
                checked={isHomeActionVisible(layout, action.id)}
                disabled={loading}
                onCheckedChange={(checked) => setAction(action.id, checked)}
              />
            </div>
          ))}
        </div>
      )}
    </div>
  );
}
