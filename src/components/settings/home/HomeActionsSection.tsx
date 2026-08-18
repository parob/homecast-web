import { useMemo } from 'react';
import { useQuery } from '@apollo/client/react';
import { Switch } from '@/components/ui/switch';
import { toast } from 'sonner';
import { useHomeLayout } from '@/hooks/useEntityLayout';
import { useAccessories } from '@/hooks/useHomeKitData';
import { deriveHomeActions, HOME_ACTION_ORDER, HOME_ACTION_NAMES } from '@/components/actions/catalog';
import type { HomeLayoutData } from '@/hooks/useEntityLayout';
import type { HomeKitScene } from '@/lib/graphql/types';
import { GET_SCENES } from '@/lib/graphql/queries';
import { isHiddenBuiltInScene } from '@/lib/scenes';
import {
  isSummarySectionVisible,
  isHomeActionVisible,
  isSceneVisible,
  withHomeActionVisibility,
  withSceneVisibility,
  type HomeActionId,
} from '@/lib/summary-sections';
import { describeError } from '@/lib/describe-error';

/**
 * Which scenes this home shows, of both kinds.
 *
 * Homecast scenes are *derived* from the home's accessories, never authored, so
 * there is nothing to create or edit here — only the choice of which to show.
 * Apple Home's own scenes are authored, and editable from the dashboard, but
 * they are listed here for the one thing the dashboard cannot do: bring back a
 * scene that is hidden, which by definition has no card to right-click.
 *
 * Both are stored in the home's layout blob as *hidden* lists, so a home that
 * predates either feature shows everything with no migration.
 *
 * Writes are optimistic: `useHomeLayout` writes the Apollo cache before it
 * mutates, so a flip lands on the dashboard behind the dialog in the same tick.
 * Don't add a refetch.
 *
 * This page is always reachable, even when a half is switched off in the Scenes
 * section — a navigation row that disappears when you flip a switch on a
 * different page is worse than a page that explains why it is empty.
 */
export function HomeActionsSection({ home }: { home: { id: string; name: string } }) {
  const { layout, updateLayout, loading } = useHomeLayout(home.id);
  const { data: accessories } = useAccessories(home.id);
  const { data: sceneData } = useQuery<{ scenes: HomeKitScene[] }>(GET_SCENES, {
    variables: { homeId: home.id },
    skip: !home.id,
    fetchPolicy: 'cache-first',
    errorPolicy: 'ignore',
  });

  // Offer a switch only for scenes this home could actually show — there is
  // no point letting someone hide "Close all blinds" in a home with no blinds.
  const availableActions = useMemo(() => deriveHomeActions(accessories ?? []), [accessories]);
  // Same filter the dashboard applies: older relays list unconfigured built-ins.
  const scenes = useMemo(
    () => (sceneData?.scenes ?? []).filter(s => !isHiddenBuiltInScene(s)),
    [sceneData],
  );

  type Visibility = HomeLayoutData['visibility'];
  const save = (mutate: (visibility: Visibility) => Visibility) =>
    updateLayout(prev => ({ ...prev, visibility: mutate(prev?.visibility) }))
      .catch(e => toast.error('Could not save', { description: describeError(e) }));

  const setAction = (id: HomeActionId, visible: boolean) =>
    save(v => ({ ...v, hiddenActions: withHomeActionVisibility(HOME_ACTION_ORDER, v?.hiddenActions, id, visible) }));

  const setScene = (id: string, visible: boolean) =>
    save(v => ({ ...v, hiddenScenes: withSceneVisibility(v?.hiddenScenes, id, visible) }));

  const actionsShown = isSummarySectionVisible(layout, 'actions');
  const scenesShown = isSummarySectionVisible(layout, 'scenes');

  const offNotice = (what: string) => (
    <p className="rounded-lg border bg-muted/30 p-3 text-xs text-muted-foreground">
      {what} are turned off for this home, so none of these appear on the home screen.
      Turn them back on under Home Screen.
    </p>
  );

  const toggleRow = (key: string, label: string, checked: boolean, onChange: (v: boolean) => void) => (
    <div key={key} className="flex items-center justify-between gap-3 py-1">
      <p className="min-w-0 truncate text-sm">{label}</p>
      <Switch checked={checked} disabled={loading} onCheckedChange={onChange} />
    </div>
  );

  return (
    <div className="space-y-5">
      <div className="space-y-2">
        <p className="text-[10px] font-semibold uppercase tracking-wider text-muted-foreground">Homecast scenes</p>
        <p className="text-xs text-muted-foreground">
          Built for you from what this home contains. They can't be edited — turn off the ones you don't want.
        </p>

        {!actionsShown && offNotice('Homecast scenes')}

        {availableActions.length === 0 ? (
          <p className="py-2 text-xs text-muted-foreground">
            None available — this home has no accessories a Homecast scene could control.
          </p>
        ) : (
          availableActions.map(action =>
            toggleRow(action.id, HOME_ACTION_NAMES[action.id], isHomeActionVisible(layout, action.id),
              (checked) => setAction(action.id, checked)))
        )}
      </div>

      <div className="space-y-2">
        <p className="text-[10px] font-semibold uppercase tracking-wider text-muted-foreground">Apple Home scenes</p>
        <p className="text-xs text-muted-foreground">
          Scenes set up in Apple Home. Turning one off here only hides it — it stays in Apple Home.
        </p>

        {!scenesShown && offNotice('Apple Home scenes')}

        {scenes.length === 0 ? (
          <p className="py-2 text-xs text-muted-foreground">
            No scenes yet. Create one from the Scenes section on the home screen.
          </p>
        ) : (
          scenes.map(scene =>
            toggleRow(scene.id, scene.name, isSceneVisible(layout, scene.id),
              (checked) => setScene(scene.id, checked)))
        )}
      </div>
    </div>
  );
}
