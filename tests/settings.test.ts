import { describe, it, expect, beforeEach } from 'vitest';
import { loadSettings, saveSettings, resetSettings, DEFAULT_SETTINGS } from '../src/storage/settings';
import { SETTINGS_STORAGE_KEY } from '../src/storage/keys';

// In-memory localStorage polyfill for Node test environment
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
  (globalThis as unknown as { localStorage: MockLocalStorage }).localStorage = new MockLocalStorage();
}

describe('Settings Storage Module', () => {
  beforeEach(() => {
    localStorage.clear();
  });

  it('returns default settings when localStorage is empty', () => {
    const settings = loadSettings();
    expect(settings).toEqual(DEFAULT_SETTINGS);
  });

  it('saves and loads custom settings cleanly', () => {
    saveSettings({ volume: 0.5, visualizerMode: 'particles', sensitivity: 1.5 });
    const settings = loadSettings();
    expect(settings.volume).toBe(0.5);
    expect(settings.visualizerMode).toBe('particles');
    expect(settings.sensitivity).toBe(1.5);
    expect(settings.version).toBe(1);
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
});
