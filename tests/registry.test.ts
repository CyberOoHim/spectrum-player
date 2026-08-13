import { describe, expect, it } from 'vitest';
import { ATMOSPHERE_MODES, isAtmosphereMode, sceneSpeedLabel } from '../src/viz/scenes/registry';

describe('atmosphere registry', () => {
  it('registers lava and hearth only', () => {
    expect(ATMOSPHERE_MODES).toEqual(['lava', 'hearth']);
    expect(isAtmosphereMode('lava')).toBe(true);
    expect(isAtmosphereMode('hearth')).toBe(true);
    expect(isAtmosphereMode('bars')).toBe(false);
    expect(isAtmosphereMode('rain')).toBe(false);
  });

  it('labels the shared speed slider for each atmosphere mode', () => {
    expect(sceneSpeedLabel('hearth')).toBe('Fire breath');
    expect(sceneSpeedLabel('lava')).toBe('Lava lamp flow');
    expect(sceneSpeedLabel('bars')).toBe('Atmosphere speed');
  });
});
