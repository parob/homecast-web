// Icon picker for the Notify node's config tray.
//
// Two ways to answer the same question, because they serve different needs: most
// notifications want a recognisable glyph and should be one click away, while a
// few want whatever an upstream node produced — a camera snapshot at the moment
// the door opened. A grid covers the first; a URL box covers the second.

import { useState } from 'react';
import { Input } from '@/components/ui/input';
import { cn } from '@/lib/utils';
import { Ban } from 'lucide-react';
import {
  NOTIFICATION_ICONS,
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

export function NotificationIconField({
  value,
  onChange,
}: {
  value: string | undefined;
  onChange: (value: string | undefined) => void;
}) {
  // A value that isn't one of ours is a URL or a template, so open on the tab
  // that can actually show it rather than on an empty grid.
  const [mode, setMode] = useState<'builtin' | 'custom'>(
    value && !isNotificationIconSlug(value) ? 'custom' : 'builtin',
  );

  const customValue = value && !isNotificationIconSlug(value) ? value : '';
  const customInvalid = !!customValue && !isValidNotificationIcon(customValue);

  return (
    <div className="space-y-2">
      <div className="flex gap-1">
        {(['builtin', 'custom'] as const).map((m) => (
          <button
            key={m}
            type="button"
            onClick={() => {
              setMode(m);
              // Switching tabs shouldn't quietly keep a value the visible tab
              // can't represent — the grid would look unselected while a URL
              // was still being sent.
              if (m === 'builtin' && customValue) onChange(undefined);
              if (m === 'custom' && value && isNotificationIconSlug(value)) onChange(undefined);
            }}
            className={cn(
              'px-2 py-1 text-[11px] rounded-md border transition-colors',
              mode === m
                ? 'bg-accent border-border text-foreground'
                : 'border-transparent text-muted-foreground hover:text-foreground',
            )}
          >
            {m === 'builtin' ? 'Built-in' : 'Custom URL'}
          </button>
        ))}
      </div>

      {mode === 'builtin' ? (
        <div className="space-y-2 max-h-64 overflow-y-auto pr-1">
          <button
            type="button"
            onClick={() => onChange(undefined)}
            title="No icon"
            className={cn(
              'flex items-center gap-1.5 px-2 py-1 rounded-md border text-[11px] transition-colors',
              !value
                ? 'border-primary bg-primary/10 text-foreground'
                : 'border-border text-muted-foreground hover:text-foreground',
            )}
          >
            <Ban className="h-3.5 w-3.5" />
            None
          </button>

          {GROUP_ORDER.map((group) => {
            const icons = NOTIFICATION_ICONS.filter((i) => i.group === group);
            if (icons.length === 0) return null;
            return (
              <div key={group} className="space-y-1">
                <p className="text-[10px] uppercase tracking-wide text-muted-foreground">
                  {GROUP_LABELS[group]}
                </p>
                <div className="grid grid-cols-6 gap-1">
                  {icons.map(({ slug, label, Icon }) => (
                    <button
                      key={slug}
                      type="button"
                      title={label}
                      aria-label={label}
                      aria-pressed={value === slug}
                      onClick={() => onChange(slug)}
                      className={cn(
                        'aspect-square flex items-center justify-center rounded-md border transition-colors',
                        value === slug
                          ? 'border-primary bg-primary/10 text-primary'
                          : 'border-border text-muted-foreground hover:text-foreground hover:bg-accent',
                      )}
                    >
                      <Icon className="h-4 w-4" />
                    </button>
                  ))}
                </div>
              </div>
            );
          })}
        </div>
      ) : (
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
