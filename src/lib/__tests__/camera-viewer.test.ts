import { describe, it, expect } from 'vitest';
import { prefersImmersiveCamera } from '../camera-viewer';

describe('prefersImmersiveCamera', () => {
  it('a phone held sideways goes immersive', () => {
    // The geometry from parob/homecast-cloud#153: an iPhone 16 Pro Max rotated.
    expect(prefersImmersiveCamera({ width: 956, height: 440 })).toBe(true);
    expect(prefersImmersiveCamera({ width: 844, height: 390 })).toBe(true);
  });

  it('the same phone upright keeps the stacked card', () => {
    expect(prefersImmersiveCamera({ width: 440, height: 956 })).toBe(false);
    expect(prefersImmersiveCamera({ width: 390, height: 844 })).toBe(false);
  });

  it('a desktop or tablet keeps the stacked card — it has the height to spend', () => {
    expect(prefersImmersiveCamera({ width: 1280, height: 800 })).toBe(false);
    expect(prefersImmersiveCamera({ width: 1024, height: 768 })).toBe(false);
  });

  it('short but not wide stays stacked — there is no width to trade for', () => {
    expect(prefersImmersiveCamera({ width: 400, height: 440 })).toBe(false);
    expect(prefersImmersiveCamera({ width: 440, height: 440 })).toBe(false);
  });

  it('a zero height is not a short viewport, it is an unmeasured one', () => {
    expect(prefersImmersiveCamera({ width: 956, height: 0 })).toBe(false);
  });
});
