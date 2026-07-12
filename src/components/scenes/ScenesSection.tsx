import { useState } from 'react';
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
import { GET_SCENES } from '@/lib/graphql/queries';
import { EXECUTE_SCENE, DELETE_SCENE } from '@/lib/graphql/mutations';
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
export function ScenesPill({ homeId, open, onToggle, isDarkBackground }: {
  homeId: string;
  open: boolean;
  onToggle: () => void;
  isDarkBackground?: boolean;
}) {
  const { data } = useQuery<{ scenes: HomeKitScene[] }>(GET_SCENES, {
    variables: { homeId },
    skip: !homeId,
    fetchPolicy: 'cache-first',
    errorPolicy: 'ignore',
  });
  const count = data?.scenes?.length ?? 0;
  if (count === 0) return null;

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
      <Zap className="h-3 w-3" />
      <span>Scenes {count}</span>
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

  const { data, refetch } = useQuery<{ scenes: HomeKitScene[] }>(GET_SCENES, {
    variables: { homeId },
    skip: !homeId,
    fetchPolicy: 'cache-first',
    errorPolicy: 'ignore',
  });
  const [executeScene] = useMutation(EXECUTE_SCENE);
  const [deleteScene] = useMutation(DELETE_SCENE);

  const scenes = data?.scenes ?? [];

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
        toast.error('Could not delete scene', { description: message });
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
          <div className={
            compact
              ? 'grid items-start gap-2 grid-cols-[repeat(auto-fill,minmax(180px,1fr))]'
              : 'grid items-start gap-3 grid-cols-[repeat(auto-fill,minmax(240px,1fr))]'
          }>
            {scenes.map(scene => (
              <div
                key={scene.id}
                role="button"
                tabIndex={0}
                onClick={() => { setEditingScene(scene); setFormOpen(true); }}
                onKeyDown={(e) => { if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); setEditingScene(scene); setFormOpen(true); } }}
                className={`flex items-center gap-2 rounded-xl border p-3 cursor-pointer transition-colors ${isDarkBackground ? 'border-white/15 bg-white/5 hover:bg-white/10' : 'bg-card hover:bg-muted/40'}`}
              >
                <div className={`flex h-8 w-8 shrink-0 items-center justify-center rounded-full shadow-sm ${sceneColors.bg} ${sceneColors.text}`}>
                  <Zap className="h-4 w-4" />
                </div>
                <div className="min-w-0 flex-1">
                  <p className={`text-sm font-medium break-words line-clamp-2 ${isDarkBackground ? 'text-white' : ''}`}>{scene.name}</p>
                  <p className={`text-[11px] ${isDarkBackground ? 'text-white/40' : 'text-muted-foreground/60'}`}>
                    {scene.automationName
                      ? `Used by automation "${scene.automationName}"`
                      : `${scene.actionCount} action${scene.actionCount === 1 ? '' : 's'}`}
                  </p>
                </div>
                <button
                  onClick={(e) => { e.stopPropagation(); handleRun(scene); }}
                  disabled={runningId === scene.id}
                  title="Run scene"
                  className={`shrink-0 rounded-lg p-1.5 transition-colors ${isDarkBackground ? 'hover:bg-white/10 text-white/70' : 'hover:bg-muted text-muted-foreground'}`}
                >
                  {runningId === scene.id ? <Loader2 className="h-4 w-4 animate-spin" /> : <Play className="h-4 w-4" />}
                </button>
              </div>
            ))}
            <button
              onClick={() => { setEditingScene(null); setFormOpen(true); }}
              className={`flex items-center justify-center gap-1.5 rounded-xl border border-dashed p-3 text-xs font-medium transition-colors ${isDarkBackground ? 'border-white/20 text-white/50 hover:text-white hover:bg-white/5' : 'text-muted-foreground/60 hover:text-foreground hover:bg-muted/40'}`}
            >
              <Plus className="h-3.5 w-3.5" /> New scene
            </button>
          </div>
        </div>
      </AnimatedCollapse>

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
