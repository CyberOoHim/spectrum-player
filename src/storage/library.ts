import { INDEXEDDB_NAME, INDEXEDDB_VERSION, INDEXEDDB_STORE_TRACKS, INDEXEDDB_STORE_METADATA } from './keys';

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

    request.onupgradeneeded = (event) => {
      const db = request.result;
      if (!db.objectStoreNames.contains(INDEXEDDB_STORE_TRACKS)) {
        db.createObjectStore(INDEXEDDB_STORE_TRACKS, { keyPath: 'id' });
      }
      if (!db.objectStoreNames.contains(INDEXEDDB_STORE_METADATA)) {
        db.createObjectStore(INDEXEDDB_STORE_METADATA, { keyPath: 'id' });
      }

      // If upgrading from v1 to v2, backfill the metadata store from existing tracks
      if (event.oldVersion < 2 && request.transaction) {
        try {
          const trackStore = request.transaction.objectStore(INDEXEDDB_STORE_TRACKS);
          const metaStore = request.transaction.objectStore(INDEXEDDB_STORE_METADATA);
          const cursorReq = trackStore.openCursor();
          cursorReq.onsuccess = () => {
            const cursor = cursorReq.result;
            if (cursor) {
              const val = cursor.value as ImportedTrack;
              metaStore.put({
                id: val.id,
                title: val.title,
                mimeType: val.mimeType,
                byteLength: val.byteLength,
                createdAt: val.createdAt,
              });
              cursor.continue();
            }
          };
        } catch (err) {
          console.warn('Failed to migrate existing IndexedDB tracks to metadata store:', err);
        }
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
  const metadata: TrackMetadata = {
    id,
    title: file.name,
    mimeType: file.type || 'audio/mpeg',
    byteLength: file.size,
    createdAt: new Date().toISOString(),
  };

  const track: ImportedTrack = {
    ...metadata,
    data: arrayBuffer,
  };

  const db = await openDB();
  return new Promise((resolve, reject) => {
    const tx = db.transaction([INDEXEDDB_STORE_TRACKS, INDEXEDDB_STORE_METADATA], 'readwrite');
    const trackStore = tx.objectStore(INDEXEDDB_STORE_TRACKS);
    const metaStore = tx.objectStore(INDEXEDDB_STORE_METADATA);

    trackStore.put(track);
    metaStore.put(metadata);

    tx.oncomplete = () => resolve(track);
    tx.onerror = () => reject(tx.error || new Error('Failed to save track to IndexedDB'));
    tx.onabort = () => reject(tx.error || new Error('IndexedDB transaction aborted'));
  });
}

export async function getAllTrackMetadata(): Promise<TrackMetadata[]> {
  try {
    const db = await openDB();
    return new Promise((resolve, reject) => {
      // Read from lightweight metadata store
      const tx = db.transaction(INDEXEDDB_STORE_METADATA, 'readonly');
      const store = tx.objectStore(INDEXEDDB_STORE_METADATA);
      const req = store.getAll ? store.getAll() : store.openCursor();
      const list: TrackMetadata[] = [];

      if ('getAll' in store) {
        req.onsuccess = () => {
          const results = (req.result as TrackMetadata[]) || [];
          results.sort((a, b) => new Date(b.createdAt).getTime() - new Date(a.createdAt).getTime());
          resolve(results);
        };
      } else {
        req.onsuccess = () => {
          const cursor = (req as IDBRequest<IDBCursorWithValue | null>).result;
          if (cursor) {
            list.push(cursor.value as TrackMetadata);
            cursor.continue();
          } else {
            list.sort((a, b) => new Date(b.createdAt).getTime() - new Date(a.createdAt).getTime());
            resolve(list);
          }
        };
      }

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
    const tx = db.transaction([INDEXEDDB_STORE_TRACKS, INDEXEDDB_STORE_METADATA], 'readwrite');
    tx.objectStore(INDEXEDDB_STORE_TRACKS).delete(id);
    tx.objectStore(INDEXEDDB_STORE_METADATA).delete(id);

    tx.oncomplete = () => resolve();
    tx.onerror = () => reject(tx.error || new Error(`Failed to delete track ${id}`));
    tx.onabort = () => reject(tx.error || new Error(`Delete track transaction aborted for ${id}`));
  });
}

export async function clearAllTracks(): Promise<void> {
  const db = await openDB();
  return new Promise((resolve, reject) => {
    const tx = db.transaction([INDEXEDDB_STORE_TRACKS, INDEXEDDB_STORE_METADATA], 'readwrite');
    tx.objectStore(INDEXEDDB_STORE_TRACKS).clear();
    tx.objectStore(INDEXEDDB_STORE_METADATA).clear();

    tx.oncomplete = () => resolve();
    tx.onerror = () => reject(tx.error || new Error('Failed to clear tracks from IndexedDB'));
    tx.onabort = () => reject(tx.error || new Error('Clear tracks transaction aborted'));
  });
}

export async function getStorageEstimate(): Promise<{ usedMB: number; totalMB: number } | null> {
  if (typeof navigator !== 'undefined' && navigator.storage && typeof navigator.storage.estimate === 'function') {
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
