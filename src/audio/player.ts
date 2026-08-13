import { getBands } from './analyser';

export interface PlayerTrackInfo {
  title: string;
  source: 'demo' | 'imported';
  demoId?: string;
  importedId?: string;
  blobUrlToRevoke?: string;
}

export type PlayerStateCallback = (info: {
  isPlaying: boolean;
  currentTime: number;
  duration: number;
  title: string;
  trackInfo: PlayerTrackInfo | null;
  error?: string;
}) => void;

export class AudioPlayer {
  private audio: HTMLAudioElement;
  private audioCtx: AudioContext | null = null;
  private sourceNode: MediaElementAudioSourceNode | null = null;
  private analyserNode: AnalyserNode | null = null;
  private gainNode: GainNode | null = null;
  private frequencyBuffer: Uint8Array = new Uint8Array(512);

  private currentTrackInfo: PlayerTrackInfo | null = null;
  private stateListeners: Set<PlayerStateCallback> = new Set();
  private volume: number = 0.8;
  private isMuted: boolean = false;
  private currentFftSize: number = 1024;

  constructor() {
    this.audio = new Audio();
    this.audio.setAttribute('playsinline', 'true');
    this.audio.crossOrigin = 'anonymous';
    this.audio.volume = 1;
    this.audio.muted = false;

    this.setupAudioListeners();
    this.setupMediaSessionHandlers();
  }

  private setupAudioListeners(): void {
    this.audio.addEventListener('timeupdate', () => this.notifyState());
    this.audio.addEventListener('loadedmetadata', () => this.notifyState());
    this.audio.addEventListener('play', () => this.notifyState());
    this.audio.addEventListener('pause', () => this.notifyState());
    this.audio.addEventListener('ended', () => this.notifyState());
    this.audio.addEventListener('error', () => {
      const errMessage = this.audio.error?.message || 'Error loading or playing audio file.';
      this.notifyState(errMessage);
    });
  }

  private setupMediaSessionHandlers(): void {
    if ('mediaSession' in navigator) {
      try {
        navigator.mediaSession.setActionHandler('play', () => {
          void this.play().catch(() => {});
        });
        navigator.mediaSession.setActionHandler('pause', () => this.pause());
        navigator.mediaSession.setActionHandler('seekto', (details) => {
          if (details.seekTime !== undefined && details.seekTime !== null) {
            this.seek(details.seekTime);
          }
        });
        navigator.mediaSession.setActionHandler('seekbackward', (details) => {
          this.seek(this.getCurrentTime() - (details.seekOffset || 5));
        });
        navigator.mediaSession.setActionHandler('seekforward', (details) => {
          this.seek(this.getCurrentTime() + (details.seekOffset || 5));
        });
        navigator.mediaSession.setActionHandler('stop', () => {
          this.pause();
          this.seek(0);
        });
      } catch (err) {
        console.warn('MediaSession action handler registration failed:', err);
      }
    }
  }

  private applyGain(): void {
    if (this.gainNode) {
      this.gainNode.gain.value = this.isMuted ? 0 : this.volume;
    }
  }

  public setLoop(loop: boolean): void {
    this.audio.loop = loop;
    this.notifyState();
  }

  public isLooping(): boolean {
    return this.audio.loop;
  }

  public ensureAudioContext(): void {
    if (!this.audioCtx) {
      const AudioContextClass = window.AudioContext || (window as unknown as { webkitAudioContext: typeof AudioContext }).webkitAudioContext;
      this.audioCtx = new AudioContextClass();

      this.sourceNode = this.audioCtx.createMediaElementSource(this.audio);
      this.analyserNode = this.audioCtx.createAnalyser();
      this.analyserNode.fftSize = this.currentFftSize;
      this.analyserNode.smoothingTimeConstant = 0.8;
      this.frequencyBuffer = new Uint8Array(this.analyserNode.frequencyBinCount);

      this.gainNode = this.audioCtx.createGain();
      // Element volume/mute would scale MediaElementSource before the analyser.
      this.audio.volume = 1;
      this.audio.muted = false;
      this.applyGain();

      this.sourceNode.connect(this.analyserNode);
      this.analyserNode.connect(this.gainNode);
      this.gainNode.connect(this.audioCtx.destination);
    }
  }

  public loadSource(src: string, trackInfo: PlayerTrackInfo): void {
    if (this.currentTrackInfo?.blobUrlToRevoke && this.currentTrackInfo.blobUrlToRevoke !== trackInfo.blobUrlToRevoke) {
      URL.revokeObjectURL(this.currentTrackInfo.blobUrlToRevoke);
    }

    this.currentTrackInfo = trackInfo;
    this.audio.src = src;
    this.audio.load();
    this.notifyState();
  }

  public whenMetadataReady(timeoutMs = 8000): Promise<void> {
    const duration = this.audio.duration;
    if (isFinite(duration) && duration > 0) {
      return Promise.resolve();
    }

    return new Promise((resolve) => {
      const finish = () => {
        this.audio.removeEventListener('loadedmetadata', finish);
        this.audio.removeEventListener('error', finish);
        window.clearTimeout(timer);
        resolve();
      };
      const timer = window.setTimeout(finish, timeoutMs);
      this.audio.addEventListener('loadedmetadata', finish);
      this.audio.addEventListener('error', finish);
    });
  }

  public canRestoreSeek(seconds: number): boolean {
    const duration = this.audio.duration;
    return isFinite(duration) && duration > 1 && isFinite(seconds) && seconds > 0 && seconds < duration - 1;
  }

  public async play(): Promise<void> {
    this.ensureAudioContext();
    try {
      if (this.audioCtx && this.audioCtx.state === 'suspended') {
        await this.audioCtx.resume();
      }
      await this.audio.play();
    } catch (err) {
      console.warn('Audio play error:', err);
      this.notifyState('Click Play to start audio.');
      throw err;
    }
  }

  public pause(): void {
    this.audio.pause();
    if (this.audioCtx && this.audioCtx.state === 'running') {
      this.audioCtx.suspend().catch((err) => console.warn('AudioContext suspend failed:', err));
    }
  }

  public togglePlayPause(): Promise<void> | void {
    if (this.audio.paused) {
      return this.play();
    }
    this.pause();
  }

  public seek(seconds: number): void {
    if (isFinite(seconds) && !isNaN(seconds)) {
      const duration = this.audio.duration;
      const max = isFinite(duration) && duration > 0 ? duration : 0;
      this.audio.currentTime = Math.max(0, Math.min(seconds, max));
    }
  }

  public setVolume(vol: number): void {
    this.volume = Math.max(0, Math.min(1, vol));
    this.applyGain();
    this.notifyState();
  }

  public setMuted(muted: boolean): void {
    this.isMuted = muted;
    this.applyGain();
    this.notifyState();
  }

  public getVolume(): number {
    return this.volume;
  }

  public isMutedState(): boolean {
    return this.isMuted;
  }

  public setFftSize(fftSize: number): void {
    this.currentFftSize = fftSize;
    if (this.analyserNode) {
      this.analyserNode.fftSize = fftSize;
      this.frequencyBuffer = new Uint8Array(this.analyserNode.frequencyBinCount);
    }
  }

  public getBands(barCount: number, sensitivity: number = 1.0): Float32Array {
    return getBands(this.analyserNode, this.frequencyBuffer, barCount, sensitivity);
  }

  public isPlaying(): boolean {
    return !this.audio.paused && !this.audio.ended;
  }

  public getCurrentTime(): number {
    return this.audio.currentTime || 0;
  }

  public getDuration(): number {
    return this.audio.duration || 0;
  }

  public getTrackInfo(): PlayerTrackInfo | null {
    return this.currentTrackInfo;
  }

  public subscribe(cb: PlayerStateCallback): () => void {
    this.stateListeners.add(cb);
    this.notifyState();
    return () => this.stateListeners.delete(cb);
  }

  private notifyState(error?: string): void {
    const isPlaying = this.isPlaying();
    const currentTime = this.getCurrentTime();
    const duration = this.getDuration();
    const title = this.currentTrackInfo?.title || 'No Track';

    const payload = {
      isPlaying,
      currentTime,
      duration,
      title,
      trackInfo: this.currentTrackInfo,
      error,
    };

    if ('mediaSession' in navigator && typeof navigator.mediaSession.setPositionState === 'function') {
      try {
        if (duration > 0 && isFinite(duration) && isFinite(currentTime) && currentTime <= duration) {
          navigator.mediaSession.setPositionState({
            duration,
            playbackRate: this.audio.playbackRate || 1,
            position: currentTime,
          });
        }
      } catch {
        // Ignore setPositionState errors if state is out of range or transient
      }
    }

    for (const listener of this.stateListeners) {
      listener(payload);
    }
  }
}
