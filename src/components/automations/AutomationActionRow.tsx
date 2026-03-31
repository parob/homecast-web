import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';
import { Slider } from '@/components/ui/slider';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { X } from 'lucide-react';
import type { HomeKitAccessory } from '@/lib/graphql/types';

interface ActionData {
  accessoryId: string;
  characteristicType: string;
  targetValue: unknown;
}

interface AutomationActionRowProps {
  action: ActionData;
  accessories: HomeKitAccessory[];
  onChange: (action: ActionData) => void;
  onRemove: () => void;
}

function getWritableCharacteristics(accessory: HomeKitAccessory | undefined) {
  if (!accessory) return [];
  const chars: Array<{ type: string; name: string; isBoolean: boolean; min?: number; max?: number; step?: number }> = [];
  for (const service of accessory.services) {
    for (const char of service.characteristics) {
      if (!char.isWritable) continue;
      const isBool = char.characteristicType === 'power_state' || char.characteristicType === 'on' ||
        char.characteristicType === 'lock_target_state' || char.characteristicType === 'active';
      chars.push({
        type: char.characteristicType,
        name: char.characteristicType.replace(/_/g, ' ').replace(/\b\w/g, l => l.toUpperCase()),
        isBoolean: isBool,
        min: char.minValue ?? undefined,
        max: char.maxValue ?? undefined,
        step: char.stepValue ?? undefined,
      });
    }
  }
  return chars;
}

export function AutomationActionRow({ action, accessories, onChange, onRemove }: AutomationActionRowProps) {
  const selectedAccessory = accessories.find(a => a.id === action.accessoryId);
  const characteristics = getWritableCharacteristics(selectedAccessory);
  const selectedChar = characteristics.find(c => c.type === action.characteristicType);

  return (
    <div className="rounded-lg border p-3 space-y-2">
      <div className="flex items-center justify-between">
        <span className="text-xs font-medium text-muted-foreground">Action</span>
        <Button variant="ghost" size="sm" className="h-6 w-6 p-0" onClick={onRemove}>
          <X className="h-3 w-3" />
        </Button>
      </div>

      <Select
        value={action.accessoryId}
        onValueChange={(id) => onChange({ ...action, accessoryId: id, characteristicType: '', targetValue: null })}
      >
        <SelectTrigger className="h-8 text-xs">
          <SelectValue placeholder="Select accessory" />
        </SelectTrigger>
        <SelectContent>
          {accessories.filter(a => a.isReachable).map(a => (
            <SelectItem key={a.id} value={a.id} className="text-xs">{a.name}</SelectItem>
          ))}
        </SelectContent>
      </Select>

      {action.accessoryId && (
        <Select
          value={action.characteristicType}
          onValueChange={(type) => {
            const char = characteristics.find(c => c.type === type);
            const defaultVal = char?.isBoolean ? true : (char?.min ?? 0);
            onChange({ ...action, characteristicType: type, targetValue: defaultVal });
          }}
        >
          <SelectTrigger className="h-8 text-xs">
            <SelectValue placeholder="Select characteristic" />
          </SelectTrigger>
          <SelectContent>
            {characteristics.map(c => (
              <SelectItem key={c.type} value={c.type} className="text-xs">{c.name}</SelectItem>
            ))}
          </SelectContent>
        </Select>
      )}

      {action.characteristicType && selectedChar && (
        <div className="pt-1">
          {selectedChar.isBoolean ? (
            <div className="flex gap-1">
              <Button
                variant={action.targetValue === true || action.targetValue === 1 ? 'default' : 'outline'}
                size="sm"
                className="h-7 text-xs flex-1"
                onClick={() => onChange({ ...action, targetValue: true })}
              >
                ON
              </Button>
              <Button
                variant={action.targetValue === false || action.targetValue === 0 ? 'default' : 'outline'}
                size="sm"
                className="h-7 text-xs flex-1"
                onClick={() => onChange({ ...action, targetValue: false })}
              >
                OFF
              </Button>
            </div>
          ) : selectedChar.max !== undefined ? (
            <div className="flex items-center gap-2">
              <Slider
                value={[Number(action.targetValue ?? selectedChar.min ?? 0)]}
                min={selectedChar.min ?? 0}
                max={selectedChar.max}
                step={selectedChar.step ?? 1}
                onValueChange={([v]) => onChange({ ...action, targetValue: v })}
                className="flex-1"
              />
              <span className="text-xs text-muted-foreground w-10 text-right">
                {String(action.targetValue ?? 0)}{selectedChar.max === 100 ? '%' : ''}
              </span>
            </div>
          ) : (
            <Input
              type="number"
              value={String(action.targetValue ?? '')}
              onChange={(e) => onChange({ ...action, targetValue: Number(e.target.value) })}
              className="h-8 text-xs"
              placeholder="Value"
            />
          )}
        </div>
      )}
    </div>
  );
}
