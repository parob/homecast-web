/** Helpers the section demos share (kept out of bits.tsx so fast refresh stays whole-file). */
import { useCallback, useState } from 'react';

export const cx = (...c: Array<string | false | null | undefined>) => c.filter(Boolean).join(' ');

export function useCopy(text: string) {
  const [copied, setCopied] = useState(false);
  const copy = useCallback(() => {
    void navigator.clipboard?.writeText(text).catch(() => undefined);
    setCopied(true);
    window.setTimeout(() => setCopied(false), 1500);
  }, [text]);
  return { copied, copy };
}
