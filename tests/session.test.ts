import { describe, it, expect, beforeEach } from 'vitest';
import { loadSession, saveSession, clearSession } from '../src/storage/session';
import { SESSION_STORAGE_KEY } from '../src/storage/keys';

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

describe('Session Storage Module', () => {
  beforeEach(() => {
    localStorage.clear();
  });

  it('returns null when empty', () => {
    expect(loadSession()).toBeNull();
  });

  it('clamps currentTime to duration - 1', () => {
    saveSession({
      source: 'demo',
      demoId: 'pulse.mp3',
      title: 'Demo',
      currentTime: 99,
      duration: 10,
    });
    const session = loadSession();
    expect(session?.currentTime).toBe(9);
    expect(session?.duration).toBe(10);
  });

  it('reads known fields from a future version payload', () => {
    localStorage.setItem(
      SESSION_STORAGE_KEY,
      JSON.stringify({
        version: 7,
        source: 'imported',
        importedId: 'local:abc',
        title: 'Clip',
        currentTime: 3,
        duration: 20,
      })
    );
    const session = loadSession();
    expect(session?.source).toBe('imported');
    expect(session?.importedId).toBe('local:abc');
    expect(session?.currentTime).toBe(3);
    expect(session?.version).toBe(1);
  });

  it('clears the session key', () => {
    saveSession({
      source: 'demo',
      title: 'Demo',
      currentTime: 1,
      duration: 8,
    });
    clearSession();
    expect(loadSession()).toBeNull();
  });
});
