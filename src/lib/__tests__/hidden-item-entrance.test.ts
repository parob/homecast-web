// @vitest-environment jsdom
import { afterEach, beforeEach, expect, it, vi } from 'vitest';
import { startHiddenItemEntrance } from '../hidden-item-entrance';

let paint: FrameRequestCallback;
let root: HTMLElement;
const settle = async () => { await Promise.resolve(); await Promise.resolve(); };
const arrival = () => {
  let finish!: () => void;
  const finished = new Promise<void>(resolve => { finish = resolve; });
  return { animationName: 'hidden-item-in', finished, finish };
};

beforeEach(() => {
  root = document.createElement('div');
  vi.stubGlobal('requestAnimationFrame', vi.fn(callback => { paint = callback; return 1; }));
  vi.stubGlobal('cancelAnimationFrame', vi.fn());
});
afterEach(() => vi.unstubAllGlobals());

it('keeps the rule through a delayed first paint and every entrance, ignoring unrelated animations', async () => {
  const first = arrival();
  const second = arrival();
  root.getAnimations = vi.fn(() => [first, second, {
    animationName: 'wiggle', finished: new Promise(() => {}),
  }] as unknown as Animation[]);
  startHiddenItemEntrance(root);
  expect(root.hasAttribute('data-hidden-entering')).toBe(true);
  expect(root.getAnimations).not.toHaveBeenCalled();
  paint(1000);
  first.finish();
  await settle();
  expect(root.hasAttribute('data-hidden-entering')).toBe(true);
  second.finish();
  await settle();
  expect(root.hasAttribute('data-hidden-entering')).toBe(false);
});

it('does not let a cancelled entrance clear a newer one', async () => {
  const old = arrival();
  const current = arrival();
  root.getAnimations = vi.fn().mockReturnValueOnce([old]).mockReturnValueOnce([current]);
  const stop = startHiddenItemEntrance(root);
  paint(0);
  stop();
  startHiddenItemEntrance(root);
  paint(1);
  old.finish();
  await settle();
  expect(root.hasAttribute('data-hidden-entering')).toBe(true);
  current.finish();
  await settle();
  expect(root.hasAttribute('data-hidden-entering')).toBe(false);
});

it('cleans up an empty reveal or reduced-motion entrance', async () => {
  root.getAnimations = vi.fn(() => []);
  startHiddenItemEntrance(root);
  paint(0);
  await settle();
  expect(root.hasAttribute('data-hidden-entering')).toBe(false);
});

it('cancels a pending paint when the dashboard exits', () => {
  const stop = startHiddenItemEntrance(root);
  stop();
  expect(cancelAnimationFrame).toHaveBeenCalledWith(1);
  expect(root.hasAttribute('data-hidden-entering')).toBe(false);
});
