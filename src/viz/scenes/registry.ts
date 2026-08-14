import { AppSettingsV1 } from '../../storage/settings';
import { SceneVisualizer, SceneVisualizerOptions } from '../scene';
import { LavaLamp } from '../lava-lamp';
import { EmberHearth } from './hearth';
import { RainlightWindow } from './rain';
import { MoonlitTide } from './tide';
import { GroveLightwells } from './grove';
import { LanternPond } from './pond';

export const ATMOSPHERE_MODES = ['lava', 'hearth', 'rain', 'tide', 'grove', 'pond'] as const;
export type AtmosphereMode = (typeof ATMOSPHERE_MODES)[number];

export function isAtmosphereMode(mode: string): mode is AtmosphereMode {
  return (ATMOSPHERE_MODES as readonly string[]).includes(mode);
}

export function createAtmosphereScene(
  mode: AtmosphereMode,
  container: HTMLElement,
  options: SceneVisualizerOptions = {}
): SceneVisualizer {
  if (mode === 'hearth') {
    return new EmberHearth(container, options);
  }
  if (mode === 'rain') {
    return new RainlightWindow(container, options);
  }
  if (mode === 'tide') {
    return new MoonlitTide(container, options);
  }
  if (mode === 'grove') {
    return new GroveLightwells(container, options);
  }
  if (mode === 'pond') {
    return new LanternPond(container, options);
  }
  return new LavaLamp(container, options);
}

export function sceneSpeedLabel(mode: AppSettingsV1['visualizerMode']): string {
  if (mode === 'hearth') return 'Fire breath';
  if (mode === 'rain') return 'Rain cadence';
  if (mode === 'tide') return 'Tide swell';
  if (mode === 'grove') return 'Canopy drift';
  if (mode === 'pond') return 'Lantern drift';
  if (mode === 'lava') return 'Lava lamp flow';
  return 'Atmosphere speed';
}

