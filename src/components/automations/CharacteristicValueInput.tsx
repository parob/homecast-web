// One control per characteristic kind — on/off pills, named options, or a
// slider — so setting a value never means guessing what a raw number means.

import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Slider } from '@/components/ui/slider';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';
import { cn } from '@/lib/utils';
import type { WritableChar } from './characteristics';

interface CharacteristicValueInputProps {
  char: WritableChar | undefined;
  value: unknown;
  onChange: (value: unknown) => void;
  className?: string;
}

/** Segmented pills — the fastest control when there are only a few choices. */
function Segmented({ options, selected, onSelect }: {
  options: { value: unknown; label: string }[];
  selected: (value: unknown) => boolean;
  onSelect: (value: unknown) => void;
}) {
  return (
    <div className="flex gap-1">
      {options.map(option => (
        <Button
          key={option.label}
          type="button"
          variant={selected(option.value) ? 'default' : 'outline'}
          size="sm"
          className="h-7 flex-1 px-3 text-xs"
          onClick={() => onSelect(option.value)}
        >
          {option.label}
        </Button>
      ))}
    </div>
  );
}

export function CharacteristicValueInput({ char, value, onChange, className }: CharacteristicValueInputProps) {
  if (!char) return null;

  if (char.kind === 'boolean') {
    return (
      <div className={className}>
        <Segmented
          options={[{ value: true, label: 'On' }, { value: false, label: 'Off' }]}
          selected={(v) => (v === true ? value === true || value === 1 : value === false || value === 0)}
          onSelect={onChange}
        />
      </div>
    );
  }

  if (char.kind === 'enum') {
    const options = char.options ?? [];
    // Pills stay readable up to three choices; beyond that they get cramped.
    if (options.length > 0 && options.length <= 3) {
      return (
        <div className={className}>
          <Segmented
            options={options.map(o => ({ value: o.value, label: o.label }))}
            selected={(v) => Number(value) === v}
            onSelect={onChange}
          />
        </div>
      );
    }
    return (
      <Select value={value != null ? String(value) : ''} onValueChange={(v) => onChange(Number(v))}>
        <SelectTrigger className={cn('h-7 text-xs', className)} data-testid="characteristic-value-select">
          <SelectValue placeholder="Select…" />
        </SelectTrigger>
        <SelectContent>
          {options.map(option => (
            <SelectItem key={option.value} value={String(option.value)} className="text-xs">
              {option.label}
            </SelectItem>
          ))}
        </SelectContent>
      </Select>
    );
  }

  if (char.kind === 'range') {
    const min = char.min ?? 0;
    const max = char.max ?? 100;
    const numeric = Number(value);
    const current = Number.isFinite(numeric) ? numeric : min;
    return (
      <div className={cn('flex items-center gap-2', className)}>
        <Slider
          value={[current]}
          min={min}
          max={max}
          step={char.step ?? 1}
          onValueChange={([v]) => onChange(v)}
          className="flex-1"
          aria-label={char.label}
        />
        <span className="w-12 shrink-0 text-right text-xs tabular-nums text-muted-foreground">
          {current}{char.unit ?? ''}
        </span>
      </div>
    );
  }

  return (
    <Input
      type="number"
      value={value == null ? '' : String(value)}
      min={char.min}
      max={char.max}
      step={char.step}
      onChange={(e) => onChange(e.target.value === '' ? null : Number(e.target.value))}
      className={cn('h-7 text-xs', className)}
      placeholder="Value"
    />
  );
}
