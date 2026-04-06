// Automation Editor - Node Config Panel (right tray)
// Opens on double-click, has Done/Cancel/Delete buttons

import { useCallback, useMemo, useState, useRef } from 'react';
import { type Node, type Edge } from '@xyflow/react';
import { Dialog, DialogContent, DialogTitle } from '@/components/ui/dialog';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';
import { Switch } from '@/components/ui/switch';
import { Slider } from '@/components/ui/slider';
import { Textarea } from '@/components/ui/textarea';
import { Trash2, Copy } from 'lucide-react';
import { cn } from '@/lib/utils';
import { CATEGORY_STYLES, NODE_OUTPUT_SCHEMAS, type FlowNodeData } from '../constants';
import { AccessoryPicker } from '@/components/AccessoryPicker';
import type { HomeKitAccessory, HomeKitHome, HomeKitScene, HomeKitServiceGroup } from '@/lib/graphql/types';

// ============================================================
// Upstream context — what data flows into this node
// ============================================================

interface UpstreamField {
  label: string;        // e.g., "Living Room Light → brightness"
  expression: string;   // e.g., "states('acc-123', 'brightness')"
  nodeLabel: string;    // e.g., "Device Changed"
}

function getUpstreamFields(
  nodeId: string,
  allNodes: Node<FlowNodeData>[],
  allEdges: Edge[],
  accessories: HomeKitAccessory[],
): UpstreamField[] {
  const fields: UpstreamField[] = [];
  const visited = new Set<string>();
  const queue = [nodeId];

  while (queue.length > 0) {
    const currentId = queue.shift()!;
    if (visited.has(currentId)) continue;
    visited.add(currentId);

    // Find edges pointing TO this node
    const inEdges = allEdges.filter((e) => e.target === currentId);
    for (const edge of inEdges) {
      const sourceNode = allNodes.find((n) => n.id === edge.source);
      if (!sourceNode) continue;

      const data = sourceNode.data as FlowNodeData;
      const config = data.config;

      // Add node output fields from schema registry
      const outputSchema = NODE_OUTPUT_SCHEMAS[data.nodeType];
      if (outputSchema) {
        const nodeLabel = data.subtitle || data.label;
        for (const field of outputSchema) {
          fields.push({
            label: `${nodeLabel} → ${field.label}`,
            expression: `nodes['${sourceNode.id}'].data.${field.field}`,
            nodeLabel: data.label,
          });
        }
      }

      // Also add legacy device state queries for backwards compatibility
      if (config.accessoryId && config.characteristicType) {
        const accName = accessories.find((a) => a.id === config.accessoryId)?.name
          ?? (config.accessoryName as string)
          ?? String(config.accessoryId).slice(0, 12);
        const charType = config.characteristicType as string;

        fields.push({
          label: `${accName} → ${charType} (live state)`,
          expression: `states('${config.accessoryId}', '${charType}')`,
          nodeLabel: data.label,
        });
      }

      // Recurse upstream
      queue.push(sourceNode.id);
    }
  }

  // Always add trigger context
  fields.push({
    label: 'Trigger → previous value',
    expression: 'trigger.from_value',
    nodeLabel: 'Trigger data',
  });
  fields.push({
    label: 'Trigger → new value',
    expression: 'trigger.to_value',
    nodeLabel: 'Trigger data',
  });
  fields.push({
    label: 'Current hour',
    expression: 'now().hour',
    nodeLabel: 'Time',
  });

  return fields;
}

// ============================================================
// Main component
// ============================================================

interface NodeConfigPanelProps {
  node: Node<FlowNodeData>;
  allNodes?: Node<FlowNodeData>[];
  allEdges?: Edge[];
  onUpdateData: (updates: Partial<FlowNodeData>) => void;
  onDelete: () => void;
  onDone: () => void;
  onCancel: () => void;
  accessories?: HomeKitAccessory[];
  homes?: HomeKitHome[];
  scenes?: HomeKitScene[];
  serviceGroups?: HomeKitServiceGroup[];
}

export function NodeConfigPanel({ node, allNodes = [], allEdges = [], onUpdateData, onDelete, onDone, onCancel, accessories = [], homes = [], scenes = [], serviceGroups = [] }: NodeConfigPanelProps) {
  const data = node.data as FlowNodeData;
  const styles = CATEGORY_STYLES[data.category] ?? CATEGORY_STYLES.action;
  const [pickerOpen, setPickerOpen] = useState(false);
  const [pickerCallback, setPickerCallback] = useState<((a: HomeKitAccessory) => void) | null>(null);

  const updateConfig = useCallback(
    (key: string, value: unknown) => {
      const newConfig = { ...data.config, [key]: value };
      const summary = buildSummary(data.nodeType, data.category, newConfig, accessories);
      onUpdateData({
        config: { ...newConfig, summary },
        subtitle: summary || undefined,
        isConfigured: isNodeConfigured(data.nodeType, data.category, newConfig),
      });
    },
    [data, onUpdateData, accessories],
  );

  const updateConfigBatch = useCallback(
    (updates: Record<string, unknown>) => {
      const newConfig = { ...data.config, ...updates };
      const summary = buildSummary(data.nodeType, data.category, newConfig, accessories);
      onUpdateData({
        config: { ...newConfig, summary },
        subtitle: summary || undefined,
        isConfigured: isNodeConfigured(data.nodeType, data.category, newConfig),
      });
    },
    [data, onUpdateData, accessories],
  );

  const openDevicePicker = useCallback((onSelect: (a: HomeKitAccessory) => void) => {
    setPickerCallback(() => onSelect);
    setPickerOpen(true);
  }, []);

  return (
    <>
      <div className="w-full sm:w-80 border-l flex flex-col min-h-0 h-full shrink-0 bg-background" data-testid="config-panel">
        {/* Header */}
        <div className="h-12 border-b flex items-center gap-2 px-3 shrink-0">
          <div className={cn('w-1.5 h-5 rounded-full', styles.borderColor.replace('border-l-', 'bg-'))} />
          <span className="text-sm font-medium flex-1 truncate">{data.label}</span>
        </div>

        {/* Enabled toggle */}
        <div className="px-4 py-2.5 border-b flex items-center justify-between shrink-0">
          <Label className="text-xs">Enabled</Label>
          <Switch
            checked={data.enabled}
            onCheckedChange={(checked) => onUpdateData({ enabled: checked })}
          />
        </div>

        {/* Config form — scrollable */}
        <div className="flex-1 min-h-0 overflow-y-auto">
          <div className="p-4 space-y-4">
            {renderConfigForm(data.category, data.nodeType, data.config, updateConfig, updateConfigBatch, accessories, homes, scenes, openDevicePicker, node.id, allNodes, allEdges, serviceGroups)}

            {/* Error handling section — action nodes only */}
            {data.category === 'action' && (
              <div className="border-t pt-3 mt-3">
                <p className="text-[10px] text-muted-foreground font-medium mb-2">Error Handling</p>
                <ConfigField label="On Error">
                  <Select
                    value={(data.config.onError as string) ?? 'stop'}
                    onValueChange={(v) => updateConfig('onError', v === 'stop' ? undefined : v)}
                  >
                    <SelectTrigger className="h-8 text-xs"><SelectValue /></SelectTrigger>
                    <SelectContent>
                      <SelectItem value="stop">Stop automation</SelectItem>
                      <SelectItem value="continue">Continue to next node</SelectItem>
                      <SelectItem value="retry">Retry with backoff</SelectItem>
                    </SelectContent>
                  </Select>
                </ConfigField>
                {data.config.onError === 'retry' && (
                  <div className="flex gap-2 mt-2">
                    <div className="flex-1">
                      <Label className="text-[10px] text-muted-foreground">Max retries</Label>
                      <Input
                        type="number"
                        value={(data.config.maxRetries as number) ?? 3}
                        onChange={(e) => updateConfig('maxRetries', parseInt(e.target.value) || 3)}
                        className="h-8 text-xs"
                        min={1}
                        max={10}
                      />
                    </div>
                    <div className="flex-1">
                      <Label className="text-[10px] text-muted-foreground">Delay (ms)</Label>
                      <Input
                        type="number"
                        value={(data.config.retryDelayMs as number) ?? 1000}
                        onChange={(e) => updateConfig('retryDelayMs', parseInt(e.target.value) || 1000)}
                        className="h-8 text-xs"
                        min={100}
                      />
                    </div>
                  </div>
                )}
              </div>
            )}
          </div>
        </div>

        {/* Footer: Delete | Cancel | Done */}
        <div className="p-3 border-t flex items-center gap-2 shrink-0">
          <Button variant="ghost" size="sm" onClick={onDelete} className="text-destructive hover:text-destructive h-8 px-2">
            <Trash2 className="h-3.5 w-3.5" />
          </Button>
          <div className="flex-1" />
          <Button variant="outline" size="sm" onClick={onCancel} className="h-8">Cancel</Button>
          <Button size="sm" onClick={onDone} className="h-8" data-testid="config-done-button">Done</Button>
        </div>
      </div>

      {/* Device Picker Dialog — single-select mode */}
      <Dialog open={pickerOpen} onOpenChange={setPickerOpen}>
        <DialogContent className="max-w-[95%] sm:max-w-[500px] max-h-[85vh] flex flex-col p-0 gap-0 [&_.h-4.w-4.rounded.border]:hidden" onOpenAutoFocus={(e) => e.preventDefault()}>
          <DialogTitle className="sr-only">Select Device</DialogTitle>
          <AccessoryPicker
            accessories={accessories}
            homes={homes}
            selectedIds={new Set(data.config.accessoryId ? [data.config.accessoryId as string] : [])}
            onToggle={(id) => {
              const acc = accessories.find((a) => a.id === id);
              if (acc && pickerCallback) pickerCallback(acc);
              setPickerOpen(false);
            }}
          />
        </DialogContent>
      </Dialog>
    </>
  );
}

// ============================================================
// Per-type config forms (simplified types)
// ============================================================

function renderConfigForm(
  category: string,
  nodeType: string,
  config: Record<string, unknown>,
  updateConfig: (key: string, value: unknown) => void,
  updateConfigBatch: (updates: Record<string, unknown>) => void,
  accessories: HomeKitAccessory[],
  homes: HomeKitHome[],
  scenes: HomeKitScene[],
  openDevicePicker: (onSelect: (accessory: HomeKitAccessory) => void) => void,
  nodeId?: string,
  allNodes?: Node<FlowNodeData>[],
  allEdges?: Edge[],
  serviceGroups?: HomeKitServiceGroup[],
) {
  // ---- TRIGGERS ----
  if (category === 'trigger') {
    switch (nodeType) {
      case 'device_changed': {
        const sourceMode = (config.sourceMode as string) ?? 'device';
        return (
          <>
            {/* Device / Group toggle */}
            {(serviceGroups?.length ?? 0) > 0 && (
              <div className="flex gap-1 p-0.5 bg-muted rounded-lg mb-1">
                <button
                  type="button"
                  className={cn(
                    'flex-1 px-2 py-1 text-xs rounded-md transition-colors',
                    sourceMode === 'device' ? 'bg-background shadow-sm font-medium' : 'text-muted-foreground hover:text-foreground',
                  )}
                  onClick={() => updateConfigBatch({ sourceMode: 'device', serviceGroupId: undefined, serviceGroupName: undefined })}
                >
                  Device
                </button>
                <button
                  type="button"
                  className={cn(
                    'flex-1 px-2 py-1 text-xs rounded-md transition-colors',
                    sourceMode === 'group' ? 'bg-background shadow-sm font-medium' : 'text-muted-foreground hover:text-foreground',
                  )}
                  onClick={() => updateConfigBatch({ sourceMode: 'group', accessoryId: undefined, accessoryName: undefined })}
                >
                  Group
                </button>
              </div>
            )}

            {sourceMode === 'group' ? (
              <GroupConfigFields
                config={config}
                updateConfig={updateConfig}
                updateConfigBatch={updateConfigBatch}
                serviceGroups={serviceGroups ?? []}
                accessories={accessories}
              />
            ) : (
              <DeviceConfigFields
                config={config}
                updateConfig={updateConfig}
                updateConfigBatch={updateConfigBatch}
                accessories={accessories}
                openDevicePicker={openDevicePicker}
              />
            )}
            <ConfigField label="To value (optional)">
              <Input
                value={String(config.to ?? '')}
                onChange={(e) => updateConfig('to', e.target.value || undefined)}
                placeholder="Any value change"
                className="h-8 text-xs"
              />
            </ConfigField>
            <ConfigField label="From value (optional)">
              <Input
                value={String(config.from ?? '')}
                onChange={(e) => updateConfig('from', e.target.value || undefined)}
                placeholder="Any previous value"
                className="h-8 text-xs"
              />
            </ConfigField>
            <div className="border-t pt-3 mt-3">
              <p className="text-[10px] text-muted-foreground mb-2">Numeric thresholds (optional — for temperature, brightness, etc.)</p>
              <div className="flex gap-2">
                <div className="flex-1">
                  <Label className="text-[10px] text-muted-foreground">Above</Label>
                  <Input
                    type="number"
                    value={(config.above as number) ?? ''}
                    onChange={(e) => updateConfig('above', e.target.value ? parseFloat(e.target.value) : undefined)}
                    placeholder="—"
                    className="h-8 text-xs"
                  />
                </div>
                <div className="flex-1">
                  <Label className="text-[10px] text-muted-foreground">Below</Label>
                  <Input
                    type="number"
                    value={(config.below as number) ?? ''}
                    onChange={(e) => updateConfig('below', e.target.value ? parseFloat(e.target.value) : undefined)}
                    placeholder="—"
                    className="h-8 text-xs"
                  />
                </div>
              </div>
            </div>
          </>
        );
      }

      case 'schedule': {
        const mode = (config.scheduleMode as string) ?? 'time';
        return (
          <>
            {/* Mode tabs */}
            <div className="flex gap-1 p-0.5 bg-muted rounded-lg">
              {(['time', 'interval', 'sun'] as const).map((m) => (
                <button
                  key={m}
                  type="button"
                  className={cn(
                    'flex-1 px-2 py-1 text-xs rounded-md transition-colors',
                    mode === m ? 'bg-background shadow-sm font-medium' : 'text-muted-foreground hover:text-foreground',
                  )}
                  onClick={() => updateConfig('scheduleMode', m)}
                >
                  {m === 'time' ? 'Time' : m === 'interval' ? 'Interval' : 'Sun'}
                </button>
              ))}
            </div>

            {mode === 'time' && (
              <>
                <ConfigField label="At">
                  <Input
                    type="time"
                    value={(config.at as string) ?? ''}
                    onChange={(e) => updateConfig('at', e.target.value)}
                    className="h-8 text-xs"
                  />
                </ConfigField>
                <ConfigField label="Days">
                  <WeekdayPicker
                    value={(config.weekdays as number[]) ?? []}
                    onChange={(v) => updateConfig('weekdays', v)}
                  />
                </ConfigField>
              </>
            )}

            {mode === 'interval' && (
              <>
                <ConfigField label="Every N hours">
                  <Input value={(config.hours as string) ?? ''} onChange={(e) => updateConfig('hours', e.target.value)} placeholder='e.g., /2 (every 2h) or *' className="h-8 text-xs" />
                </ConfigField>
                <ConfigField label="Every N minutes">
                  <Input value={(config.minutes as string) ?? ''} onChange={(e) => updateConfig('minutes', e.target.value)} placeholder='e.g., /15 (every 15m)' className="h-8 text-xs" />
                </ConfigField>
              </>
            )}

            {mode === 'sun' && (
              <>
                <ConfigField label="Event">
                  <Select value={(config.event as string) ?? 'sunset'} onValueChange={(v) => updateConfig('event', v)}>
                    <SelectTrigger className="h-8 text-xs"><SelectValue /></SelectTrigger>
                    <SelectContent>
                      <SelectItem value="sunrise">Sunrise</SelectItem>
                      <SelectItem value="sunset">Sunset</SelectItem>
                    </SelectContent>
                  </Select>
                </ConfigField>
                <ConfigField label="Offset (minutes)">
                  <Input
                    type="number"
                    value={(config.offsetMinutes as number) ?? 0}
                    onChange={(e) => updateConfig('offsetMinutes', parseInt(e.target.value) || 0)}
                    className="h-8 text-xs"
                  />
                </ConfigField>
              </>
            )}
          </>
        );
      }

      case 'webhook': {
        // Auto-fill webhook ID on first render
        const webhookId = (config.webhookId as string) || '';
        if (!webhookId) {
          // Schedule auto-fill (can't call updateConfig during render)
          setTimeout(() => updateConfig('webhookId', crypto.randomUUID().slice(0, 8)), 0);
        }
        return (
          <>
            <ConfigField label="Webhook ID">
              <Input value={webhookId} onChange={(e) => updateConfig('webhookId', e.target.value)} className="h-8 text-xs" />
            </ConfigField>
            {webhookId && (
              <div className="p-2 bg-muted rounded-md">
                <p className="text-[10px] text-muted-foreground mb-1">Webhook URL:</p>
                <code className="text-[10px] font-mono break-all">POST /webhook/{webhookId}</code>
              </div>
            )}
          </>
        );
      }

      default:
        return <p className="text-xs text-muted-foreground">Configuration for {nodeType} trigger</p>;
    }
  }

  // ---- ACTIONS ----
  if (category === 'action') {
    switch (nodeType) {
      case 'set_device':
        return (
          <DeviceConfigFields
            config={config}
            updateConfig={updateConfig}
            updateConfigBatch={updateConfigBatch}
            accessories={accessories}
            openDevicePicker={openDevicePicker}
            showValue
          />
        );

      case 'run_scene': {
        return (
          <ConfigField label="Scene">
            {scenes.length > 0 ? (
              <Select value={(config.sceneId as string) ?? ''} onValueChange={(v) => updateConfig('sceneId', v)}>
                <SelectTrigger className="h-8 text-xs"><SelectValue placeholder="Select a scene..." /></SelectTrigger>
                <SelectContent>
                  {scenes.map((s) => (
                    <SelectItem key={s.id} value={s.id}>
                      <span>{s.name}</span>
                      <span className="ml-1.5 text-muted-foreground text-[10px]">{s.actionCount} action{s.actionCount !== 1 ? 's' : ''}</span>
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            ) : (
              <p className="text-xs text-muted-foreground">No scenes available. Create scenes in Apple Home first.</p>
            )}
          </ConfigField>
        );
      }

      case 'delay':
        return (
          <ConfigField label="Duration">
            <div className="flex gap-2">
              <div className="flex-1">
                <Label className="text-[10px] text-muted-foreground">Hours</Label>
                <Input type="number" min={0} value={(config.hours as number) ?? 0} onChange={(e) => updateConfig('hours', parseInt(e.target.value) || 0)} className="h-8 text-xs" />
              </div>
              <div className="flex-1">
                <Label className="text-[10px] text-muted-foreground">Minutes</Label>
                <Input type="number" min={0} value={(config.minutes as number) ?? 0} onChange={(e) => updateConfig('minutes', parseInt(e.target.value) || 0)} className="h-8 text-xs" />
              </div>
              <div className="flex-1">
                <Label className="text-[10px] text-muted-foreground">Seconds</Label>
                <Input type="number" min={0} value={(config.seconds as number) ?? 0} onChange={(e) => updateConfig('seconds', parseInt(e.target.value) || 0)} className="h-8 text-xs" />
              </div>
            </div>
          </ConfigField>
        );

      case 'notify':
        return (
          <>
            <ConfigField label="Title">
              <Input value={(config.title as string) ?? ''} onChange={(e) => updateConfig('title', e.target.value)} placeholder="Optional title" className="h-8 text-xs" />
            </ConfigField>
            <ConfigField label="Message">
              <Textarea value={(config.message as string) ?? ''} onChange={(e) => updateConfig('message', e.target.value)} placeholder="Notification message..." className="text-xs min-h-[60px]" />
            </ConfigField>
          </>
        );

      case 'http_request':
        return (
          <>
            <ConfigField label="URL">
              <Input value={(config.url as string) ?? ''} onChange={(e) => updateConfig('url', e.target.value)} placeholder="https://..." className="h-8 text-xs" />
            </ConfigField>
            <ConfigField label="Method">
              <Select value={(config.method as string) ?? 'POST'} onValueChange={(v) => updateConfig('method', v)}>
                <SelectTrigger className="h-8 text-xs"><SelectValue /></SelectTrigger>
                <SelectContent>
                  <SelectItem value="GET">GET</SelectItem>
                  <SelectItem value="POST">POST</SelectItem>
                  <SelectItem value="PUT">PUT</SelectItem>
                  <SelectItem value="DELETE">DELETE</SelectItem>
                </SelectContent>
              </Select>
            </ConfigField>
          </>
        );

      case 'code':
        return (
          <>
            <ConfigField label="JavaScript Code">
              <Textarea
                value={(config.code as string) ?? ''}
                onChange={(e) => updateConfig('code', e.target.value)}
                placeholder={'// Access upstream data via input.nodes\n// Access trigger via input.trigger\n// Access variables via input.variables\n// Return a value to pass downstream\n\nreturn { result: input.trigger.to_value * 2 };'}
                className="font-mono text-xs min-h-[120px] resize-y"
                rows={8}
              />
            </ConfigField>
            <ConfigField label="Timeout (ms)">
              <Input
                type="number"
                value={(config.timeout as number) ?? 5000}
                onChange={(e) => updateConfig('timeout', parseInt(e.target.value) || 5000)}
                className="h-8 text-xs"
              />
            </ConfigField>
            {nodeId && allNodes && allEdges && (
              <div className="border-t pt-3 mt-3">
                <p className="text-[10px] text-muted-foreground mb-2">Available input data</p>
                <div className="flex flex-wrap gap-1">
                  {getUpstreamFields(nodeId, allNodes, allEdges, accessories).slice(0, 10).map((f, i) => (
                    <button key={i} type="button" className="text-[9px] px-1.5 py-0.5 rounded bg-muted hover:bg-muted/80 font-mono truncate max-w-full" title={f.expression}
                      onClick={() => {
                        const ref = `input.${f.expression.startsWith('nodes') ? f.expression : `trigger.${f.expression.replace('trigger.', '')}`}`;
                        updateConfig('code', ((config.code as string) ?? '') + ref);
                      }}>
                      {f.label}
                    </button>
                  ))}
                </div>
              </div>
            )}
          </>
        );

      default:
        return <p className="text-xs text-muted-foreground">Configuration for {nodeType} action</p>;
    }
  }

  // ---- CONDITION (for loaded automations with condition nodes) ----
  if (category === 'condition') {
    switch (nodeType) {
      case 'state':
        return (
          <DeviceConfigFields
            config={config}
            updateConfig={updateConfig}
            updateConfigBatch={updateConfigBatch}
            accessories={accessories}
            openDevicePicker={openDevicePicker}
            showValue
          />
        );
      case 'time':
        return (
          <>
            <ConfigField label="After">
              <Input type="time" value={(config.after as string) ?? ''} onChange={(e) => updateConfig('after', e.target.value)} className="h-8 text-xs" />
            </ConfigField>
            <ConfigField label="Before">
              <Input type="time" value={(config.before as string) ?? ''} onChange={(e) => updateConfig('before', e.target.value)} className="h-8 text-xs" />
            </ConfigField>
            <ConfigField label="Days">
              <WeekdayPicker value={(config.weekdays as number[]) ?? []} onChange={(v) => updateConfig('weekdays', v)} />
            </ConfigField>
          </>
        );
      case 'template':
        return (
          <ConfigField label="Expression">
            <Textarea value={(config.expression as string) ?? ''} onChange={(e) => updateConfig('expression', e.target.value)} placeholder="states('ACC_ID', 'temp') > 25" className="text-xs font-mono min-h-[80px]" />
          </ConfigField>
        );
      default:
        return <p className="text-xs text-muted-foreground">Configuration for {nodeType} condition</p>;
    }
  }

  // ---- LOGIC ----
  if (category === 'logic') {
    switch (nodeType) {
      case 'if':
        return (
          <IfNodeConfig
            config={config}
            updateConfig={updateConfig}
            nodeId={nodeId}
            allNodes={allNodes}
            allEdges={allEdges}
            accessories={accessories}
          />
        );

      case 'wait':
        return (
          <>
            <ConfigField label="Timeout (seconds)">
              <Input type="number" value={(config.timeoutSeconds as number) ?? 30} onChange={(e) => updateConfig('timeoutSeconds', parseInt(e.target.value) || 30)} className="h-8 text-xs" />
            </ConfigField>
            <ConfigField label="Continue on timeout">
              <Switch checked={(config.continueOnTimeout as boolean) ?? true} onCheckedChange={(v) => updateConfig('continueOnTimeout', v)} />
            </ConfigField>
          </>
        );

      case 'sub_workflow':
        return (
          <>
            <ConfigField label="Automation ID">
              <Input
                value={(config.automationId as string) ?? ''}
                onChange={(e) => updateConfig('automationId', e.target.value)}
                placeholder="Paste automation ID..."
                className="h-8 text-xs font-mono"
              />
            </ConfigField>
            <p className="text-[10px] text-muted-foreground">Runs another automation as a sub-flow. The sub-automation's final variables become this node's output.</p>
          </>
        );

      case 'merge':
        return (
          <>
            <ConfigField label="Merge Mode">
              <Select value={(config.mergeMode as string) ?? 'append'} onValueChange={(v) => updateConfig('mergeMode', v)}>
                <SelectTrigger className="h-8 text-xs"><SelectValue /></SelectTrigger>
                <SelectContent>
                  <SelectItem value="append">Append (combine into array)</SelectItem>
                  <SelectItem value="combine">Combine (merge objects)</SelectItem>
                  <SelectItem value="wait_all">Wait All (wait for all inputs)</SelectItem>
                </SelectContent>
              </Select>
            </ConfigField>
            {config.mergeMode === 'combine' && (
              <ConfigField label="Combine Key">
                <Input
                  value={(config.combineKey as string) ?? ''}
                  onChange={(e) => updateConfig('combineKey', e.target.value)}
                  placeholder="e.g., id"
                  className="h-8 text-xs"
                />
              </ConfigField>
            )}
            <p className="text-[10px] text-muted-foreground mt-2">Connect two branches to the input handles (A and B) at the top of this node.</p>
          </>
        );

      default:
        return <p className="text-xs text-muted-foreground">Configuration for {nodeType}</p>;
    }
  }

  return <p className="text-xs text-muted-foreground">No configuration needed</p>;
}

// ============================================================
// IF node config — shows upstream data + expression editor
// ============================================================

function IfNodeConfig({
  config,
  updateConfig,
  nodeId,
  allNodes,
  allEdges,
  accessories,
}: {
  config: Record<string, unknown>;
  updateConfig: (key: string, value: unknown) => void;
  nodeId?: string;
  allNodes?: Node<FlowNodeData>[];
  allEdges?: Edge[];
  accessories: HomeKitAccessory[];
}) {
  const textareaRef = useRef<HTMLTextAreaElement>(null);

  // Get upstream device references
  const upstreamFields = useMemo(() => {
    if (!nodeId || !allNodes || !allEdges) return [];
    return getUpstreamFields(nodeId, allNodes, allEdges, accessories);
  }, [nodeId, allNodes, allEdges, accessories]);

  const insertExpression = (expr: string) => {
    const textarea = textareaRef.current;
    if (!textarea) {
      // No cursor — append to end
      const current = (config.expression as string) ?? '';
      updateConfig('expression', current ? `${current} ${expr}` : expr);
      return;
    }
    const start = textarea.selectionStart;
    const end = textarea.selectionEnd;
    const current = (config.expression as string) ?? '';
    const newVal = current.slice(0, start) + expr + current.slice(end);
    updateConfig('expression', newVal);
    // Restore cursor after the inserted text
    setTimeout(() => {
      textarea.focus();
      textarea.setSelectionRange(start + expr.length, start + expr.length);
    }, 0);
  };

  const deviceFields = upstreamFields.filter((f) => f.nodeLabel !== 'Trigger data' && f.nodeLabel !== 'Time');
  const builtinFields = upstreamFields.filter((f) => f.nodeLabel === 'Trigger data' || f.nodeLabel === 'Time');

  return (
    <>
      {/* Upstream data — devices from connected nodes */}
      {deviceFields.length > 0 && (
        <div className="space-y-1.5">
          <Label className="text-xs font-medium">Input data <span className="text-muted-foreground font-normal">(click to insert)</span></Label>
          <div className="space-y-0.5">
            {deviceFields.map((field, i) => (
              <button
                key={i}
                type="button"
                className="w-full flex items-center gap-2 px-2 py-1.5 rounded-md bg-muted/50 hover:bg-muted text-left transition-colors group"
                onClick={() => insertExpression(field.expression)}
                title={field.expression}
              >
                <div className="min-w-0 flex-1">
                  <div className="text-[11px] font-medium truncate">{field.label}</div>
                  <div className="text-[9px] font-mono text-muted-foreground truncate">{field.expression}</div>
                </div>
                <Copy className="w-3 h-3 text-muted-foreground opacity-0 group-hover:opacity-100 shrink-0" />
              </button>
            ))}
          </div>
        </div>
      )}

      {/* Expression editor */}
      <ConfigField label="Condition expression">
        <Textarea
          ref={textareaRef}
          value={(config.expression as string) ?? ''}
          onChange={(e) => updateConfig('expression', e.target.value)}
          placeholder={deviceFields.length > 0 ? 'Click a field above or type an expression...' : "states('ACC_ID', 'power_state') == 1"}
          className="text-xs font-mono min-h-[80px] bg-muted/30"
        />
      </ConfigField>

      <p className="text-[10px] text-muted-foreground">
        Evaluates to true or false. <span className="text-emerald-600 font-medium">True</span> and <span className="text-red-400 font-medium">False</span> outputs go to different branches.
      </p>

      {/* Quick-insert: trigger data + time */}
      <div className="space-y-1.5">
        <Label className="text-[10px] text-muted-foreground">Quick insert</Label>
        <div className="flex flex-wrap gap-1">
          {builtinFields.map((field, i) => (
            <button
              key={i}
              type="button"
              className="px-2 py-0.5 rounded-full bg-muted text-[10px] font-mono hover:bg-muted-foreground/20 transition-colors"
              onClick={() => insertExpression(field.expression)}
              title={field.expression}
            >
              {field.label}
            </button>
          ))}
          {/* Common operators */}
          {['==', '!=', '>', '<', '>=', '<=', '&&', '||'].map((op) => (
            <button
              key={op}
              type="button"
              className="px-2 py-0.5 rounded-full bg-muted text-[10px] font-mono hover:bg-muted-foreground/20 transition-colors"
              onClick={() => insertExpression(` ${op} `)}
            >
              {op}
            </button>
          ))}
        </div>
      </div>

      {/* Function reference */}
      <details className="text-[10px] text-muted-foreground">
        <summary className="cursor-pointer font-medium hover:text-foreground">All functions</summary>
        <div className="mt-1.5 space-y-1 font-mono bg-muted/30 rounded-md p-2">
          <p className="cursor-pointer hover:text-foreground" onClick={() => insertExpression("states('', '')")}>states(accId, charType)</p>
          <p className="cursor-pointer hover:text-foreground" onClick={() => insertExpression("is_state('', '', 1)")}>is_state(accId, charType, val)</p>
          <p className="cursor-pointer hover:text-foreground" onClick={() => insertExpression("last_changed('', '')")}>last_changed(accId, charType)</p>
          <p className="cursor-pointer hover:text-foreground" onClick={() => insertExpression('now().hour')}>now().hour / .minute / .weekday</p>
          <p className="cursor-pointer hover:text-foreground" onClick={() => insertExpression('min()')}>min(), max(), abs(), round()</p>
        </div>
      </details>
    </>
  );
}

// ============================================================
// Shared form components
// ============================================================

function DeviceConfigFields({
  config,
  updateConfig,
  updateConfigBatch,
  accessories,
  openDevicePicker,
  showValue,
}: {
  config: Record<string, unknown>;
  updateConfig: (key: string, value: unknown) => void;
  updateConfigBatch?: (updates: Record<string, unknown>) => void;
  accessories: HomeKitAccessory[];
  openDevicePicker: (onSelect: (a: HomeKitAccessory) => void) => void;
  showValue?: boolean;
}) {
  const selectedAccessory = accessories.find((a) => a.id === config.accessoryId);
  const characteristics = selectedAccessory?.services
    ?.flatMap((s) => s.characteristics)
    ?.filter((c) => c.isWritable || c.isReadable) ?? [];

  return (
    <>
      <ConfigField label="Device">
        <Button
          variant="outline"
          size="sm"
          className="w-full justify-start h-8 text-xs font-normal"
          onClick={() => openDevicePicker((acc) => {
            if (updateConfigBatch) {
              updateConfigBatch({ accessoryId: acc.id, accessoryName: acc.name, characteristicType: '' });
            } else {
              updateConfig('accessoryId', acc.id);
            }
          })}
          data-testid="select-device-button"
        >
          {selectedAccessory?.name ?? (config.accessoryId ? String(config.accessoryId).slice(0, 12) + '...' : 'Select a device...')}
        </Button>
      </ConfigField>

      {config.accessoryId && (
        <ConfigField label="Characteristic">
          {characteristics.length > 0 ? (
            <Select
              value={(config.characteristicType as string) ?? ''}
              onValueChange={(v) => updateConfig('characteristicType', v)}
            >
              <SelectTrigger className="h-8 text-xs" data-testid="characteristic-select">
                <SelectValue placeholder="Select..." />
              </SelectTrigger>
              <SelectContent>
                {characteristics.map((c) => {
                  const meta = getCharMeta(c);
                  return (
                    <SelectItem key={c.id} value={c.characteristicType}>
                      <span>{c.characteristicType}</span>
                      {meta && <span className="ml-1.5 text-muted-foreground text-[10px]">{meta}</span>}
                    </SelectItem>
                  );
                })}
              </SelectContent>
            </Select>
          ) : (
            <Input
              value={(config.characteristicType as string) ?? ''}
              onChange={(e) => updateConfig('characteristicType', e.target.value)}
              placeholder="e.g., power_state"
              className="h-8 text-xs"
            />
          )}
        </ConfigField>
      )}

      {showValue && config.characteristicType && (() => {
        const selectedChar = characteristics.find((c) => c.characteristicType === config.characteristicType);
        // Boolean characteristic → switch
        if (selectedChar?.validValues && selectedChar.validValues.length === 2 &&
            selectedChar.validValues.includes(0) && selectedChar.validValues.includes(1)) {
          return (
            <ConfigField label="Value">
              <div className="flex items-center gap-2">
                <Switch
                  checked={config.value === true || config.value === 1 || config.value === '1'}
                  onCheckedChange={(v) => updateConfig('value', v ? 1 : 0)}
                  data-testid="value-input"
                />
                <span className="text-xs text-muted-foreground">{config.value ? 'On' : 'Off'}</span>
              </div>
            </ConfigField>
          );
        }
        // Numeric characteristic with range → slider + input
        if (selectedChar?.minValue !== undefined && selectedChar?.maxValue !== undefined) {
          const numVal = typeof config.value === 'number' ? config.value : Number(config.value) || selectedChar.minValue;
          return (
            <ConfigField label={`Value (${selectedChar.minValue}–${selectedChar.maxValue})`}>
              <Slider
                value={[numVal]}
                min={selectedChar.minValue}
                max={selectedChar.maxValue}
                step={selectedChar.stepValue ?? 1}
                onValueChange={([v]) => updateConfig('value', v)}
                className="my-2"
              />
              <Input type="number" value={numVal} min={selectedChar.minValue} max={selectedChar.maxValue} step={selectedChar.stepValue ?? 1} onChange={(e) => updateConfig('value', parseFloat(e.target.value) || 0)} className="h-8 text-xs" data-testid="value-input" />
            </ConfigField>
          );
        }
        // Enum characteristic → select
        if (selectedChar?.validValues && selectedChar.validValues.length > 2) {
          return (
            <ConfigField label="Value">
              <Select value={String(config.value ?? '')} onValueChange={(v) => updateConfig('value', Number(v))}>
                <SelectTrigger className="h-8 text-xs" data-testid="value-input"><SelectValue placeholder="Select..." /></SelectTrigger>
                <SelectContent>
                  {selectedChar.validValues.map((v) => (
                    <SelectItem key={v} value={String(v)}>{v}</SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </ConfigField>
          );
        }
        // Default: text input
        return (
          <ConfigField label="Value">
            <Input value={String(config.value ?? '')} onChange={(e) => updateConfig('value', e.target.value)} placeholder="e.g., 80 or {{ expression }}" className="h-8 text-xs" data-testid="value-input" />
          </ConfigField>
        );
      })()}
    </>
  );
}

function GroupConfigFields({
  config,
  updateConfig,
  updateConfigBatch,
  serviceGroups,
  accessories,
}: {
  config: Record<string, unknown>;
  updateConfig: (key: string, value: unknown) => void;
  updateConfigBatch?: (updates: Record<string, unknown>) => void;
  serviceGroups: HomeKitServiceGroup[];
  accessories: HomeKitAccessory[];
}) {
  const selectedGroup = serviceGroups.find((g) => g.id === config.serviceGroupId);

  // Derive common characteristics from the group's member accessories
  const groupCharacteristics = (() => {
    if (!selectedGroup) return [];
    const groupAccessories = accessories.filter((a) => selectedGroup.accessoryIds.includes(a.id));
    const charSets = groupAccessories.map(
      (a) => new Set(a.services?.flatMap((s) => s.characteristics)?.map((c) => c.characteristicType) ?? []),
    );
    if (charSets.length === 0) return [];
    // Intersection of all characteristic types
    const common = [...charSets[0]].filter((ct) => charSets.every((s) => s.has(ct)));
    return common;
  })();

  return (
    <>
      <ConfigField label="Service Group">
        <Select
          value={(config.serviceGroupId as string) ?? ''}
          onValueChange={(v) => {
            const group = serviceGroups.find((g) => g.id === v);
            if (updateConfigBatch) {
              updateConfigBatch({ serviceGroupId: v, serviceGroupName: group?.name ?? v, characteristicType: '' });
            } else {
              updateConfig('serviceGroupId', v);
            }
          }}
        >
          <SelectTrigger className="h-8 text-xs" data-testid="select-group-button">
            <SelectValue placeholder="Select a group..." />
          </SelectTrigger>
          <SelectContent>
            {serviceGroups.map((g) => (
              <SelectItem key={g.id} value={g.id}>
                <span>{g.name}</span>
                <span className="ml-1.5 text-muted-foreground text-[10px]">{g.accessoryIds.length} devices</span>
              </SelectItem>
            ))}
          </SelectContent>
        </Select>
      </ConfigField>

      {config.serviceGroupId && (
        <ConfigField label="Characteristic">
          {groupCharacteristics.length > 0 ? (
            <Select
              value={(config.characteristicType as string) ?? ''}
              onValueChange={(v) => updateConfig('characteristicType', v)}
            >
              <SelectTrigger className="h-8 text-xs" data-testid="characteristic-select">
                <SelectValue placeholder="Select..." />
              </SelectTrigger>
              <SelectContent>
                {groupCharacteristics.map((ct) => (
                  <SelectItem key={ct} value={ct}>{ct}</SelectItem>
                ))}
              </SelectContent>
            </Select>
          ) : (
            <Input
              value={(config.characteristicType as string) ?? ''}
              onChange={(e) => updateConfig('characteristicType', e.target.value)}
              placeholder="e.g., power_state"
              className="h-8 text-xs"
            />
          )}
        </ConfigField>
      )}
    </>
  );
}

function getCharMeta(c: { validValues?: number[]; minValue?: number; maxValue?: number }): string {
  if (c.validValues && c.validValues.length === 2 && c.validValues.includes(0) && c.validValues.includes(1)) return 'on/off';
  if (c.minValue !== undefined && c.maxValue !== undefined) return `${c.minValue}–${c.maxValue}`;
  if (c.validValues && c.validValues.length > 0) return `${c.validValues.length} values`;
  return '';
}

function ConfigField({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <div className="space-y-1.5">
      <Label className="text-xs font-medium">{label}</Label>
      {children}
    </div>
  );
}

const DAYS = ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat'];

function WeekdayPicker({ value, onChange }: { value: number[]; onChange: (v: number[]) => void }) {
  return (
    <div className="flex gap-1">
      {DAYS.map((day, idx) => (
        <button
          key={day}
          type="button"
          className={cn(
            'w-8 h-7 rounded-md text-[10px] font-medium transition-colors',
            value.includes(idx)
              ? 'bg-primary text-primary-foreground'
              : 'bg-muted text-muted-foreground hover:bg-muted/80',
          )}
          onClick={() => {
            const next = value.includes(idx)
              ? value.filter((d) => d !== idx)
              : [...value, idx].sort();
            onChange(next);
          }}
        >
          {day}
        </button>
      ))}
    </div>
  );
}

// ============================================================
// Summary builders (simplified types)
// ============================================================

function buildSummary(nodeType: string, category: string, config: Record<string, unknown>, accessories?: HomeKitAccessory[]): string {
  const getDeviceName = () => {
    if (config.accessoryName) return config.accessoryName as string;
    if (config.accessoryId && accessories) {
      const acc = accessories.find((a) => a.id === config.accessoryId);
      if (acc) return acc.name;
    }
    return config.accessoryId ? String(config.accessoryId).slice(0, 12) + '…' : '';
  };

  if (category === 'trigger') {
    switch (nodeType) {
      case 'device_changed':
        if (config.serviceGroupId) {
          const groupName = (config.serviceGroupName as string) ?? 'Group';
          const char = config.characteristicType ? ` / ${config.characteristicType}` : '';
          const threshold = (config.above !== undefined || config.below !== undefined)
            ? ` (${config.above !== undefined ? `>${config.above}` : ''}${config.below !== undefined ? `<${config.below}` : ''})`
            : '';
          return `${groupName}${char}${threshold}`;
        }
        if (config.accessoryId) {
          const name = getDeviceName();
          const char = config.characteristicType ? ` / ${config.characteristicType}` : '';
          const threshold = (config.above !== undefined || config.below !== undefined)
            ? ` (${config.above !== undefined ? `>${config.above}` : ''}${config.below !== undefined ? `<${config.below}` : ''})`
            : '';
          return `${name}${char}${threshold}`;
        }
        break;
      case 'schedule': {
        const mode = (config.scheduleMode as string) ?? 'time';
        if (mode === 'time' && config.at) return `At ${config.at}`;
        if (mode === 'interval') {
          const parts: string[] = [];
          if (config.hours) parts.push(`${config.hours}h`);
          if (config.minutes) parts.push(`${config.minutes}m`);
          return parts.length ? `Every ${parts.join(' ')}` : 'Interval';
        }
        if (mode === 'sun') return `${config.event ?? 'sunset'}${config.offsetMinutes ? ` ±${config.offsetMinutes}m` : ''}`;
        break;
      }
      case 'webhook':
        if (config.webhookId) return `ID: ${(config.webhookId as string).slice(0, 12)}`;
        break;
    }
  }

  if (category === 'action') {
    switch (nodeType) {
      case 'set_device':
        if (config.accessoryId) return `Set ${getDeviceName()} to ${config.value ?? '?'}`;
        break;
      case 'run_scene':
        if (config.sceneId) return `Scene ${(config.sceneId as string).slice(0, 12)}…`;
        break;
      case 'delay': {
        const parts: string[] = [];
        if (config.hours) parts.push(`${config.hours}h`);
        if (config.minutes) parts.push(`${config.minutes}m`);
        if (config.seconds) parts.push(`${config.seconds}s`);
        return parts.length ? `Wait ${parts.join(' ')}` : '';
      }
      case 'notify':
        if (config.message) return `${(config.message as string).slice(0, 30)}`;
        break;
      case 'http_request':
        if (config.url) return `${config.method ?? 'POST'} ${(config.url as string).slice(0, 25)}`;
        break;
      case 'code':
        if (config.code) return `${(config.code as string).split('\n').length} lines`;
        break;
    }
  }

  if (category === 'logic') {
    switch (nodeType) {
      case 'if':
        if (config.expression) return `${(config.expression as string).slice(0, 30)}`;
        break;
      case 'wait':
        return `Timeout: ${config.timeoutSeconds ?? 30}s`;
      case 'merge':
        return (config.mergeMode as string) ?? 'append';
      case 'sub_workflow':
        if (config.automationId) return `ID: ${(config.automationId as string).slice(0, 8)}...`;
        break;
    }
  }

  // Condition nodes (loaded from existing automations)
  if (category === 'condition') {
    switch (nodeType) {
      case 'state':
        if (config.accessoryId) return `${getDeviceName()} == ${config.value ?? '?'}`;
        break;
      case 'time': {
        const parts: string[] = [];
        if (config.after) parts.push(`after ${config.after}`);
        if (config.before) parts.push(`before ${config.before}`);
        return parts.join(', ') || 'Time window';
      }
      case 'template':
        if (config.expression) return `${(config.expression as string).slice(0, 30)}`;
        break;
    }
  }

  return '';
}

function isNodeConfigured(nodeType: string, category: string, config: Record<string, unknown>): boolean {
  if (category === 'trigger') {
    switch (nodeType) {
      case 'device_changed': return !!((config.accessoryId || config.serviceGroupId) && config.characteristicType);
      case 'schedule': {
        const mode = (config.scheduleMode as string) ?? 'time';
        if (mode === 'time') return !!config.at;
        if (mode === 'interval') return !!(config.hours || config.minutes);
        if (mode === 'sun') return !!config.event;
        return false;
      }
      case 'webhook': return !!config.webhookId;
    }
  }
  if (category === 'action') {
    switch (nodeType) {
      case 'set_device': return !!(config.accessoryId && config.characteristicType);
      case 'run_scene': return !!config.sceneId;
      case 'delay': return !!((config.hours as number) || (config.minutes as number) || (config.seconds as number));
      case 'notify': return !!config.message;
      case 'http_request': return !!config.url;
      case 'code': return !!config.code;
    }
  }
  if (category === 'condition') {
    switch (nodeType) {
      case 'state': return !!(config.accessoryId && config.characteristicType);
      case 'time': return !!(config.after || config.before);
      case 'template': return !!config.expression;
    }
  }
  if (category === 'logic') {
    if (nodeType === 'sub_workflow') return !!config.automationId;
    return true;
  }
  return false;
}
