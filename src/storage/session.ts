import { SESSION_STORAGE_KEY } from './keys';

export interface LastSessionV1 {
  version: 1;
  source: 'demo' | 'imported' | 'none';
  demoId?: string;
  importedId?: string;
  title: string;
  currentTime: number;
  duration: number;
  updatedAt: string;
}

function clampCurrentTime(currentTime: number, duration: number): number {
  const time = Math.max(0, currentTime);
  if (duration > 1) {
    return Math.min(time, duration - 1);
  }
  return time;
}

export function loadSession(): LastSessionV1 | null {
  try {
    const raw = localStorage.getItem(SESSION_STORAGE_KEY);
    if (!raw) return null;
    const parsed = JSON.parse(raw);
    if (!parsed || typeof parsed !== 'object') return null;

    const duration = typeof parsed.duration === 'number' && !isNaN(parsed.duration) ? Math.max(0, parsed.duration) : 0;
    const rawTime = typeof parsed.currentTime === 'number' && !isNaN(parsed.currentTime) ? parsed.currentTime : 0;
    const source: LastSessionV1['source'] =
      parsed.source === 'imported' ? 'imported' : parsed.source === 'none' ? 'none' : 'demo';

    return {
      version: 1,
      source,
      demoId: typeof parsed.demoId === 'string' ? parsed.demoId : undefined,
      importedId: typeof parsed.importedId === 'string' ? parsed.importedId : undefined,
      title: typeof parsed.title === 'string' ? parsed.title : 'Unknown Track',
      currentTime: clampCurrentTime(rawTime, duration),
      duration,
      updatedAt: typeof parsed.updatedAt === 'string' ? parsed.updatedAt : new Date().toISOString(),
    };
  } catch (err) {
    console.warn('Failed to load session from localStorage:', err);
    return null;
  }
}

export function saveSession(session: Omit<LastSessionV1, 'version' | 'updatedAt'>): void {
  try {
    const duration = Math.max(0, session.duration);
    const payload: LastSessionV1 = {
      ...session,
      currentTime: clampCurrentTime(session.currentTime, duration),
      duration,
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
