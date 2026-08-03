import { useEffect, useMemo, useState } from 'react';
import { Dialog, DialogContent, DialogTitle } from '@/components/ui/dialog';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Switch } from '@/components/ui/switch';
import { Trash2, Plus, X } from 'lucide-react';
import {
  VIRTUAL_TYPE_LIST, defaultVirtualAccessory, validateVirtualAccessory,
  type CreatableVirtualType,
} from '@/automation/virtual-accessories/catalogue';
import { VirtualAccessoryTypeIcon } from './VirtualAccessoryTypeIcon';
import type { HelperDefinition } from '@/automation/types/automation';

interface VirtualAccessoryEditorDialogProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  homeId: string;
  /** Rooms this helper accessory can be placed in. */
  rooms?: { id: string; name: string }[];
  /** Pre-selected room when created from a room's menu. */
  defaultRoomId?: string;
  /** Everything already in this home, so a duplicate name can be refused. */
  siblings?: HelperDefinition[];
  /** Undefined when creating. */
  existing?: HelperDefinition;
  onSave: (helper: HelperDefinition) => Promise<void>;
  onDelete?: (helperId: string) => Promise<void>;
}

/**
 * Create or edit a helper.
 *
 * Two steps when creating — pick a type, then configure it — because the type
 * decides which fields exist at all. Showing every field for every type and
 * greying out the irrelevant ones would make a counter look like a badly
 * configured timer.
 *
 * Editing skips straight to configuration: a helper's type cannot change, since
 * the value it holds and the operations automations perform on it are both
 * bound to that type. Changing it would silently break every automation
 * referencing the helper, so the honest move is to make a new one.
 */
export function VirtualAccessoryEditorDialog({
  open, onOpenChange, homeId, rooms = [], defaultRoomId, siblings = [], existing, onSave, onDelete,
}: VirtualAccessoryEditorDialogProps) {
  const [draft, setDraft] = useState<HelperDefinition | null>(null);
  const [saving, setSaving] = useState(false);
  const [confirmDelete, setConfirmDelete] = useState(false);

  // Reset whenever the dialog opens so a previous edit can't leak into the next.
  useEffect(() => {
    if (!open) return;
    setDraft(existing ? { ...existing } : null);
    setConfirmDelete(false);
    setSaving(false);
  }, [open, existing]);

  const problem = useMemo(() => (draft ? validateVirtualAccessory(draft, siblings) : null), [draft, siblings]);

  const pickType = (type: CreatableVirtualType) => {
    // id is empty until saved: Community's IndexedDB layer and the cloud both
    // mint it, and inventing one here would create a second source of identity.
    setDraft({ ...defaultVirtualAccessory(type, '', homeId, ''), roomId: defaultRoomId });
  };

  const handleSave = async () => {
    if (!draft || problem) return;
    setSaving(true);
    try {
      await onSave({ ...draft, name: draft.name.trim() });
      onOpenChange(false);
    } finally {
      setSaving(false);
    }
  };

  const patch = (changes: Partial<HelperDefinition>) =>
    setDraft(d => (d ? ({ ...d, ...changes } as HelperDefinition) : d));

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="sm:max-w-md" onOpenAutoFocus={e => e.preventDefault()}>
        <DialogTitle className="text-base font-semibold">
          {existing ? `Edit ${existing.name}` : draft ? 'New virtual accessory' : 'What kind of virtual accessory?'}
        </DialogTitle>

        {/* Step 1 — type picker (creating only) */}
        {!draft && (
          <div className="grid gap-2 max-h-[60vh] overflow-y-auto -mx-1 px-1">
            {VIRTUAL_TYPE_LIST.map(info => (
              <button
                key={info.type}
                type="button"
                data-testid={`helper-type-${info.type}`}
                onClick={() => pickType(info.type)}
                className="flex items-start gap-3 rounded-xl border p-3 text-left transition-colors hover:border-primary/40 hover:bg-muted/40"
              >
                <VirtualAccessoryTypeIcon type={info.type} className="h-5 w-5 mt-0.5 shrink-0 text-muted-foreground" />
                <span className="min-w-0">
                  <span className="block text-sm font-medium">{info.label}</span>
                  <span className="block text-xs text-muted-foreground">{info.description}</span>
                  <span className="block text-[11px] text-muted-foreground/70 mt-0.5">{info.example}</span>
                </span>
              </button>
            ))}
          </div>
        )}

        {/* Step 2 — configuration */}
        {draft && (
          <div className="space-y-4">
            <div className="space-y-1.5">
              <Label htmlFor="helper-name">Name</Label>
              <Input
                id="helper-name"
                data-testid="helper-name"
                autoFocus
                value={draft.name}
                placeholder="Home Mode"
                onChange={e => patch({ name: e.target.value })}
              />
            </div>

            <HelperTypeFields draft={draft} patch={patch} />

            <div className="space-y-1.5">
              <Label htmlFor="helper-room">Location</Label>
              <select
                id="helper-room"
                data-testid="helper-room"
                className="w-full h-9 rounded-md border bg-background px-3 text-sm"
                value={draft.roomId ?? ''}
                onChange={e => patch({ roomId: e.target.value || undefined })}
              >
                {/* Not a HomeKit room: helper accessories are ours, so they can
                    sit outside HomeKit's room structure entirely. */}
                <option value="">Top of the home</option>
                {rooms.map(r => (
                  <option key={r.id} value={r.id}>{r.name}</option>
                ))}
              </select>
            </div>

            <div className="flex items-start justify-between gap-3">
              <div className="min-w-0">
                <Label htmlFor="helper-controllable">User Editable</Label>
                <p className="text-[11px] text-muted-foreground mt-0.5">
                  {draft.controllable === false
                    ? 'Shows its value. Only automations can change it.'
                    : 'Can be edited from the dashboard.'}
                </p>
              </div>
              <Switch
                id="helper-controllable"
                data-testid="helper-controllable"
                checked={draft.controllable !== false}
                onCheckedChange={v => patch({ controllable: v })}
              />
            </div>

            {problem && (
              <p className="text-xs text-destructive" role="alert">{problem}</p>
            )}

            <div className="flex items-center gap-2 pt-1">
              {existing && onDelete && (
                confirmDelete ? (
                  <Button
                    variant="destructive"
                    size="sm"
                    data-testid="helper-delete-confirm"
                    onClick={async () => { await onDelete(existing.id); onOpenChange(false); }}
                  >
                    Delete for good
                  </Button>
                ) : (
                  <Button
                    variant="ghost"
                    size="sm"
                    className="text-muted-foreground"
                    onClick={() => setConfirmDelete(true)}
                  >
                    <Trash2 className="h-4 w-4 mr-1.5" />
                    Delete
                  </Button>
                )
              )}
              <div className="flex-1" />
              <Button variant="ghost" size="sm" onClick={() => onOpenChange(false)}>Cancel</Button>
              <Button
                size="sm"
                data-testid="helper-save"
                disabled={!!problem || saving}
                onClick={handleSave}
              >
                {saving ? 'Saving…' : existing ? 'Save' : 'Create'}
              </Button>
            </div>

            {existing && confirmDelete && (
              <p className="text-xs text-muted-foreground">
                Automations referring to this helper will stop working.
              </p>
            )}
          </div>
        )}
      </DialogContent>
    </Dialog>
  );
}

/** The fields that exist only for one helper type. */
function HelperTypeFields({
  draft, patch,
}: {
  draft: HelperDefinition;
  patch: (changes: Partial<HelperDefinition>) => void;
}) {
  switch (draft.type) {
    case 'input_boolean':
      return (
        <div className="flex items-center justify-between">
          <Label htmlFor="helper-initial">Starts on</Label>
          <Switch
            id="helper-initial"
            checked={!!draft.initialValue}
            onCheckedChange={v => patch({ initialValue: v })}
          />
        </div>
      );

    case 'input_select':
      return (
        <OptionListEditor
          options={draft.options}
          initialValue={draft.initialValue}
          onChange={(options, initialValue) => patch({ options, initialValue })}
        />
      );

    case 'counter':
      return (
        <div className="grid grid-cols-2 gap-3">
          <NumberField label="Starts at" value={draft.initial ?? 0} onChange={v => patch({ initial: v })} />
          <NumberField label="Step" value={draft.step ?? 1} onChange={v => patch({ step: v })} />
          <NumberField label="Minimum" value={draft.min} optional onChange={v => patch({ min: v })} />
          <NumberField label="Maximum" value={draft.max} optional onChange={v => patch({ max: v })} />
        </div>
      );

    case 'timer':
      return (
        <div className="space-y-1.5">
          <Label>Runs for</Label>
          <div className="grid grid-cols-3 gap-3">
            {(['hours', 'minutes', 'seconds'] as const).map(unit => (
              <NumberField
                key={unit}
                label={unit[0].toUpperCase() + unit.slice(1)}
                value={draft.duration?.[unit] ?? 0}
                onChange={v => patch({ duration: { ...draft.duration, [unit]: v ?? 0 } })}
              />
            ))}
          </div>
          <p className="text-[11px] text-muted-foreground">
            An automation can override this when it starts the timer.
          </p>
        </div>
      );

    case 'input_number':
      return (
        <>
          <div className="grid grid-cols-3 gap-3">
            <NumberField label="Minimum" value={draft.min} onChange={v => patch({ min: v ?? 0 })} />
            <NumberField label="Maximum" value={draft.max} onChange={v => patch({ max: v ?? 0 })} />
            <NumberField label="Step" value={draft.step} onChange={v => patch({ step: v ?? 1 })} />
          </div>
          <div className="grid grid-cols-2 gap-3">
            <NumberField
              label="Starts at"
              value={draft.initialValue ?? draft.min}
              onChange={v => patch({ initialValue: v })}
            />
            <div className="space-y-1.5">
              <Label htmlFor="helper-unit">Unit</Label>
              <Input
                id="helper-unit"
                value={draft.unit ?? ''}
                placeholder="°C"
                onChange={e => patch({ unit: e.target.value || undefined })}
              />
            </div>
          </div>
        </>
      );

    case 'input_text':
      return (
        <div className="space-y-1.5">
          <Label htmlFor="helper-text-initial">Starts as</Label>
          <Input
            id="helper-text-initial"
            value={draft.initialValue ?? ''}
            onChange={e => patch({ initialValue: e.target.value })}
          />
        </div>
      );

    case 'input_datetime':
      return (
        <div className="space-y-2">
          <div className="flex items-center justify-between">
            <Label htmlFor="helper-has-date">Includes a date</Label>
            <Switch
              id="helper-has-date"
              checked={draft.hasDate}
              onCheckedChange={v => patch({ hasDate: v })}
            />
          </div>
          <div className="flex items-center justify-between">
            <Label htmlFor="helper-has-time">Includes a time</Label>
            <Switch
              id="helper-has-time"
              checked={draft.hasTime}
              onCheckedChange={v => patch({ hasTime: v })}
            />
          </div>
        </div>
      );

    default:
      return null;
  }
}

/**
 * A number input that can be genuinely empty.
 *
 * `optional` matters for counter bounds: an empty maximum means "no ceiling",
 * which is not the same as zero. A plain number input coerces a cleared field
 * to 0 and would silently cap the counter at nothing.
 */
function NumberField({
  label, value, onChange, optional,
}: {
  label: string;
  value: number | undefined;
  onChange: (value: number | undefined) => void;
  optional?: boolean;
}) {
  const id = `helper-num-${label.toLowerCase().replace(/\s+/g, '-')}`;
  return (
    <div className="space-y-1.5">
      <Label htmlFor={id}>{label}</Label>
      <Input
        id={id}
        type="number"
        inputMode="decimal"
        value={value ?? ''}
        placeholder={optional ? 'None' : undefined}
        onChange={e => {
          const raw = e.target.value;
          if (raw === '') { onChange(undefined); return; }
          const n = Number(raw);
          if (Number.isFinite(n)) onChange(n);
        }}
      />
    </div>
  );
}

/** The list of choices for a mode, plus which one it starts on. */
function OptionListEditor({
  options, initialValue, onChange,
}: {
  options: string[];
  initialValue?: string;
  onChange: (options: string[], initialValue?: string) => void;
}) {
  const setOption = (index: number, text: string) => {
    const next = options.map((o, i) => (i === index ? text : o));
    // Follow a rename: the starting value points at an option by its text, so
    // editing "Home" to "At home" would otherwise leave it pointing at nothing
    // and the helper would start empty.
    const nextInitial = initialValue === options[index] ? text : initialValue;
    onChange(next, nextInitial);
  };

  const removeOption = (index: number) => {
    const next = options.filter((_, i) => i !== index);
    const nextInitial = initialValue === options[index] ? next[0] : initialValue;
    onChange(next, nextInitial);
  };

  return (
    <div className="space-y-1.5">
      <Label>Options</Label>
      <div className="space-y-2">
        {options.map((option, i) => (
          <div key={i} className="flex items-center gap-2">
            <Input
              value={option}
              data-testid={`helper-option-${i}`}
              placeholder={`Option ${i + 1}`}
              onChange={e => setOption(i, e.target.value)}
            />
            <button
              type="button"
              aria-label={`Remove option ${i + 1}`}
              className="p-1.5 rounded-md text-muted-foreground hover:bg-muted disabled:opacity-30"
              disabled={options.length <= 1}
              onClick={() => removeOption(i)}
            >
              <X className="h-4 w-4" />
            </button>
          </div>
        ))}
      </div>
      <Button
        variant="ghost"
        size="sm"
        className="text-muted-foreground"
        data-testid="helper-add-option"
        onClick={() => onChange([...options, ''], initialValue)}
      >
        <Plus className="h-3.5 w-3.5 mr-1.5" />
        Add option
      </Button>

      <div className="space-y-1.5 pt-1">
        <Label htmlFor="helper-select-initial">Starts on</Label>
        <select
          id="helper-select-initial"
          className="w-full h-9 rounded-md border bg-background px-3 text-sm"
          value={initialValue ?? ''}
          onChange={e => onChange(options, e.target.value || undefined)}
        >
          {options.filter(Boolean).map(o => (
            <option key={o} value={o}>{o}</option>
          ))}
        </select>
      </div>
    </div>
  );
}
