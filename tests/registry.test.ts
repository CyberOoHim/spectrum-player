import { describe, expect, it } from 'vitest';
import { ATMOSPHERE_MODES, isAtmosphereMode, sceneSpeedLabel } from '../src/viz/scenes/registry';

describe('atmosphere registry', () => {
  it('registers all six atmosphere modes', () => {
    expect(ATMOSPHERE_MODES).toEqual(['lava', 'hearth', 'rain', 'tide', 'grove', 'pond']);
    expect(isAtmosphereMode('lava')).toBe(true);
    expect(isAtmosphereMode('hearth')).toBe(true);
    expect(isAtmosphereMode('rain')).toBe(true);
    expect(isAtmosphereMode('tide')).toBe(true);
    expect(isAtmosphereMode('grove')).toBe(true);
    expect(isAtmosphereMode('pond')).toBe(true);
    expect(isAtmosphereMode('bars')).toBe(false);
    expect(isAtmosphereMode('unknown')).toBe(false);
  });

  it('labels the shared speed slider for each atmosphere mode', () => {
    expect(sceneSpeedLabel('hearth')).toBe('Fire breath');
    expect(sceneSpeedLabel('rain')).toBe('Rain cadence');
    expect(sceneSpeedLabel('tide')).toBe('Tide swell');
    expect(sceneSpeedLabel('grove')).toBe('Canopy drift');
    expect(sceneSpeedLabel('pond')).toBe('Lantern drift');
    expect(sceneSpeedLabel('lava')).toBe('Lava lamp flow');
    expect(sceneSpeedLabel('bars')).toBe('Atmosphere speed');
  });
});
