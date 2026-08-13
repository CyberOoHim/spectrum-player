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

    this.setupAudioListeners();
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

  public ensureAudioContext(): void {
    if (!this.audioCtx) {
      const AudioContextClass = window.AudioContext || (window as unknown as { webkitAudioContext: typeof AudioContext }).webkitAudioContext;
      this.audioCtx = new AudioContextClass();

      // Create Web Audio graph once
      this.sourceNode = this.audioCtx.createMediaElementSource(this.audio);
      this.analyserNode = this.audioCtx.createAnalyser();
      this.analyserNode.fftSize = this.currentFftSize;
      this.analyserNode.smoothingTimeConstant = 0.8;
      this.frequencyBuffer = new Uint8Array(this.analyserNode.frequencyBinCount);

      this.gainNode = this.audioCtx.createGain();
      this.gainNode.gain.value = this.isMuted ? 0 : this.volume;

      // Tap analyser before master gain
      this.sourceNode.connect(this.analyserNode);
      this.analyserNode.connect(this.gainNode);
      this.gainNode.connect(this.audioCtx.destination);
    }

    if (this.audioCtx.state === 'suspended') {
      this.audioCtx.resume().catch((err) => console.warn('AudioContext resume failed:', err));
    }
  }

  public loadSource(src: string, trackInfo: PlayerTrackInfo): void {
    // Revoke previous blob URL if any
    if (this.currentTrackInfo?.blobUrlToRevoke) {
      URL.revokeObjectURL(this.currentTrackInfo.blobUrlToRevoke);
    }

    this.currentTrackInfo = trackInfo;
    this.audio.src = src;
    this.audio.load();
    this.notifyState();
  }

  public async play(): Promise<void> {
    this.ensureAudioContext();
    try {
      await this.audio.play();
    } catch (err) {
      console.warn('Audio play error:', err);
      this.notifyState('Click Play to start audio.');
      throw err;
    }
  }

  public pause(): void {
    this.audio.pause();
  }

  public togglePlayPause(): Promise<void> | void {
    if (this.audio.paused) {
      return this.play();
    } else {
      this.pause();
    }
  }

  public seek(seconds: number): void {
    if (isFinite(seconds) && !isNaN(seconds)) {
      this.audio.currentTime = Math.max(0, Math.min(seconds, this.audio.duration || 0));
    }
  }

  public setVolume(vol: number): void {
    this.volume = Math.max(0, Math.min(1, vol));
    this.audio.volume = this.volume;
    if (this.gainNode) {
      this.gainNode.gain.value = this.isMuted ? 0 : this.volume;
    }
    this.notifyState();
  }

  public setMuted(muted: boolean): void {
    this.isMuted = muted;
    this.audio.muted = muted;
    if (this.gainNode) {
      this.gainNode.gain.value = this.isMuted ? 0 : this.volume;
    }
    this.notifyState();
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
    return !this.audio.paused && !this.audio.ended && this.audio.readyState > 2;
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
    const payload = {
      isPlaying: this.isPlaying(),
      currentTime: this.getCurrentTime(),
      duration: this.getDuration(),
      title: this.currentTrackInfo?.title || 'No Track',
      trackInfo: this.currentTrackInfo,
      error,
    };
    for (const listener of this.stateListeners) {
      listener(payload);
    }
  }
}
