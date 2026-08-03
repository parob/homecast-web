// Homecast Automation Engine - Helper catalogue
//
// The single list of helper types a user may create, with the defaults and
// display rules that go with each. Shared by the Helpers section and the
// automation editor so the two can never disagree about what exists.

import type { HelperDefinition, HelperType } from '../types/automation';

/**
 * Helper types the engine can actually run.
 *
 * `HelperDefinition` also declares `template_sensor` and `group`, and
 * `HelperManager.register()` has no case for either — creating one would
 * register a helper with no initial value and no behaviour, which is
 * indistinguishable from a helper that simply never changes. `schedule` is
 * worse than useless: `isScheduleActive` is evaluated once at registration and
 * nothing re-evaluates it, so its state is frozen at whatever it was when the
 * relay started.
 *
 * They are omitted here rather than shown-and-disabled: a type that cannot be
 * created isn't a choice, and listing it only invites the question. If any of
 * the three gains an implementation, add it here and it appears everywhere.
 */
export const CREATABLE_HELPER_TYPES = [
  'input_boolean',
  'input_select',
  'counter',
  'timer',
  'input_number',
  'input_text',
  'input_datetime',
] as const satisfies readonly HelperType[];

export type CreatableHelperType = (typeof CREATABLE_HELPER_TYPES)[number];

export function isCreatableHelperType(type: string): type is CreatableHelperType {
  return (CREATABLE_HELPER_TYPES as readonly string[]).includes(type);
}

export interface HelperTypeInfo {
  type: CreatableHelperType;
  label: string;
  /** What it is, in the user's terms. */
  description: string;
  /** A concrete thing people actually build with it. */
  example: string;
  /** Lucide icon name, resolved by the component that renders it. */
  icon: string;
  /** Whether a person can set the value by hand from the Helpers list. */
  manuallySettable: boolean;
}

export const HELPER_TYPES: Record<CreatableHelperType, HelperTypeInfo> = {
  input_boolean: {
    type: 'input_boolean',
    label: 'Switch',
    description: 'An on/off flag with no device behind it.',
    example: 'Guest Staying — automations check it before running the night routine.',
    icon: 'ToggleLeft',
    manuallySettable: true,
  },
  input_select: {
    type: 'input_select',
    label: 'Mode',
    description: 'One choice from a list you define.',
    example: 'Home Mode — Home / Away / Night / Vacation.',
    icon: 'ListChecks',
    manuallySettable: true,
  },
  counter: {
    type: 'counter',
    label: 'Counter',
    description: 'A number automations can count up and down.',
    example: 'Door Opens Today — reset at midnight, notify past ten.',
    icon: 'Hash',
    manuallySettable: true,
  },
  timer: {
    type: 'timer',
    label: 'Timer',
    description: 'A countdown an automation can start, pause or cancel.',
    example: 'Porch Cooldown — start on motion, ignore further motion until it finishes.',
    icon: 'Timer',
    // A timer's value is a lifecycle (idle/active/paused), not a value to type
    // in. It is driven by start/pause/cancel, which the list offers instead.
    manuallySettable: false,
  },
  input_number: {
    type: 'input_number',
    label: 'Number',
    description: 'A number within a range you set.',
    example: 'Comfort Temperature — one place to change what every automation targets.',
    icon: 'SlidersHorizontal',
    manuallySettable: true,
  },
  input_text: {
    type: 'input_text',
    label: 'Text',
    description: 'A short piece of text.',
    example: 'Last Alert — what the most recent notification said.',
    icon: 'Type',
    manuallySettable: true,
  },
  input_datetime: {
    type: 'input_datetime',
    label: 'Date & time',
    description: 'A date, a time, or both.',
    example: 'Holiday Ends — automations compare against it to resume the schedule.',
    icon: 'CalendarClock',
    manuallySettable: true,
  },
};

/** The type list in display order. */
export const HELPER_TYPE_LIST: HelperTypeInfo[] =
  CREATABLE_HELPER_TYPES.map(t => HELPER_TYPES[t]);

/**
 * A new helper of the given type, with defaults that produce something usable
 * without further configuration.
 *
 * `id` is left to the caller: in Community the IndexedDB layer mints it, and in
 * cloud the server does, so inventing one here would create a second source of
 * truth for identity — the exact split that caused the hc_id/live-UUID bug.
 */
export function defaultHelper(
  type: CreatableHelperType,
  id: string,
  homeId: string,
  name: string,
): HelperDefinition {
  const base = { id, homeId, name };
  switch (type) {
    case 'input_boolean':
      return { ...base, type, initialValue: false };
    case 'input_select':
      // Two options, because one is not a choice and zero makes `initialValue`
      // resolve to '' — a mode helper that reads as empty until someone edits it.
      return { ...base, type, options: ['Home', 'Away'], initialValue: 'Home' };
    case 'counter':
      return { ...base, type, initial: 0, step: 1, min: 0 };
    case 'timer':
      return { ...base, type, duration: { minutes: 5 } };
    case 'input_number':
      return { ...base, type, min: 0, max: 100, step: 1, initialValue: 0 };
    case 'input_text':
      return { ...base, type, initialValue: '' };
    case 'input_datetime':
      return { ...base, type, hasDate: true, hasTime: true, initialValue: '' };
  }
}

/** Human-readable current value for the Helpers list. */
export function formatHelperValue(helper: HelperDefinition, value: unknown): string {
  if (value === undefined || value === null || value === '') return '—';
  switch (helper.type) {
    case 'input_boolean':
      return value ? 'On' : 'Off';
    case 'timer':
      // The store holds the lifecycle state, not a countdown.
      return String(value);
    case 'input_number':
      return helper.unit ? `${value} ${helper.unit}` : String(value);
    default:
      return String(value);
  }
}

/**
 * Why a helper cannot be saved, or null if it can.
 *
 * Returned as a message rather than a boolean so the dialog can say what is
 * wrong instead of just disabling Save with no explanation.
 */
export function validateHelper(helper: HelperDefinition): string | null {
  if (!helper.name.trim()) return 'Give the helper a name.';

  switch (helper.type) {
    case 'input_select': {
      const options = helper.options.map(o => o.trim()).filter(Boolean);
      if (options.length < 2) return 'A mode needs at least two options.';
      if (new Set(options).size !== options.length) return 'Options must be unique.';
      if (helper.initialValue && !options.includes(helper.initialValue)) {
        return 'The starting value must be one of the options.';
      }
      return null;
    }
    case 'input_number': {
      if (!Number.isFinite(helper.min) || !Number.isFinite(helper.max)) {
        return 'Minimum and maximum must be numbers.';
      }
      if (helper.min >= helper.max) return 'Maximum must be greater than minimum.';
      if (!(helper.step > 0)) return 'Step must be greater than zero.';
      return null;
    }
    case 'counter': {
      if (helper.min !== undefined && helper.max !== undefined && helper.min >= helper.max) {
        return 'Maximum must be greater than minimum.';
      }
      if (helper.step !== undefined && !(helper.step > 0)) return 'Step must be greater than zero.';
      return null;
    }
    case 'timer': {
      const d = helper.duration;
      const total = (d?.hours ?? 0) + (d?.minutes ?? 0) + (d?.seconds ?? 0);
      if (!total) return 'Set how long the timer runs.';
      return null;
    }
    case 'input_datetime':
      if (!helper.hasDate && !helper.hasTime) return 'Include a date, a time, or both.';
      return null;
    default:
      return null;
  }
}
