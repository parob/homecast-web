import { useEffect, useMemo, useState } from 'react';
import { useMutation, useQuery } from '@apollo/client/react';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Dialog, DialogContent, DialogTitle } from '@/components/ui/dialog';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';
import { Loader2, Plus, Trash2, X, Zap } from 'lucide-react';
import { AccessoryPicker, getAccessoryIcon } from '@/components/AccessoryPicker';
import { CharacteristicValueInput } from '@/components/automations/CharacteristicValueInput';
import {
  defaultValueFor, describeValue, getWritableCharacteristics, primaryWritableChar,
  type WritableChar,
} from '@/components/automations/characteristics';
import { charLabel } from '@/components/automations/format';
import { getIconColor } from '@/components/widgets/iconColors';
import { parseCharacteristicValue } from '@/components/widgets/types';
import { isBuiltInScene } from '@/lib/scenes';
import { GET_ACCESSORIES, GET_HOMES } from '@/lib/graphql/queries';
import { CREATE_SCENE, UPDATE_SCENE } from '@/lib/graphql/mutations';
import { translateHomeKitError, homeEditPermissionFix } from '@/lib/homekit-errors';
import { useHomeRelayKind } from '@/hooks/useRelayCannotEdit';
import { getDisplayName } from '@/lib/graphql/types';
import type { HomeKitAccessory, HomeKitHome, HomeKitScene, AutomationAction } from '@/lib/graphql/types';

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
  /** Shown as a Delete button when editing a deletable scene. */
  onDelete?: () => void;
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
    targetValue: parseCharacteristicValue(a.targetValue),
  }));
}

const sceneColors = getIconColor('scene');

/**
 * One card per device, listing the properties this scene sets on it. Grouping
 * by device matches how people describe a scene ("kitchen lights at 30%")
 * and keeps repeat trips through the picker down to one.
 */
function DeviceActionCard({ accessory, accessoryId, actions, chars, readOnly, onChange, onRemove }: {
  accessory: HomeKitAccessory | undefined;
  accessoryId: string;
  actions: ActionData[];
  chars: WritableChar[];
  readOnly: boolean;
  onChange: (next: ActionData[]) => void;
  onRemove: () => void;
}) {
  const Icon = accessory ? getAccessoryIcon(accessory) : Zap;
  const usedTypes = new Set(actions.map(a => a.characteristicType));
  const unusedChars = chars.filter(c => !usedTypes.has(c.type));

  const updateAction = (index: number, updates: Partial<ActionData>) => {
    onChange(actions.map((a, i) => i === index ? { ...a, ...updates } : a));
  };

  return (
    <div className="rounded-xl border p-3 space-y-2.5">
      <div className="flex items-center gap-2">
        <Icon className="h-4 w-4 shrink-0 text-muted-foreground" />
        <div className="min-w-0 flex-1">
          <p className="truncate text-sm font-medium">
            {accessory ? getDisplayName(accessory.name, accessory.roomName) : 'Unknown device'}
          </p>
          {accessory?.roomName && (
            <p className="truncate text-[11px] text-muted-foreground">{accessory.roomName}</p>
          )}
        </div>
        {!readOnly && (
          <button
            onClick={onRemove}
            aria-label={`Remove ${accessory?.name ?? 'device'}`}
            className="shrink-0 text-muted-foreground transition-colors hover:text-foreground"
          >
            <X className="h-3.5 w-3.5" />
          </button>
        )}
      </div>

      {actions.map((action, index) => {
        const char = chars.find(c => c.type === action.characteristicType);

        if (readOnly) {
          return (
            <div key={index} className="flex items-center justify-between gap-2 text-xs">
              <span className="text-muted-foreground">{char?.label ?? charLabel(action.characteristicType)}</span>
              <span className="font-medium">{describeValue(char, action.targetValue)}</span>
            </div>
          );
        }

        return (
          <div key={index} className="flex items-center gap-2">
            {chars.length > 1 ? (
              <Select
                value={action.characteristicType}
                onValueChange={(type) => {
                  const next = chars.find(c => c.type === type);
                  updateAction(index, { characteristicType: type, targetValue: defaultValueFor(next) });
                }}
              >
                <SelectTrigger className="h-7 w-auto min-w-[130px] text-xs" data-testid="characteristic-select">
                  <SelectValue placeholder="Property" />
                </SelectTrigger>
                <SelectContent>
                  {chars.map(c => (
                    <SelectItem
                      key={c.type}
                      value={c.type}
                      className="text-xs"
                      disabled={c.type !== action.characteristicType && usedTypes.has(c.type)}
                    >
                      {c.label}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            ) : (
              <span className="text-xs text-muted-foreground">{char?.label ?? charLabel(action.characteristicType)}</span>
            )}
            <div className="ml-auto min-w-[140px] flex-1">
              <CharacteristicValueInput
                char={char}
                value={action.targetValue}
                onChange={(v) => updateAction(index, { targetValue: v })}
              />
            </div>
            {actions.length > 1 && (
              <button
                onClick={() => onChange(actions.filter((_, i) => i !== index))}
                aria-label={`Remove ${char?.label ?? 'property'}`}
                className="shrink-0 text-muted-foreground transition-colors hover:text-foreground"
              >
                <X className="h-3 w-3" />
              </button>
            )}
          </div>
        );
      })}

      {!readOnly && unusedChars.length > 0 && (
        <button
          onClick={() => onChange([...actions, {
            accessoryId,
            characteristicType: unusedChars[0].type,
            targetValue: defaultValueFor(unusedChars[0]),
          }])}
          className="text-xs text-muted-foreground transition-colors hover:text-foreground"
        >
          + Add property
        </button>
      )}
    </div>
  );
}

export function SceneFormDialog({ open, onOpenChange, homeId, scene, onSaved, onDelete }: SceneFormDialogProps) {
  const isEditing = !!scene;
  // Automation-owned and built-in scenes can't be modified — show actions read-only
  const builtIn = isBuiltInScene(scene);
  const [name, setName] = useState('');
  const [actions, setActions] = useState<ActionData[]>([]);
  const [error, setError] = useState<string | null>(null);
  const [saving, setSaving] = useState(false);
  const [pickingDevices, setPickingDevices] = useState(false);

  const { data: accessoriesData } = useQuery<{ accessories: HomeKitAccessory[] }>(GET_ACCESSORIES, {
    variables: { homeId },
    skip: !open || !homeId,
    fetchPolicy: 'cache-first',
  });
  const { data: homesData } = useQuery<{ homes: HomeKitHome[] }>(GET_HOMES, {
    skip: !open,
    fetchPolicy: 'cache-first',
  });
  const accessories = useMemo(() => accessoriesData?.accessories ?? [], [accessoriesData]);
  // Scenes are scoped to one home, so the picker only ever filters within it.
  const homes = useMemo(
    () => (homesData?.homes ?? []).filter(h => h.id === homeId),
    [homesData, homeId],
  );

  // Third reason a scene is read-only, alongside built-in and automation-owned:
  // the relay's Apple ID only has view-only access to the home. Reuses the
  // query the device picker already runs, so it costs no extra fetch.
  // `=== false` only — older relays don't report isAdmin at all.
  const relayCannotEdit = homes[0]?.isAdmin === false;
  const readOnly = !!scene?.automationName || builtIn || relayCannotEdit;
  // Which relay serves this home decides who the user grants access to.
  const relayKind = useHomeRelayKind(relayCannotEdit ? homeId : undefined);

  const [createScene] = useMutation(CREATE_SCENE);
  const [updateScene] = useMutation(UPDATE_SCENE);

  useEffect(() => {
    if (!open) return;
    setError(null);
    setPickingDevices(false);
    if (scene) {
      setName(scene.name);
      setActions(parseSceneActions(scene));
    } else {
      setName('');
      setActions([]);
    }
  }, [open, scene]);

  // Writable characteristics per accessory, computed once for the devices in play
  const charsByAccessory = useMemo(() => {
    const map = new Map<string, WritableChar[]>();
    for (const accessory of accessories) map.set(accessory.id, getWritableCharacteristics(accessory));
    return map;
  }, [accessories]);

  // A scene sets device state, so anything with nothing settable — sensors,
  // bridges — would just be a dead row in the picker.
  const controllableAccessories = useMemo(
    () => accessories.filter(a => (charsByAccessory.get(a.id)?.length ?? 0) > 0),
    [accessories, charsByAccessory],
  );

  const deviceIds = useMemo(
    () => [...new Set(actions.map(a => a.accessoryId).filter(Boolean))],
    [actions],
  );
  const selectedIds = useMemo(() => new Set(deviceIds), [deviceIds]);

  /** Swap a device's actions in place so its card doesn't jump on every edit. */
  const replaceDeviceActions = (accessoryId: string, next: ActionData[]) => {
    setActions(prev => {
      const out: ActionData[] = [];
      let inserted = false;
      for (const action of prev) {
        if (action.accessoryId !== accessoryId) { out.push(action); continue; }
        if (!inserted) { out.push(...next); inserted = true; }
      }
      if (!inserted) out.push(...next);
      return out;
    });
  };

  const toggleDevice = (accessoryId: string) => {
    if (selectedIds.has(accessoryId)) {
      setActions(prev => prev.filter(a => a.accessoryId !== accessoryId));
      return;
    }
    const chars = charsByAccessory.get(accessoryId) ?? [];
    const primary = primaryWritableChar(chars);
    if (!primary) return;
    setActions(prev => [...prev, {
      accessoryId,
      characteristicType: primary.type,
      targetValue: defaultValueFor(primary),
    }]);
    setError(null);
  };

  const handleSave = async () => {
    const trimmed = name.trim();
    if (!trimmed) { setError('Name is required'); return; }
    // HomeKit rejects names not ending with a letter or number
    if (!/[\p{L}\p{N}]$/u.test(trimmed)) {
      setError('Scene names must end with a letter or number (no trailing punctuation)');
      return;
    }
    const validActions = actions.filter(a => a.accessoryId && a.characteristicType && a.targetValue != null);
    if (validActions.length === 0) { setError('Add at least one device'); return; }

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
        setError(translateHomeKitError(e, 'scene'));
      }
    } finally {
      setSaving(false);
    }
  };

  const actionsUnavailable = isEditing && scene?.actions == null;

  return (
    <>
      <Dialog open={open} onOpenChange={onOpenChange}>
        <DialogContent className="sm:max-w-lg max-h-[85vh] flex flex-col p-0 gap-0">
          <DialogTitle className="sr-only">{readOnly ? 'Scene' : isEditing ? 'Edit Scene' : 'Create Scene'}</DialogTitle>
          <div className="shrink-0 px-6 pt-5 pb-3">
            <div className="flex items-center gap-2 mb-2">
              <div className={`flex h-6 w-6 shrink-0 items-center justify-center rounded-full shadow-sm ${sceneColors.bg} ${sceneColors.text}`}>
                <Zap className="h-3.5 w-3.5" />
              </div>
              <span className="text-xs text-muted-foreground font-medium">{readOnly ? 'Scene' : isEditing ? 'Edit Scene' : 'New Scene'}</span>
            </div>
            {readOnly ? (
              <p className="text-lg font-semibold break-words">{scene?.name}</p>
            ) : (
              <Input
                value={name}
                onChange={(e) => { setName(e.target.value); setError(null); }}
                placeholder="Scene name"
                className="h-auto text-lg font-semibold placeholder:text-muted-foreground/40 border-0 p-0 shadow-none focus-visible:ring-0"
              />
            )}
          </div>

          <div className="flex-1 overflow-y-auto px-6 pb-4 space-y-2">
            {readOnly && (
              <p className="text-xs text-muted-foreground">
                {scene?.automationName
                  ? `This scene belongs to the automation "${scene.automationName}" — edit that automation to change it.`
                  : builtIn
                    ? 'This is a built-in HomeKit scene — it can be run, but only the Apple Home app can change or remove it.'
                    : `Homecast can view this home but not change it, so this scene is read-only. ${homeEditPermissionFix(relayKind)}`}
              </p>
            )}
            <p className="text-xs text-muted-foreground">Device states this scene applies when run:</p>

            {actionsUnavailable ? (
              <p className="text-xs text-muted-foreground/70 rounded-lg border border-dashed p-3">
                Viewing a scene's actions needs a newer version of the Homecast relay app.
              </p>
            ) : deviceIds.length === 0 ? (
              <p className="text-xs text-muted-foreground/70 rounded-lg border border-dashed p-3">
                {readOnly ? 'No actions.' : 'No devices yet — add the ones this scene should set.'}
              </p>
            ) : (
              deviceIds.map(deviceId => (
                <DeviceActionCard
                  key={deviceId}
                  accessoryId={deviceId}
                  accessory={accessories.find(a => a.id === deviceId)}
                  actions={actions.filter(a => a.accessoryId === deviceId)}
                  chars={charsByAccessory.get(deviceId) ?? []}
                  readOnly={readOnly}
                  onChange={(next) => replaceDeviceActions(deviceId, next)}
                  onRemove={() => setActions(prev => prev.filter(a => a.accessoryId !== deviceId))}
                />
              ))
            )}

            {!readOnly && (
              <button
                onClick={() => setPickingDevices(true)}
                className="flex w-full items-center justify-center gap-1.5 rounded-xl border border-dashed py-2.5 text-sm text-muted-foreground transition-colors hover:border-muted-foreground/30 hover:text-foreground"
              >
                <Plus className="h-3.5 w-3.5" /> Add devices
              </button>
            )}
            {error && <p className="text-xs text-red-500">{error}</p>}
          </div>

          <div className="shrink-0 flex items-center gap-2 border-t px-6 py-3">
            {isEditing && !readOnly && onDelete && (
              <Button variant="ghost" size="sm" className="text-red-500 hover:text-red-600" onClick={onDelete} disabled={saving}>
                <Trash2 className="h-3.5 w-3.5 mr-1.5" /> Delete
              </Button>
            )}
            <div className="flex-1" />
            <Button variant="outline" size="sm" onClick={() => onOpenChange(false)} disabled={saving}>
              {readOnly ? 'Close' : 'Cancel'}
            </Button>
            {!readOnly && (
              <Button size="sm" onClick={handleSave} disabled={saving}>
                {saving && <Loader2 className="h-3.5 w-3.5 animate-spin mr-1.5" />}
                {isEditing ? 'Save' : 'Create'}
              </Button>
            )}
          </div>
        </DialogContent>
      </Dialog>

      <Dialog open={pickingDevices} onOpenChange={setPickingDevices}>
        <DialogContent
          className="max-w-[95%] sm:max-w-[500px] max-h-[85vh] flex flex-col p-0 gap-0"
          onOpenAutoFocus={(e) => e.preventDefault()}
        >
          <DialogTitle className="sr-only">Add Devices</DialogTitle>
          <AccessoryPicker
            accessories={controllableAccessories}
            homes={homes}
            selectedIds={selectedIds}
            onToggle={toggleDevice}
          />
          <div className="shrink-0 px-4 py-3 border-t flex justify-end">
            <Button size="sm" onClick={() => setPickingDevices(false)}>Done</Button>
          </div>
        </DialogContent>
      </Dialog>
    </>
  );
}
