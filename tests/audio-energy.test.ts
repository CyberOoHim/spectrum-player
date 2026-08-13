import { describe, expect, it } from 'vitest';
import { AudioEnergySmoother, bandAt, sampleBandEnergy } from '../src/viz/audio-energy';

describe('audio energy', () => {
  it('splits bands into bass, mid, and treble thirds', () => {
    const bands = new Float32Array([1, 1, 1, 0.4, 0.4, 0.4, 0.1, 0.1, 0.1]);
    const energy = sampleBandEnergy(bands);
    expect(energy.bass).toBeCloseTo(1);
    expect(energy.mid).toBeCloseTo(0.4);
    expect(energy.treble).toBeCloseTo(0.1);
    expect(energy.energy).toBeCloseTo(1 * 0.5 + 0.4 * 0.3 + 0.1 * 0.2);
  });

  it('reads a band by normalized position', () => {
    const bands = new Float32Array([0.2, 0.5, 0.9]);
    expect(bandAt(bands, 0)).toBeCloseTo(0.2);
    expect(bandAt(bands, 0.5)).toBeCloseTo(0.5);
    expect(bandAt(bands, 0.99)).toBeCloseTo(0.9);
    expect(bandAt(new Float32Array(), 0.5)).toBe(0);
  });

  it('smooths toward incoming energy and builds an onset pulse', () => {
    const smoother = new AudioEnergySmoother();
    const quiet = new Float32Array(9);
    smoother.update(quiet, 0.016);
    expect(smoother.energy).toBe(0);

    const loud = new Float32Array([1, 1, 1, 0.6, 0.6, 0.6, 0.2, 0.2, 0.2]);
    smoother.update(loud, 0.016);
    expect(smoother.bass).toBeGreaterThan(0);
    expect(smoother.heatPulse).toBeGreaterThan(0);
    expect(smoother.bass).toBeLessThan(1);
  });
});
