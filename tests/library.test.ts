import { describe, it, expect, vi, afterEach } from 'vitest';
import { isSupportedAudioFile } from '../src/ui/controls';
import {
  getAllTrackMetadata,
  getTrackData,
  getStorageEstimate,
} from '../src/storage/library';

// Simple mock for File in node environment if needed
class MockFile {
  name: string;
  type: string;
  size: number;
  private buffer: ArrayBuffer;

  constructor(parts: (string | ArrayBuffer)[], name: string, options?: { type?: string }) {
    this.name = name;
    this.type = options?.type || '';
    this.buffer = new ArrayBuffer(parts.reduce((acc, p) => acc + (typeof p === 'string' ? p.length : p.byteLength), 0));
    this.size = this.buffer.byteLength;
  }

  arrayBuffer(): Promise<ArrayBuffer> {
    return Promise.resolve(this.buffer);
  }
}

describe('Audio File Validation', () => {
  it('identifies supported audio mime types and extensions', () => {
    const mp3File = new MockFile(['audio-data'], 'song.mp3', { type: 'audio/mpeg' }) as unknown as File;
    const wavFile = new MockFile(['audio-data'], 'sample.wav', { type: 'audio/wav' }) as unknown as File;
    const flacFile = new MockFile(['audio-data'], 'lossless.flac', { type: '' }) as unknown as File;
    const m4aFile = new MockFile(['audio-data'], 'music.m4a', { type: '' }) as unknown as File;
    const oggFile = new MockFile(['audio-data'], 'audio.ogg', { type: 'audio/ogg' }) as unknown as File;
    const webmFile = new MockFile(['audio-data'], 'track.webm', { type: 'audio/webm' }) as unknown as File;
    const txtFile = new MockFile(['text-data'], 'lyrics.txt', { type: 'text/plain' }) as unknown as File;
    const exeFile = new MockFile(['binary'], 'installer.exe', { type: 'application/octet-stream' }) as unknown as File;

    expect(isSupportedAudioFile(mp3File)).toBe(true);
    expect(isSupportedAudioFile(wavFile)).toBe(true);
    expect(isSupportedAudioFile(flacFile)).toBe(true);
    expect(isSupportedAudioFile(m4aFile)).toBe(true);
    expect(isSupportedAudioFile(oggFile)).toBe(true);
    expect(isSupportedAudioFile(webmFile)).toBe(true);
    expect(isSupportedAudioFile(txtFile)).toBe(false);
    expect(isSupportedAudioFile(exeFile)).toBe(false);
  });
});

describe('Storage Estimate Helper', () => {
  afterEach(() => {
    vi.unstubAllGlobals();
  });

  it('returns null when storage estimate API is unavailable', async () => {
    vi.stubGlobal('navigator', undefined);

    const result = await getStorageEstimate();
    expect(result).toBeNull();
  });

  it('calculates MB correctly when storage estimate API is present', async () => {
    const mockEstimate = vi.fn().mockResolvedValue({
      usage: 10 * 1024 * 1024, // 10 MB
      quota: 100 * 1024 * 1024, // 100 MB
    });

    vi.stubGlobal('navigator', {
      storage: { estimate: mockEstimate },
    });

    const result = await getStorageEstimate();
    expect(result).toEqual({ usedMB: 10, totalMB: 100 });
  });
});

describe('IndexedDB Graceful Degradation in Non-Browser Environments', () => {
  it('getAllTrackMetadata returns empty array when IndexedDB is not defined', async () => {
    const list = await getAllTrackMetadata();
    expect(Array.isArray(list)).toBe(true);
  });

  it('getTrackData returns null when IndexedDB is not defined or track not found', async () => {
    const track = await getTrackData('non-existent');
    expect(track).toBeNull();
  });
});

