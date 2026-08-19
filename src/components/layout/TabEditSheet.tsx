import { useEffect, useState } from 'react';
import { cn } from '@/lib/utils';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogFooter } from '@/components/ui/dialog';
import { RotateCcw } from 'lucide-react';
import { OVERLAY_SCRIM } from '@/lib/overlay-scrim';
import { TAB_ICON_GROUPS } from '@/lib/tab-icons';
import { tabIconEntries } from './tabIconComponents';
import type { LucideIcon } from 'lucide-react';

/** Longest a custom tab label may be — the bar has room for about this much. */
const MAX_LABEL_LENGTH = 20;

interface TabEditSheetProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  /** What the tab is called when it has no override — the placeholder. */
  derivedName: string;
  /** The glyph the tab would wear with no override, shown as the reset target. */
  DerivedIcon: LucideIcon;
  customName?: string;
  customIcon?: string;
  /** Both at once: one blob write, so a rename cannot lose a fresh icon. */
  onSave: (next: { customName?: string; customIcon?: string }) => void;
}

/**
 * The editor behind a tab in Edit Layout.
 *
 * Renaming used to be an input drawn inside the tab itself, which worked only
 * because the tab was 64px of column with a label already under the icon. The
 * bar is a row of capsules now with one label between them, so there is nowhere
 * to put a field — and an icon grid was never going to fit there anyway.
 *
 * Name and icon commit together. Two separate writes would each save the whole
 * `pinnedTabs` blob from its own copy of state, so whichever landed second
 * would quietly undo the first.
 */
export function TabEditSheet({
  open, onOpenChange, derivedName, DerivedIcon, customName, customIcon, onSave,
}: TabEditSheetProps) {
  const [name, setName] = useState(customName ?? '');
  const [icon, setIcon] = useState<string | undefined>(customIcon);

  // Reopening on a different tab has to start from that tab's values, not the
  // last one's — the dialog stays mounted between opens.
  useEffect(() => {
    if (!open) return;
    setName(customName ?? '');
    setIcon(customIcon);
  }, [open, customName, customIcon]);

  const commit = () => {
    const trimmed = name.trim();
    onSave({ customName: trimmed || undefined, customIcon: icon });
    onOpenChange(false);
  };

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent overlayClassName={OVERLAY_SCRIM} className="sm:max-w-md">
        <DialogHeader>
          <DialogTitle>Edit tab</DialogTitle>
        </DialogHeader>

        <div className="space-y-4">
          <div className="space-y-1.5">
            <label htmlFor="tab-name" className="text-sm font-medium">Name</label>
            <Input
              id="tab-name"
              value={name}
              placeholder={derivedName}
              maxLength={MAX_LABEL_LENGTH}
              onChange={(e) => setName(e.target.value)}
              onKeyDown={(e) => { if (e.key === 'Enter') commit(); }}
            />
            <p className="text-xs text-muted-foreground">
              Leave empty to use “{derivedName}”.
            </p>
          </div>

          <div className="space-y-1.5">
            <div className="flex items-center justify-between">
              <span className="text-sm font-medium">Icon</span>
              {icon && (
                <Button variant="ghost" size="sm" className="h-7 px-2 text-xs" onClick={() => setIcon(undefined)}>
                  <RotateCcw className="h-3 w-3 mr-1.5" />
                  Use default
                </Button>
              )}
            </div>

            <div className="max-h-[38vh] overflow-y-auto rounded-lg border p-2 space-y-3">
              {/* The derived glyph is an option like any other, so "back to
                  automatic" is a thing you can pick rather than a thing you
                  have to know to un-pick. */}
              <div>
                <p className="px-1 pb-1.5 text-xs font-medium text-muted-foreground">Default</p>
                <IconButton
                  Icon={DerivedIcon}
                  label={`Default icon for ${derivedName}`}
                  selected={icon === undefined}
                  onClick={() => setIcon(undefined)}
                />
              </div>
              {TAB_ICON_GROUPS.map(group => (
                <div key={group.label}>
                  <p className="px-1 pb-1.5 text-xs font-medium text-muted-foreground">{group.label}</p>
                  <div className="grid grid-cols-8 gap-1">
                    {tabIconEntries(group.keys).map(({ key, Icon }) => (
                      <IconButton
                        key={key}
                        Icon={Icon}
                        label={key.replace(/-/g, ' ')}
                        selected={icon === key}
                        onClick={() => setIcon(key)}
                      />
                    ))}
                  </div>
                </div>
              ))}
            </div>
          </div>
        </div>

        <DialogFooter>
          <div className="flex gap-2">
            <Button variant="outline" onClick={() => onOpenChange(false)}>Cancel</Button>
            <Button onClick={commit}>Done</Button>
          </div>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

function IconButton({ Icon, label, selected, onClick }: {
  Icon: LucideIcon; label: string; selected: boolean; onClick: () => void;
}) {
  return (
    <button
      type="button"
      onClick={onClick}
      aria-label={label}
      aria-pressed={selected}
      // A real button with an outline ring, not a focus ring: `--ring` and
      // `--primary` are the same blue, so a focus ring on a tinted tile is
      // indistinguishable from selection.
      className={cn(
        'flex aspect-square items-center justify-center rounded-lg transition-colors',
        selected
          ? 'bg-primary text-primary-foreground'
          : 'hover:bg-muted text-muted-foreground hover:text-foreground',
      )}
    >
      <Icon className="h-4 w-4" />
    </button>
  );
}
