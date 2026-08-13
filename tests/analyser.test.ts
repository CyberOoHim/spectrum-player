import { describe, it, expect } from 'vitest';
import { getBandsFromData } from '../src/audio/analyser';

describe('FFT Analyser Band Grouping', () => {
  it('returns zeros array when frequency buffer is empty or zeroes', () => {
    const data = new Uint8Array(512);
    const bands = getBandsFromData(data, 64, 1.0);
    expect(bands.length).toBe(64);
    for (let i = 0; i < bands.length; i++) {
      expect(bands[i]).toBe(0);
    }
  });

  it('correctly maps low frequency energy peak to initial bands', () => {
    const data = new Uint8Array(512);
    // Fill first 10 bins (low frequency / bass) with max energy (255)
    for (let i = 0; i < 10; i++) {
      data[i] = 255;
    }

    const bands = getBandsFromData(data, 64, 1.0);
    expect(bands[0]).toBeGreaterThan(0.5);
    // High frequency bands should be 0
    expect(bands[60]).toBe(0);
  });

  it('applies sensitivity multiplier and clamps to 1.0', () => {
    const data = new Uint8Array(512);
    data.fill(128);

    const bandsNormal = getBandsFromData(data, 32, 1.0);
    const bandsHighSens = getBandsFromData(data, 32, 2.0);

    expect(bandsNormal[0]).toBeCloseTo(128 / 255, 1);
    expect(bandsHighSens[0]).toBe(1.0);
  });
});
