import { AudioPlayer, PlayerTrackInfo } from '../audio/player';
import { AppSettingsV1, saveSettings, resetSettings } from '../storage/settings';
import { saveTrack, getAllTrackMetadata, deleteTrack, getTrackData, getStorageEstimate, clearAllTracks, TrackMetadata } from '../storage/library';

export interface UIControlsConfig {
  player: AudioPlayer;
  settings: AppSettingsV1;
  onSettingsChange: (newSettings: AppSettingsV1) => void;
  onTrackSelected: (src: string, trackInfo: PlayerTrackInfo) => void;
  setStatusMessage: (msg: string, isError?: boolean) => void;
}

const AUDIO_EXT = /\.(mp3|wav|ogg|m4a|flac|aac|webm|mp4|opus)$/i;
const DEMO_TRACK: PlayerTrackInfo = {
  title: 'Demo · pulse.mp3',
  source: 'demo',
  demoId: 'pulse.mp3',
};
const DEMO_URL = './demo/pulse.mp3';

export function isSupportedAudioFile(file: File): boolean {
  if (file.type.startsWith('audio/')) return true;
  return AUDIO_EXT.test(file.name);
}

export class UIControls {
  private config: UIControlsConfig;

  private playBtn: HTMLButtonElement;
  private prevBtn: HTMLButtonElement | null;
  private nextBtn: HTMLButtonElement | null;
  private seekInput: HTMLInputElement;
  private timeDisplay: HTMLElement;
  private volumeInput: HTMLInputElement;
  private muteBtn: HTMLButtonElement;
  private loopBtn: HTMLButtonElement;
  private fileInput: HTMLInputElement;
  private modeSelect: HTMLSelectElement;
  private colorSelect: HTMLSelectElement;
  private sensitivityInput: HTMLInputElement;
  private barCountSelect: HTMLSelectElement | null;
  private fftSizeSelect: HTMLSelectElement | null;
  private lavaSpeedInput: HTMLInputElement | null;
  private lavaSpeedControl: HTMLElement | null;
  private reducedMotionSelect: HTMLSelectElement | null;
  private autoRotateInput: HTMLInputElement | null;
  private autoRotateSpeedInput: HTMLInputElement | null;
  private autoRotateSpeedControl: HTMLElement | null;
  private librarySelect: HTMLSelectElement;
  private deleteTrackBtn: HTMLButtonElement;
  private storageInfo: HTMLElement;

  private exportSettingsBtn: HTMLButtonElement | null;
  private importSettingsBtn: HTMLButtonElement | null;
  private importSettingsFile: HTMLInputElement | null;
  private resetSettingsBtn: HTMLButtonElement | null;
  private clearLibraryBtn: HTMLButtonElement | null;

  // New Cozy UI Elements
  private settingsDrawer: HTMLElement | null;
  private settingsToggleBtn: HTMLButtonElement | null;
  private closeDrawerBtn: HTMLButtonElement | null;
  private fullscreenBtn: HTMLButtonElement | null;
  private dropOverlay: HTMLElement | null;
  private soundwaveDot: HTMLElement | null;

  private currentTrackMetadataList: TrackMetadata[] = [];
  private isUserSeeking: boolean = false;
  private dragCounter: number = 0;

  constructor(config: UIControlsConfig) {
    this.config = config;

    this.playBtn = document.querySelector<HTMLButtonElement>('#play')!;
    this.prevBtn = document.querySelector<HTMLButtonElement>('#prev-track');
    this.nextBtn = document.querySelector<HTMLButtonElement>('#next-track');
    this.seekInput = document.querySelector<HTMLInputElement>('#seek')!;
    this.timeDisplay = document.querySelector<HTMLElement>('#time-display')!;
    this.volumeInput = document.querySelector<HTMLInputElement>('#volume')!;
    this.muteBtn = document.querySelector<HTMLButtonElement>('#mute')!;
    this.loopBtn = document.querySelector<HTMLButtonElement>('#loop')!;
    this.fileInput = document.querySelector<HTMLInputElement>('#file')!;
    this.modeSelect = document.querySelector<HTMLSelectElement>('#mode-select')!;
    this.colorSelect = document.querySelector<HTMLSelectElement>('#color-select')!;
    this.sensitivityInput = document.querySelector<HTMLInputElement>('#sensitivity')!;
    this.barCountSelect = document.querySelector<HTMLSelectElement>('#bar-count');
    this.fftSizeSelect = document.querySelector<HTMLSelectElement>('#fft-size');
    this.lavaSpeedInput = document.querySelector<HTMLInputElement>('#lava-speed');
    this.lavaSpeedControl = document.querySelector<HTMLElement>('#lava-speed-control');
    this.reducedMotionSelect = document.querySelector<HTMLSelectElement>('#reduced-motion');
    this.autoRotateInput = document.querySelector<HTMLInputElement>('#auto-rotate');
    this.autoRotateSpeedInput = document.querySelector<HTMLInputElement>('#auto-rotate-speed');
    this.autoRotateSpeedControl = document.querySelector<HTMLElement>('#auto-rotate-speed-control');
    this.librarySelect = document.querySelector<HTMLSelectElement>('#library-select')!;
    this.deleteTrackBtn = document.querySelector<HTMLButtonElement>('#delete-track')!;
    this.storageInfo = document.querySelector<HTMLElement>('#storage-info')!;

    this.exportSettingsBtn = document.querySelector<HTMLButtonElement>('#export-settings');
    this.importSettingsBtn = document.querySelector<HTMLButtonElement>('#import-settings-btn');
    this.importSettingsFile = document.querySelector<HTMLInputElement>('#import-settings-file');
    this.resetSettingsBtn = document.querySelector<HTMLButtonElement>('#reset-settings');
    this.clearLibraryBtn = document.querySelector<HTMLButtonElement>('#clear-library');

    this.settingsDrawer = document.querySelector<HTMLElement>('#settings-drawer');
    this.settingsToggleBtn = document.querySelector<HTMLButtonElement>('#settings-toggle');
    this.closeDrawerBtn = document.querySelector<HTMLButtonElement>('#close-drawer');
    this.fullscreenBtn = document.querySelector<HTMLButtonElement>('#fullscreen-btn');
    this.dropOverlay = document.querySelector<HTMLElement>('#drop-overlay');
    this.soundwaveDot = document.querySelector<HTMLElement>('#soundwave-dot');

    this.initUIValues();
    this.bindEvents();
    this.bindKeyboardShortcuts();
    this.refreshLibrary();
  }

  public syncFromSettings(settings: AppSettingsV1): void {
    this.config.settings = settings;
    this.initUIValues();
  }

  private persistSettings(partial: Partial<AppSettingsV1>): AppSettingsV1 {
    const updated = saveSettings(partial);
    this.config.settings = updated;
    this.config.onSettingsChange(updated);
    return updated;
  }

  private applyVolume(vol: number): void {
    const clamped = Math.max(0, Math.min(1, vol));
    this.config.player.setVolume(clamped);
    this.volumeInput.value = clamped.toString();
    this.persistSettings({ volume: clamped });
  }

  private catchPlay(result: Promise<void> | void): void {
    if (result) {
      void result.catch(() => {});
    }
  }

  private updateMuteIconState(muted: boolean): void {
    this.muteBtn.setAttribute('aria-pressed', muted ? 'true' : 'false');
    const highIcon = this.muteBtn.querySelector('.icon-vol-high');
    const mutedIcon = this.muteBtn.querySelector('.icon-vol-muted');
    if (highIcon && mutedIcon) {
      highIcon.classList.toggle('hidden', muted);
      mutedIcon.classList.toggle('hidden', !muted);
    } else {
      this.muteBtn.textContent = muted ? 'Unmute' : 'Mute';
    }
  }

  private updateThemePalette(colorMode: AppSettingsV1['colorMode']): void {
    const themeMap: Record<AppSettingsV1['colorMode'], string> = {
      spectrum: 'sunset',
      mood: 'mood',
      mono: 'mono',
    };
    document.documentElement.setAttribute('data-theme', themeMap[colorMode] || 'sunset');
  }

  private toggleDrawer(open: boolean): void {
    if (!this.settingsDrawer) return;
    if (open) {
      this.settingsDrawer.classList.remove('hidden');
      this.settingsDrawer.setAttribute('aria-hidden', 'false');
    } else {
      this.settingsDrawer.classList.add('hidden');
      this.settingsDrawer.setAttribute('aria-hidden', 'true');
    }
  }

  private initUIValues(): void {
    const s = this.config.settings;
    this.volumeInput.value = s.volume.toString();
    this.volumeInput.disabled = false;
    this.updateMuteIconState(s.muted);

    if (this.loopBtn) {
      this.loopBtn.setAttribute('aria-pressed', s.loop ? 'true' : 'false');
    }
    this.modeSelect.value = s.visualizerMode;
    if (this.colorSelect) {
      this.colorSelect.value = s.colorMode;
      this.updateThemePalette(s.colorMode);
    }
    if (this.sensitivityInput) this.sensitivityInput.value = s.sensitivity.toString();
    if (this.barCountSelect) this.barCountSelect.value = String(s.barCount);
    if (this.fftSizeSelect) this.fftSizeSelect.value = String(s.fftSize);
    if (this.lavaSpeedInput) this.lavaSpeedInput.value = s.lavaSpeed.toString();
    if (this.lavaSpeedControl) {
      this.lavaSpeedControl.style.display = s.visualizerMode === 'lava' ? 'flex' : 'none';
    }
    if (this.reducedMotionSelect) this.reducedMotionSelect.value = s.reducedMotionOverride;
    if (this.autoRotateInput) this.autoRotateInput.checked = s.cameraAutoRotate;
    if (this.autoRotateSpeedInput) {
      this.autoRotateSpeedInput.value = (s.cameraAutoRotateSpeed ?? 1.0).toString();
      this.autoRotateSpeedInput.disabled = !s.cameraAutoRotate;
    }
    if (this.autoRotateSpeedControl) {
      this.autoRotateSpeedControl.classList.toggle('disabled', !s.cameraAutoRotate);
    }
  }

  private endSeek(): void {
    if (!this.isUserSeeking) return;
    const val = parseFloat(this.seekInput.value);
    if (isFinite(val)) {
      this.config.player.seek(val);
    }
    this.isUserSeeking = false;
  }

  private bindEvents(): void {
    this.playBtn.addEventListener('click', () => {
      this.catchPlay(this.config.player.togglePlayPause());
    });

    this.seekInput.addEventListener('pointerdown', () => {
      this.isUserSeeking = true;
    });
    this.seekInput.addEventListener('input', () => {
      const val = parseFloat(this.seekInput.value);
      this.updateTimeDisplay(val, this.config.player.getDuration());
    });
    this.seekInput.addEventListener('pointerup', () => this.endSeek());
    this.seekInput.addEventListener('pointercancel', () => this.endSeek());
    this.seekInput.addEventListener('blur', () => this.endSeek());
    this.seekInput.addEventListener('change', () => this.endSeek());

    this.volumeInput.addEventListener('input', () => {
      this.applyVolume(parseFloat(this.volumeInput.value));
    });

    this.muteBtn.addEventListener('click', () => {
      const newMuted = !this.config.settings.muted;
      this.config.player.setMuted(newMuted);
      this.updateMuteIconState(newMuted);
      this.persistSettings({ muted: newMuted });
    });

    if (this.loopBtn) {
      this.loopBtn.addEventListener('click', () => {
        const newLoop = !this.config.settings.loop;
        this.config.player.setLoop(newLoop);
        this.loopBtn.setAttribute('aria-pressed', newLoop ? 'true' : 'false');
        this.persistSettings({ loop: newLoop });
      });
    }

    this.modeSelect.addEventListener('change', () => {
      const mode = this.modeSelect.value as AppSettingsV1['visualizerMode'];
      if (this.lavaSpeedControl) {
        this.lavaSpeedControl.style.display = mode === 'lava' ? 'flex' : 'none';
      }
      this.persistSettings({ visualizerMode: mode });
    });

    if (this.colorSelect) {
      this.colorSelect.addEventListener('change', () => {
        const color = this.colorSelect.value as AppSettingsV1['colorMode'];
        this.updateThemePalette(color);
        this.persistSettings({ colorMode: color });
      });
    }

    if (this.sensitivityInput) {
      this.sensitivityInput.addEventListener('input', () => {
        const sens = parseFloat(this.sensitivityInput.value);
        this.persistSettings({ sensitivity: sens });
      });
    }

    if (this.barCountSelect) {
      this.barCountSelect.addEventListener('change', () => {
        const barCount = parseInt(this.barCountSelect!.value, 10);
        this.persistSettings({ barCount });
      });
    }

    if (this.fftSizeSelect) {
      this.fftSizeSelect.addEventListener('change', () => {
        const fftSize = parseInt(this.fftSizeSelect!.value, 10) as AppSettingsV1['fftSize'];
        this.persistSettings({ fftSize });
      });
    }

    if (this.lavaSpeedInput) {
      this.lavaSpeedInput.addEventListener('input', () => {
        const lavaSpeed = parseFloat(this.lavaSpeedInput!.value);
        this.persistSettings({ lavaSpeed });
      });
    }

    if (this.reducedMotionSelect) {
      this.reducedMotionSelect.addEventListener('change', () => {
        const reducedMotionOverride = this.reducedMotionSelect!.value as AppSettingsV1['reducedMotionOverride'];
        this.persistSettings({ reducedMotionOverride });
      });
    }

    if (this.autoRotateInput) {
      this.autoRotateInput.addEventListener('change', () => {
        const isChecked = this.autoRotateInput!.checked;
        if (this.autoRotateSpeedInput) {
          this.autoRotateSpeedInput.disabled = !isChecked;
        }
        if (this.autoRotateSpeedControl) {
          this.autoRotateSpeedControl.classList.toggle('disabled', !isChecked);
        }
        this.persistSettings({ cameraAutoRotate: isChecked });
      });
    }

    if (this.autoRotateSpeedInput) {
      this.autoRotateSpeedInput.addEventListener('input', () => {
        const cameraAutoRotateSpeed = parseFloat(this.autoRotateSpeedInput!.value);
        this.persistSettings({ cameraAutoRotateSpeed });
      });
    }

    // Drawer Event Listeners
    if (this.settingsToggleBtn) {
      this.settingsToggleBtn.addEventListener('click', () => {
        const isHidden = this.settingsDrawer?.classList.contains('hidden');
        this.toggleDrawer(!!isHidden);
      });
    }

    if (this.closeDrawerBtn) {
      this.closeDrawerBtn.addEventListener('click', () => this.toggleDrawer(false));
    }

    if (this.settingsDrawer) {
      this.settingsDrawer.addEventListener('click', (e) => {
        if (e.target === this.settingsDrawer) {
          this.toggleDrawer(false);
        }
      });
    }

    // Fullscreen Action
    if (this.fullscreenBtn) {
      this.fullscreenBtn.addEventListener('click', () => {
        if (document.fullscreenElement) {
          void document.exitFullscreen();
        } else {
          void document.documentElement.requestFullscreen();
        }
      });
    }

    // File Import Events
    this.fileInput.addEventListener('change', async () => {
      const file = this.fileInput.files?.[0];
      if (!file) return;
      try {
        await this.importAudioFile(file);
      } finally {
        this.fileInput.value = '';
      }
    });

    // Drag and drop overlay feedback
    window.addEventListener('dragenter', (e) => {
      e.preventDefault();
      this.dragCounter++;
      if (this.dropOverlay) this.dropOverlay.classList.add('active');
    });

    window.addEventListener('dragover', (e) => e.preventDefault());

    window.addEventListener('dragleave', (e) => {
      e.preventDefault();
      this.dragCounter--;
      if (this.dragCounter <= 0 && this.dropOverlay) {
        this.dragCounter = 0;
        this.dropOverlay.classList.remove('active');
      }
    });

    window.addEventListener('drop', async (e) => {
      e.preventDefault();
      this.dragCounter = 0;
      if (this.dropOverlay) this.dropOverlay.classList.remove('active');

      const files = e.dataTransfer?.files;
      if (files && files.length > 0) {
        await this.importAudioFile(files[0]);
      }
    });

    this.librarySelect.addEventListener('change', async () => {
      const selectedId = this.librarySelect.value;
      if (!selectedId) return;

      if (selectedId === 'demo') {
        this.config.onTrackSelected(DEMO_URL, DEMO_TRACK);
        this.catchPlay(this.config.player.play());
        this.config.setStatusMessage('Loaded demo track.');
        return;
      }

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
        this.catchPlay(this.config.player.play());
        this.config.setStatusMessage(`Loaded "${trackData.title}".`);
      } catch (err: unknown) {
        const message = err instanceof Error ? err.message : 'Failed to load track.';
        this.config.setStatusMessage(message, true);
      }
    });

    this.deleteTrackBtn.addEventListener('click', async () => {
      const selectedId = this.librarySelect.value;
      if (!selectedId || selectedId === 'demo') return;

      if (confirm('Delete this track from local library?')) {
        try {
          await deleteTrack(selectedId);
          this.config.setStatusMessage('Track deleted.');
          await this.refreshLibrary();
          this.config.onTrackSelected(DEMO_URL, DEMO_TRACK);
        } catch (err: unknown) {
          const message = err instanceof Error ? err.message : 'Failed to delete track.';
          this.config.setStatusMessage(message, true);
        }
      }
    });

    if (this.prevBtn) {
      this.prevBtn.addEventListener('click', () => this.playPrevTrack());
    }
    if (this.nextBtn) {
      this.nextBtn.addEventListener('click', () => this.playNextTrack());
    }

    if (this.exportSettingsBtn) {
      this.exportSettingsBtn.addEventListener('click', () => {
        const jsonStr = JSON.stringify(this.config.settings, null, 2);
        const blob = new Blob([jsonStr], { type: 'application/json' });
        const url = URL.createObjectURL(blob);
        const a = document.createElement('a');
        a.href = url;
        a.download = 'spectrum-player-settings.json';
        a.click();
        URL.revokeObjectURL(url);
        this.config.setStatusMessage('Exported settings to spectrum-player-settings.json');
      });
    }

    if (this.importSettingsBtn && this.importSettingsFile) {
      this.importSettingsBtn.addEventListener('click', () => {
        this.importSettingsFile?.click();
      });

      this.importSettingsFile.addEventListener('change', async () => {
        const file = this.importSettingsFile?.files?.[0];
        if (!file) return;

        try {
          const text = await file.text();
          const parsed = JSON.parse(text);
          const updated = saveSettings(parsed);
          this.config.settings = updated;
          this.initUIValues();
          this.config.onSettingsChange(updated);
          this.config.setStatusMessage('Settings imported successfully.');
        } catch {
          this.config.setStatusMessage('Invalid settings JSON file.', true);
        } finally {
          if (this.importSettingsFile) {
            this.importSettingsFile.value = '';
          }
        }
      });
    }

    if (this.resetSettingsBtn) {
      this.resetSettingsBtn.addEventListener('click', () => {
        if (confirm('Reset all settings to defaults?')) {
          const defaults = resetSettings();
          this.config.settings = defaults;
          this.initUIValues();
          this.config.onSettingsChange(defaults);
          this.config.setStatusMessage('Settings reset to defaults.');
        }
      });
    }

    if (this.clearLibraryBtn) {
      this.clearLibraryBtn.addEventListener('click', async () => {
        if (confirm('Clear all imported audio files from your library?')) {
          try {
            await clearAllTracks();
            this.config.setStatusMessage('Audio library cleared.');
            await this.refreshLibrary();
            this.librarySelect.value = 'demo';
            this.librarySelect.dispatchEvent(new Event('change'));
          } catch {
            this.config.setStatusMessage('Failed to clear library.', true);
          }
        }
      });
    }

    this.config.player.subscribe(({ isPlaying, currentTime, duration, title, error }) => {
      // Toggle play / pause icons
      const playIcon = this.playBtn.querySelector('.icon-play');
      const pauseIcon = this.playBtn.querySelector('.icon-pause');
      if (playIcon && pauseIcon) {
        playIcon.classList.toggle('hidden', isPlaying);
        pauseIcon.classList.toggle('hidden', !isPlaying);
      } else {
        this.playBtn.textContent = isPlaying ? 'Pause' : 'Play';
      }
      this.playBtn.setAttribute('aria-label', isPlaying ? 'Pause' : 'Play');

      if (this.soundwaveDot) {
        this.soundwaveDot.classList.toggle('playing', isPlaying);
      }

      if (!this.isUserSeeking) {
        this.seekInput.max = (duration || 100).toString();
        this.seekInput.value = (currentTime || 0).toString();
        this.updateTimeDisplay(currentTime, duration);
      }

      if (error) {
        this.config.setStatusMessage(error, true);
      }

      if ('mediaSession' in navigator) {
        navigator.mediaSession.metadata = new MediaMetadata({ title });
        navigator.mediaSession.playbackState = isPlaying ? 'playing' : 'paused';
        try {
          navigator.mediaSession.setActionHandler('previoustrack', () => this.playPrevTrack());
          navigator.mediaSession.setActionHandler('nexttrack', () => this.playNextTrack());
        } catch {
          // Action handlers optional
        }
      }
    });
  }

  private async importAudioFile(file: File): Promise<void> {
    if (!isSupportedAudioFile(file)) {
      this.config.setStatusMessage('Selected file is not a supported audio format.', true);
      return;
    }

    const previous = this.config.player.getTrackInfo();
    let savedId: string | null = null;

    try {
      this.config.setStatusMessage(`Importing ${file.name}...`);
      const savedTrack = await saveTrack(file);
      savedId = savedTrack.id;

      const blob = new Blob([savedTrack.data], { type: savedTrack.mimeType });
      const blobUrl = URL.createObjectURL(blob);
      const trackInfo: PlayerTrackInfo = {
        title: savedTrack.title,
        source: 'imported',
        importedId: savedTrack.id,
        blobUrlToRevoke: blobUrl,
      };

      this.config.onTrackSelected(blobUrl, trackInfo);

      try {
        await this.config.player.play();
      } catch {
        await deleteTrack(savedTrack.id);
        savedId = null;
        await this.restorePreviousOrDemo(previous);
        this.config.setStatusMessage('Could not play that file. Library unchanged.', true);
        await this.refreshLibrary();
        return;
      }

      this.config.setStatusMessage(`Loaded & playing "${savedTrack.title}".`);
      await this.refreshLibrary();
    } catch (err: unknown) {
      if (savedId) {
        try {
          await deleteTrack(savedId);
        } catch {
          // Best-effort rollback
        }
      }
      const message = err instanceof Error ? err.message : 'File import failed.';
      this.config.setStatusMessage(message, true);
    }
  }

  private async restorePreviousOrDemo(previous: PlayerTrackInfo | null): Promise<void> {
    if (previous?.source === 'imported' && previous.importedId) {
      const trackData = await getTrackData(previous.importedId);
      if (trackData) {
        const blob = new Blob([trackData.data], { type: trackData.mimeType });
        const blobUrl = URL.createObjectURL(blob);
        this.config.onTrackSelected(blobUrl, {
          title: trackData.title,
          source: 'imported',
          importedId: trackData.id,
          blobUrlToRevoke: blobUrl,
        });
        return;
      }
    }

    this.config.onTrackSelected(DEMO_URL, previous?.source === 'demo' ? previous : DEMO_TRACK);
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

    const estimate = await getStorageEstimate();
    if (estimate && this.storageInfo) {
      if (estimate.totalMB > 0) {
        this.storageInfo.textContent = `Storage: ${estimate.usedMB.toFixed(1)} / ${estimate.totalMB.toFixed(0)} MB`;
      } else {
        this.storageInfo.textContent = `Storage: ${estimate.usedMB.toFixed(1)} MB used`;
      }
    }
  }

  private bindKeyboardShortcuts(): void {
    window.addEventListener('keydown', (e) => {
      const target = e.target as HTMLElement;
      if (['INPUT', 'SELECT', 'TEXTAREA', 'BUTTON'].includes(target.tagName)) {
        return;
      }

      if (e.key === 'Escape') {
        this.toggleDrawer(false);
        return;
      }

      switch (e.key) {
        case ' ':
          e.preventDefault();
          this.catchPlay(this.config.player.togglePlayPause());
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
          this.applyVolume(this.config.player.getVolume() + 0.05);
          break;
        case 'ArrowDown':
          e.preventDefault();
          this.applyVolume(this.config.player.getVolume() - 0.05);
          break;
        case 'm':
        case 'M':
          e.preventDefault();
          this.muteBtn.click();
          break;
        case 'l':
        case 'L':
          e.preventDefault();
          if (this.loopBtn) this.loopBtn.click();
          break;
        case 'n':
        case 'N':
          e.preventDefault();
          this.playNextTrack();
          break;
        case 'p':
        case 'P':
          e.preventDefault();
          this.playPrevTrack();
          break;
      }
    });
  }

  public playNextTrack(): void {
    const options = Array.from(this.librarySelect.options);
    if (options.length <= 1) return;
    const currentIndex = this.librarySelect.selectedIndex;
    const nextIndex = (currentIndex + 1) % options.length;
    this.librarySelect.selectedIndex = nextIndex;
    this.librarySelect.dispatchEvent(new Event('change'));
  }

  public playPrevTrack(): void {
    const options = Array.from(this.librarySelect.options);
    if (options.length <= 1) return;
    const currentIndex = this.librarySelect.selectedIndex;
    const prevIndex = (currentIndex - 1 + options.length) % options.length;
    this.librarySelect.selectedIndex = prevIndex;
    this.librarySelect.dispatchEvent(new Event('change'));
  }
}
