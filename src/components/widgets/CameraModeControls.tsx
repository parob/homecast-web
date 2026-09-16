import { ColoredSwitch } from './shared';
import { getCharacteristic, type WidgetProps } from './types';

const modes = [
  { type: 'camera_operating_mode_indicator', uuid: '0000021B-0000-1000-8000-0026BB765291',
    label: 'Status light', description: 'The indicator light on the camera.' },
  { type: 'homekit_camera_active', uuid: '0000021D-0000-1000-8000-0026BB765291',
    label: 'HomeKit camera access', description: 'Camera access through HomeKit, not the camera’s power.' },
] as const;

/** Explicitly named settings in the opened viewer, never a tile power switch.
 * The indicator and HomeKit access are separate characteristics. Recording
 * Active and Periodic Snapshots Active must not be substituted for either.
 */
export function CameraModeControls({ accessory, onToggle, getEffectiveValue }:
  Pick<WidgetProps, 'accessory' | 'onToggle' | 'getEffectiveValue'>) {
  return <div className="space-y-3">
    {modes.map(mode => {
      const characteristic = getCharacteristic(accessory, mode.type) || getCharacteristic(accessory, mode.uuid);
      if (!characteristic?.isWritable) return null;
      const value = getEffectiveValue(accessory.id, characteristic.type, characteristic.value);
      const enabled = value === true || value === 'true' || value === 1 || value === '1';
      const disabled = value === false || value === 'false' || value === 0 || value === '0';
      if (!enabled && !disabled) return null;
      return <div key={mode.type} className="flex items-center justify-between gap-4">
        <div className="min-w-0">
          <p className="text-sm font-medium">{mode.label}</p>
          <p className="text-xs text-muted-foreground">{mode.description}</p>
        </div>
        <ColoredSwitch aria-label={mode.label} description={mode.description} checked={enabled}
          disabled={!accessory.isReachable}
          onCheckedChange={() => onToggle(accessory.id, characteristic.type, enabled)} />
      </div>;
    })}
  </div>;
}
