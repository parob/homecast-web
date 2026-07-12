import { useEffect, useState } from 'react';
import { useMutation, useQuery } from '@apollo/client/react';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Dialog, DialogContent, DialogTitle } from '@/components/ui/dialog';
import { Loader2, Plus, Zap } from 'lucide-react';
import { AutomationActionRow } from '@/components/automations/AutomationActionRow';
import { GET_ACCESSORIES } from '@/lib/graphql/queries';
import { CREATE_SCENE, UPDATE_SCENE } from '@/lib/graphql/mutations';
import { translateHomeKitError } from '@/lib/homekit-errors';
import type { HomeKitAccessory, HomeKitScene, AutomationAction } from '@/lib/graphql/types';

interface ActionData {
  accessoryId: string;
  characteristicType: string;
  targetValue: unknown;
}

interface SceneFormDialogProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  homeId: string;
  /** When set, edit this scene; otherwise create a new one. */
  scene?: HomeKitScene | null;
  onSaved?: () => void;
}

function parseSceneActions(scene: HomeKitScene | null | undefined): ActionData[] {
  if (!scene?.actions) return [];
  // Cloud GraphQL serializes actions as a JSON string; CE returns the raw array.
  const raw = typeof scene.actions === 'string' ? (() => {
    try { return JSON.parse(scene.actions) as AutomationAction[]; } catch { return []; }
  })() : scene.actions;
  return (raw ?? []).map(a => ({
    accessoryId: a.accessoryId,
    characteristicType: a.characteristicType,
    targetValue: a.targetValue,
  }));
}

export function SceneFormDialog({ open, onOpenChange, homeId, scene, onSaved }: SceneFormDialogProps) {
  const isEditing = !!scene;
  const [name, setName] = useState('');
  const [actions, setActions] = useState<ActionData[]>([]);
  const [error, setError] = useState<string | null>(null);
  const [saving, setSaving] = useState(false);

  const { data: accessoriesData } = useQuery<{ accessories: HomeKitAccessory[] }>(GET_ACCESSORIES, {
    variables: { homeId },
    skip: !open || !homeId,
    fetchPolicy: 'cache-first',
  });
  const accessories = accessoriesData?.accessories ?? [];

  const [createScene] = useMutation(CREATE_SCENE);
  const [updateScene] = useMutation(UPDATE_SCENE);

  useEffect(() => {
    if (!open) return;
    setError(null);
    if (scene) {
      setName(scene.name);
      setActions(parseSceneActions(scene));
    } else {
      setName('');
      setActions([{ accessoryId: '', characteristicType: '', targetValue: null }]);
    }
  }, [open, scene]);

  const handleSave = async () => {
    const trimmed = name.trim();
    if (!trimmed) { setError('Name is required'); return; }
    // HomeKit rejects names not ending with a letter or number
    if (!/[\p{L}\p{N}]$/u.test(trimmed)) {
      setError('Scene names must end with a letter or number (no trailing punctuation)');
      return;
    }
    const validActions = actions.filter(a => a.accessoryId && a.characteristicType);
    if (validActions.length === 0) { setError('Add at least one action'); return; }

    setSaving(true);
    setError(null);
    try {
      if (isEditing && scene) {
        await updateScene({ variables: {
          sceneId: scene.id,
          homeId,
          ...(trimmed !== scene.name && { name: trimmed }),
          actions: JSON.stringify(validActions),
        } });
      } else {
        await createScene({ variables: { homeId, name: trimmed, actions: JSON.stringify(validActions) } });
      }
      onOpenChange(false);
      onSaved?.();
    } catch (e: any) {
      const message = String(e?.message ?? e);
      if (/UNKNOWN_METHOD|Unknown method/i.test(message)) {
        setError('Creating and editing scenes needs a newer version of the Homecast relay app.');
      } else {
        setError(translateHomeKitError(e));
      }
    } finally {
      setSaving(false);
    }
  };

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="sm:max-w-md max-h-[85vh] flex flex-col p-0 gap-0">
        <DialogTitle className="sr-only">{isEditing ? 'Edit Scene' : 'Create Scene'}</DialogTitle>
        <div className="shrink-0 px-6 pt-5 pb-3">
          <div className="flex items-center gap-2 mb-2">
            <Zap className="h-4 w-4 shrink-0 text-muted-foreground" />
            <span className="text-xs text-muted-foreground font-medium">{isEditing ? 'Edit Scene' : 'New Scene'}</span>
          </div>
          <Input
            value={name}
            onChange={(e) => { setName(e.target.value); setError(null); }}
            placeholder="Scene name"
            className="h-auto text-lg font-semibold placeholder:text-muted-foreground/40 border-0 p-0 shadow-none focus-visible:ring-0"
          />
        </div>

        <div className="flex-1 overflow-y-auto px-6 pb-4 space-y-2">
          <p className="text-xs text-muted-foreground">Device states this scene applies when run:</p>
          {actions.map((action, idx) => (
            <AutomationActionRow
              key={idx}
              action={action}
              accessories={accessories}
              onChange={(updated) => setActions(prev => prev.map((a, i) => i === idx ? updated : a))}
              onRemove={() => setActions(prev => prev.filter((_, i) => i !== idx))}
            />
          ))}
          <Button variant="outline" size="sm" className="w-full h-8 text-xs"
            onClick={() => setActions(prev => [...prev, { accessoryId: '', characteristicType: '', targetValue: null }])}>
            <Plus className="h-3 w-3 mr-1" /> Add device
          </Button>
          {error && <p className="text-xs text-red-500">{error}</p>}
        </div>

        <div className="shrink-0 flex justify-end gap-2 border-t px-6 py-3">
          <Button variant="outline" size="sm" onClick={() => onOpenChange(false)} disabled={saving}>Cancel</Button>
          <Button size="sm" onClick={handleSave} disabled={saving}>
            {saving && <Loader2 className="h-3.5 w-3.5 animate-spin mr-1.5" />}
            {isEditing ? 'Save' : 'Create'}
          </Button>
        </div>
      </DialogContent>
    </Dialog>
  );
}
