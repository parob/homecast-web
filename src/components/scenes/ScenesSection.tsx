import { Fragment, useState } from 'react';
import { useQuery, useMutation } from '@apollo/client/react';
import { AnimatedCollapse } from '@/components/ui/animated-collapse';
import { ChevronRight, Loader2, Play, Plus, Zap } from 'lucide-react';
import { toast } from 'sonner';
import { cn } from '@/lib/utils';
import {
  AlertDialog, AlertDialogAction, AlertDialogCancel, AlertDialogContent,
  AlertDialogDescription, AlertDialogFooter, AlertDialogHeader, AlertDialogTitle,
} from '@/components/ui/alert-dialog';
import { getIconColor } from '@/components/widgets/iconColors';
import { isBuiltInScene, isHiddenBuiltInScene } from '@/lib/scenes';
import { GET_SCENES } from '@/lib/graphql/queries';
import { EXECUTE_SCENE, DELETE_SCENE } from '@/lib/graphql/mutations';
import { TileEditActions } from '@/components/shared/EditActions';
import { useLayoutEdit } from '@/contexts/LayoutEditContext';
import { ViewOnlyHomeDialog } from '@/components/shared/ViewOnlyHomeDialog';
import { useRelayCannotEdit } from '@/hooks/useRelayCannotEdit';
import { translateHomeKitError } from '@/lib/homekit-errors';
import { SceneFormDialog } from './SceneFormDialog';
import type { HomeKitScene } from '@/lib/graphql/types';

interface ScenesSectionProps {
  homeId: string;
  compact?: boolean;
  isDarkBackground?: boolean;
  /** Controlled expansion (pill in the summary row drives it). */
  open: boolean;
}

/**
 * Compact bubble button for the sensor-summary row. Toggles the
 * ScenesSection content rendered elsewhere on the page.
 */
export function ScenesPill({ homeId, open, onToggle, isDarkBackground, hideAccessoryCounts }: {
  homeId: string;
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
  const count = (data?.scenes ?? []).filter(s => !isHiddenBuiltInScene(s)).length;
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

const sceneColors = getIconColor('scene');

export function ScenesSection({ homeId, compact, isDarkBackground, open }: ScenesSectionProps) {
  const [runningId, setRunningId] = useState<string | null>(null);
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
  const { editMode } = useLayoutEdit();
  const [executeScene] = useMutation(EXECUTE_SCENE);
  const [deleteScene] = useMutation(DELETE_SCENE);

  // Filter here too — older relays list unconfigured built-ins
  const scenes = (data?.scenes ?? []).filter(s => !isHiddenBuiltInScene(s));

  const handleRun = async (scene: HomeKitScene) => {
    setRunningId(scene.id);
    try {
      await executeScene({ variables: { sceneId: scene.id, homeId } });
      toast.success(`Ran "${scene.name}"`);
    } catch (e: any) {
      toast.error('Scene failed', { description: String(e?.message ?? e) });
    } finally {
      setRunningId(null);
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

  return (
    <>
      <AnimatedCollapse open={open}>
        <div className={compact ? 'mb-3' : 'mb-6'}>
          {scenes.length === 0 && (
            <p className={`text-xs mb-2 ${isDarkBackground ? 'text-white/40' : 'text-muted-foreground/50'}`}>
              No scenes yet. A scene sets several accessories at once — create one to get started.
            </p>
          )}
          <div className={
            compact
              ? 'grid items-start gap-2 grid-cols-[repeat(auto-fill,minmax(min(180px,calc(50%-4px)),1fr))]'
              : 'grid items-start gap-3 grid-cols-[repeat(auto-fill,minmax(240px,1fr))]'
          }>
            {scenes.map(scene => {
              const tile = (
              <div
                role="button"
                tabIndex={0}
                onClick={editMode ? undefined : () => { setEditingScene(scene); setFormOpen(true); }}
                onKeyDown={(e) => { if (!editMode && (e.key === 'Enter' || e.key === ' ')) { e.preventDefault(); setEditingScene(scene); setFormOpen(true); } }}
                className={`relative rounded-2xl h-fit ${editMode ? '' : 'cursor-pointer'} transition-all duration-300 ring-1 ring-inset ${isDarkBackground ? 'ring-transparent' : 'ring-slate-200'}`}
                style={{ contain: 'layout style paint' }}
              >
                {/* Blur layer — matches WidgetWrapper */}
                <div className={`absolute inset-0 rounded-2xl backdrop-blur-xl shadow-sm transition-colors duration-300 ${isDarkBackground ? 'bg-black/20' : 'bg-slate-100/80'} transform-gpu`} />
                <div className="relative z-[1] flex items-center gap-2 p-3">
                  <div className={`flex h-8 w-8 shrink-0 items-center justify-center rounded-full shadow-sm ${sceneColors.bg} ${sceneColors.text}`}>
                    <Zap className="h-4 w-4" />
                  </div>
                  <div className="min-w-0 flex-1">
                    <p className={`text-sm font-medium break-words line-clamp-2 transition-colors duration-300 ${isDarkBackground ? 'text-white' : ''}`}>{scene.name}</p>
                    <p className={`text-[11px] transition-colors duration-300 ${isDarkBackground ? 'text-white/60' : 'text-muted-foreground/60'}`}>
                      {scene.automationName
                        ? `Used by automation "${scene.automationName}"`
                        : isBuiltInScene(scene)
                          ? `Built-in · ${scene.actionCount} action${scene.actionCount === 1 ? '' : 's'}`
                          : `${scene.actionCount} action${scene.actionCount === 1 ? '' : 's'}`}
                    </p>
                  </div>
                  {!editMode && (
                  <button
                    onClick={(e) => { e.stopPropagation(); handleRun(scene); }}
                    disabled={runningId === scene.id}
                    title="Run scene"
                    className={`shrink-0 rounded-lg p-1.5 transition-colors ${isDarkBackground ? 'hover:bg-white/10 text-white/70' : 'hover:bg-muted text-muted-foreground'}`}
                  >
                    {runningId === scene.id ? <Loader2 className="h-4 w-4 animate-spin" /> : <Play className="h-4 w-4" />}
                  </button>
                  )}
                </div>
              </div>
              );
              // Pinning is an Edit Layout job now — see ActionsSection.
              if (!editMode) return <Fragment key={scene.id}>{tile}</Fragment>;
              return (
                <div key={scene.id} className="relative">
                  {tile}
                  <TileEditActions
                    action={null}
                    tab={{ type: 'scene', id: scene.id, name: scene.name, homeId: homeId ?? undefined }}
                  />
                </div>
              );
            })}
            {!editMode && <button
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
        </div>
      </AnimatedCollapse>

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
