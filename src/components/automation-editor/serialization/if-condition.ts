// Automation Editor - IF condition <-> editor config
//
// The IF node's friendly form is a list of device-state rows ("Reading Lamp ·
// Power is On"), stored in node config and converted to the engine's
// ConditionBlock on save. Conversion lives here, shared by both serializers
// and the config panel, so the same block that saves is the one that reopens.
//
// Three fidelity tiers, decided by what the block contains:
//   simple     — and/or of state / numeric-state leaves (rows)
//   expression — a single template condition (the advanced textarea)
//   custom     — anything else; carried as raw JSON so an automation written
//                by hand or via MCP survives an editor open/save untouched.

import type {
  Condition,
  ConditionBlock,
  NumericStateCondition,
  StateCondition,
} from '@/automation/types/automation';
import { isConditionBlock, createEmptyConditionBlock } from '@/automation/types/automation';
import {
  resolveEntityName, characteristicLabel, characteristicValueLabel, type EntityNameSource,
} from '../entity-labels';

export type IfRowOperator = 'eq' | 'neq' | 'above' | 'below';

export interface IfConditionRow {
  accessoryId: string;
  /** Captured at pick time; display falls back to it before HomeKit data loads. */
  accessoryName?: string;
  characteristicType: string;
  operator: IfRowOperator;
  /** eq / neq */
  value?: unknown;
  /** above / below */
  threshold?: number;
}

export interface IfConditionConfig {
  conditionMode?: 'simple' | 'expression' | 'custom';
  conditionLogic?: 'and' | 'or';
  conditions?: IfConditionRow[];
  expression?: string;
  conditionJson?: string;
}

/** A row the serializer can act on — matches the config panel's completeness check. */
export function isCompleteRow(row: IfConditionRow): boolean {
  if (!row.accessoryId || !row.characteristicType) return false;
  if (row.operator === 'above' || row.operator === 'below') return typeof row.threshold === 'number';
  return row.value !== undefined && row.value !== null && row.value !== '';
}

export function rowsToConditionBlock(rows: IfConditionRow[], logic: 'and' | 'or', idBase: string): ConditionBlock {
  const conditions: (Condition | ConditionBlock)[] = rows.filter(isCompleteRow).map((row, i) => {
    const id = `${idBase}-c${i}`;
    switch (row.operator) {
      case 'above':
        return { type: 'numeric_state', id, accessoryId: row.accessoryId, characteristicType: row.characteristicType, above: row.threshold } satisfies NumericStateCondition;
      case 'below':
        return { type: 'numeric_state', id, accessoryId: row.accessoryId, characteristicType: row.characteristicType, below: row.threshold } satisfies NumericStateCondition;
      case 'neq':
        // The engine has no "is not" leaf; NOT-wrap an equality. NOT blocks
        // pass when ALL children are false, so one child inverts cleanly.
        return {
          operator: 'not',
          conditions: [{ type: 'state', id, accessoryId: row.accessoryId, characteristicType: row.characteristicType, value: row.value } satisfies StateCondition],
        };
      default:
        return { type: 'state', id, accessoryId: row.accessoryId, characteristicType: row.characteristicType, value: row.value } satisfies StateCondition;
    }
  });
  return { operator: logic, conditions };
}

/**
 * Build the engine condition for an IF node from its editor config.
 * Empty/unconfigured yields an empty block (passes — same as before).
 */
export function ifConfigToConditionBlock(config: IfConditionConfig, idBase: string): ConditionBlock {
  const mode = config.conditionMode
    // Legacy configs predate conditionMode and only ever held an expression.
    ?? (config.expression ? 'expression' : 'simple');

  if (mode === 'custom' && config.conditionJson) {
    try {
      const parsed = JSON.parse(config.conditionJson) as ConditionBlock;
      if (parsed && Array.isArray(parsed.conditions)) return parsed;
    } catch { /* fall through to the other modes */ }
  }

  if (mode === 'expression') {
    const expression = (config.expression ?? '').trim();
    if (!expression) return createEmptyConditionBlock();
    return { operator: 'and', conditions: [{ type: 'template', id: `${idBase}-expr`, expression }] };
  }

  const rows = config.conditions ?? [];
  if (rows.filter(isCompleteRow).length === 0) return createEmptyConditionBlock();
  return rowsToConditionBlock(rows, config.conditionLogic === 'or' ? 'or' : 'and', idBase);
}

function leafToRow(node: Condition | ConditionBlock): IfConditionRow | null {
  // NOT-wrapped single state condition = "is not".
  if (isConditionBlock(node)) {
    if (node.operator === 'not' && node.conditions.length === 1) {
      const inner = node.conditions[0];
      if (!isConditionBlock(inner) && inner.type === 'state') {
        return { accessoryId: inner.accessoryId, characteristicType: inner.characteristicType, operator: 'neq', value: inner.value };
      }
    }
    return null;
  }
  if (node.type === 'state') {
    return { accessoryId: node.accessoryId, characteristicType: node.characteristicType, operator: 'eq', value: node.value };
  }
  if (node.type === 'numeric_state') {
    const hasAbove = node.above !== undefined;
    const hasBelow = node.below !== undefined;
    if (hasAbove && !hasBelow) return { accessoryId: node.accessoryId, characteristicType: node.characteristicType, operator: 'above', threshold: node.above };
    if (hasBelow && !hasAbove) return { accessoryId: node.accessoryId, characteristicType: node.characteristicType, operator: 'below', threshold: node.below };
    return null; // both bounds — representable as two rows only under AND; keep custom
  }
  return null;
}

/**
 * Recover editor config from an engine condition block. Never lossy: what the
 * rows/expression forms can't express comes back as `custom` with raw JSON,
 * which serializes straight through on the next save.
 */
export function conditionBlockToIfConfig(block: ConditionBlock | undefined): IfConditionConfig {
  if (!block || block.conditions.length === 0) {
    return { conditionMode: 'simple', conditionLogic: 'and', conditions: [], expression: '' };
  }

  // A single template condition is the expression form.
  const only = block.conditions.length === 1 ? block.conditions[0] : undefined;
  if (only && !isConditionBlock(only) && only.type === 'template' && block.operator !== 'not') {
    return { conditionMode: 'expression', expression: only.expression };
  }

  if (block.operator === 'and' || block.operator === 'or') {
    const rows = block.conditions.map(leafToRow);
    if (rows.every((r): r is IfConditionRow => r !== null)) {
      return { conditionMode: 'simple', conditionLogic: block.operator, conditions: rows, expression: '' };
    }
  }

  return { conditionMode: 'custom', conditionJson: JSON.stringify(block), expression: '' };
}

const OPERATOR_WORDS: Record<IfRowOperator, string> = {
  eq: 'is', neq: 'is not', above: '>', below: '<',
};

/** Human line for one row: "Reading Lamp · Power is On". */
export function describeIfRow(row: IfConditionRow, names?: EntityNameSource): string {
  const device = resolveEntityName(names, { accessoryId: row.accessoryId, fallbackName: row.accessoryName });
  const char = characteristicLabel(row.characteristicType);
  const value = row.operator === 'above' || row.operator === 'below'
    ? String(row.threshold ?? '')
    : characteristicValueLabel(row.characteristicType, row.value);
  return `${device} · ${char} ${OPERATOR_WORDS[row.operator]} ${value}`;
}

/** Node-subtitle summary for an IF's condition config. */
export function summarizeIfConfig(config: IfConditionConfig, names?: EntityNameSource): string {
  const mode = config.conditionMode ?? (config.expression ? 'expression' : 'simple');
  if (mode === 'custom') return 'Custom condition';
  if (mode === 'expression') return (config.expression ?? '').slice(0, 30);
  const rows = (config.conditions ?? []).filter(isCompleteRow);
  if (rows.length === 0) return '';
  const first = describeIfRow(rows[0], names);
  return rows.length > 1 ? `${first} +${rows.length - 1} more` : first;
}
