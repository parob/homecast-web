/** Small pieces the section demos share. */
import type { ReactNode } from 'react';
import { Check, Copy } from 'lucide-react';
import { cx, useCopy } from './util';

export function CopyButton({ text, label, className }: { text: string; label?: string; className?: string }) {
  const { copied, copy } = useCopy(text);
  return (
    <button type="button" onClick={copy} aria-label={label ? undefined : 'Copy'} className={cx('inline-flex items-center justify-center gap-2 rounded-lg transition-colors', className)}>
      {copied ? <Check className="h-4 w-4 text-emerald-500" /> : <Copy className="h-4 w-4" />}
      {label && <span>{copied ? 'Copied' : label}</span>}
    </button>
  );
}

/** A dialog-shaped frame — the screenshots are dialogs and settings panes. */
export function Panel({ className, children }: { className?: string; children: ReactNode }) {
  return <div className={cx('w-full rounded-2xl border border-border bg-card p-5 text-card-foreground shadow-lg', className)}>{children}</div>;
}

export const softBtn = 'inline-flex h-9 items-center justify-center gap-2 rounded-lg bg-primary/10 px-3 text-sm font-medium transition-colors hover:bg-primary/15';
export const iconBtn = 'flex h-7 w-7 items-center justify-center rounded-md text-muted-foreground transition-colors hover:bg-muted hover:text-foreground';
