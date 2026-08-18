import { useMemo, useState } from 'react';
import { useQuery, useMutation } from '@apollo/client/react';
import { AnimatedCollapse } from '@/components/ui/animated-collapse';
import { ChevronRight, Loader2, Plus } from 'lucide-react';
import { toast } from 'sonner';
import { cn } from '@/lib/utils';
import {
  AlertDialog, AlertDialogAction, AlertDialogCancel, AlertDialogContent,
  AlertDialogDescription, AlertDialogFooter, AlertDialogHeader, AlertDialogTitle,
} from '@/components/ui/alert-dialog';
import { isBuiltInScene, isHiddenBuiltInScene } from '@/lib/scenes';
import { GET_SCENES } from '@/lib/graphql/queries';
import { EXECUTE_SCENE, DELETE_SCENE } from '@/lib/graphql/mutations';
import { useLayoutEdit } from '@/contexts/LayoutEditContext';
import { ViewOnlyHomeDialog } from '@/components/shared/ViewOnlyHomeDialog';
import { useRelayCannotEdit } from '@/hooks/useRelayCannotEdit';
import { translateHomeKitError } from '@/lib/homekit-errors';
import { DraggableGrid } from '@/components/shared/DraggableGrid';
import { SortableItem } from '@/components/shared/SortableItem';
import { DragHandleArea } from '@/components/shared/DragHandleArea';
import {
  isSummarySectionVisible, isHomeActionVisible, type HomeActionId,
} from '@/lib/summary-sections';
import { homeCardKey, applyHomeCardOrder } from '@/lib/home-cards';
import { deriveHomeActions, type HomeAction } from '@/components/actions/catalog';
import { ActionCard } from '@/components/actions/ActionCard';
import { ActionConfirmDialog } from '@/components/actions/ActionConfirmDialog';
import { useHomeActionRunner } from '@/components/actions/useHomeActionRunner';
import type { RunHomeActionOverrides } from '@/components/actions/useRunHomeAction';
import type { HomeLayoutData } from '@/hooks/useEntityLayout';
import type { HomeKitAccessory } from '@/native/homekit-bridge';
import { SceneFormDialog } from './SceneFormDialog';
import { SceneCard } from './SceneCard';
import type { HomeKitScene } from '@/lib/graphql/types';

/**
 * Scenes — one section holding two kinds of card.
 *
 * Shortcuts (derived from the home's accessories) and Apple Home scenes both
 * mean "run something in this home", so they share a pill, a grid and an
 * ordering. Each half has its own visibility switch; the section only
 * disappears when both are off.
 */

/** Scenes worth showing: older relays list unconfigured built-ins. */
function visibleScenes(scenes: HomeKitScene[] | undefined, layout: HomeLayoutData | null | undefined) {
  if (!isSummarySectionVisible(layout, 'scenes')) return [];
  return (scenes ?? []).filter(s => !isHiddenBuiltInScene(s));
}

function visibleActions(accessories: HomeKitAccessory[], layout: HomeLayoutData | null | undefined) {
  if (!isSummarySectionVisible(layout, 'actions')) return [];
  return deriveHomeActions(accessories).filter(a => isHomeActionVisible(layout, a.id));
}

type Card =
  | { kind: 'action'; id: string; action: HomeAction }
  | { kind: 'scene'; id: string; scene: HomeKitScene };

const cardKey = (c: Card) => homeCardKey(c.kind, c.id);

/**
 * The cards, in the user's order.
 *
 * Shortcuts lead before anything has been dragged: they are the same in every
 * home and the ones people reach for without looking.
 */
function useOrderedCards(
  scenes: HomeKitScene[],
  actions: HomeAction[],
  order: string[] | undefined,
): Card[] {
  return useMemo(() => {
    const cards: Card[] = [
      ...actions.map(action => ({ kind: 'action' as const, id: action.id, action })),
      ...scenes.map(scene => ({ kind: 'scene' as const, id: scene.id, scene })),
    ];
    return applyHomeCardOrder(cards, order, cardKey);
  }, [scenes, actions, order]);
}

/**
 * Compact bubble button for the sensor-summary row. Toggles the
 * ScenesSection content rendered elsewhere on the page.
 */
export function ScenesPill({ homeId, accessories, homeLayout, open, onToggle, isDarkBackground, hideAccessoryCounts }: {
  homeId: string;
  accessories: HomeKitAccessory[];
  homeLayout: HomeLayoutData | null | undefined;
  open: boolean;
  onToggle: () => void;
  isDarkBackground?: boolean;
  /** The "Show counts" display setting, inverted. Same toggle the sidebar obeys. */
  hideAccessoryCounts?: boolean;
}) {
  const { data } = useQuery<{ scenes: HomeKitScene[] }>(GET_SCENES, {
    variables: { homeId },
    skip: !homeId,
    fetchPolicy: 'cache-first',
    errorPolicy: 'ignore',
  });
  // Always render for a real home — hiding at zero made the section (and the
  // "Create scene" button inside it) unreachable, so a home with no scenes had no
  // way to create its first one.
  const count = visibleScenes(data?.scenes, homeLayout).length
    + visibleActions(accessories, homeLayout).length;
  if (!homeId) return null;

  return (
    <button
      type="button"
      onClick={onToggle}
      className={cn(
        'inline-flex items-center gap-1.5 rounded-full px-2.5 py-1 text-xs font-medium transition-colors',
        isDarkBackground
          ? (open ? 'bg-white/25 text-white' : 'bg-black/25 text-white/90 hover:bg-black/35')
          : (open ? 'bg-primary/15 text-primary' : 'bg-muted text-muted-foreground hover:bg-muted/80'),
      )}
    >
      <span>Scenes{!hideAccessoryCounts && count > 0 ? ` ${count}` : ''}</span>
      <ChevronRight className={cn('h-3 w-3 transition-transform', open && 'rotate-90')} />
    </button>
  );
}

interface ScenesSectionProps {
  homeId: string;
  /** The whole home's accessories — shortcuts are home-wide, like their subtitles. */
  accessories: HomeKitAccessory[];
  homeLayout: HomeLayoutData | null | undefined;
  compact?: boolean;
  isDarkBackground?: boolean;
  /** Controlled expansion (pill in the summary row drives it). */
  open: boolean;
  isViewOnly?: boolean;
  /** Whether dragging is live here. Desktop always; touch only in Edit Layout. */
  dndEnabled?: boolean;
  onRunAction: (action: HomeAction, opts?: RunHomeActionOverrides) => Promise<void>;
  /**
   * Turn a shortcut off for this home. Writes the same per-home `hiddenActions`
   * list Settings writes, so hiding one here unticks it there. Absent where
   * there is nothing to write to (a shared home, a view-only member).
   */
  onHideAction?: (id: HomeActionId) => void;
  /** Persist the card arrangement. Absent where the layout can't be written. */
  onReorderCards?: (order: string[]) => void;
}

export function ScenesSection({
  homeId, accessories, homeLayout, compact, isDarkBackground, open, isViewOnly,
  dndEnabled = true, onRunAction, onHideAction, onReorderCards,
}: ScenesSectionProps) {
  const [runningSceneId, setRunningSceneId] = useState<string | null>(null);
  const [confirmDelete, setConfirmDelete] = useState<HomeKitScene | null>(null);
  const [deleting, setDeleting] = useState(false);
  const [formOpen, setFormOpen] = useState(false);
  const [editingScene, setEditingScene] = useState<HomeKitScene | null>(null);
  const [viewOnlyOpen, setViewOnlyOpen] = useState(false);

  // Creating a scene writes to the HomeKit database, so it needs edit access
  // the relay may not have. Checked up front — the form is long enough that
  // failing at Create meant losing every device and value the user had set.
  const relayCannotEdit = useRelayCannotEdit(homeId);

  const { data, refetch } = useQuery<{ scenes: HomeKitScene[] }>(GET_SCENES, {
    variables: { homeId },
    skip: !homeId,
    fetchPolicy: 'cache-first',
    errorPolicy: 'ignore',
  });
  const { editMode, touchMode } = useLayoutEdit();
  const [executeScene] = useMutation(EXECUTE_SCENE);
  const [deleteScene] = useMutation(DELETE_SCENE);

  const scenes = visibleScenes(data?.scenes, homeLayout);
  const actions = visibleActions(accessories, homeLayout);
  const cards = useOrderedCards(scenes, actions, homeLayout?.sceneCardOrder);

  const runner = useHomeActionRunner(onRunAction);

  const openEditor = (scene: HomeKitScene) => { setEditingScene(scene); setFormOpen(true); };

  const handleRun = async (scene: HomeKitScene) => {
    setRunningSceneId(scene.id);
    try {
      await executeScene({ variables: { sceneId: scene.id, homeId } });
      toast.success(`Ran "${scene.name}"`);
    } catch (e: any) {
      toast.error('Scene failed', { description: String(e?.message ?? e) });
    } finally {
      setRunningSceneId(null);
    }
  };

  const handleDelete = async () => {
    if (!confirmDelete) return;
    setDeleting(true);
    try {
      await deleteScene({ variables: { sceneId: confirmDelete.id, homeId } });
      toast.success(`Deleted "${confirmDelete.name}"`);
      setConfirmDelete(null);
      refetch();
    } catch (e: any) {
      const message = String(e?.message ?? e);
      if (/UNKNOWN_METHOD|Unknown method/i.test(message)) {
        toast.error('Relay update required', {
          description: 'Managing scenes needs a newer version of the Homecast relay app.',
        });
      } else {
        toast.error('Could not delete scene', { description: translateHomeKitError(e, 'scene') });
      }
      setConfirmDelete(null);
    } finally {
      setDeleting(false);
    }
  };

  const renderCard = (card: Card) => card.kind === 'action' ? (
    <ActionCard
      action={card.action}
      homeId={homeId}
      isDarkBackground={isDarkBackground}
      isViewOnly={isViewOnly}
      editMode={editMode}
      touchMode={touchMode}
      running={runner.runningId === card.action.id}
      progress={runner.runningId === card.action.id ? runner.progress : null}
      runningTextOf={runner.runningTextOf}
      onPress={runner.press}
      onRun={runner.run}
      onHideAction={onHideAction}
    />
  ) : (
    <SceneCard
      scene={card.scene}
      homeId={homeId}
      isDarkBackground={isDarkBackground}
      editMode={editMode}
      running={runningSceneId === card.scene.id}
      onRun={handleRun}
      onEdit={openEditor}
    />
  );

  const canShowScenes = isSummarySectionVisible(homeLayout, 'scenes');
  const itemIds = cards.map(cardKey);

  return (
    <>
      <AnimatedCollapse open={open}>
        <div className={compact ? 'mb-3' : 'mb-6'}>
          {cards.length === 0 && canShowScenes && (
            <p className={`text-xs mb-2 ${isDarkBackground ? 'text-white/40' : 'text-muted-foreground/50'}`}>
              No scenes yet. A scene sets several accessories at once — create one to get started.
            </p>
          )}
          <DraggableGrid
            itemIds={itemIds}
            onReorder={(order) => onReorderCards?.(order)}
            enabled={dndEnabled && !!onReorderCards}
            touchMode={touchMode}
            renderDragOverlay={(activeId) => {
              const card = cards.find(c => cardKey(c) === activeId);
              return card ? <div className="w-full opacity-90">{renderCard(card)}</div> : null;
            }}
          >
            <div className={
              compact
                ? 'grid items-start gap-2 grid-cols-2 sm:grid-cols-[repeat(auto-fill,minmax(180px,1fr))]'
                : 'grid items-start gap-3 grid-cols-[repeat(auto-fill,minmax(240px,1fr))]'
            }>
              {cards.map(card => (
                <SortableItem key={cardKey(card)} id={cardKey(card)} disabled={!dndEnabled || !onReorderCards}>
                  <DragHandleArea>{renderCard(card)}</DragHandleArea>
                </SortableItem>
              ))}
              {!editMode && canShowScenes && <button
                onClick={() => {
                  if (relayCannotEdit) { setViewOnlyOpen(true); return; }
                  setEditingScene(null);
                  setFormOpen(true);
                }}
                className={`flex items-center justify-center gap-1.5 rounded-2xl border-2 border-dashed p-3 text-xs font-medium transition-colors ${
                  isDarkBackground
                    ? 'border-white/15 text-white/40 hover:border-white/30 hover:text-white/60'
                    : 'border-muted-foreground/20 text-muted-foreground/50 hover:border-muted-foreground/40 hover:text-muted-foreground'
                }`}
              >
                <Plus className="h-3.5 w-3.5" /> Create scene
              </button>}
            </div>
          </DraggableGrid>
        </div>
      </AnimatedCollapse>

      <ActionConfirmDialog
        action={runner.confirming}
        onCancel={() => runner.setConfirming(null)}
        onConfirm={(action) => { runner.setConfirming(null); runner.run(action); }}
      />

      {viewOnlyOpen && (
        <ViewOnlyHomeDialog open onOpenChange={setViewOnlyOpen} homeId={homeId} subject="scene" />
      )}

      <SceneFormDialog
        open={formOpen}
        onOpenChange={setFormOpen}
        homeId={homeId}
        scene={editingScene}
        onSaved={() => refetch()}
        onDelete={() => { setFormOpen(false); setConfirmDelete(editingScene); }}
      />

      <AlertDialog open={!!confirmDelete} onOpenChange={(o) => !o && setConfirmDelete(null)}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>Delete "{confirmDelete?.name}"?</AlertDialogTitle>
            <AlertDialogDescription>
              This permanently removes the scene from Apple Home. It cannot be undone.
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel disabled={deleting}>Cancel</AlertDialogCancel>
            <AlertDialogAction onClick={(e) => { e.preventDefault(); handleDelete(); }} disabled={deleting} className="bg-destructive text-destructive-foreground hover:bg-destructive/90">
              {deleting ? <Loader2 className="h-4 w-4 animate-spin" /> : 'Delete'}
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </>
  );
}
