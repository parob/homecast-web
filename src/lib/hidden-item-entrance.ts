/** Keep the entrance rule until the animations it starts actually finish. */
export function startHiddenItemEntrance(root: HTMLElement): () => void {
  let stopped = false;
  let frame: number;
  const stop = () => {
    if (stopped) return;
    stopped = true;
    cancelAnimationFrame(frame);
    root.removeAttribute('data-hidden-entering');
  };

  // Stamp before React mounts the items, then read after the commit. Reading
  // animations flushes styles, so their clock starts even after a slow render.
  root.setAttribute('data-hidden-entering', 'true');
  frame = requestAnimationFrame(() => {
    const arrivals = root.getAnimations({ subtree: true }).filter(animation =>
      'animationName' in animation && animation.animationName === 'hidden-item-in',
    );
    // Reduced motion and an empty reveal have nothing to wait for. A cancelled
    // animation also settles; an old completion must never clear a new reveal.
    void Promise.allSettled(arrivals.map(animation => animation.finished)).then(stop);
  });
  return stop;
}
