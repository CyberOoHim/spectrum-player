import { AudioPlayer, PlayerTrackInfo } from '../audio/player';
import { AppSettingsV1, saveSettings } from '../storage/settings';
import { saveTrack, getAllTrackMetadata, deleteTrack, getTrackData, getStorageEstimate, TrackMetadata } from '../storage/library';

export interface UIControlsConfig {
  player: AudioPlayer;
  settings: AppSettingsV1;
  onSettingsChange: (newSettings: AppSettingsV1) => void;
  onTrackSelected: (src: string, trackInfo: PlayerTrackInfo) => void;
  setStatusMessage: (msg: string, isError?: boolean) => void;
}

export class UIControls {
  private config: UIControlsConfig;

  // DOM Elements
  private playBtn: HTMLButtonElement;
  private seekInput: HTMLInputElement;
  private timeDisplay: HTMLElement;
  private volumeInput: HTMLInputElement;
  private muteBtn: HTMLButtonElement;
  private fileInput: HTMLInputElement;
  private modeSelect: HTMLSelectElement;
  private colorSelect: HTMLSelectElement;
  private sensitivityInput: HTMLInputElement;
  private librarySelect: HTMLSelectElement;
  private deleteTrackBtn: HTMLButtonElement;
  private storageInfo: HTMLElement;

  private currentTrackMetadataList: TrackMetadata[] = [];
  private isUserSeeking: boolean = false;

  constructor(config: UIControlsConfig) {
    this.config = config;

    // Element bindings
    this.playBtn = document.querySelector<HTMLButtonElement>('#play')!;
    this.seekInput = document.querySelector<HTMLInputElement>('#seek')!;
    this.timeDisplay = document.querySelector<HTMLElement>('#time-display')!;
    this.volumeInput = document.querySelector<HTMLInputElement>('#volume')!;
    this.muteBtn = document.querySelector<HTMLButtonElement>('#mute')!;
    this.fileInput = document.querySelector<HTMLInputElement>('#file')!;
    this.modeSelect = document.querySelector<HTMLSelectElement>('#mode-select')!;
    this.colorSelect = document.querySelector<HTMLSelectElement>('#color-select')!;
    this.sensitivityInput = document.querySelector<HTMLInputElement>('#sensitivity')!;
    this.librarySelect = document.querySelector<HTMLSelectElement>('#library-select')!;
    this.deleteTrackBtn = document.querySelector<HTMLButtonElement>('#delete-track')!;
    this.storageInfo = document.querySelector<HTMLElement>('#storage-info')!;

    this.initUIValues();
    this.bindEvents();
    this.bindKeyboardShortcuts();
    this.refreshLibrary();
  }

  private initUIValues(): void {
    const s = this.config.settings;
    this.volumeInput.value = s.volume.toString();
    this.volumeInput.disabled = false;
    this.muteBtn.textContent = s.muted ? 'Unmute' : 'Mute';
    this.modeSelect.value = s.visualizerMode;
    if (this.colorSelect) this.colorSelect.value = s.colorMode;
    if (this.sensitivityInput) this.sensitivityInput.value = s.sensitivity.toString();
  }

  private bindEvents(): void {
    // Play/Pause
    this.playBtn.addEventListener('click', () => {
      this.config.player.togglePlayPause();
    });

    // Seek input
    this.seekInput.addEventListener('mousedown', () => { this.isUserSeeking = true; });
    this.seekInput.addEventListener('touchstart', () => { this.isUserSeeking = true; });
    this.seekInput.addEventListener('input', () => {
      const val = parseFloat(this.seekInput.value);
      this.updateTimeDisplay(val, this.config.player.getDuration());
    });
    this.seekInput.addEventListener('change', () => {
      const val = parseFloat(this.seekInput.value);
      this.config.player.seek(val);
      this.isUserSeeking = false;
    });

    // Volume & Mute
    this.volumeInput.addEventListener('input', () => {
      const vol = parseFloat(this.volumeInput.value);
      this.config.player.setVolume(vol);
      const updated = saveSettings({ volume: vol });
      this.config.onSettingsChange(updated);
    });

    this.muteBtn.addEventListener('click', () => {
      const newMuted = !this.config.settings.muted;
      this.config.player.setMuted(newMuted);
      this.muteBtn.textContent = newMuted ? 'Unmute' : 'Mute';
      const updated = saveSettings({ muted: newMuted });
      this.config.onSettingsChange(updated);
    });

    // Mode Selector
    this.modeSelect.addEventListener('change', () => {
      const mode = this.modeSelect.value as AppSettingsV1['visualizerMode'];
      const updated = saveSettings({ visualizerMode: mode });
      this.config.onSettingsChange(updated);
    });

    // Color Mode Selector
    if (this.colorSelect) {
      this.colorSelect.addEventListener('change', () => {
        const color = this.colorSelect.value as AppSettingsV1['colorMode'];
        const updated = saveSettings({ colorMode: color });
        this.config.onSettingsChange(updated);
      });
    }

    // Sensitivity Slider
    if (this.sensitivityInput) {
      this.sensitivityInput.addEventListener('input', () => {
        const sens = parseFloat(this.sensitivityInput.value);
        const updated = saveSettings({ sensitivity: sens });
        this.config.onSettingsChange(updated);
      });
    }

    // File Input / Upload
    this.fileInput.addEventListener('change', async () => {
      const file = this.fileInput.files?.[0];
      if (!file) return;

      try {
        this.config.setStatusMessage(`Importing ${file.name}...`);
        const savedTrack = await saveTrack(file);

        const blob = new Blob([savedTrack.data], { type: savedTrack.mimeType });
        const blobUrl = URL.createObjectURL(blob);

        const trackInfo: PlayerTrackInfo = {
          title: savedTrack.title,
          source: 'imported',
          importedId: savedTrack.id,
          blobUrlToRevoke: blobUrl,
        };

        this.config.onTrackSelected(blobUrl, trackInfo);
        await this.config.player.play();
        this.config.setStatusMessage(`Loaded & playing "${savedTrack.title}".`);
        await this.refreshLibrary();
      } catch (err: unknown) {
        const message = err instanceof Error ? err.message : 'File import failed.';
        this.config.setStatusMessage(message, true);
      } finally {
        this.fileInput.value = '';
      }
    });

    // Drag and Drop on Window
    window.addEventListener('dragover', (e) => e.preventDefault());
    window.addEventListener('drop', async (e) => {
      e.preventDefault();
      const files = e.dataTransfer?.files;
      if (files && files.length > 0) {
        const file = files[0];
        if (!file.type.startsWith('audio/') && !file.name.match(/\.(mp3|wav|ogg|m4a|flac|aac|webm|mp4)$/i)) {
          this.config.setStatusMessage('Selected file is not a supported audio format.', true);
          return;
        }
        try {
          this.config.setStatusMessage(`Importing ${file.name}...`);
          const savedTrack = await saveTrack(file);
          const blob = new Blob([savedTrack.data], { type: savedTrack.mimeType });
          const blobUrl = URL.createObjectURL(blob);

          const trackInfo: PlayerTrackInfo = {
            title: savedTrack.title,
            source: 'imported',
            importedId: savedTrack.id,
            blobUrlToRevoke: blobUrl,
          };

          this.config.onTrackSelected(blobUrl, trackInfo);
          await this.config.player.play();
          this.config.setStatusMessage(`Loaded & playing "${savedTrack.title}".`);
          await this.refreshLibrary();
        } catch (err: unknown) {
          const message = err instanceof Error ? err.message : 'File import failed.';
          this.config.setStatusMessage(message, true);
        }
      }
    });

    // Library Selector Change
    this.librarySelect.addEventListener('change', async () => {
      const selectedId = this.librarySelect.value;
      if (!selectedId) return;

      if (selectedId === 'demo') {
        const demoUrl = './demo/pulse.mp3';
        const trackInfo: PlayerTrackInfo = {
          title: 'Demo · pulse.mp3',
          source: 'demo',
          demoId: 'pulse.mp3',
        };
        this.config.onTrackSelected(demoUrl, trackInfo);
        await this.config.player.play();
        this.config.setStatusMessage('Loaded demo track.');
        return;
      }

      // Load imported track from IndexedDB
      try {
        this.config.setStatusMessage('Loading track from IndexedDB...');
        const trackData = await getTrackData(selectedId);
        if (!trackData) {
          this.config.setStatusMessage('Track not found in IndexedDB.', true);
          return;
        }

        const blob = new Blob([trackData.data], { type: trackData.mimeType });
        const blobUrl = URL.createObjectURL(blob);

        const trackInfo: PlayerTrackInfo = {
          title: trackData.title,
          source: 'imported',
          importedId: trackData.id,
          blobUrlToRevoke: blobUrl,
        };

        this.config.onTrackSelected(blobUrl, trackInfo);
        await this.config.player.play();
        this.config.setStatusMessage(`Loaded "${trackData.title}".`);
      } catch (err: unknown) {
        const message = err instanceof Error ? err.message : 'Failed to load track.';
        this.config.setStatusMessage(message, true);
      }
    });

    // Delete Track
    this.deleteTrackBtn.addEventListener('click', async () => {
      const selectedId = this.librarySelect.value;
      if (!selectedId || selectedId === 'demo') return;

      if (confirm('Delete this track from local library?')) {
        try {
          await deleteTrack(selectedId);
          this.config.setStatusMessage('Track deleted.');
          await this.refreshLibrary();

          // Fall back to demo track
          const demoUrl = './demo/pulse.mp3';
          const trackInfo: PlayerTrackInfo = {
            title: 'Demo · pulse.mp3',
            source: 'demo',
            demoId: 'pulse.mp3',
          };
          this.config.onTrackSelected(demoUrl, trackInfo);
        } catch (err: unknown) {
          const message = err instanceof Error ? err.message : 'Failed to delete track.';
          this.config.setStatusMessage(message, true);
        }
      }
    });

    // Player State Updates Listener
    this.config.player.subscribe(({ isPlaying, currentTime, duration, title, error }) => {
      this.playBtn.textContent = isPlaying ? 'Pause' : 'Play';
      this.playBtn.setAttribute('aria-label', isPlaying ? 'Pause' : 'Play');

      if (!this.isUserSeeking) {
        this.seekInput.max = (duration || 100).toString();
        this.seekInput.value = (currentTime || 0).toString();
        this.updateTimeDisplay(currentTime, duration);
      }

      if (error) {
        this.config.setStatusMessage(error, true);
      }

      // Update Media Session
      if ('mediaSession' in navigator) {
        navigator.mediaSession.metadata = new MediaMetadata({ title });
        navigator.mediaSession.playbackState = isPlaying ? 'playing' : 'paused';
      }
    });
  }

  private updateTimeDisplay(current: number, total: number): void {
    this.timeDisplay.textContent = `${this.formatTime(current)} / ${this.formatTime(total)}`;
  }

  private formatTime(sec: number): string {
    if (isNaN(sec) || !isFinite(sec) || sec < 0) return '0:00';
    const m = Math.floor(sec / 60);
    const s = Math.floor(sec % 60);
    return `${m}:${s < 10 ? '0' : ''}${s}`;
  }

  public async refreshLibrary(): Promise<void> {
    this.currentTrackMetadataList = await getAllTrackMetadata();
    this.librarySelect.innerHTML = '';

    const demoOption = document.createElement('option');
    demoOption.value = 'demo';
    demoOption.textContent = 'Demo Track (pulse.mp3)';
    this.librarySelect.appendChild(demoOption);

    for (const track of this.currentTrackMetadataList) {
      const opt = document.createElement('option');
      opt.value = track.id;
      const sizeMB = (track.byteLength / (1024 * 1024)).toFixed(1);
      opt.textContent = `${track.title} (${sizeMB} MB)`;
      this.librarySelect.appendChild(opt);
    }

    const currentTrack = this.config.player.getTrackInfo();
    if (currentTrack?.importedId) {
      this.librarySelect.value = currentTrack.importedId;
      this.deleteTrackBtn.style.display = 'inline-block';
    } else {
      this.librarySelect.value = 'demo';
      this.deleteTrackBtn.style.display = 'none';
    }

    // Storage Estimate
    const estimate = await getStorageEstimate();
    if (estimate && this.storageInfo) {
      this.storageInfo.textContent = `Storage: ${estimate.usedMB.toFixed(1)} MB used`;
    }
  }

  private bindKeyboardShortcuts(): void {
    window.addEventListener('keydown', (e) => {
      const target = e.target as HTMLElement;
      if (['INPUT', 'SELECT', 'TEXTAREA', 'BUTTON'].includes(target.tagName)) {
        return;
      }

      switch (e.key) {
        case ' ':
          e.preventDefault();
          this.config.player.togglePlayPause();
          break;
        case 'ArrowLeft':
          e.preventDefault();
          this.config.player.seek(this.config.player.getCurrentTime() - 5);
          break;
        case 'ArrowRight':
          e.preventDefault();
          this.config.player.seek(this.config.player.getCurrentTime() + 5);
          break;
        case 'ArrowUp':
          e.preventDefault();
          this.config.player.setVolume(Math.min(1, parseFloat(this.volumeInput.value) + 0.05));
          this.volumeInput.value = (this.config.player['volume'] || 0.8).toString();
          break;
        case 'ArrowDown':
          e.preventDefault();
          this.config.player.setVolume(Math.max(0, parseFloat(this.volumeInput.value) - 0.05));
          this.volumeInput.value = (this.config.player['volume'] || 0.8).toString();
          break;
        case 'm':
        case 'M':
          e.preventDefault();
          this.muteBtn.click();
          break;
      }
    });
  }
}
