// Unified entity picker — consistent selection UI for devices, groups, and scenes

import { useState } from 'react';
import { Button } from '@/components/ui/button';
import { Dialog, DialogContent, DialogTitle } from '@/components/ui/dialog';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';
import { Lightbulb, Users, Play, ChevronDown } from 'lucide-react';
import { cn } from '@/lib/utils';
import { AccessoryPicker } from '@/components/AccessoryPicker';
import type { HomeKitAccessory, HomeKitScene, HomeKitServiceGroup } from '@/lib/graphql/types';

// ============================================================
// Shared picker button style
// ============================================================

function PickerButton({
  icon: Icon,
  label,
  placeholder,
  onClick,
  className,
  testId,
}: {
  icon: React.ElementType;
  label: string | null;
  placeholder: string;
  onClick: () => void;
  className?: string;
  testId?: string;
}) {
  return (
    <Button
      variant="outline"
      size="sm"
      className={cn('w-full justify-start h-9 text-xs font-normal gap-2', className)}
      onClick={onClick}
      data-testid={testId}
    >
      <Icon className="h-3.5 w-3.5 text-muted-foreground shrink-0" />
      <span className={cn('flex-1 text-left truncate', !label && 'text-muted-foreground')}>
        {label ?? placeholder}
      </span>
      <ChevronDown className="h-3 w-3 text-muted-foreground shrink-0" />
    </Button>
  );
}

// ============================================================
// Device Picker
// ============================================================

export function DevicePicker({
  value,
  accessories,
  onChange,
}: {
  value: string | undefined;
  accessories: HomeKitAccessory[];
  onChange: (id: string, name: string) => void;
}) {
  const [open, setOpen] = useState(false);
  const selected = accessories.find((a) => a.id === value);

  return (
    <>
      <PickerButton
        icon={Lightbulb}
        label={selected?.name ?? null}
        placeholder="Select a device..."
        onClick={() => setOpen(true)}
        testId="select-device-button"
      />
      <Dialog open={open} onOpenChange={setOpen}>
        <DialogContent className="!max-w-md p-0 gap-0 !z-[10060]" hideCloseButton>
          <DialogTitle className="sr-only">Select Device</DialogTitle>
          <AccessoryPicker
            accessories={accessories}
            homes={[]}
            selectedIds={value ? new Set([value]) : new Set()}
            onToggle={(id) => {
              const acc = accessories.find((a) => a.id === id);
              if (acc) {
                onChange(acc.id, acc.name);
                setOpen(false);
              }
            }}
          />
        </DialogContent>
      </Dialog>
    </>
  );
}

// ============================================================
// Service Group Picker
// ============================================================

export function GroupPicker({
  value,
  serviceGroups,
  onChange,
}: {
  value: string | undefined;
  serviceGroups: HomeKitServiceGroup[];
  onChange: (id: string, name: string) => void;
}) {
  const selected = serviceGroups.find((g) => g.id === value);

  return (
    <Select
      value={value ?? ''}
      onValueChange={(v) => {
        const group = serviceGroups.find((g) => g.id === v);
        if (group) onChange(group.id, group.name);
      }}
    >
      <SelectTrigger className="h-9 text-xs gap-2" data-testid="select-group-button">
        <Users className="h-3.5 w-3.5 text-muted-foreground shrink-0" />
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
  );
}

// ============================================================
// Scene Picker
// ============================================================

export function ScenePicker({
  value,
  scenes,
  onChange,
}: {
  value: string | undefined;
  scenes: HomeKitScene[];
  onChange: (id: string) => void;
}) {
  return (
    <Select value={value ?? ''} onValueChange={onChange}>
      <SelectTrigger className="h-9 text-xs gap-2">
        <Play className="h-3.5 w-3.5 text-muted-foreground shrink-0" />
        <SelectValue placeholder="Select a scene..." />
      </SelectTrigger>
      <SelectContent>
        {scenes.map((s) => (
          <SelectItem key={s.id} value={s.id}>
            <span>{s.name}</span>
            {s.actionCount != null && (
              <span className="ml-1.5 text-muted-foreground text-[10px]">{s.actionCount} action{s.actionCount !== 1 ? 's' : ''}</span>
            )}
          </SelectItem>
        ))}
      </SelectContent>
    </Select>
  );
}

// ============================================================
// Characteristic Picker (shared between device and group modes)
// ============================================================

export function CharacteristicPicker({
  value,
  characteristics,
  onChange,
}: {
  value: string | undefined;
  characteristics: { type: string; meta?: string }[];
  onChange: (value: string) => void;
}) {
  if (characteristics.length > 0) {
    return (
      <Select value={value ?? ''} onValueChange={onChange}>
        <SelectTrigger className="h-8 text-xs" data-testid="characteristic-select">
          <SelectValue placeholder="Select..." />
        </SelectTrigger>
        <SelectContent>
          {characteristics.map((c) => (
            <SelectItem key={c.type} value={c.type}>
              <span>{c.type}</span>
              {c.meta && <span className="ml-1.5 text-muted-foreground text-[10px]">{c.meta}</span>}
            </SelectItem>
          ))}
        </SelectContent>
      </Select>
    );
  }

  return (
    <input
      value={value ?? ''}
      onChange={(e) => onChange(e.target.value)}
      placeholder="e.g., power_state"
      className="flex h-8 w-full rounded-md border border-input bg-background px-3 py-2 text-xs ring-offset-background"
    />
  );
}
