import { useMemo } from 'react';
import { Switch } from '@/components/ui/switch';
import { toast } from 'sonner';
import { useHomeLayout } from '@/hooks/useEntityLayout';
import { useAccessories } from '@/hooks/useHomeKitData';
import { deriveHomeActions, HOME_ACTION_ORDER, HOME_ACTION_NAMES } from '@/components/actions/catalog';
import type { HomeLayoutData } from '@/hooks/useEntityLayout';
import {
  isSummarySectionVisible,
  isHomeActionVisible,
  withHomeActionVisibility,
  type HomeActionId,
} from '@/lib/summary-sections';
import { describeError } from '@/lib/describe-error';

/**
 * Which shortcuts sit inside this home's Scenes section.
 *
 * Actions are *derived* from the home's accessories, never authored, so there
 * is nothing to create or edit here — only the choice of which derived
 * shortcuts to show. Stored in the home's layout blob as a *hidden* list, so a
 * home that predates the feature shows everything with no migration.
 *
 * Writes are optimistic: `useHomeLayout` writes the Apollo cache before it
 * mutates, so a flip lands on the dashboard behind the dialog in the same tick.
 * Don't add a refetch.
 *
 * This page is always reachable, even when the shortcuts are switched off in
 * the Scenes section — a navigation row that disappears when you flip a switch
 * on a different page is worse than a page that explains why it is empty.
 */
export function HomeActionsSection({ home }: { home: { id: string; name: string } }) {
  const { layout, updateLayout, loading } = useHomeLayout(home.id);
  const { data: accessories } = useAccessories(home.id);

  // Offer a switch only for actions this home could actually show — there is
  // no point letting someone hide "Close all blinds" in a home with no blinds.
  const availableActions = useMemo(() => deriveHomeActions(accessories ?? []), [accessories]);

  type Visibility = HomeLayoutData['visibility'];
  const save = (mutate: (visibility: Visibility) => Visibility) =>
    updateLayout(prev => ({ ...prev, visibility: mutate(prev?.visibility) }))
      .catch(e => toast.error('Could not save', { description: describeError(e) }));

  const setAction = (id: HomeActionId, visible: boolean) =>
    save(v => ({ ...v, hiddenActions: withHomeActionVisibility(HOME_ACTION_ORDER, v?.hiddenActions, id, visible) }));

  const actionsShown = isSummarySectionVisible(layout, 'actions');

  return (
    <div className="space-y-2">
      <p className="text-[10px] font-semibold uppercase tracking-wider text-muted-foreground">Actions</p>
      <p className="text-xs text-muted-foreground">
        Shortcuts built from what this home contains. They can't be edited — turn off the ones you don't want.
      </p>

      {!actionsShown && (
        <p className="rounded-lg border bg-muted/30 p-3 text-xs text-muted-foreground">
          Shortcuts are turned off for this home, so none of these appear on the home screen.
          Turn them back on under Home Screen.
        </p>
      )}

      {availableActions.length === 0 ? (
        <p className="py-2 text-xs text-muted-foreground">
          No actions available — this home has no accessories an action could control.
        </p>
      ) : (
        availableActions.map(action => (
          <div key={action.id} className="flex items-center justify-between gap-3 py-1">
            <p className="min-w-0 text-sm">{HOME_ACTION_NAMES[action.id]}</p>
            <Switch
              checked={isHomeActionVisible(layout, action.id)}
              disabled={loading}
              onCheckedChange={(checked) => setAction(action.id, checked)}
            />
          </div>
        ))
      )}
    </div>
  );
}
