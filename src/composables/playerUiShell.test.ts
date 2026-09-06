import { describe, expect, it } from 'vitest';

import { getNextWheelVolume } from '../utils/volume';

describe('player UI volume wheel handling', () => {
  it('adjusts volume by one percent per wheel step', () => {
    expect(getNextWheelVolume(50, -120)).toBe(51);
    expect(getNextWheelVolume(50, 120)).toBe(49);
  });

  it('clamps wheel volume changes to the valid range', () => {
    expect(getNextWheelVolume(100, -120)).toBe(100);
    expect(getNextWheelVolume(0, 120)).toBe(0);
  });
});
