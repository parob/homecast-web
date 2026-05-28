import { useMemo } from 'react';
import { CircleDot } from 'lucide-react';
import { getAccessoryIcon } from '@/components/AccessoryPicker';
import { pickPrimaryBool, pickPrimaryNumeric, InlineToggle, InlineSlider } from './helpers';
import { inferServiceType } from './widget-adapter';

interface Props {
  topic: string;
  payload: string;
  onPublish: (topic: string, key: string, value: unknown) => void;
}

export interface PickedKeys { bool: string | null; numeric: string | null; }

export function pickedKeys(payload: string): PickedKeys {
  return { bool: pickPrimaryBool(payload), numeric: pickPrimaryNumeric(payload) };
}

// Lucide icon for the accessory type derived from the MQTT payload.
// Reuses the same icon map the Dashboard's AccessoryPicker uses, so the
// MQTT browser visually matches the rest of the app.
export function AccessoryTypeIcon({ payload, className }: { payload: string; className?: string }) {
  const Icon = useMemo(() => {
    try {
      const p = JSON.parse(payload);
      if (!p || typeof p !== 'object') return CircleDot;
      const serviceType = inferServiceType(p as Record<string, unknown>);
      if (serviceType === 'unknown') return CircleDot;
      return getAccessoryIcon({ services: [{ serviceType }] });
    } catch { return CircleDot; }
  }, [payload]);
  return <Icon className={className || 'h-3.5 w-3.5 text-muted-foreground shrink-0'} />;
}

// Fixed-width inline controls. Toggle and slider live in reserved cells
// so they line up vertically across rows — even when a given row has
// only one (or neither) actionable control.
export function InlineRowControls({ topic, payload, onPublish }: Props) {
  const parsed = useMemo(() => {
    try { const p = JSON.parse(payload); return (p && typeof p === 'object' && !Array.isArray(p)) ? p as Record<string, unknown> : null; }
    catch { return null; }
  }, [payload]);
  const { bool, numeric } = useMemo(() => pickedKeys(payload), [payload]);

  return (
    <div className="flex items-center gap-2 shrink-0">
      {/* Toggle cell — reserved width even when empty */}
      <div className="w-9 flex justify-center shrink-0">
        {parsed && bool && <InlineToggle name={bool} value={parsed[bool]} onPublish={(k, v) => onPublish(topic, k, v)} compact />}
      </div>
      {/* Slider cell — reserved width even when empty */}
      <div className="w-[140px] shrink-0">
        {parsed && numeric && typeof parsed[numeric] === 'number' && (
          <InlineSlider name={numeric} value={parsed[numeric] as number} onPublish={(k, v) => onPublish(topic, k, v)} compact />
        )}
      </div>
    </div>
  );
}
