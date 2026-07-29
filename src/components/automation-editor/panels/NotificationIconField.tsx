// Icon picker for the Notify node's config tray.
//
// Three modes, because they are genuinely three different intentions rather than
// variations on one: no icon at all, one of ours, or an image the automation
// produces. None hides everything below it — a grid and a colour row are noise
// when the answer is "no icon", and leaving them visible invited the reading that
// something was still selected.

import { useState } from 'react';
import { Input } from '@/components/ui/input';
import { cn } from '@/lib/utils';
import {
  NOTIFICATION_ICONS,
  NOTIFICATION_ICON_COLORS,
  DEFAULT_NOTIFICATION_ICON_COLOR,
  getNotificationIconColor,
  isNotificationIconSlug,
  isValidNotificationIcon,
  type NotificationIconGroup,
} from '../notificationIcons';

const GROUP_LABELS: Record<NotificationIconGroup, string> = {
  device: 'Devices',
  status: 'Status',
  home: 'Home',
};

const GROUP_ORDER: NotificationIconGroup[] = ['status', 'device', 'home'];

type Mode = 'none' | 'predefined' | 'custom';

const MODE_LABELS: Record<Mode, string> = {
  none: 'None',
  predefined: 'Predefined',
  custom: 'Custom',
};

/** What the saved value implies, so reopening a node lands on the right mode. */
function modeFor(value: string | undefined): Mode {
  if (!value) return 'none';
  return isNotificationIconSlug(value) ? 'predefined' : 'custom';
}

export function NotificationIconField({
  value,
  color,
  onChange,
  onColorChange,
}: {
  value: string | undefined;
  color: string | undefined;
  onChange: (value: string | undefined) => void;
  onColorChange: (color: string | undefined) => void;
}) {
  const [mode, setMode] = useState<Mode>(() => modeFor(value));

  const customValue = value && !isNotificationIconSlug(value) ? value : '';
  const customInvalid = !!customValue && !isValidNotificationIcon(customValue);
  const tile = getNotificationIconColor(color);

  function switchTo(next: Mode) {
    setMode(next);
    // Clear whatever the new mode cannot represent, so the visible controls and
    // the value that actually gets sent never disagree.
    if (next === 'none') {
      onChange(undefined);
      onColorChange(undefined);
    } else if (next === 'predefined' && customValue) {
      onChange(undefined);
    } else if (next === 'custom') {
      if (value && isNotificationIconSlug(value)) onChange(undefined);
      // A custom image is the author's own and isn't recoloured, so a colour
      // left over from Predefined would be a setting with no effect.
      onColorChange(undefined);
    }
  }

  return (
    <div className="space-y-2">
      <div className="flex gap-1">
        {(['none', 'predefined', 'custom'] as const).map((m) => (
          <button
            key={m}
            type="button"
            onClick={() => switchTo(m)}
            aria-pressed={mode === m}
            className={cn(
              'px-2 py-1 text-[11px] rounded-md border transition-colors',
              mode === m
                ? 'bg-accent border-border text-foreground'
                : 'border-transparent text-muted-foreground hover:text-foreground',
            )}
          >
            {MODE_LABELS[m]}
          </button>
        ))}
      </div>

      {mode === 'predefined' && (
        <div className="space-y-2">
          {/* Colour first: it previews on the selected glyph below, so choosing
              it up front means the grid already shows the real thing. */}
          <div className="flex items-center gap-1.5">
            {NOTIFICATION_ICON_COLORS.map((c) => {
              const active = (color ?? DEFAULT_NOTIFICATION_ICON_COLOR) === c.slug;
              return (
                <button
                  key={c.slug}
                  type="button"
                  title={c.label}
                  aria-label={c.label}
                  aria-pressed={active}
                  onClick={() =>
                    onColorChange(c.slug === DEFAULT_NOTIFICATION_ICON_COLOR ? undefined : c.slug)
                  }
                  className={cn(
                    'h-5 w-5 rounded-full transition-transform',
                    active
                      ? 'ring-2 ring-offset-2 ring-offset-background ring-foreground/40 scale-110'
                      : 'hover:scale-110',
                  )}
                  style={{ background: `linear-gradient(135deg, ${c.from}, ${c.to})` }}
                />
              );
            })}
          </div>

          <div className="space-y-2 max-h-56 overflow-y-auto pr-1">
            {GROUP_ORDER.map((group) => {
              const icons = NOTIFICATION_ICONS.filter((i) => i.group === group);
              if (icons.length === 0) return null;
              return (
                <div key={group} className="space-y-1">
                  <p className="text-[10px] uppercase tracking-wide text-muted-foreground">
                    {GROUP_LABELS[group]}
                  </p>
                  <div className="grid grid-cols-6 gap-1">
                    {icons.map(({ slug, label, Icon }) => {
                      const selected = value === slug;
                      return (
                        <button
                          key={slug}
                          type="button"
                          title={label}
                          aria-label={label}
                          aria-pressed={selected}
                          onClick={() => onChange(slug)}
                          // The selected one renders as the tile that actually
                          // gets delivered — white glyph on the chosen gradient
                          // — so the picker previews the notification rather
                          // than describing it.
                          style={
                            selected
                              ? { background: `linear-gradient(135deg, ${tile.from}, ${tile.to})` }
                              : undefined
                          }
                          className={cn(
                            'aspect-square flex items-center justify-center rounded-md border transition-colors',
                            selected
                              ? 'border-transparent text-white shadow-sm'
                              : 'border-border text-muted-foreground hover:text-foreground hover:bg-accent',
                          )}
                        >
                          <Icon className="h-4 w-4" />
                        </button>
                      );
                    })}
                  </div>
                </div>
              );
            })}
          </div>
        </div>
      )}

      {mode === 'custom' && (
        <div className="space-y-1">
          <Input
            value={customValue}
            onChange={(e) => onChange(e.target.value || undefined)}
            placeholder="https://… or {{ nodes.snapshot.data.url }}"
            className={cn('h-8 text-xs', customInvalid && 'border-destructive')}
          />
          {customInvalid && (
            <p className="text-[11px] text-destructive leading-snug">
              Must be an https:// URL, or an expression that resolves to one.
            </p>
          )}
        </div>
      )}
    </div>
  );
}
