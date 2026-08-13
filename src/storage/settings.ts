import { SETTINGS_STORAGE_KEY } from './keys';

export interface AppSettingsV1 {
  version: 1;
  volume: number;
  muted: boolean;
  visualizerMode: 'bars' | 'radial' | 'particles' | '2d';
  colorMode: 'spectrum' | 'mono' | 'mood';
  sensitivity: number;
  fftSize: 512 | 1024 | 2048;
  barCount: number;
  reducedMotionOverride: 'system' | 'on' | 'off';
  cameraAutoRotate: boolean;
}

export const DEFAULT_SETTINGS: AppSettingsV1 = {
  version: 1,
  volume: 0.8,
  muted: false,
  visualizerMode: 'bars',
  colorMode: 'spectrum',
  sensitivity: 1.0,
  fftSize: 1024,
  barCount: 64,
  reducedMotionOverride: 'system',
  cameraAutoRotate: true,
};

function getLocalStorage(): Storage | null {
  try {
    if (typeof localStorage !== 'undefined') {
      return localStorage;
    }
  } catch {
    // Ignore error in restricted environments
  }
  return null;
}

function clamp(val: number, min: number, max: number): number {
  return Math.min(Math.max(val, min), max);
}

export function loadSettings(): AppSettingsV1 {
  try {
    const storage = getLocalStorage();
    const raw = storage ? storage.getItem(SETTINGS_STORAGE_KEY) : null;
    if (!raw) return { ...DEFAULT_SETTINGS };
    const parsed = JSON.parse(raw);
    if (!parsed || typeof parsed !== 'object') return { ...DEFAULT_SETTINGS };

    const volume = typeof parsed.volume === 'number' ? clamp(parsed.volume, 0, 1) : DEFAULT_SETTINGS.volume;
    const muted = typeof parsed.muted === 'boolean' ? parsed.muted : DEFAULT_SETTINGS.muted;
    const visualizerMode = ['bars', 'radial', 'particles', '2d'].includes(parsed.visualizerMode)
      ? parsed.visualizerMode
      : DEFAULT_SETTINGS.visualizerMode;
    const colorMode = ['spectrum', 'mono', 'mood'].includes(parsed.colorMode)
      ? parsed.colorMode
      : DEFAULT_SETTINGS.colorMode;
    const sensitivity = typeof parsed.sensitivity === 'number' ? clamp(parsed.sensitivity, 0.5, 2) : DEFAULT_SETTINGS.sensitivity;
    const fftSize = [512, 1024, 2048].includes(parsed.fftSize) ? parsed.fftSize : DEFAULT_SETTINGS.fftSize;
    const barCount = typeof parsed.barCount === 'number' ? Math.round(clamp(parsed.barCount, 32, 128)) : DEFAULT_SETTINGS.barCount;
    const reducedMotionOverride = ['system', 'on', 'off'].includes(parsed.reducedMotionOverride)
      ? parsed.reducedMotionOverride
      : DEFAULT_SETTINGS.reducedMotionOverride;
    const cameraAutoRotate = typeof parsed.cameraAutoRotate === 'boolean' ? parsed.cameraAutoRotate : DEFAULT_SETTINGS.cameraAutoRotate;

    return {
      version: 1,
      volume,
      muted,
      visualizerMode,
      colorMode,
      sensitivity,
      fftSize,
      barCount,
      reducedMotionOverride,
      cameraAutoRotate,
    };
  } catch (err) {
    console.warn('Failed to load settings from localStorage:', err);
    return { ...DEFAULT_SETTINGS };
  }
}

export function saveSettings(settings: Partial<AppSettingsV1>): AppSettingsV1 {
  const current = loadSettings();
  const updated: AppSettingsV1 = {
    ...current,
    ...settings,
    version: 1,
  };
  try {
    const storage = getLocalStorage();
    if (storage) {
      storage.setItem(SETTINGS_STORAGE_KEY, JSON.stringify(updated));
    }
  } catch (err) {
    console.warn('Failed to save settings to localStorage:', err);
  }
  return updated;
}

export function resetSettings(): AppSettingsV1 {
  try {
    const storage = getLocalStorage();
    if (storage) {
      storage.removeItem(SETTINGS_STORAGE_KEY);
    }
  } catch (err) {
    console.warn('Failed to remove settings from localStorage:', err);
  }
  return { ...DEFAULT_SETTINGS };
}
