import { SESSION_STORAGE_KEY } from './keys';

export interface LastSessionV1 {
  version: 1;
  source: 'demo' | 'imported';
  demoId?: string;
  importedId?: string;
  title: string;
  currentTime: number;
  duration: number;
  updatedAt: string;
}

export function loadSession(): LastSessionV1 | null {
  try {
    const raw = localStorage.getItem(SESSION_STORAGE_KEY);
    if (!raw) return null;
    const parsed = JSON.parse(raw);
    if (!parsed || typeof parsed !== 'object') return null;
    if (parsed.version !== 1) return null;

    return {
      version: 1,
      source: parsed.source === 'imported' ? 'imported' : 'demo',
      demoId: typeof parsed.demoId === 'string' ? parsed.demoId : undefined,
      importedId: typeof parsed.importedId === 'string' ? parsed.importedId : undefined,
      title: typeof parsed.title === 'string' ? parsed.title : 'Unknown Track',
      currentTime: typeof parsed.currentTime === 'number' && !isNaN(parsed.currentTime) ? Math.max(0, parsed.currentTime) : 0,
      duration: typeof parsed.duration === 'number' && !isNaN(parsed.duration) ? Math.max(0, parsed.duration) : 0,
      updatedAt: typeof parsed.updatedAt === 'string' ? parsed.updatedAt : new Date().toISOString(),
    };
  } catch (err) {
    console.warn('Failed to load session from localStorage:', err);
    return null;
  }
}

export function saveSession(session: Omit<LastSessionV1, 'version' | 'updatedAt'>): void {
  try {
    const payload: LastSessionV1 = {
      ...session,
      version: 1,
      updatedAt: new Date().toISOString(),
    };
    localStorage.setItem(SESSION_STORAGE_KEY, JSON.stringify(payload));
  } catch (err) {
    console.warn('Failed to save session to localStorage:', err);
  }
}

export function clearSession(): void {
  try {
    localStorage.removeItem(SESSION_STORAGE_KEY);
  } catch (err) {
    console.warn('Failed to clear session from localStorage:', err);
  }
}
