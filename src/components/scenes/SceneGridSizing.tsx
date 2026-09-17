import { useLayoutEffect, useRef, type ReactNode } from 'react';

/** Size shown scenes together; revealing a hidden card must not enlarge the dashboard. */
export function SceneGridSizing({ children }: { children: ReactNode }) {
  const rootRef = useRef<HTMLDivElement>(null);
  useLayoutEffect(() => {
    const root = rootRef.current;
    if (!root) return;
    let contents: HTMLElement[] = [];
    const measure = () => {
      // Hidden cards (including cards in a hidden room) appear while editing.
      // They can fit their own text without changing every other scene's height.
      // Layout height also excludes the reveal/drag animation's transforms.
      const height = Math.max(96, ...contents
        .filter(node => !node.closest('[data-hidden-item]'))
        .map(node => node.offsetHeight));
      root.style.setProperty('--scene-tile-height', `${Math.ceil(height)}px`);
    };
    const sizes = new ResizeObserver(measure);
    const refresh = () => {
      sizes.disconnect();
      contents = Array.from(root.querySelectorAll<HTMLElement>('[data-scene-tile-content]'));
      contents.forEach(node => sizes.observe(node));
      measure();
    };
    const childrenChanged = new MutationObserver(refresh);
    childrenChanged.observe(root, {
      childList: true, subtree: true, attributes: true, attributeFilter: ['data-hidden-item'],
    });
    refresh();
    return () => { sizes.disconnect(); childrenChanged.disconnect(); };
  }, []);
  return <div ref={rootRef}>{children}</div>;
}
