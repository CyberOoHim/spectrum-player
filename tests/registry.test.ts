import { describe, expect, it } from 'vitest';
import { ATMOSPHERE_MODES, isAtmosphereMode, sceneSpeedLabel } from '../src/viz/scenes/registry';

describe('atmosphere registry', () => {
  it('registers lava, hearth, and rain', () => {
    expect(ATMOSPHERE_MODES).toEqual(['lava', 'hearth', 'rain']);
    expect(isAtmosphereMode('lava')).toBe(true);
    expect(isAtmosphereMode('hearth')).toBe(true);
    expect(isAtmosphereMode('rain')).toBe(true);
    expect(isAtmosphereMode('bars')).toBe(false);
    expect(isAtmosphereMode('tide')).toBe(false);
  });

  it('labels the shared speed slider for each atmosphere mode', () => {
    expect(sceneSpeedLabel('hearth')).toBe('Fire breath');
    expect(sceneSpeedLabel('rain')).toBe('Rain cadence');
    expect(sceneSpeedLabel('lava')).toBe('Lava lamp flow');
    expect(sceneSpeedLabel('bars')).toBe('Atmosphere speed');
  });
});
