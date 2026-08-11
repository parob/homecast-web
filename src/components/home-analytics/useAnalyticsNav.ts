import { useCallback, useMemo, useState } from 'react';
import { CATEGORIES, type CategoryId } from '@/history/categories';
import type { ExplorerView } from './types';

/**
 * The Analytics navigation stack. Three levels, one back button, and the
 * title IS the location — the SettingsDialog drill-down convention: the
 * host renders `title()` in its DialogTitle with an embedded back arrow
 * when `depth > 0`, popping one level per press.
 */
export type AnalyticsLevel =
  | { level: 'home' }
  /** `room` filters within the category; `groupId` is the Groups-category
   *  equivalent (a selected service group instead of a room). */
  | { level: 'category'; category: CategoryId; room?: string | null; groupId?: string | null }
  | { level: 'custom'; view: ExplorerView };

export interface AnalyticsNav {
  current: AnalyticsLevel;
  depth: number;
  title: string;
  push: (next: AnalyticsLevel) => void;
  back: () => void;
  reset: (to?: AnalyticsLevel) => void;
  /** Swap the current level in place (e.g. room filter changes). */
  replace: (next: AnalyticsLevel) => void;
}

export function useAnalyticsNav(initial?: AnalyticsLevel): AnalyticsNav {
  const [stack, setStack] = useState<AnalyticsLevel[]>(
    initial && initial.level !== 'home' ? [{ level: 'home' }, initial] : [{ level: 'home' }],
  );
  const current = stack[stack.length - 1];

  const title = useMemo(() => {
    switch (current.level) {
      case 'home':
        return 'Home Analytics';
      case 'category': {
        const name = CATEGORIES[current.category].title;
        return current.room ? `${name} · ${current.room}` : name;
      }
      case 'custom':
        return current.view.title || 'Custom view';
    }
  }, [current]);

  const push = useCallback((next: AnalyticsLevel) => {
    setStack(s => [...s, next]);
  }, []);

  const back = useCallback(() => {
    setStack(s => (s.length > 1 ? s.slice(0, -1) : s));
  }, []);

  const reset = useCallback((to?: AnalyticsLevel) => {
    setStack(to && to.level !== 'home' ? [{ level: 'home' }, to] : [{ level: 'home' }]);
  }, []);

  const replace = useCallback((next: AnalyticsLevel) => {
    setStack(s => [...s.slice(0, -1), next]);
  }, []);

  return useMemo(
    () => ({ current, depth: stack.length - 1, title, push, back, reset, replace }),
    [current, stack.length, title, push, back, reset, replace],
  );
}
