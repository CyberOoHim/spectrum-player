import { AudioPlayer, PlayerTrackInfo } from './audio/player';
import { loadSettings, saveSettings, subscribeSettingsPersist, AppSettingsV1 } from './storage/settings';
import { loadSession, saveSession } from './storage/session';
import { getTrackData } from './storage/library';
import { Spectrum3D } from './viz/spectrum-3d';
import { Spectrum2D } from './viz/spectrum-2d';
import { SceneVisualizer } from './viz/scene';
import { createAtmosphereScene, isAtmosphereMode } from './viz/scenes/registry';
import { UIControls } from './ui/controls';

const DEMO_TRACK: PlayerTrackInfo = {
  title: 'Demo · pulse.mp3',
  source: 'demo',
  demoId: 'pulse.mp3',
};

const DEMO_URL = './demo/pulse.mp3';
const SLOW_FRAME_MS = 42;
const SLOW_FRAME_LIMIT = 120;

export function boot(): void {
  const container = document.querySelector<HTMLElement>('#canvas-host');
  const nowPlayingEl = document.querySelector<HTMLElement>('#now-playing');
  const statusEl = document.querySelector<HTMLElement>('#status');

  if (!container || !nowPlayingEl || !statusEl) {
    console.error('Shell markup is missing expected control elements.');
    return;
  }

  let settings: AppSettingsV1 = loadSettings();
  let persistWarned = false;

  const setStatusMessage = (msg: string, isError: boolean = false) => {
    statusEl.textContent = msg;
    statusEl.style.color = isError ? '#fca5a5' : 'var(--text-muted)';
  };

  subscribeSettingsPersist((ok) => {
    if (!ok && !persistWarned) {
      persistWarned = true;
      setStatusMessage("Settings won't persist in this browser.", true);
    }
  });

  const player = new AudioPlayer();
  player.setVolume(settings.volume);
  player.setMuted(settings.muted);
  player.setLoop(settings.loop);
  player.setFftSize(settings.fftSize);

  let viz3d: Spectrum3D | null = null;
  let viz2d: Spectrum2D | null = null;
  let vizScene: SceneVisualizer | null = null;
  let idleBands = new Float32Array(settings.barCount);

  const clearAtmosphereStage = () => {
    container.classList.remove('atmosphere-stage', 'lava-stage');
    delete container.dataset.scene;
  };

  const destroyVisualizers = () => {
    if (viz3d) {
      viz3d.destroy();
      viz3d = null;
    }
    if (viz2d) {
      viz2d.destroy();
      viz2d = null;
    }
    if (vizScene) {
      vizScene.destroy();
      vizScene = null;
    }
    clearAtmosphereStage();
  };

  const fallBackTo2D = (message: string) => {
    if (viz3d) {
      viz3d.destroy();
      viz3d = null;
    }
    if (vizScene) {
      vizScene.destroy();
      vizScene = null;
    }
    clearAtmosphereStage();
    if (!viz2d) {
      try {
        viz2d = new Spectrum2D(container);
      } catch (err) {
        console.warn('Failed to initialize 2D canvas spectrum:', err);
      }
    }
    const updated = saveSettings({ visualizerMode: '2d' });
    if (controls) {
      controls.syncFromSettings(updated);
    }
    setStatusMessage(message);
  };

  let warmupUntil = 0;
  let rafId: number | null = null;
  let lastFrameTime = 0;
  let slowFrameCount = 0;
  let controls: UIControls | null = null;

  const initVisualizer = () => {
    destroyVisualizers();
    warmupUntil = performance.now() + 2000;
    slowFrameCount = 0;

    if (settings.visualizerMode === '2d') {
      try {
        viz2d = new Spectrum2D(container);
      } catch (err) {
        console.warn('Failed to initialize 2D canvas spectrum:', err);
      }
      return;
    }

    if (isAtmosphereMode(settings.visualizerMode)) {
      container.classList.add('atmosphere-stage');
      container.dataset.scene = settings.visualizerMode;
      try {
        vizScene = createAtmosphereScene(settings.visualizerMode, container, {
          onContextLost: () => fallBackTo2D('WebGL unavailable. Using 2D spectrum.'),
        });
      } catch (err) {
        console.warn('Atmosphere scene initialization failed, falling back to 2D canvas spectrum:', err);
        fallBackTo2D('WebGL unavailable. Using 2D spectrum.');
      }
      return;
    }

    try {
      viz3d = new Spectrum3D(container, {
        onContextLost: () => fallBackTo2D('WebGL unavailable. Using 2D spectrum.'),
      });
    } catch (err) {
      console.warn('WebGL initialization failed, falling back to 2D canvas spectrum:', err);
      fallBackTo2D('WebGL unavailable. Using 2D spectrum.');
    }
  };

  initVisualizer();

  const stopLoop = () => {
    if (rafId !== null) {
      cancelAnimationFrame(rafId);
      rafId = null;
    }
    lastFrameTime = 0;
  };

  const degradePerformance = () => {
    if (isAtmosphereMode(settings.visualizerMode) && vizScene) {
      const reducedInternal = vizScene.degradeQuality();
      if (reducedInternal) {
        setStatusMessage('Performance: reduced atmosphere quality.');
        return;
      }
    }

    const updates: Partial<AppSettingsV1> = {};
    const nextBarCount = Math.max(32, Math.round(settings.barCount / 2));
    if (nextBarCount < settings.barCount) {
      updates.barCount = nextBarCount;
    }
    const prevMode = settings.visualizerMode;
    if (settings.visualizerMode === 'particles' || settings.visualizerMode === 'orb') {
      updates.visualizerMode = 'bars';
    }
    if (Object.keys(updates).length === 0) return;

    const updated = saveSettings(updates);
    applySettings(updated);
    if (controls) {
      controls.syncFromSettings(updated);
    }
    const parts = [];
    if (updates.barCount) parts.push(`bar count ${updated.barCount}`);
    if (updates.visualizerMode) {
      if (prevMode === 'orb') {
        parts.push('shader orb off');
      } else {
        parts.push('particles off');
      }
    }
    setStatusMessage(`Performance: reduced ${parts.join(', ')}.`);
  };

  const shouldKeepLoop = () => {
    return !document.hidden;
  };

  const renderFrame = (now: number) => {
    if (!shouldKeepLoop()) {
      rafId = null;
      return;
    }

    if (now < warmupUntil) {
      lastFrameTime = now;
      slowFrameCount = 0;
    } else if (lastFrameTime > 0 && player.isPlaying()) {
      const dt = now - lastFrameTime;
      if (dt > SLOW_FRAME_MS) {
        slowFrameCount += 1;
        if (slowFrameCount >= SLOW_FRAME_LIMIT) {
          slowFrameCount = 0;
          degradePerformance();
        }
      } else {
        slowFrameCount = Math.max(0, slowFrameCount - 1);
      }
    } else {
      slowFrameCount = 0;
    }
    lastFrameTime = now;

    const bands = player.isPlaying()
      ? player.getBands(settings.barCount, settings.sensitivity)
      : idleBands;
    if (vizScene) {
      vizScene.render(bands, settings);
    } else if (viz3d) {
      viz3d.render(bands, settings);
    } else if (viz2d) {
      viz2d.render(bands, settings);
    }

    rafId = requestAnimationFrame(renderFrame);
  };

  const startLoop = () => {
    if (rafId === null && shouldKeepLoop()) {
      lastFrameTime = 0;
      rafId = requestAnimationFrame(renderFrame);
    }
  };

  const applySettings = (newSettings: AppSettingsV1) => {
    const modeChanged = settings.visualizerMode !== newSettings.visualizerMode;
    settings = newSettings;
    if (idleBands.length !== settings.barCount) {
      idleBands = new Float32Array(settings.barCount);
    }
    player.setVolume(settings.volume);
    player.setMuted(settings.muted);
    player.setLoop(settings.loop);
    player.setFftSize(settings.fftSize);
    if (modeChanged) {
      initVisualizer();
      if (shouldKeepLoop()) {
        startLoop();
      } else {
        stopLoop();
      }
    }
  };

  const handleTrackSelected = (src: string, trackInfo: PlayerTrackInfo, options?: { restoreTime?: number }) => {
    player.loadSource(src, trackInfo);
    nowPlayingEl.textContent = trackInfo.title;

    if (options?.restoreTime === undefined) {
      saveSession({
        source: trackInfo.source,
        demoId: trackInfo.demoId,
        importedId: trackInfo.importedId,
        title: trackInfo.title,
        currentTime: 0,
        duration: 0,
      });
    }
  };

  const restoreSeek = async (savedTime: number) => {
    await player.whenMetadataReady();
    if (player.canRestoreSeek(savedTime)) {
      player.seek(savedTime);
    }
  };

  controls = new UIControls({
    player,
    settings,
    onSettingsChange: applySettings,
    onTrackSelected: handleTrackSelected,
    setStatusMessage,
  });

  if (shouldKeepLoop()) {
    startLoop();
  }

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
        handleTrackSelected(blobUrl, trackInfo, { restoreTime: session.currentTime });
        await restoreSeek(session.currentTime);
        setStatusMessage(`Restored session: ${track.title}`);
        await controls?.refreshLibrary();
        return;
      }
    }

    handleTrackSelected(DEMO_URL, DEMO_TRACK, session?.source === 'demo' ? { restoreTime: session.currentTime } : undefined);
    if (session?.source === 'demo') {
      await restoreSeek(session.currentTime);
    }
    setStatusMessage('Ready to play.');
    await controls?.refreshLibrary();
  };

  restoreLastSession().catch((err) => {
    console.warn('Session restore failed:', err);
    handleTrackSelected(DEMO_URL, DEMO_TRACK);
    setStatusMessage('Ready to play.');
  });

  let lastSaveTime = 0;
  player.subscribe(({ currentTime, duration, trackInfo }) => {
    if (shouldKeepLoop()) {
      startLoop();
    } else {
      stopLoop();
    }

    const now = Date.now();
    if (trackInfo && duration > 0 && now - lastSaveTime > 2000) {
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

  document.addEventListener('visibilitychange', () => {
    if (document.hidden) {
      stopLoop();
    } else if (shouldKeepLoop()) {
      startLoop();
    }
  });
}
