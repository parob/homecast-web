import React, { memo } from 'react';
import { Plus, Minus, Play, Square, ToggleLeft, ListChecks, Hash, Timer, SlidersHorizontal, Type, CalendarClock } from 'lucide-react';
import { WidgetCard } from './WidgetCard';
import { WidgetProps } from './types';

/**
 * A helper accessory — a value the automation engine owns.
 *
 * It is an accessory like any other by the time it reaches here: it arrived
 * through `accessories.list`, it is grouped into a room, it is shared and
 * hidden and searched by the same code. All that is left is drawing the control
 * for a characteristic HomeKit doesn't have, which is exactly the job of a
 * widget.
 */

/** Characteristic → how to draw it. Mirrors relay/helper-accessories.ts. */
const VIRTUAL_CHARS = [
  'virtual_mode', 'virtual_count', 'virtual_number',
  'virtual_timer', 'virtual_text', 'virtual_datetime',
] as const;

const ICONS: Record<string, React.ElementType> = {
  virtual_mode: ListChecks,
  virtual_count: Hash,
  virtual_number: SlidersHorizontal,
  virtual_timer: Timer,
  virtual_text: Type,
  virtual_datetime: CalendarClock,
};

interface VirtualAccessoryShape {
  virtualType?: string;
  isUserEditable?: boolean;
  virtualOptions?: string[];
  virtualHasDate?: boolean;
  virtualHasTime?: boolean;
  /**
   * Pre-rename spellings, read but never written — the same inbound-alias
   * pattern `power_state` uses. In cloud mode the relay's WebView keeps its
   * cached bundle until the Mac app restarts, so for a while after a deploy a
   * new browser is reading a relay that still emits the old names. Without
   * these the tile renders as an unknown type in that window.
   */
  helperType?: string;
  helperOptions?: string[];
}

export const VirtualAccessoryWidget: React.FC<WidgetProps> = memo((props) => {
  const {
    accessory, getEffectiveValue, onSetValue, onSlider, compact, disabled,
    onExpandToggle, onDebug, iconStyle, editMode, editModeType, isHiddenUi,
    homeName, disableTooltip, onRemove, removeLabel, onHide, hideLabel,
    isHidden, showHiddenItems, onToggleShowHidden, onShare, locationSubtitle,
    onEdit, editLabel,
  } = props;

  const raw = accessory as unknown as VirtualAccessoryShape;
  const meta: VirtualAccessoryShape = {
    ...raw,
    virtualType: raw.virtualType ?? raw.helperType,
    virtualOptions: raw.virtualOptions ?? raw.helperOptions,
  };
  const service = (accessory.services || [])[0];
  const char = (service?.characteristics || []).find(
    c => (VIRTUAL_CHARS as readonly string[]).includes(c.characteristicType),
  );

  const value = char ? getEffectiveValue(accessory.id, char.characteristicType, char.value) : undefined;
  const charType = char?.characteristicType ?? '';
  const Icon = ICONS[charType] ?? ToggleLeft;

  // Read-only, view-only share, or edit mode: show the value, offer nothing.
  // A control that looks live and isn't is worse than no control.
  const readOnly = disabled || editMode || meta.isUserEditable === false || !char;

  const set = (v: unknown) => {
    if (readOnly) return;
    if (typeof v === 'number' && !onSetValue) onSlider(accessory.id, charType, v);
    else onSetValue?.(accessory.id, charType, v);
  };

  const display = formatValue(charType, value);
  const numeric = Number(value);
  const step = char?.stepValue ?? 1;
  const running = value === 'active';

  return (
    <WidgetCard
      title={accessory.name}
      subtitle={display}
      icon={<Icon className="h-4 w-4" />}
      isOn={charType === 'virtual_timer' ? running : false}
      isReachable={accessory.isReachable}
      accessory={accessory}
      compact={compact}
      onExpandToggle={onExpandToggle}
      onDebug={onDebug}
      serviceType="switch"
      iconStyle={iconStyle}
      editMode={editMode}
      editModeType={editModeType}
      isHiddenUi={isHiddenUi}
      homeName={homeName}
      disableTooltip={disableTooltip}
      onRemove={onRemove}
      removeLabel={removeLabel}
      onHide={onHide}
      hideLabel={hideLabel}
      isHidden={isHidden}
      showHiddenItems={showHiddenItems}
      onToggleShowHidden={onToggleShowHidden}
      onShare={onShare}
      locationSubtitle={locationSubtitle}
      onEdit={onEdit}
      editLabel={editLabel}
      headerAction={readOnly ? undefined : renderControl()}
    />
  );

  function renderControl(): React.ReactNode {
    switch (charType) {
      case 'virtual_mode':
        return (
          <select
            className="h-8 rounded-md border bg-background px-2 text-xs max-w-full"
            aria-label={`Set ${accessory.name}`}
            value={typeof value === 'string' ? value : ''}
            onClick={e => e.stopPropagation()}
            onChange={e => set(e.target.value)}
          >
            {/* A value that is no longer an option still has to show, or the
                tile would misrepresent the current mode. */}
            {typeof value === 'string' && value && !(meta.virtualOptions ?? []).includes(value) && (
              <option value={value}>{value}</option>
            )}
            {(meta.virtualOptions ?? []).map(o => <option key={o} value={o}>{o}</option>)}
          </select>
        );

      case 'virtual_count':
      case 'virtual_number':
        return (
          <div className="flex items-center gap-1" onClick={e => e.stopPropagation()}>
            <button
              type="button"
              aria-label={`Decrease ${accessory.name}`}
              className="p-1 rounded-md hover:bg-muted"
              onClick={() => set(clamp(numeric - step, char))}
            >
              <Minus className="h-3.5 w-3.5" />
            </button>
            <span className="text-sm tabular-nums min-w-[2rem] text-center">{display}</span>
            <button
              type="button"
              aria-label={`Increase ${accessory.name}`}
              className="p-1 rounded-md hover:bg-muted"
              onClick={() => set(clamp(numeric + step, char))}
            >
              <Plus className="h-3.5 w-3.5" />
            </button>
          </div>
        );

      case 'virtual_timer':
        return (
          <button
            type="button"
            aria-label={running ? `Cancel ${accessory.name}` : `Start ${accessory.name}`}
            className="p-1.5 rounded-md hover:bg-muted"
            onClick={e => { e.stopPropagation(); set(running ? 'idle' : 'active'); }}
          >
            {running ? <Square className="h-4 w-4" /> : <Play className="h-4 w-4" />}
          </button>
        );

      case 'virtual_text':
        return (
          <VirtualTextControl
            label={accessory.name}
            value={typeof value === 'string' ? value : ''}
            onCommit={set}
          />
        );

      case 'virtual_datetime':
        // The input's own value format is the storage format: the engine keeps
        // whatever string it is given, and `date`/`time`/`datetime-local` all
        // produce sortable ISO-ish text that expressions can compare.
        return (
          <input
            type={
              meta.virtualHasDate === false ? 'time'
                : meta.virtualHasTime === false ? 'date'
                  : 'datetime-local'
            }
            className="h-8 rounded-md border bg-background px-2 text-xs max-w-full"
            aria-label={`Set ${accessory.name}`}
            value={typeof value === 'string' ? value : ''}
            onClick={e => e.stopPropagation()}
            onChange={e => set(e.target.value)}
          />
        );

      default:
        return undefined;
    }
  }
});

/**
 * Free text needs a draft: the value is re-read every 10s while the tile is on
 * screen, and binding the input straight to it would overwrite what is being
 * typed. Committed on Enter or on leaving the field, and Escape abandons it.
 */
const VirtualTextControl: React.FC<{
  label: string;
  value: string;
  onCommit: (v: string) => void;
}> = ({ label, value, onCommit }) => {
  const [draft, setDraft] = React.useState<string | null>(null);
  const shown = draft ?? value;

  const commit = () => {
    if (draft !== null && draft !== value) onCommit(draft);
    setDraft(null);
  };

  return (
    <input
      type="text"
      className="h-8 w-28 rounded-md border bg-background px-2 text-xs"
      aria-label={`Set ${label}`}
      value={shown}
      onClick={e => e.stopPropagation()}
      onChange={e => setDraft(e.target.value)}
      onBlur={commit}
      onKeyDown={e => {
        e.stopPropagation();
        if (e.key === 'Enter') { commit(); (e.target as HTMLInputElement).blur(); }
        if (e.key === 'Escape') { setDraft(null); (e.target as HTMLInputElement).blur(); }
      }}
    />
  );
};

function clamp(v: number, char?: { minValue?: number; maxValue?: number }): number {
  let out = v;
  if (typeof char?.minValue === 'number') out = Math.max(char.minValue, out);
  if (typeof char?.maxValue === 'number') out = Math.min(char.maxValue, out);
  return out;
}

function formatValue(charType: string, value: unknown): string {
  if (value === undefined || value === null || value === '') return '—';
  if (charType === 'virtual_timer') {
    return value === 'active' ? 'Running' : value === 'paused' ? 'Paused' : 'Idle';
  }
  return String(value);
}

VirtualAccessoryWidget.displayName = 'VirtualAccessoryWidget';
