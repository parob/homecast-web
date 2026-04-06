// Homecast Automation Engine - Core Type Definitions
// Inspired by Home Assistant's Trigger-Condition-Action model

// ============================================================
// Utilities
// ============================================================

export interface Duration {
  hours?: number;
  minutes?: number;
  seconds?: number;
}

export function durationToMs(d: Duration): number {
  return ((d.hours ?? 0) * 3600 + (d.minutes ?? 0) * 60 + (d.seconds ?? 0)) * 1000;
}

// ============================================================
// Automation (top-level)
// ============================================================

export type AutomationMode = 'single' | 'restart' | 'queued' | 'parallel';

export interface Automation {
  id: string;
  name: string;
  description?: string;
  homeId: string;
  enabled: boolean;
  mode: AutomationMode;
  maxRunning?: number;
  triggers: Trigger[];
  conditions: ConditionBlock;
  actions: Action[];
  variables?: Record<string, unknown>;
  blueprintId?: string;
  metadata: AutomationMetadata;
}

export interface AutomationMetadata {
  createdAt: string;
  updatedAt: string;
  lastTriggeredAt?: string;
  triggerCount: number;
}

// ============================================================
// Triggers
// ============================================================

export type Trigger =
  | StateTrigger
  | NumericStateTrigger
  | TimeTrigger
  | TimePatternTrigger
  | SunTrigger
  | WebhookTrigger
  | EventTrigger
  | SystemTrigger
  | TemplateTrigger;

export type TriggerType = Trigger['type'];

interface BaseTrigger {
  id: string;
  enabled?: boolean;
}

export interface StateTrigger extends BaseTrigger {
  type: 'state';
  accessoryId?: string;
  serviceGroupId?: string; // Mutually exclusive with accessoryId — triggers on any accessory in group
  characteristicType: string;
  from?: unknown;
  to?: unknown;
  for?: Duration;
}

export interface NumericStateTrigger extends BaseTrigger {
  type: 'numeric_state';
  accessoryId?: string;
  serviceGroupId?: string; // Mutually exclusive with accessoryId — triggers on any accessory in group
  characteristicType: string;
  above?: number;
  below?: number;
  for?: Duration;
}

export interface TimeTrigger extends BaseTrigger {
  type: 'time';
  at: string; // HH:MM:SS or HH:MM
  weekdays?: number[]; // 0=Sun .. 6=Sat
}

export interface TimePatternTrigger extends BaseTrigger {
  type: 'time_pattern';
  hours?: string; // "/2" = every 2 hours, "1" = at hour 1, "*" = every
  minutes?: string;
  seconds?: string;
}

export interface SunTrigger extends BaseTrigger {
  type: 'sun';
  event: 'sunrise' | 'sunset';
  offset?: Duration;
}

export interface WebhookTrigger extends BaseTrigger {
  type: 'webhook';
  webhookId: string;
  allowedMethods?: string[];
}

export interface EventTrigger extends BaseTrigger {
  type: 'event';
  eventType: string;
  eventData?: Record<string, unknown>;
}

export interface SystemTrigger extends BaseTrigger {
  type: 'system';
  event: 'relay_connected' | 'relay_disconnected' | 'automation_reloaded';
}

export interface TemplateTrigger extends BaseTrigger {
  type: 'template';
  expression: string;
  for?: Duration;
}

// Data passed to the execution context when a trigger fires
export interface TriggerData {
  triggerId: string;
  triggerType: TriggerType;
  fromValue?: unknown;
  toValue?: unknown;
  accessoryId?: string;
  serviceGroupId?: string;
  characteristicType?: string;
  eventType?: string;
  eventData?: Record<string, unknown>;
  webhookPayload?: unknown;
  timestamp: number;
}

// ============================================================
// Conditions
// ============================================================

export interface ConditionBlock {
  operator: 'and' | 'or' | 'not';
  conditions: (Condition | ConditionBlock)[];
}

export type Condition =
  | StateCondition
  | NumericStateCondition
  | TimeCondition
  | SunCondition
  | TemplateCondition
  | TriggerCondition;

export type ConditionType = Condition['type'];

interface BaseCondition {
  id: string;
  enabled?: boolean;
}

export interface StateCondition extends BaseCondition {
  type: 'state';
  accessoryId: string;
  characteristicType: string;
  value: unknown;
}

export interface NumericStateCondition extends BaseCondition {
  type: 'numeric_state';
  accessoryId: string;
  characteristicType: string;
  above?: number;
  below?: number;
}

export interface TimeCondition extends BaseCondition {
  type: 'time';
  after?: string; // HH:MM:SS
  before?: string; // HH:MM:SS
  weekdays?: number[]; // 0=Sun .. 6=Sat
}

export interface SunCondition extends BaseCondition {
  type: 'sun';
  after?: 'sunrise' | 'sunset';
  afterOffset?: Duration;
  before?: 'sunrise' | 'sunset';
  beforeOffset?: Duration;
}

export interface TemplateCondition extends BaseCondition {
  type: 'template';
  expression: string;
}

export interface TriggerCondition extends BaseCondition {
  type: 'trigger';
  triggerId: string;
}

// Type guard: is this a ConditionBlock or a leaf Condition?
export function isConditionBlock(c: Condition | ConditionBlock): c is ConditionBlock {
  return 'operator' in c && 'conditions' in c;
}

// ============================================================
// Actions
// ============================================================

export type Action =
  | SetCharacteristicAction
  | SetServiceGroupAction
  | ExecuteSceneAction
  | DelayAction
  | WaitForTriggerAction
  | WaitForTemplateAction
  | ChooseAction
  | IfThenElseAction
  | RepeatAction
  | ParallelAction
  | VariablesAction
  | StopAction
  | FireEventAction
  | FireWebhookAction
  | ToggleAutomationAction
  | CallScriptAction
  | NotifyAction
  | CodeAction
  | MergeAction;

export type ActionType = Action['type'];

interface BaseAction {
  id: string;
  alias?: string;
  enabled?: boolean;
  /** Error handling strategy: stop (default), continue, or retry */
  onError?: 'stop' | 'continue' | 'retry';
  /** Max retry attempts (only used when onError is 'retry') */
  maxRetries?: number;
  /** Delay between retries in ms (only used when onError is 'retry') */
  retryDelayMs?: number;
}

export interface SetCharacteristicAction extends BaseAction {
  type: 'set_characteristic';
  accessoryId: string; // Can contain {{ template }}
  characteristicType: string;
  value: unknown; // Can contain {{ template }}
}

export interface SetServiceGroupAction extends BaseAction {
  type: 'set_service_group';
  groupId: string;
  characteristicType: string;
  value: unknown;
  homeId?: string;
}

export interface ExecuteSceneAction extends BaseAction {
  type: 'execute_scene';
  sceneId: string;
  homeId?: string;
}

export interface DelayAction extends BaseAction {
  type: 'delay';
  duration: Duration;
}

export interface WaitForTriggerAction extends BaseAction {
  type: 'wait_for_trigger';
  triggers: Trigger[];
  timeout?: Duration;
  continueOnTimeout?: boolean; // default true
}

export interface WaitForTemplateAction extends BaseAction {
  type: 'wait_for_template';
  expression: string;
  timeout?: Duration;
  continueOnTimeout?: boolean;
}

export interface ChooseAction extends BaseAction {
  type: 'choose';
  choices: ChoiceBranch[];
  default?: Action[];
}

export interface ChoiceBranch {
  alias?: string;
  conditions: ConditionBlock;
  actions: Action[];
}

export interface IfThenElseAction extends BaseAction {
  type: 'if_then_else';
  condition: ConditionBlock;
  then: Action[];
  else?: Action[];
}

export interface RepeatAction extends BaseAction {
  type: 'repeat';
  mode: 'count' | 'while' | 'until' | 'for_each';
  count?: number;
  whileCondition?: ConditionBlock;
  untilCondition?: ConditionBlock;
  forEachItems?: unknown[]; // Can contain {{ template }} strings
  sequence: Action[];
}

export interface ParallelAction extends BaseAction {
  type: 'parallel';
  branches: Action[][]; // Each inner array is a sequential action chain
}

export interface VariablesAction extends BaseAction {
  type: 'variables';
  variables: Record<string, unknown>; // Values can contain {{ template }}
}

export interface StopAction extends BaseAction {
  type: 'stop';
  reason?: string;
  error?: boolean;
  responseVariable?: string;
}

export interface FireEventAction extends BaseAction {
  type: 'fire_event';
  eventType: string;
  eventData?: Record<string, unknown>;
}

export interface FireWebhookAction extends BaseAction {
  type: 'fire_webhook';
  url: string;
  method?: 'GET' | 'POST' | 'PUT' | 'DELETE';
  headers?: Record<string, string>;
  body?: unknown;
}

export interface ToggleAutomationAction extends BaseAction {
  type: 'toggle_automation';
  automationId: string;
  action: 'enable' | 'disable' | 'toggle' | 'trigger';
}

export interface CallScriptAction extends BaseAction {
  type: 'call_script';
  scriptId: string;
  variables?: Record<string, unknown>;
  responseVariable?: string;
}

export interface NotifyAction extends BaseAction {
  type: 'notify';
  message: string; // Can contain {{ template }}
  title?: string;
  data?: Record<string, unknown>; // Platform-specific (e.g., action buttons)
}

export interface CodeAction extends BaseAction {
  type: 'code';
  code: string; // JavaScript source — receives `input` object, returns result
  timeout?: number; // Max execution time in ms (default 5000)
}

export interface MergeAction extends BaseAction {
  type: 'merge';
  mode: 'append' | 'combine' | 'wait_all';
  combineKey?: string; // For 'combine' mode: key field to merge on
  inputIds: string[]; // Node IDs whose outputs to merge
}

// ============================================================
// Scripts (reusable action sequences)
// ============================================================

export type ScriptMode = 'single' | 'restart' | 'queued' | 'parallel';

export interface Script {
  id: string;
  name: string;
  description?: string;
  homeId: string;
  mode: ScriptMode;
  maxRunning?: number;
  inputs?: ScriptInput[];
  actions: Action[];
  variables?: Record<string, unknown>;
  metadata: {
    createdAt: string;
    updatedAt: string;
  };
}

export interface ScriptInput {
  name: string;
  label: string;
  description?: string;
  required?: boolean;
  default?: unknown;
  selector: InputSelector;
}

export type InputSelector =
  | { type: 'device'; category?: string }
  | { type: 'characteristic'; deviceInput: string }
  | { type: 'number'; min?: number; max?: number; step?: number; unit?: string }
  | { type: 'text'; multiline?: boolean }
  | { type: 'boolean' }
  | { type: 'select'; options: { value: string; label: string }[] }
  | { type: 'time' }
  | { type: 'duration' }
  | { type: 'scene' };

// ============================================================
// Helpers (virtual entities)
// ============================================================

export type HelperDefinition =
  | InputBooleanHelper
  | InputNumberHelper
  | InputSelectHelper
  | InputTextHelper
  | InputDateTimeHelper
  | TimerHelper
  | CounterHelper
  | ScheduleHelper
  | TemplateSensorHelper
  | GroupHelper;

export type HelperType = HelperDefinition['type'];

interface BaseHelper {
  id: string;
  name: string;
  homeId: string;
  icon?: string;
}

export interface InputBooleanHelper extends BaseHelper {
  type: 'input_boolean';
  initialValue?: boolean;
}

export interface InputNumberHelper extends BaseHelper {
  type: 'input_number';
  min: number;
  max: number;
  step: number;
  initialValue?: number;
  unit?: string;
}

export interface InputSelectHelper extends BaseHelper {
  type: 'input_select';
  options: string[];
  initialValue?: string;
}

export interface InputTextHelper extends BaseHelper {
  type: 'input_text';
  minLength?: number;
  maxLength?: number;
  pattern?: string;
  initialValue?: string;
}

export interface InputDateTimeHelper extends BaseHelper {
  type: 'input_datetime';
  hasDate: boolean;
  hasTime: boolean;
  initialValue?: string;
}

export interface TimerHelper extends BaseHelper {
  type: 'timer';
  duration?: Duration;
  restoreOnRestart?: boolean;
}

export interface CounterHelper extends BaseHelper {
  type: 'counter';
  initial?: number;
  step?: number;
  min?: number;
  max?: number;
}

export interface ScheduleBlock {
  day: number; // 0=Sun .. 6=Sat
  from: string; // HH:MM
  to: string; // HH:MM
}

export interface ScheduleHelper extends BaseHelper {
  type: 'schedule';
  blocks: ScheduleBlock[];
}

export interface TemplateSensorHelper extends BaseHelper {
  type: 'template_sensor';
  expression: string;
  unit?: string;
}

export interface GroupHelper extends BaseHelper {
  type: 'group';
  accessoryIds: string[];
  characteristicType: string;
  aggregation: 'any' | 'all' | 'min' | 'max' | 'mean';
}

// ============================================================
// Blueprints
// ============================================================

export interface Blueprint {
  id: string;
  name: string;
  description: string;
  author?: string;
  category: string;
  icon?: string;
  inputs: BlueprintInput[];
  automation: Automation; // Template with {{ input.xxx }} placeholders
}

export interface BlueprintInput {
  name: string;
  label: string;
  description?: string;
  required?: boolean;
  default?: unknown;
  selector: InputSelector;
}

// ============================================================
// Empty/default factories
// ============================================================

export function createEmptyConditionBlock(): ConditionBlock {
  return { operator: 'and', conditions: [] };
}

export function createEmptyAutomation(homeId: string): Automation {
  return {
    id: crypto.randomUUID(),
    name: '',
    homeId,
    enabled: true,
    mode: 'single',
    triggers: [],
    conditions: createEmptyConditionBlock(),
    actions: [],
    metadata: {
      createdAt: new Date().toISOString(),
      updatedAt: new Date().toISOString(),
      triggerCount: 0,
    },
  };
}
