import { Send, X } from 'lucide-react';
import { AccessoryWidget } from '@/components/widgets/AccessoryWidget';
import { PropertyEditor, TopicPath, TypeBadge } from './helpers';
import { mqttToAccessory, mqttPublishFor } from './widget-adapter';
import type { TopicMessage, MqttRowType } from './topic-tree';

interface InspectorPanelProps {
  topic: string;
  message: TopicMessage | undefined;
  effectivePayload: string;
  rowType: MqttRowType;
  homeOffline: boolean;
  // Controls/JSON tabs — only used by the 'sheet' variant.
  rawMode: boolean;
  onRawModeChange: (v: boolean) => void;
  publishValue: string;
  onPublishValueChange: (v: string) => void;
  onPublishToSet: (topic: string, payload: string) => void;
  onPublishProp: (topic: string, key: string, value: unknown) => void;
  onClose: () => void;
  // 'pane': desktop sidebar — widget and payload stacked, no tabs.
  // 'sheet': mobile bottom drawer — one section at a time via tabs.
  variant: 'pane' | 'sheet';
}

// Detail view for the selected topic: the real Dashboard widget (or a raw
// property editor for unknown types) plus the JSON payload editor that
// publishes to <topic>/set.
export function InspectorPanel({
  topic, message, effectivePayload, rowType, homeOffline,
  rawMode, onRawModeChange, publishValue, onPublishValueChange,
  onPublishToSet, onPublishProp, onClose, variant,
}: InspectorPanelProps) {
  const renderControls = () => {
    const adapted = mqttToAccessory(topic, effectivePayload, !homeOffline);
    if (!adapted) {
      return <PropertyEditor payload={effectivePayload} onPublish={(k, v) => onPublishProp(topic, k, v)} />;
    }
    const { accessory, type } = adapted;
    return (
      <AccessoryWidget
        accessory={accessory}
        onToggle={(_id, characteristicType, currentValue) => {
          const out = mqttPublishFor(type, characteristicType, !currentValue);
          if (!out) return;
          onPublishProp(topic, out.key, out.value);
        }}
        onSlider={(_id, characteristicType, value) => {
          const out = mqttPublishFor(type, characteristicType, value);
          if (!out) return;
          onPublishProp(topic, out.key, out.value);
        }}
        getEffectiveValue={(_id, _characteristicType, serverValue) => serverValue}
      />
    );
  };

  const showControls = variant === 'pane' || !rawMode;
  const showJson = variant === 'pane' || rawMode;

  return (
    <div className="rounded-lg border bg-muted/20 shadow-sm overflow-hidden">
      {/* Header: badge + full topic path + meta + close */}
      <div className="flex items-center justify-between gap-2 border-b bg-background/60 px-3 py-2">
        <span className="flex min-w-0 items-center gap-2">
          <TypeBadge type={rowType} />
          <span className="min-w-0 truncate font-mono text-xs" title={topic}><TopicPath topic={topic} /></span>
        </span>
        <span className="flex shrink-0 items-center gap-2 text-[10px] text-muted-foreground">
          {message && message.updates > 1 && <span className="tabular-nums">{message.updates} updates</span>}
          {message && <span className="tabular-nums">{new Date(message.timestamp).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit', second: '2-digit' })}</span>}
          <button onClick={onClose} title="Close (Esc)" className="-m-1 rounded p-1 text-muted-foreground hover:bg-muted hover:text-foreground">
            <X className="h-3.5 w-3.5" />
          </button>
        </span>
      </div>
      {/* Controls/JSON tabs (sheet variant only) */}
      {variant === 'sheet' && (
        <div className="flex items-center gap-2 px-3 py-1.5 text-[10px]">
          <button onClick={() => onRawModeChange(false)} className={!rawMode ? 'text-foreground font-medium' : 'text-muted-foreground hover:text-foreground'}>Controls</button>
          <span className="text-muted-foreground/40">·</span>
          <button onClick={() => onRawModeChange(true)} className={rawMode ? 'text-foreground font-medium' : 'text-muted-foreground hover:text-foreground'}>JSON</button>
        </div>
      )}
      {/* Relay-offline hint */}
      {homeOffline && (
        <div className="px-3 py-1 text-[10px] text-amber-700 dark:text-amber-400">
          Relay offline — publishes won't reach the device.
        </div>
      )}
      <div className="space-y-3 p-3">
        {showControls && (
          <section className="w-full min-w-0 rounded-md border border-border/70 bg-background/50 p-2">
            {renderControls()}
          </section>
        )}
        {showJson && (
          <section className="w-full min-w-0 rounded-md border border-border/70 bg-background/50 p-2">
            <div className="mb-1.5 flex items-center justify-end text-[10px] text-muted-foreground">
              <span className="truncate font-mono" title={topic + '/set'}>{topic}/set</span>
            </div>
            <div className="space-y-1.5">
              <textarea
                ref={(el) => { if (el) { el.style.height = 'auto'; el.style.height = el.scrollHeight + 'px'; } }}
                value={publishValue}
                onChange={(e) => { onPublishValueChange(e.target.value); const t = e.target; t.style.height = 'auto'; t.style.height = t.scrollHeight + 'px'; }}
                className="min-h-[40px] w-full resize-y rounded border bg-background p-1.5 font-mono text-[11px] outline-none focus:border-primary"
              />
              <div className="flex min-w-0 items-center justify-end gap-2">
                <button onClick={() => onPublishToSet(topic, publishValue)} className="flex shrink-0 items-center gap-1 rounded bg-primary px-2 py-1 text-[11px] text-primary-foreground hover:bg-primary/90">
                  <Send className="h-3 w-3" /> Publish
                </button>
              </div>
            </div>
          </section>
        )}
      </div>
    </div>
  );
}
