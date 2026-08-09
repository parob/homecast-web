import { describe, it, expect } from 'vitest';
import { mirrorMired, miredToKelvin, formatMirroredAsKelvin } from '../shared/colorTemp';

const MIN = 140; // coolest a HomeKit bulb reports
const MAX = 500; // warmest

describe('colour temperature axis', () => {
  it('puts warm at the start of the slider and cool at the end', () => {
    // Slider at its minimum (left / bottom) must mean the WARMEST light, which
    // in mireds is the maximum. This is the whole point of the mirror: the
    // captions read "Warm … Cool" and the gradient runs orange → blue.
    expect(mirrorMired(MIN, MIN, MAX)).toBe(MAX);
    expect(mirrorMired(MAX, MIN, MAX)).toBe(MIN);
  });

  it('is its own inverse, so a committed value round-trips', () => {
    for (const mired of [140, 200, 320, 400, 500]) {
      expect(mirrorMired(mirrorMired(mired, MIN, MAX), MIN, MAX)).toBe(mired);
    }
  });

  it('leaves the midpoint alone', () => {
    expect(mirrorMired(320, MIN, MAX)).toBe(320);
  });

  it('converts mireds to the Kelvin people quote', () => {
    expect(miredToKelvin(500)).toBe(2000); // warm white
    expect(miredToKelvin(250)).toBe(4000);
    expect(miredToKelvin(140)).toBe(7150); // cool daylight
  });

  it('labels the slider so the number rises as it gets cooler', () => {
    const warmEnd = formatMirroredAsKelvin(MIN, MIN, MAX);
    const coolEnd = formatMirroredAsKelvin(MAX, MIN, MAX);
    expect(warmEnd).toBe('2000K');
    expect(coolEnd).toBe('7150K');
    expect(parseInt(coolEnd, 10)).toBeGreaterThan(parseInt(warmEnd, 10));
  });
});
