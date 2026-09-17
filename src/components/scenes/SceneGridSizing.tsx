import { useLayoutEffect, useRef, type ReactNode } from 'react';

/** Give every scene the space the longest visible card needs, without clipping names. */
export function SceneGridSizing({ children }: { children: ReactNode }) {
  const rootRef = useRef<HTMLDivElement>(null);
  useLayoutEffect(() => {
    const root = rootRef.current;
    if (!root) return;
    let contents: Element[] = [];
    const measure = () => {
      const height = Math.max(96, ...contents.map(node => node.getBoundingClientRect().height));
      root.style.setProperty('--scene-tile-height', `${Math.ceil(height)}px`);
    };
    const sizes = new ResizeObserver(measure);
    const refresh = () => {
      sizes.disconnect();
      contents = Array.from(root.querySelectorAll('[data-scene-tile-content]'));
      contents.forEach(node => sizes.observe(node));
      measure();
    };
    const childrenChanged = new MutationObserver(refresh);
    childrenChanged.observe(root, { childList: true, subtree: true });
    refresh();
    return () => { sizes.disconnect(); childrenChanged.disconnect(); };
  }, []);
  return <div ref={rootRef}>{children}</div>;
}
