import { useState } from 'react';
import { useQuery, useMutation } from '@apollo/client/react';
import { AnimatedCollapse } from '@/components/ui/animated-collapse';
import { ChevronRight, Loader2, Play, Trash2, Zap } from 'lucide-react';
import { toast } from 'sonner';
import {
  AlertDialog, AlertDialogAction, AlertDialogCancel, AlertDialogContent,
  AlertDialogDescription, AlertDialogFooter, AlertDialogHeader, AlertDialogTitle,
} from '@/components/ui/alert-dialog';
import { GET_SCENES } from '@/lib/graphql/queries';
import { EXECUTE_SCENE, DELETE_SCENE } from '@/lib/graphql/mutations';
import type { HomeKitScene } from '@/lib/graphql/types';

interface ScenesSectionProps {
  homeId: string;
  compact?: boolean;
  isDarkBackground?: boolean;
  hideAccessoryCounts?: boolean;
}

export function ScenesSection({ homeId, compact, isDarkBackground, hideAccessoryCounts }: ScenesSectionProps) {
  const [expanded, setExpanded] = useState(false);
  const [runningId, setRunningId] = useState<string | null>(null);
  const [confirmDelete, setConfirmDelete] = useState<HomeKitScene | null>(null);
  const [deleting, setDeleting] = useState(false);

  const { data, loading, refetch } = useQuery<{ scenes: HomeKitScene[] }>(GET_SCENES, {
    variables: { homeId },
    skip: !homeId,
    fetchPolicy: 'cache-first',
    errorPolicy: 'ignore',
  });
  const [executeScene] = useMutation(EXECUTE_SCENE);
  const [deleteScene] = useMutation(DELETE_SCENE);

  const scenes = data?.scenes ?? [];
  const hidden = !loading && scenes.length === 0;

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
          description: 'Deleting scenes needs a newer version of the Homecast relay app.',
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
      <div className={`flex items-center gap-2 ${compact ? 'mb-1.5 mt-1' : 'mb-3 mt-2'} ${hidden ? 'hidden' : ''}`}>
        <button
          onClick={() => !loading && setExpanded(!expanded)}
          className={`flex items-center gap-1 text-sm font-semibold selectable text-left transition-opacity hover:opacity-100 ${isDarkBackground ? 'text-white/70 hover:text-white' : 'text-muted-foreground/70 hover:text-muted-foreground'}`}
        >
          Scenes{!hideAccessoryCounts && scenes.length > 0 ? ` (${scenes.length})` : ''}
          {loading ? (
            <Loader2 className="h-3.5 w-3.5 animate-spin" />
          ) : (
            <ChevronRight className={`h-3.5 w-3.5 transition-transform ${expanded ? 'rotate-90' : ''}`} />
          )}
        </button>
      </div>

      <AnimatedCollapse open={expanded && !hidden}>
        <div className={compact ? 'mb-3' : 'mb-6'}>
          <div className={
            compact
              ? 'grid items-start gap-2 grid-cols-[repeat(auto-fill,minmax(180px,1fr))]'
              : 'grid items-start gap-3 grid-cols-[repeat(auto-fill,minmax(240px,1fr))]'
          }>
            {scenes.map(scene => (
              <div
                key={scene.id}
                className={`group flex items-center gap-2 rounded-xl border p-3 ${isDarkBackground ? 'border-white/15 bg-white/5' : 'bg-card'}`}
              >
                <Zap className={`h-4 w-4 shrink-0 ${isDarkBackground ? 'text-white/50' : 'text-muted-foreground'}`} />
                <div className="min-w-0 flex-1">
                  <p className={`text-sm font-medium truncate ${isDarkBackground ? 'text-white' : ''}`}>{scene.name}</p>
                  <p className={`text-[11px] ${isDarkBackground ? 'text-white/40' : 'text-muted-foreground/60'}`}>
                    {scene.automationName
                      ? `Used by automation "${scene.automationName}"`
                      : `${scene.actionCount} action${scene.actionCount === 1 ? '' : 's'}`}
                  </p>
                </div>
                <button
                  onClick={() => handleRun(scene)}
                  disabled={runningId === scene.id}
                  title="Run scene"
                  className={`shrink-0 rounded-lg p-1.5 transition-colors ${isDarkBackground ? 'hover:bg-white/10 text-white/70' : 'hover:bg-muted text-muted-foreground'}`}
                >
                  {runningId === scene.id ? <Loader2 className="h-4 w-4 animate-spin" /> : <Play className="h-4 w-4" />}
                </button>
                {!scene.automationName && (
                  <button
                    onClick={() => setConfirmDelete(scene)}
                    title="Delete scene"
                    className={`shrink-0 rounded-lg p-1.5 transition-colors opacity-0 group-hover:opacity-100 focus:opacity-100 ${isDarkBackground ? 'hover:bg-white/10 text-white/50 hover:text-red-400' : 'hover:bg-muted text-muted-foreground/60 hover:text-red-500'}`}
                  >
                    <Trash2 className="h-4 w-4" />
                  </button>
                )}
              </div>
            ))}
          </div>
        </div>
      </AnimatedCollapse>

      <AlertDialog open={!!confirmDelete} onOpenChange={(open) => !open && setConfirmDelete(null)}>
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
