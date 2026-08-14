import { describe, it, expect, beforeEach } from 'vitest';
import {
  loadSettings,
  saveSettings,
  resetSettings,
  resetSettingsCache,
  flushSettingsPersist,
  subscribeSettingsPersist,
  DEFAULT_SETTINGS,
} from '../src/storage/settings';
import { SETTINGS_STORAGE_KEY } from '../src/storage/keys';

class MockLocalStorage {
  private store: Record<string, string> = {};

  getItem(key: string): string | null {
    return this.store[key] || null;
  }

  setItem(key: string, value: string): void {
    this.store[key] = String(value);
  }

  removeItem(key: string): void {
    delete this.store[key];
  }

  clear(): void {
    this.store = {};
  }
}

if (typeof globalThis.localStorage === 'undefined') {
  Object.defineProperty(globalThis, 'localStorage', {
    value: new MockLocalStorage(),
    writable: true,
    configurable: true,
  });
}


describe('Settings Storage Module', () => {
  beforeEach(() => {
    resetSettingsCache();
    localStorage.clear();
  });

  it('returns default settings when localStorage is empty', () => {
    const settings = loadSettings();
    expect(settings).toEqual(DEFAULT_SETTINGS);
  });

  it('saves and loads custom settings cleanly', () => {
    saveSettings({ volume: 0.5, visualizerMode: 'orb', sensitivity: 1.5, loop: true });
    const settings = loadSettings();
    expect(settings.volume).toBe(0.5);
    expect(settings.visualizerMode).toBe('orb');
    expect(settings.sensitivity).toBe(1.5);
    expect(settings.loop).toBe(true);
    expect(settings.version).toBe(1);
  });

  it('persists lava visualizer mode and sceneSpeed', () => {
    saveSettings({ visualizerMode: 'lava', colorMode: 'mood', sceneSpeed: 1.2 });
    const settings = loadSettings();
    expect(settings.visualizerMode).toBe('lava');
    expect(settings.colorMode).toBe('mood');
    expect(settings.sceneSpeed).toBe(1.2);
  });

  it('persists hearth visualizer mode', () => {
    saveSettings({ visualizerMode: 'hearth', sceneSpeed: 0.6 });
    const settings = loadSettings();
    expect(settings.visualizerMode).toBe('hearth');
    expect(settings.sceneSpeed).toBe(0.6);
  });

  it('persists rain visualizer mode', () => {
    saveSettings({ visualizerMode: 'rain', sceneSpeed: 0.9, colorMode: 'mood' });
    const settings = loadSettings();
    expect(settings.visualizerMode).toBe('rain');
    expect(settings.sceneSpeed).toBe(0.9);
    expect(settings.colorMode).toBe('mood');
  });

  it('persists tide visualizer mode', () => {
    saveSettings({ visualizerMode: 'tide', sceneSpeed: 0.7 });
    const settings = loadSettings();
    expect(settings.visualizerMode).toBe('tide');
    expect(settings.sceneSpeed).toBe(0.7);
  });

  it('persists grove visualizer mode', () => {
    saveSettings({ visualizerMode: 'grove', sceneSpeed: 0.85 });
    const settings = loadSettings();
    expect(settings.visualizerMode).toBe('grove');
    expect(settings.sceneSpeed).toBe(0.85);
  });

  it('persists pond visualizer mode', () => {
    saveSettings({ visualizerMode: 'pond', sceneSpeed: 0.75 });
    const settings = loadSettings();
    expect(settings.visualizerMode).toBe('pond');
    expect(settings.sceneSpeed).toBe(0.75);
  });

  it('reads legacy lavaSpeed as sceneSpeed', () => {
    localStorage.setItem(
      SETTINGS_STORAGE_KEY,
      JSON.stringify({ visualizerMode: 'lava', lavaSpeed: 1.1 })
    );
    const settings = loadSettings();
    expect(settings.visualizerMode).toBe('lava');
    expect(settings.sceneSpeed).toBe(1.1);
  });

  it('keeps bars as the default visualizer mode', () => {
    expect(DEFAULT_SETTINGS.visualizerMode).toBe('bars');
  });

  it('persists cameraAutoRotateSpeed and clamps bounds', () => {
    saveSettings({ cameraAutoRotateSpeed: 2.5 });
    let settings = loadSettings();
    expect(settings.cameraAutoRotateSpeed).toBe(2.5);

    saveSettings({ cameraAutoRotateSpeed: 10.0 });
    settings = loadSettings();
    expect(settings.cameraAutoRotateSpeed).toBe(3.0);

    saveSettings({ cameraAutoRotateSpeed: 0.01 });
    settings = loadSettings();
    expect(settings.cameraAutoRotateSpeed).toBe(0.1);
  });

  it('falls back to bars for unknown visualizer modes', () => {
    localStorage.setItem(
      SETTINGS_STORAGE_KEY,
      JSON.stringify({ visualizerMode: 'unknown-mode', volume: 0.4 })
    );
    const settings = loadSettings();
    expect(settings.visualizerMode).toBe('bars');
    expect(settings.volume).toBe(0.4);
  });

  it('clamps invalid numerical values on load', () => {
    localStorage.setItem(
      SETTINGS_STORAGE_KEY,
      JSON.stringify({ volume: 5.0, sensitivity: -2.0, barCount: 999 })
    );
    const settings = loadSettings();
    expect(settings.volume).toBe(1.0);
    expect(settings.sensitivity).toBe(0.5);
    expect(settings.barCount).toBe(128);
  });

  it('clamps values on save', () => {
    saveSettings({ volume: 5, barCount: 10, sensitivity: 9 });
    const settings = loadSettings();
    expect(settings.volume).toBe(1);
    expect(settings.barCount).toBe(32);
    expect(settings.sensitivity).toBe(2);
  });

  it('reads known fields from a future version payload', () => {
    localStorage.setItem(
      SETTINGS_STORAGE_KEY,
      JSON.stringify({ version: 99, volume: 0.25, visualizerMode: 'radial' })
    );
    const settings = loadSettings();
    expect(settings.volume).toBe(0.25);
    expect(settings.visualizerMode).toBe('radial');
    expect(settings.version).toBe(1);
    expect(settings.fftSize).toBe(DEFAULT_SETTINGS.fftSize);
  });

  it('handles corrupt JSON gracefully without crashing', () => {
    localStorage.setItem(SETTINGS_STORAGE_KEY, '{ invalid_json ::: ');
    const settings = loadSettings();
    expect(settings).toEqual(DEFAULT_SETTINGS);
  });

  it('resets settings back to defaults', () => {
    saveSettings({ volume: 0.2 });
    resetSettings();
    const settings = loadSettings();
    expect(settings.volume).toBe(DEFAULT_SETTINGS.volume);
  });

  it('notifies when persist fails', () => {
    const seen: boolean[] = [];
    const unsub = subscribeSettingsPersist((ok) => seen.push(ok));
    const original = localStorage.setItem.bind(localStorage);
    localStorage.setItem = () => {
      throw new Error('quota');
    };
    try {
      saveSettings({ volume: 0.1 });
      flushSettingsPersist();
      expect(seen).toContain(false);
    } finally {
      localStorage.setItem = original;
      unsub();
    }
  });
});
