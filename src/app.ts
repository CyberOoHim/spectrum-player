import { AudioPlayer, PlayerTrackInfo } from './audio/player';
import { loadSettings, AppSettingsV1 } from './storage/settings';
import { loadSession, saveSession } from './storage/session';
import { getTrackData } from './storage/library';
import { Spectrum3D } from './viz/spectrum-3d';
import { Spectrum2D } from './viz/spectrum-2d';
import { UIControls } from './ui/controls';

export function boot(): void {
  const container = document.querySelector<HTMLElement>('#canvas-host');
  const nowPlayingEl = document.querySelector<HTMLParagraphElement>('#now-playing');
  const statusEl = document.querySelector<HTMLParagraphElement>('#status');

  if (!container || !nowPlayingEl || !statusEl) {
    console.error('Shell markup is missing expected control elements.');
    return;
  }

  // 1. Load persisted settings
  let settings: AppSettingsV1 = loadSettings();

  // Helper to set status message
  const setStatusMessage = (msg: string, isError: boolean = false) => {
    statusEl.textContent = msg;
    statusEl.style.color = isError ? '#f87171' : 'var(--muted)';
  };

  // 2. Instantiate Audio Player
  const player = new AudioPlayer();
  player.setVolume(settings.volume);
  player.setMuted(settings.muted);
  player.setFftSize(settings.fftSize);

  // 3. Setup Visualizers (3D with 2D fallback)
  let viz3d: Spectrum3D | null = null;
  let viz2d: Spectrum2D | null = null;

  const initVisualizer = () => {
    // Clean up previous instances
    if (viz3d) {
      viz3d.destroy();
      viz3d = null;
    }
    if (viz2d) {
      viz2d.destroy();
      viz2d = null;
    }

    if (settings.visualizerMode === '2d') {
      try {
        viz2d = new Spectrum2D(container);
      } catch (err) {
        console.warn('Failed to initialize 2D canvas spectrum:', err);
      }
    } else {
      try {
        viz3d = new Spectrum3D(container);
      } catch (err) {
        console.warn('WebGL initialization failed, falling back to 2D canvas spectrum:', err);
        viz2d = new Spectrum2D(container);
      }
    }
  };

  initVisualizer();

  // 4. Animation Loop (rAF loop)
  let rafId: number | null = null;

  const renderFrame = () => {
    if (player.isPlaying() && !document.hidden) {
      const bands = player.getBands(settings.barCount, settings.sensitivity);
      if (viz3d) {
        viz3d.render(bands, settings);
      } else if (viz2d) {
        viz2d.render(bands, settings);
      }
    }
    rafId = requestAnimationFrame(renderFrame);
  };

  const startLoop = () => {
    if (rafId === null) {
      rafId = requestAnimationFrame(renderFrame);
    }
  };

  startLoop();

  // Handle visibility change to save CPU when tab is hidden
  document.addEventListener('visibilitychange', () => {
    if (document.hidden && rafId !== null) {
      cancelAnimationFrame(rafId);
      rafId = null;
    } else if (!document.hidden) {
      startLoop();
    }
  });

  // Track selection handler
  const handleTrackSelected = (src: string, trackInfo: PlayerTrackInfo) => {
    player.loadSource(src, trackInfo);
    nowPlayingEl.textContent = trackInfo.title;

    saveSession({
      source: trackInfo.source,
      demoId: trackInfo.demoId,
      importedId: trackInfo.importedId,
      title: trackInfo.title,
      currentTime: 0,
      duration: player.getDuration(),
    });
  };

  // 5. Initialize UI Controls
  const controls = new UIControls({
    player,
    settings,
    onSettingsChange: (newSettings) => {
      const modeChanged = settings.visualizerMode !== newSettings.visualizerMode;
      settings = newSettings;
      player.setFftSize(settings.fftSize);
      if (modeChanged) {
        initVisualizer();
      }
    },
    onTrackSelected: handleTrackSelected,
    setStatusMessage,
  });

  // 6. Restore last session or boot demo
  const restoreLastSession = async () => {
    const session = loadSession();
    if (session && session.source === 'imported' && session.importedId) {
      const track = await getTrackData(session.importedId);
      if (track) {
        const blob = new Blob([track.data], { type: track.mimeType });
        const blobUrl = URL.createObjectURL(blob);
        const trackInfo: PlayerTrackInfo = {
          title: track.title,
          source: 'imported',
          importedId: track.id,
          blobUrlToRevoke: blobUrl,
        };

        handleTrackSelected(blobUrl, trackInfo);
        if (session.currentTime > 0) {
          player.seek(session.currentTime);
        }
        setStatusMessage(`Restored session: ${track.title}`);
        await controls.refreshLibrary();
        return;
      }
    }

    // Default to demo track
    const demoTrackInfo: PlayerTrackInfo = {
      title: 'Demo · pulse.mp3',
      source: 'demo',
      demoId: 'pulse.mp3',
    };
    handleTrackSelected('./demo/pulse.mp3', demoTrackInfo);
    if (session && session.currentTime > 0) {
      player.seek(session.currentTime);
    }
    setStatusMessage('Ready to play.');
  };

  restoreLastSession().catch((err) => {
    console.warn('Session restore failed:', err);
    setStatusMessage('Ready to play.');
  });

  // Periodic session time saver (throttled to 2 seconds)
  let lastSaveTime = 0;
  player.subscribe(({ currentTime, duration, trackInfo }) => {
    const now = Date.now();
    if (trackInfo && now - lastSaveTime > 2000) {
      lastSaveTime = now;
      saveSession({
        source: trackInfo.source,
        demoId: trackInfo.demoId,
        importedId: trackInfo.importedId,
        title: trackInfo.title,
        currentTime,
        duration,
      });
    }
  });
}
