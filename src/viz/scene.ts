import { AppSettingsV1 } from '../storage/settings';

export interface SceneVisualizer {
  render(bands: Float32Array, settings: AppSettingsV1): void;
  degradeQuality(): boolean;
  destroy(): void;
}

export interface SceneVisualizerOptions {
  onContextLost?: () => void;
}

export function isReducedMotion(settings: AppSettingsV1): boolean {
  return (
    settings.reducedMotionOverride === 'on' ||
    (settings.reducedMotionOverride === 'system' &&
      typeof window !== 'undefined' &&
      window.matchMedia('(prefers-reduced-motion: reduce)').matches)
  );
}

export function atmosphereSpeed(settings: AppSettingsV1): number {
  if (typeof settings.sceneSpeed === 'number' && Number.isFinite(settings.sceneSpeed)) {
    return settings.sceneSpeed;
  }
  return 0.8;
}
