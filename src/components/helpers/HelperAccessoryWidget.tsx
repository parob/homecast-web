import { Plus, Minus, Play, Square } from 'lucide-react';
import { Switch } from '@/components/ui/switch';
import { HelperTypeIcon } from './HelperTypeIcon';
import { formatHelperValue, HELPER_TYPES, type CreatableHelperType } from '@/automation/helpers/catalogue';
import type { HelperDefinition, HelperOperation } from '@/automation/types/automation';

export interface HelperAccessoryWidgetProps {
  helper: HelperDefinition;
  value: unknown;
  /** False when the relay can't be reached — controls disable themselves. */
  live: boolean;
  compact?: boolean;
  isDarkBackground?: boolean;
  onEdit: () => void;
  onOperate: (id: string, op: HelperOperation, opts?: { value?: unknown }) => void | Promise<void>;
}

/**
 * A helper accessory as a dashboard tile.
 *
 * Shares the accessory widget's shape — rounded card, icon, name, control on
 * the right — because it sits in the same grid and a tile that looked different
 * would read as a different kind of thing. It is not built on AccessoryWidget:
 * that renders from HomeKit services and characteristics, and a Mode or a
 * Counter has neither. Fabricating services to borrow the widget would mean
 * inventing a serviceType for its branching to misread.
 */
export function HelperAccessoryWidget({
  helper, value, live, compact, isDarkBackground, onEdit, onOperate,
}: HelperAccessoryWidgetProps) {
  const type = helper.type as CreatableHelperType;
  const info = HELPER_TYPES[type];

  return (
    <div
      data-helper-accessory={helper.id}
      className={`rounded-[20px] border transition-colors ${compact ? 'p-2.5' : 'p-3.5'} ${
        isDarkBackground
          ? 'border-white/10 bg-white/5 hover:border-white/20'
          : 'border-border bg-card hover:border-muted-foreground/30'
      }`}
    >
      <div className="flex items-start gap-2 min-w-0">
        <HelperTypeIcon
          type={type}
          className={`${compact ? 'h-4 w-4' : 'h-5 w-5'} shrink-0 mt-0.5 ${
            isDarkBackground ? 'text-white/50' : 'text-muted-foreground'
          }`}
        />
        <button
          type="button"
          onClick={onEdit}
          className="min-w-0 flex-1 text-left"
          title="Edit this helper accessory"
        >
          <span className={`block truncate font-medium ${compact ? 'text-xs' : 'text-sm'} ${
            isDarkBackground ? 'text-white' : ''
          }`}>
            {helper.name}
          </span>
          <span className={`block text-[11px] ${isDarkBackground ? 'text-white/40' : 'text-muted-foreground'}`}>
            {info?.label ?? type}
          </span>
        </button>

        <div className="shrink-0">
          <HelperControl helper={helper} value={value} live={live} onOperate={onOperate} />
        </div>
      </div>
    </div>
  );
}

/**
 * The inline control.
 *
 * Only types whose value a person can set in one gesture get one; the rest show
 * their value and are edited in the dialog. Everything disables when the engine
 * isn't reachable — a control that looks operable and silently isn't is worse
 * than one that admits it can't act.
 */
export function HelperControl({
  helper, value, live, onOperate,
}: {
  helper: HelperDefinition;
  value: unknown;
  live: boolean;
  onOperate: (id: string, op: HelperOperation, opts?: { value?: unknown }) => void | Promise<void>;
}) {
  const disabled = !live;

  // Read-only: still shows its value, still fully writable by automations, just
  // not something to prod by hand. Plain text rather than a disabled control,
  // because greyed-out chrome reads as broken rather than as deliberately
  // not-yours.
  if (helper.controllable === false) {
    return (
      <span className="text-xs text-muted-foreground max-w-[9rem] truncate block" title="Read-only">
        {formatHelperValue(helper, value)}
      </span>
    );
  }

  switch (helper.type) {
    case 'input_boolean':
      return (
        <Switch
          checked={!!value}
          disabled={disabled}
          aria-label={`Toggle ${helper.name}`}
          data-testid={`helper-toggle-${helper.id}`}
          onCheckedChange={v => onOperate(helper.id, v ? 'turn_on' : 'turn_off')}
        />
      );

    case 'input_select':
      return (
        <select
          className="h-8 rounded-md border bg-background px-2 text-xs max-w-[9rem]"
          disabled={disabled}
          aria-label={`Set ${helper.name}`}
          data-testid={`helper-select-${helper.id}`}
          value={typeof value === 'string' ? value : ''}
          onChange={e => onOperate(helper.id, 'set', { value: e.target.value })}
        >
          {/* A reported value that is no longer an option still has to appear,
              or the tile would silently misrepresent the current mode. */}
          {typeof value === 'string' && value && !helper.options.includes(value) && (
            <option value={value}>{value} (removed)</option>
          )}
          {helper.options.filter(Boolean).map(o => (
            <option key={o} value={o}>{o}</option>
          ))}
        </select>
      );

    case 'counter':
    case 'input_number':
      return (
        <div className="flex items-center gap-1">
          <button
            type="button"
            className="p-1 rounded-md hover:bg-muted disabled:opacity-30"
            disabled={disabled}
            aria-label={`Decrease ${helper.name}`}
            onClick={() => onOperate(helper.id, 'decrement')}
          >
            <Minus className="h-3.5 w-3.5" />
          </button>
          <span className="text-sm tabular-nums min-w-[2.5rem] text-center">
            {formatHelperValue(helper, value)}
          </span>
          <button
            type="button"
            className="p-1 rounded-md hover:bg-muted disabled:opacity-30"
            disabled={disabled}
            aria-label={`Increase ${helper.name}`}
            onClick={() => onOperate(helper.id, 'increment')}
          >
            <Plus className="h-3.5 w-3.5" />
          </button>
        </div>
      );

    case 'timer': {
      const running = value === 'active';
      return (
        <div className="flex items-center gap-1.5">
          <span className="text-xs text-muted-foreground">{formatHelperValue(helper, value)}</span>
          <button
            type="button"
            className="p-1 rounded-md hover:bg-muted disabled:opacity-30"
            disabled={disabled}
            aria-label={running ? `Cancel ${helper.name}` : `Start ${helper.name}`}
            data-testid={`helper-timer-${helper.id}`}
            onClick={() => onOperate(helper.id, running ? 'cancel' : 'start')}
          >
            {running ? <Square className="h-3.5 w-3.5" /> : <Play className="h-3.5 w-3.5" />}
          </button>
        </div>
      );
    }

    default:
      return (
        <span className="text-xs text-muted-foreground max-w-[9rem] truncate block">
          {formatHelperValue(helper, value)}
        </span>
      );
  }
}
