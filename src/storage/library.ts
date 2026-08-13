import { INDEXEDDB_NAME, INDEXEDDB_VERSION, INDEXEDDB_STORE_TRACKS } from './keys';

export interface ImportedTrack {
  id: string;
  title: string;
  mimeType: string;
  byteLength: number;
  createdAt: string;
  data: ArrayBuffer;
}

export type TrackMetadata = Omit<ImportedTrack, 'data'>;

const MAX_FILE_SIZE_BYTES = 40 * 1024 * 1024; // 40 MB

function openDB(): Promise<IDBDatabase> {
  return new Promise((resolve, reject) => {
    if (typeof indexedDB === 'undefined') {
      return reject(new Error('IndexedDB is not available in this environment.'));
    }
    const request = indexedDB.open(INDEXEDDB_NAME, INDEXEDDB_VERSION);

    request.onupgradeneeded = () => {
      const db = request.result;
      if (!db.objectStoreNames.contains(INDEXEDDB_STORE_TRACKS)) {
        db.createObjectStore(INDEXEDDB_STORE_TRACKS, { keyPath: 'id' });
      }
    };

    request.onsuccess = () => resolve(request.result);
    request.onerror = () => reject(request.error || new Error('Failed to open IndexedDB database'));
  });
}

export async function saveTrack(file: File): Promise<ImportedTrack> {
  if (file.size > MAX_FILE_SIZE_BYTES) {
    throw new Error(`File "${file.name}" (${(file.size / (1024 * 1024)).toFixed(1)} MB) exceeds the 40 MB limit.`);
  }

  const arrayBuffer = await file.arrayBuffer();
  const id = `local:${Date.now()}-${Math.random().toString(36).substring(2, 9)}`;
  const track: ImportedTrack = {
    id,
    title: file.name,
    mimeType: file.type || 'audio/mpeg',
    byteLength: file.size,
    createdAt: new Date().toISOString(),
    data: arrayBuffer,
  };

  const db = await openDB();
  return new Promise((resolve, reject) => {
    const tx = db.transaction(INDEXEDDB_STORE_TRACKS, 'readwrite');
    const store = tx.objectStore(INDEXEDDB_STORE_TRACKS);
    const req = store.put(track);

    req.onsuccess = () => resolve(track);
    req.onerror = () => reject(req.error || new Error('Failed to save track to IndexedDB'));
  });
}

export async function getAllTrackMetadata(): Promise<TrackMetadata[]> {
  try {
    const db = await openDB();
    return new Promise((resolve, reject) => {
      const tx = db.transaction(INDEXEDDB_STORE_TRACKS, 'readonly');
      const store = tx.objectStore(INDEXEDDB_STORE_TRACKS);
      const req = store.openCursor();
      const list: TrackMetadata[] = [];

      req.onsuccess = () => {
        const cursor = req.result;
        if (cursor) {
          const val = cursor.value as ImportedTrack;
          list.push({
            id: val.id,
            title: val.title,
            mimeType: val.mimeType,
            byteLength: val.byteLength,
            createdAt: val.createdAt,
          });
          cursor.continue();
        } else {
          // Sort by creation date descending
          list.sort((a, b) => new Date(b.createdAt).getTime() - new Date(a.createdAt).getTime());
          resolve(list);
        }
      };
      req.onerror = () => reject(req.error || new Error('Failed to fetch track list from IndexedDB'));
    });
  } catch (err) {
    console.warn('Failed to access IndexedDB track metadata:', err);
    return [];
  }
}

export async function getTrackData(id: string): Promise<ImportedTrack | null> {
  try {
    const db = await openDB();
    return new Promise((resolve, reject) => {
      const tx = db.transaction(INDEXEDDB_STORE_TRACKS, 'readonly');
      const store = tx.objectStore(INDEXEDDB_STORE_TRACKS);
      const req = store.get(id);

      req.onsuccess = () => resolve(req.result ? (req.result as ImportedTrack) : null);
      req.onerror = () => reject(req.error || new Error(`Failed to fetch track ${id}`));
    });
  } catch (err) {
    console.warn(`Failed to fetch track ${id}:`, err);
    return null;
  }
}

export async function deleteTrack(id: string): Promise<void> {
  const db = await openDB();
  return new Promise((resolve, reject) => {
    const tx = db.transaction(INDEXEDDB_STORE_TRACKS, 'readwrite');
    const store = tx.objectStore(INDEXEDDB_STORE_TRACKS);
    const req = store.delete(id);

    req.onsuccess = () => resolve();
    req.onerror = () => reject(req.error || new Error(`Failed to delete track ${id}`));
  });
}

export async function clearAllTracks(): Promise<void> {
  const db = await openDB();
  return new Promise((resolve, reject) => {
    const tx = db.transaction(INDEXEDDB_STORE_TRACKS, 'readwrite');
    const store = tx.objectStore(INDEXEDDB_STORE_TRACKS);
    const req = store.clear();

    req.onsuccess = () => resolve();
    req.onerror = () => reject(req.error || new Error('Failed to clear tracks from IndexedDB'));
  });
}

export async function getStorageEstimate(): Promise<{ usedMB: number; totalMB: number } | null> {
  if (navigator.storage && navigator.storage.estimate) {
    try {
      const estimate = await navigator.storage.estimate();
      const usedMB = (estimate.usage || 0) / (1024 * 1024);
      const totalMB = (estimate.quota || 0) / (1024 * 1024);
      return { usedMB, totalMB };
    } catch {
      return null;
    }
  }
  return null;
}
