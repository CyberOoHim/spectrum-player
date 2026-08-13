import { SETTINGS_STORAGE_KEY } from './keys';

export interface AppSettingsV1 {
  version: 1;
  volume: number;
  muted: boolean;
  loop: boolean;
  visualizerMode: 'bars' | 'radial' | 'particles' | '2d' | 'orb' | 'lava';
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
  loop: false,
  visualizerMode: 'bars',
  colorMode: 'spectrum',
  sensitivity: 1.0,
  fftSize: 1024,
  barCount: 64,
  reducedMotionOverride: 'system',
  cameraAutoRotate: true,
};

const PERSIST_DEBOUNCE_MS = 300;

let memorySettings: AppSettingsV1 | null = null;
let persistTimer: ReturnType<typeof setTimeout> | null = null;
const persistListeners = new Set<(ok: boolean) => void>();

function getLocalStorage(): Storage | null {
  try {
    if (typeof localStorage !== 'undefined') {
      return localStorage;
    }
  } catch {
    // Private mode / blocked storage
  }
  return null;
}

function clamp(val: number, min: number, max: number): number {
  return Math.min(Math.max(val, min), max);
}

export function normalizeSettings(input: unknown): AppSettingsV1 {
  const parsed = input && typeof input === 'object' ? (input as Record<string, unknown>) : {};

  const volume = typeof parsed.volume === 'number' ? clamp(parsed.volume, 0, 1) : DEFAULT_SETTINGS.volume;
  const muted = typeof parsed.muted === 'boolean' ? parsed.muted : DEFAULT_SETTINGS.muted;
  const loop = typeof parsed.loop === 'boolean' ? parsed.loop : DEFAULT_SETTINGS.loop;
  const visualizerMode = ['bars', 'radial', 'particles', '2d', 'orb', 'lava'].includes(parsed.visualizerMode as string)
    ? (parsed.visualizerMode as AppSettingsV1['visualizerMode'])
    : DEFAULT_SETTINGS.visualizerMode;
  const colorMode = ['spectrum', 'mono', 'mood'].includes(parsed.colorMode as string)
    ? (parsed.colorMode as AppSettingsV1['colorMode'])
    : DEFAULT_SETTINGS.colorMode;
  const sensitivity = typeof parsed.sensitivity === 'number' ? clamp(parsed.sensitivity, 0.5, 2) : DEFAULT_SETTINGS.sensitivity;
  const fftSize = [512, 1024, 2048].includes(parsed.fftSize as number)
    ? (parsed.fftSize as AppSettingsV1['fftSize'])
    : DEFAULT_SETTINGS.fftSize;
  const barCount = typeof parsed.barCount === 'number' ? Math.round(clamp(parsed.barCount, 32, 128)) : DEFAULT_SETTINGS.barCount;
  const reducedMotionOverride = ['system', 'on', 'off'].includes(parsed.reducedMotionOverride as string)
    ? (parsed.reducedMotionOverride as AppSettingsV1['reducedMotionOverride'])
    : DEFAULT_SETTINGS.reducedMotionOverride;
  const cameraAutoRotate = typeof parsed.cameraAutoRotate === 'boolean' ? parsed.cameraAutoRotate : DEFAULT_SETTINGS.cameraAutoRotate;

  return {
    version: 1,
    volume,
    muted,
    loop,
    visualizerMode,
    colorMode,
    sensitivity,
    fftSize,
    barCount,
    reducedMotionOverride,
    cameraAutoRotate,
  };
}

function notifyPersist(ok: boolean): void {
  for (const listener of persistListeners) {
    listener(ok);
  }
}

function writeSettings(settings: AppSettingsV1): boolean {
  try {
    const storage = getLocalStorage();
    if (!storage) {
      notifyPersist(false);
      return false;
    }
    storage.setItem(SETTINGS_STORAGE_KEY, JSON.stringify(settings));
    notifyPersist(true);
    return true;
  } catch (err) {
    console.warn('Failed to save settings to localStorage:', err);
    notifyPersist(false);
    return false;
  }
}

function schedulePersist(settings: AppSettingsV1): void {
  if (persistTimer !== null) {
    clearTimeout(persistTimer);
  }
  persistTimer = setTimeout(() => {
    persistTimer = null;
    writeSettings(settings);
  }, PERSIST_DEBOUNCE_MS);
}

/** Clears the in-memory cache so the next load reads disk. Used by tests. */
export function resetSettingsCache(): void {
  if (persistTimer !== null) {
    clearTimeout(persistTimer);
    persistTimer = null;
  }
  memorySettings = null;
}

export function flushSettingsPersist(): boolean {
  if (persistTimer !== null) {
    clearTimeout(persistTimer);
    persistTimer = null;
  }
  if (!memorySettings) return true;
  return writeSettings(memorySettings);
}

export function subscribeSettingsPersist(listener: (ok: boolean) => void): () => void {
  persistListeners.add(listener);
  return () => persistListeners.delete(listener);
}

export function loadSettings(): AppSettingsV1 {
  if (memorySettings) {
    return { ...memorySettings };
  }

  try {
    const storage = getLocalStorage();
    const raw = storage ? storage.getItem(SETTINGS_STORAGE_KEY) : null;
    if (!raw) {
      memorySettings = { ...DEFAULT_SETTINGS };
      return { ...memorySettings };
    }
    const parsed = JSON.parse(raw);
    if (!parsed || typeof parsed !== 'object') {
      memorySettings = { ...DEFAULT_SETTINGS };
      return { ...memorySettings };
    }
    memorySettings = normalizeSettings(parsed);
    return { ...memorySettings };
  } catch (err) {
    console.warn('Failed to load settings from localStorage:', err);
    memorySettings = { ...DEFAULT_SETTINGS };
    return { ...memorySettings };
  }
}

export function saveSettings(settings: Partial<AppSettingsV1>): AppSettingsV1 {
  const updated = normalizeSettings({
    ...loadSettings(),
    ...settings,
  });
  memorySettings = updated;
  schedulePersist(updated);
  return { ...updated };
}

export function resetSettings(): AppSettingsV1 {
  if (persistTimer !== null) {
    clearTimeout(persistTimer);
    persistTimer = null;
  }
  memorySettings = { ...DEFAULT_SETTINGS };
  try {
    const storage = getLocalStorage();
    if (storage) {
      storage.removeItem(SETTINGS_STORAGE_KEY);
    }
    notifyPersist(true);
  } catch (err) {
    console.warn('Failed to remove settings from localStorage:', err);
    notifyPersist(false);
  }
  return { ...DEFAULT_SETTINGS };
}
