import { useCallback, useEffect, useMemo, useState } from 'react';
import { useQuery, useMutation } from '@apollo/client/react';
import { Plus, Minus, Play, Square } from 'lucide-react';
import { toast } from 'sonner';
import { Switch } from '@/components/ui/switch';
import { serverConnection } from '@/server/connection';
import { HC_HELPERS } from '@/lib/graphql/queries';
import { SAVE_HC_HELPER, DELETE_HC_HELPER } from '@/lib/graphql/mutations';
import { HelperEditorDialog } from './HelperEditorDialog';
import { HelperTypeIcon } from './HelperTypeIcon';
import {
  formatHelperValue, isCreatableHelperType, HELPER_TYPES,
  type CreatableHelperType,
} from '@/automation/helpers/catalogue';
import type { HelperDefinition, HelperOperation } from '@/automation/types/automation';

/** How often to re-read live values while the section is open. */
const STATE_POLL_MS = 10_000;

interface StoredHelperEntity {
  entityId: string;
  dataJson: string;
  updatedAt: string;
}

/**
 * Parse stored helper rows into definitions.
 *
 * A row whose type the engine can't run is dropped rather than rendered: it
 * would show a control that does nothing. That can only happen if a helper was
 * created by a newer build, so it's a forwards-compatibility guard, not an
 * expected state.
 */
function parseHelpers(entities: StoredHelperEntity[]): HelperDefinition[] {
  const out: HelperDefinition[] = [];
  for (const e of entities) {
    try {
      const parsed = JSON.parse(e.dataJson) as HelperDefinition;
      if (!parsed?.type || !isCreatableHelperType(parsed.type)) continue;
      out.push({ ...parsed, id: parsed.id || e.entityId });
    } catch {
      // A row we can't read is not a row we can safely show a control for.
    }
  }
  return out.sort((a, b) => a.name.localeCompare(b.name));
}

export function HelpersPanel({ homeId, compact, isDarkBackground, active }: {
  homeId: string;
  compact?: boolean;
  isDarkBackground?: boolean;
  /** True while the containing section is open — gates fetching and polling. */
  active: boolean;
}) {
  const [editorOpen, setEditorOpen] = useState(false);
  const [editing, setEditing] = useState<HelperDefinition | undefined>(undefined);
  const [states, setStates] = useState<Record<string, unknown>>({});
  /** Null while unknown; false once we know the engine isn't reachable. */
  const [engineLive, setEngineLive] = useState<boolean | null>(null);

  const { data, refetch } = useQuery<{ hcHelpers: StoredHelperEntity[] }>(HC_HELPERS, {
    variables: { homeId },
    skip: !homeId || !active,
    fetchPolicy: 'cache-first',
    errorPolicy: 'all',
  });

  const [saveHelper] = useMutation(SAVE_HC_HELPER);
  const [deleteHelper] = useMutation(DELETE_HC_HELPER);

  const helpers = useMemo(
    () => parseHelpers(data?.hcHelpers ?? []),
    [data],
  );

  const refreshStates = useCallback(async () => {
    try {
      const res = await serverConnection.request<{ states: Record<string, unknown> }>(
        'automation.helper_states', {},
      );
      setStates(res?.states ?? {});
      setEngineLive(true);
    } catch {
      // The relay may be offline, or running a build without helper support.
      // Values stay unknown and the controls disable themselves — better than
      // showing a stale value beside a control that would act on it.
      setEngineLive(false);
    }
  }, []);

  // Only while open: a helper's value changes when an automation touches it, so
  // it has to be polled, but there's no reason to pay for that when it isn't
  // on screen.
  useEffect(() => {
    if (!active || !homeId) return;
    void refreshStates();
    const t = setInterval(() => { void refreshStates(); }, STATE_POLL_MS);
    return () => clearInterval(t);
  }, [active, homeId, refreshStates]);

  const operate = useCallback(async (
    helperId: string,
    operation: HelperOperation,
    opts: { value?: unknown } = {},
  ) => {
    // Optimistic only for the value we can predict; everything else waits for
    // the round trip so the row can't claim a change the engine refused.
    try {
      const res = await serverConnection.request<{ helperId: string; state: unknown }>(
        'automation.helper_operate', { helperId, operation, ...opts },
      );
      setStates(s => ({ ...s, [helperId]: res?.state }));
    } catch (e) {
      toast.error(e instanceof Error ? e.message : 'Could not change that helper');
      void refreshStates();
    }
  }, [refreshStates]);

  const handleSave = async (helper: HelperDefinition) => {
    try {
      await saveHelper({
        variables: {
          homeId,
          helperId: helper.id || null,
          // id is stripped on create: the store mints it, and writing an empty
          // one into the blob would leave the definition disagreeing with its row.
          data: JSON.stringify(helper.id ? helper : { ...helper, id: undefined }),
        },
      });
      await refetch();
      void refreshStates();
      toast.success(helper.id ? 'Helper saved' : 'Helper created');
    } catch (e) {
      toast.error(e instanceof Error ? e.message : 'Could not save the helper');
      throw e;
    }
  };

  const handleDelete = async (helperId: string) => {
    try {
      await deleteHelper({ variables: { helperId } });
      await refetch();
      toast.success('Helper deleted');
    } catch (e) {
      toast.error(e instanceof Error ? e.message : 'Could not delete the helper');
    }
  };

  const isEmpty = helpers.length === 0;

  return (
    <>
      <div className={compact ? 'mb-3' : 'mb-4'}>
          {/* Labelled, because inside the Automations section an unlabelled row
              of controls would read as more automations. */}
          <div className="flex items-baseline gap-2 mb-1.5">
            <span className={`text-xs font-medium ${isDarkBackground ? 'text-white/70' : 'text-muted-foreground'}`}>
              Helpers
            </span>
            <span className={`text-[11px] ${isDarkBackground ? 'text-white/35' : 'text-muted-foreground/60'}`}>
              values your automations can read and set
            </span>
          </div>
          {isEmpty && (
            <p className={`text-xs mb-2 ${isDarkBackground ? 'text-white/40' : 'text-muted-foreground/50'}`}>
              A helper is something your automations remember — a mode like Home/Away, a cooldown
              timer, or a counter. Apple Home has nowhere to put any of that.
            </p>
          )}
          {engineLive === false && !isEmpty && (
            <p className={`text-xs mb-2 ${isDarkBackground ? 'text-white/40' : 'text-muted-foreground/50'}`}>
              Current values need the relay. Showing definitions only.
            </p>
          )}

          <div className={
            compact
              ? 'grid items-start gap-2 grid-cols-[repeat(auto-fill,minmax(240px,1fr))]'
              : 'grid items-start gap-3 grid-cols-[repeat(auto-fill,minmax(320px,1fr))]'
          }>
            {helpers.map(helper => (
              <HelperRow
                key={helper.id}
                helper={helper}
                value={states[helper.id]}
                live={engineLive === true}
                compact={compact}
                isDarkBackground={isDarkBackground}
                onEdit={() => { setEditing(helper); setEditorOpen(true); }}
                onOperate={operate}
              />
            ))}

            <button
              type="button"
              data-testid="new-helper-button"
              onClick={() => { setEditing(undefined); setEditorOpen(true); }}
              className={`w-full flex items-center justify-center gap-1.5 rounded-[20px] border-2 border-dashed transition-colors ${compact ? 'p-2.5' : 'p-4'} ${
                isDarkBackground
                  ? 'border-white/15 text-white/40 hover:border-white/30 hover:text-white/60'
                  : 'border-muted-foreground/20 text-muted-foreground/50 hover:border-muted-foreground/40 hover:text-muted-foreground'
              }`}
            >
              <Plus className={compact ? 'h-3.5 w-3.5' : 'h-4 w-4'} />
              <span className={compact ? 'text-xs' : 'text-sm'}>New</span>
            </button>
          </div>
      </div>

      <HelperEditorDialog
        open={editorOpen}
        onOpenChange={setEditorOpen}
        homeId={homeId}
        existing={editing}
        onSave={handleSave}
        onDelete={handleDelete}
      />
    </>
  );
}

/** One helper: what it is, what it currently reads, and how to change it. */
function HelperRow({
  helper, value, live, compact, isDarkBackground, onEdit, onOperate,
}: {
  helper: HelperDefinition;
  value: unknown;
  live: boolean;
  compact?: boolean;
  isDarkBackground?: boolean;
  onEdit: () => void;
  onOperate: (id: string, op: HelperOperation, opts?: { value?: unknown }) => Promise<void>;
}) {
  const type = helper.type as CreatableHelperType;
  const info = HELPER_TYPES[type];

  return (
    <div
      className={`rounded-[20px] border transition-colors ${compact ? 'p-2.5' : 'p-3'} ${
        isDarkBackground ? 'border-white/10 bg-white/5' : 'border-border bg-card'
      }`}
    >
      <div className="flex items-center gap-2 min-w-0">
        <HelperTypeIcon
          type={type}
          className={`h-4 w-4 shrink-0 ${isDarkBackground ? 'text-white/50' : 'text-muted-foreground'}`}
        />
        <button
          type="button"
          onClick={onEdit}
          className="min-w-0 flex-1 text-left"
          title="Edit this helper"
        >
          <span className={`block truncate text-sm font-medium ${isDarkBackground ? 'text-white' : ''}`}>
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
 * The inline control for a helper.
 *
 * Only types whose value a person can sensibly set in one gesture get a
 * control; the rest show their value and are edited in the dialog. Everything
 * is disabled when the engine isn't reachable, because a control that appears
 * to work and silently doesn't is worse than one that says it can't.
 */
function HelperControl({
  helper, value, live, onOperate,
}: {
  helper: HelperDefinition;
  value: unknown;
  live: boolean;
  onOperate: (id: string, op: HelperOperation, opts?: { value?: unknown }) => Promise<void>;
}) {
  const disabled = !live;

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
          className="h-8 rounded-md border bg-background px-2 text-xs max-w-[10rem]"
          disabled={disabled}
          aria-label={`Set ${helper.name}`}
          data-testid={`helper-select-${helper.id}`}
          value={typeof value === 'string' ? value : ''}
          onChange={e => onOperate(helper.id, 'set', { value: e.target.value })}
        >
          {/* A value the engine reports that is no longer an option still has to
              be shown, or the row would silently misrepresent the current mode. */}
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
        <span className="text-xs text-muted-foreground max-w-[10rem] truncate block">
          {formatHelperValue(helper, value)}
        </span>
      );
  }
}
