// Homecast Automation Engine - Execution Trace Types

import type { TriggerData } from './automation';

// ============================================================
// Execution Trace
// ============================================================

export type ExecutionStatus = 'running' | 'success' | 'error' | 'stopped' | 'timeout' | 'cancelled';

export interface ExecutionTrace {
  id: string;
  automationId: string;
  automationName: string;
  startedAt: string;
  finishedAt?: string;
  status: ExecutionStatus;
  triggerData: TriggerData;
  steps: TraceStep[];
  variables: Record<string, unknown>;
  error?: string;
}

// ============================================================
// Trace Steps
// ============================================================

export type TraceStepResult = 'passed' | 'failed' | 'executed' | 'skipped' | 'error' | 'running' | 'timeout';

export interface TraceStep {
  index: number;
  type: 'trigger' | 'condition' | 'action';
  nodeId: string;
  nodeType: string;
  nodeSummary: string;
  startedAt: string;
  finishedAt?: string;
  result: TraceStepResult;
  input?: Record<string, unknown>;
  output?: Record<string, unknown>;
  error?: string;
  children?: TraceStep[];
}

// ============================================================
// Execution Context (runtime state during a single automation run)
// ============================================================

export interface ExecutionVariables {
  [key: string]: unknown;
}

export interface WaitResult {
  completed: boolean;
  trigger?: TriggerData;
  remainingTimeout?: number;
}

export interface RepeatState {
  index: number;
  first: boolean;
  last: boolean;
  item?: unknown; // Current item for for_each
}

// ============================================================
// Execution Events (for real-time trace streaming)
// ============================================================

export type ExecutionEvent =
  | { type: 'started'; traceId: string; automationId: string; timestamp: string }
  | { type: 'step'; traceId: string; step: TraceStep }
  | { type: 'variables_changed'; traceId: string; variables: Record<string, unknown> }
  | { type: 'finished'; traceId: string; status: ExecutionStatus; error?: string; timestamp: string };

// ============================================================
// State Change Event (from StateStore)
// ============================================================

export interface StateChangeEvent {
  accessoryId: string;
  characteristicType: string;
  newValue: unknown;
  oldValue: unknown;
  timestamp: number;
}

// ============================================================
// Custom Event (inter-automation)
// ============================================================

export interface AutomationEvent {
  type: string;
  data?: Record<string, unknown>;
  source?: string; // automation ID that fired the event
  timestamp: number;
}
