# Standalone Web Audio Player + 3D Spectrum Visualizer

| Field | Value |
|-------|--------|
| **Status** | Ready to execute elsewhere (not this ambient-sound repo) |
| **Product** | New single-purpose web app: play local/bundled audio + live 3D spectrum |
| **Deploy** | GitHub Pages (static only) |
| **Stack** | Vite + TypeScript + Three.js + Web Audio `AnalyserNode` |
| **Storage** | `localStorage` for settings/session; IndexedDB for imported audio |
| **Out of scope** | The existing Ambient Sound mixer, presets, binaural, one-shots, YouTube |

This plan is self-contained. Copy this file into a new repo and execute phase by phase. Do not import code or product assumptions from Ambient Sound.

---

## 1. Goal

Ship a **static** browser app that:

1. Plays one audio file at a time (bundled demo track and/or user-picked file).
2. Shows a **real-time 3D frequency spectrum** driven by the playing audio.
3. Remembers user preferences and last session in the **browser**.
4. Deploys to **GitHub Pages** with no backend.

**Success looks like**

| Metric | Target |
|--------|--------|
| First play | Click Play → audio + 3D bars/particles move within 1s |
| Persistence | Reload restores volume, visualizer mode, last file *handle or imported clip* |
| Reduced motion | `prefers-reduced-motion: reduce` → static or 2D wash, no orbit/particles |
| Pages | `pnpm build` output is enough; Actions deploys `/dist` |
| Offline after first visit | Optional PWA in Phase 6; not required for v1 |

---

## 2. Why this stack

There is no good “3D spectrum player” library. Split the job:

| Layer | Choice | Why |
|-------|--------|-----|
| Bundler | **Vite** | Fast, static `dist/`, first-class GH Pages |
| Language | **TypeScript** | Safer analyser/Three wiring |
| UI | **Vanilla TS** (no React/Svelte required) | Portable; smallest mental overhead |
| Playback | **HTMLAudioElement + Web Audio** | Seeking, media keys, mobile background path |
| Spectrum | **`AnalyserNode`** | Native FFT; no extra audio lib |
| 3D | **Three.js** | Bars, rings, particles, shaders; CDN or npm both work on Pages |
| Settings | **`localStorage`** | Tiny JSON prefs |
| User files | **IndexedDB** | Blobs exceed `localStorage` quota |

Do **not** use wavesurfer.js as the 3D engine (2D waveform only). Optional later: wavesurfer as a **seek bar** only. Skip p5.js, Babylon, Tone.js for v1.

**GitHub Pages constraints (design around these from day one)**

- Static files only. No server-side audio proxy.
- Same-origin bundled audio is fine. Remote URLs need CORS (`Access-Control-Allow-Origin`) or they **cannot** feed an `AnalyserNode`.
- Autoplay is blocked until a user gesture.
- `file://` will not work; always use `vite` / Pages HTTPS.
- Large imported files live in IndexedDB, not git.

---

## 3. Architecture

```
[File picker / bundled URL / IDB blob URL]
        │
        ▼
 HTMLAudioElement  ──element source──►  AudioContext
        │                                    │
   play/pause/seek                      MediaElementSource
   volume (element + gain)                    │
                                              ▼
                                         AnalyserNode
                                          │         │
                                          ▼         ▼
                                    destination   Visualizer
                                                  (rAF loop)
                                                       │
                                                       ▼
                                              Three.js WebGL canvas
```

**Rules**

- One `AudioContext`, created on first Play (user gesture).
- One `MediaElementAudioSourceNode` per element. **Never** call `createMediaElementSource` twice on the same element.
- Analyser sits **after** a master `GainNode` so volume changes are visible if you want, **or** tap before gain if the visualizer should stay full-scale while the user turns volume down. **Default: tap before master gain** so visuals stay lively at low volume.
- Pause the `requestAnimationFrame` loop when audio is paused / tab is hidden.
- Dispose Three.js on teardown (`renderer.dispose()`, geometries, materials).

### Module map (new repo)

```
src/
  main.ts                 # boot
  app.ts                  # wires player + visualizer + settings UI
  audio/
    player.ts             # HTMLAudioElement + Web Audio graph
    analyser.ts           # FFT helpers, bin grouping
  viz/
    spectrum-3d.ts        # Three.js scene, camera, bars/particles
    modes.ts              # bar-ring / terrain / particles
  storage/
    keys.ts               # versioned storage key constants
    settings.ts           # localStorage load/save/migrate
    session.ts            # last track metadata (not the blob)
    library.ts            # IndexedDB imported files
  ui/
    controls.ts           # play, seek, volume, mode, import
    seekbar.ts            # optional canvas/waveform later
  styles.css
index.html
public/
  demo/                   # 1–2 short CC0 loops for first paint
.github/workflows/pages.yml
```

Keep UI in plain DOM. A framework is optional later; do not start with one.

---

## 4. Data model

### 4.1 Settings (`localStorage`)

Key: `spectrum-player:settings:v1`

```ts
interface AppSettingsV1 {
  version: 1;
  volume: number;            // 0..1
  muted: boolean;
  visualizerMode: 'bars' | 'radial' | 'particles';
  colorMode: 'spectrum' | 'mono' | 'mood';
  sensitivity: number;       // 0.5..2
  fftSize: 512 | 1024 | 2048;
  barCount: number;          // 32..128
  reducedMotionOverride: 'system' | 'on' | 'off';
  cameraAutoRotate: boolean;
}
```

Defaults: `volume: 0.8`, `mode: 'bars'`, `fftSize: 1024`, `barCount: 64`, `reducedMotionOverride: 'system'`, `cameraAutoRotate: true`.

### 4.2 Last session (`localStorage`)

Key: `spectrum-player:session:v1`

```ts
interface LastSessionV1 {
  version: 1;
  source: 'demo' | 'imported' | 'none';
  demoId?: string;
  importedId?: string;       // IndexedDB id
  title: string;
  currentTime: number;       // seconds
  duration: number;
  updatedAt: string;         // ISO
}
```

Do **not** put audio bytes in `localStorage`. Restore time only if `< duration - 1`.

### 4.3 Imported library (IndexedDB)

DB: `spectrum-player-library` · version `1` · store `tracks` · keyPath `id`

```ts
interface ImportedTrack {
  id: string;                // `local:` + uuid
  title: string;
  mimeType: string;
  byteLength: number;
  createdAt: string;
  data: ArrayBuffer;
}
```

Quota: show `navigator.storage.estimate()` in the UI. Reject files `> 40 MB` with a clear message. Allow delete + “remove unused”.

### 4.4 Migration

Every stored JSON has `version`. Loaders:

1. Missing key → defaults.
2. Corrupt JSON → defaults + `console.warn` (do not crash).
3. Unknown future version → try to read known fields, else defaults.
4. Bump key suffix (`v2`) when the shape is incompatible; keep a one-shot migrator from `v1`.

---

## 5. Visualizer design (v1)

**Mode A — 3D bars (ship first)**  
Instanced `BoxGeometry` in a line or shallow arc. Y-scale = log-grouped FFT bin energy. Color from mood/spectrum. Camera: slight orbit, drag to rotate (`OrbitControls`).

**Mode B — Radial ring**  
Bars around a circle; radius or height driven by bins. Same analyser.

**Mode C — Particles**  
Points whose size/opacity follow bass / mid / high bands. Disable when reduced motion is on.

**FFT grouping**

- Use `getByteFrequencyData`.
- Group bins **logarithmically** (human pitch) into `barCount` bands.
- Apply `sensitivity` as a multiplier + soft clip.
- Smooth with analyser `smoothingTimeConstant` (~0.75–0.85), not a second JS filter at first.

**Performance budget**

| Device | Target |
|--------|--------|
| Desktop | 60 fps, 64–128 bars |
| Mid mobile | 30–60 fps, 32–64 bars |
| Hidden tab | rAF stopped |
| Reduced motion | no camera motion; optional freeze last frame or 2D gradient |

If frame time `> 24 ms` for 30 frames, drop `barCount` and disable particles automatically; persist that choice.

---

## 6. Phase-by-phase implementation

Each phase is: **code → verify → adjust**. Do not start the next phase until the verify list is green. Adjust means fix what verify found before adding scope.

---

### Phase 0 — Repo, tool, empty shell

**Code**

- `pnpm create vite` → Vanilla + TypeScript.
- `pnpm add three` and `pnpm add -D @types/three` if needed (Three r170+ ships types).
- `base: './'` in `vite.config.ts` so Pages project sites (`username.github.io/repo/`) resolve assets.
- `index.html`: title, play button, file input, canvas host, volume slider (disabled until Phase 1).
- GitHub Action: build on `main`, upload `dist`, deploy Pages.
- Add 1 short **CC0** demo mp3/ogg under `public/demo/` (≤ 1 MB). Document license in `ATTRIBUTIONS.md`.

**Verify**

```bash
pnpm install
pnpm build
pnpm preview
```

- Preview loads at `/` with a blank canvas area and controls.
- Built asset URLs are relative (`./assets/...`), not `/assets/...`.
- Action deploys; opening `https://<user>.github.io/<repo>/` shows the shell (can be empty).

**Adjust**

- If CSS/JS 404 on Pages, `base` is wrong — fix before any audio work.
- If Action fails on Node version, pin `node-version: 22` and `packageManager`.

**Exit:** a live (or previewable) empty app on static hosting.

---

### Phase 1 — Core audio player (no 3D yet)

**Code**

- `player.ts`:
  - create `<audio>` (`playsInline`, `crossOrigin = 'anonymous'` for same-origin).
  - `loadUrl(url, title)`, `play()`, `pause()`, `seek(sec)`, `setVolume(0..1)`, `setMuted`.
  - events: `timeupdate`, `ended`, `error`, `loadedmetadata`.
- Wire Play / Pause, seek range, volume, mute, now-playing title.
- Load the bundled demo on first visit.
- Unlock `AudioContext` on first Play (create context here even if unused visually).

**Verify (browser)**

1. Play demo → hear audio.
2. Pause / Play / seek / volume / mute work.
3. End of track: button returns to Play; seek resets or loops (pick **stop at end** for v1).
4. Refresh mid-play: audio does **not** autoplay (policy). Controls still work after click.
5. Broken URL shows an error string, does not throw.
6. Chrome + Firefox + one mobile Safari/Chrome.

**Adjust**

- iOS: `playsInline` + resume `AudioContext` on the same click as `audio.play()`.
- If play() rejects, surface “tap Play again” rather than a silent fail.

**Exit:** a reliable 1-track player. No visualizer yet.

---

### Phase 2 — Analyser + 2D spectrum (prove the FFT path)

Build a **2D canvas bar graph first**. Three.js on a broken analyser wastes days.

**Code**

- After first Play, `createMediaElementSource(audio)` → `GainNode` (visual tap) → `AnalyserNode` → `destination`.
- `fftSize = 1024`, `smoothingTimeConstant = 0.8`.
- `analyser.ts`: `getBands(barCount): Float32Array` (0..1, log groups).
- `ui/spectrum-2d.ts`: draw bars each rAF while playing; stop rAF when paused.
- Unit-test `getBands` with a **fake** analyser (inject a frequency buffer) — no Web Audio in Vitest.

**Verify**

1. Play a track with bass + treble (or a sweep if you have one). Low bars move more on kick, high bars on hats/noise.
2. Pause: bars freeze or decay and **rAF stops** (check via a debug frame counter).
3. Volume down: **visuals still move** (tap is pre-gain).
4. Mute: audio silent; visuals still move (mute the element or a separate output gain, not the tap).
5. `pnpm test` covers bin grouping (empty buffer → zeros; peak in low bins → first bars high).

**Adjust**

- If all bars move together: grouping is linear or you’re using time-domain data. Switch to frequency data + log groups.
- If visuals are silent: `crossOrigin` / CORS, or source created twice, or context not running.
- If CPU is hot while paused: rAF leak.

**Exit:** trusted FFT numbers and a 2D reference view you can keep as a debug overlay.

---

### Phase 3 — 3D spectrum (Three.js)

**Code**

- `spectrum-3d.ts`: scene, perspective camera, `WebGLRenderer({ antialias, alpha })`, resize observer, `OrbitControls` (damping on).
- Instanced mesh of `barCount` boxes. Each frame: `getBands` → instance matrix scale.y + color.
- Soft fog / dark background; simple directional + ambient light.
- Bind to the same rAF gate as Phase 2. Keep 2D behind a “Debug 2D” checkbox (off by default).
- `prefers-reduced-motion`: skip auto-rotate; optionally hold last scales.

**Verify**

1. Play → 3D bars animate in sync with 2D debug (if enabled).
2. Drag orbit works; zoom does not clip the ground plane badly.
3. Resize window + rotate phone: canvas fills host, no stretch (update camera aspect + renderer size + pixel ratio cap at 2).
4. Pause → GPU load drops (rAF stopped). Leave tab in background 30s → no runaway timer.
5. Chrome, Firefox, Safari. If WebGL fails, show “WebGL unavailable” and fall back to 2D.
6. `pnpm build` bundle size: Three.js is large; confirm Pages payload is acceptable (~150–250 kB gzip JS is fine).

**Adjust**

- Jittery bars: increase analyser smoothing or lerp instance scales (~0.2).
- Too tall / clipping: normalize by recent peak (slow decay envelope).
- Mobile heat: lower pixel ratio, `barCount`, disable shadows (don’t add shadows in v1).
- Context lost: listen `webglcontextlost` / `restored`; rebuild renderer.

**Exit:** one good 3D mode that is clearly audio-reactive.

---

### Phase 4 — Visualizer modes + settings persistence (`localStorage`)

**Code**

- Add radial + particles modes; one Three.js scene, swap or hide meshes.
- Settings panel: mode, color, sensitivity, bar count, auto-rotate.
- `settings.ts`: load on boot, debounce-save (200–400 ms) on change.
- Apply settings before first render so there is no flash of defaults.
- Quota / private mode: wrap `setItem` in try/catch; if it fails, app still runs (in-memory only) and show a one-line “settings won’t persist”.

**Verify**

1. Change mode + sensitivity → reload → same UI and same 3D mode.
2. Corrupt the key in DevTools → app starts with defaults, no white screen.
3. `localStorage` disabled (or throw on set) → player still works.
4. Schema: bump a field, reload old payload → migrator fills defaults.
5. Reduced-motion OS setting honored unless user override is on/off.

**Adjust**

- If save storms: you forgot debounce.
- If old sessions break after a field add: you mutated in place without defaults. Always ` { ...DEFAULTS, ...parsed } ` then clamp.

**Exit:** visualizer preferences survive refresh.

---

### Phase 5 — Session restore + file import (IndexedDB)

**Code**

- File input (`audio/*`) + drag-and-drop on the window.
- `library.ts`: put ArrayBuffer, list metadata, get blob URL, delete, estimate quota.
- On import: persist blob, set as current track, revoke previous object URLs.
- `session.ts`: save `source`, ids, `currentTime` (throttle 2s), title.
- On boot:
  1. Load settings.
  2. Load session.
  3. If `imported` and IDB row exists → object URL → `loadUrl` (do not autoplay).
  4. Else demo.
  5. After `loadedmetadata`, `seek(savedTime)` if valid.
- Library UI: list imported tracks, switch, delete. Confirm delete if it’s the current track.
- Export/import of the **settings JSON** is optional; skip audio backup for v1 unless quota UX needs it.

**Verify**

1. Import a local mp3 → plays → 3D reacts (decode must succeed).
2. Reload → same file, same seek position (±2s), same volume/mode.
3. Delete imported file → session falls back to demo; no broken play.
4. Import a 50 MB file → rejected with message; quota line updates after a valid import.
5. Import unsupported type → error, library unchanged.
6. Two imports → switch between them without creating a second `MediaElementSource` (reuse one `<audio>`: `audio.src = newUrl`).
7. Safari: IndexedDB + object URLs play; if not, fall back to `File` live object URL for the current session only and warn “won’t survive reload”.

**Adjust**

- Detached ArrayBuffers after IDB read: copy before storing if you later transfer to workers.
- Memory: `URL.revokeObjectURL` on every src change.
- Seek-on-restore racing `loadedmetadata`: wait for that event; don’t seek immediately after setting `src`.

**Exit:** a personal player that remembers the last imported track in this browser.

---

### Phase 6 — Polish, a11y, Pages hardening

**Code**

- Keyboard: Space play/pause (not when typing in inputs), `←/→` seek 5s, `↑/↓` volume, `M` mute.
- `Media Session` API: title, play/pause, seek.
- Focus styles, `aria-label` on icon buttons, live region for errors.
- Hide visualizer canvas from AT (`aria-hidden="true"`).
- Optional loop toggle (persist in settings).
- Optional tiny 2D seek waveform (canvas, not wavesurfer) — only if time left.
- `404.html` copy of `index.html` if you later add routes (not needed for a single page).
- README: how to add a demo track, Pages setup, storage keys, licenses.

**Verify**

1. Full keyboard path without a mouse.
2. VoiceOver/NVDA: controls announced; canvas ignored.
3. Lighthouse (Pages URL): no broken a11y contrast on controls.
4. Cold load on 4G: demo + Three.js usable under ~3s on desktop.
5. Hard refresh on Pages after a new deploy: new hashed assets load (no SW yet). If you add a service worker, bump cache version every release.

**Adjust**

- Space scrolling the page: `preventDefault` only when focus is not in a slider.
- iOS lock screen: Media Session + playing `<audio>` element (you already use one).

**Exit:** something you would send to a friend on a Pages URL.

---

### Phase 7 — Optional PWA / extra modes (only after 0–6)

- Web app manifest + service worker caching `index.html` + JS/CSS + demo audio.
- Extra shader mode (displaced plane / glowing orb).
- Playlist of multiple imported tracks (still IDB).
- Settings export/import JSON.
- wavesurfer.js **only** as a waveform seekbar — do not replace Three.js.

Each of these is its own mini phase with the same code → verify → adjust loop.

---

## 7. Verification gates (every phase)

Automated (add as soon as Phase 2 exists):

```bash
pnpm test          # storage migrate, band grouping, settings clamp
pnpm build         # must stay green
```

Manual smoke (repeat on desktop + one phone before calling a phase done):

1. First visit: demo listed, nothing autoplays.
2. Play: audio + current visualizer mode react.
3. Pause: motion stops; no fan noise from GPU.
4. Reload: settings + session restore; still no autoplay.
5. Import file: plays, persists, delete works.
6. Reduced motion: no orbit / particles.
7. Pages URL (not just localhost): play + analyser work (CORS/base path).

---

## 8. Browser local storage — operating rules

Treat storage as **untrusted, finite, and evictable**.

| Store | What | What not |
|-------|------|----------|
| `localStorage` | settings, last session metadata, UI flags | audio, large arrays, Three.js state |
| IndexedDB | imported `ArrayBuffer`s + title/mime | settings (keep those sync and tiny) |
| Memory | `AudioContext`, object URLs, renderer | anything you need after reload |

**Implementation checklist**

- Version every payload (`version: 1`).
- Centralize keys in `storage/keys.ts`.
- Clamp every number on load (`volume`, `fftSize`, `barCount`, `currentTime`).
- Debounce writes; wrap in `try/catch` (`QuotaExceededError`, security errors).
- Never `JSON.parse` without try/catch.
- Show approximate IDB usage: `used / quota`.
- Provide **Reset settings** (clears settings key only) and **Clear library** (IDB + session).
- Do not store file system paths. After reload you only have IDB bytes or a new user pick.
- Private/incognito: app must run; persist may be best-effort.
- Same origin only: `https://user.github.io` and `https://user.github.io/repo/` are **different** origins — document that stored data will not follow a path change. Pick one Pages URL and keep it.

**Suggested key list**

```
spectrum-player:settings:v1
spectrum-player:session:v1
spectrum-player:onboarding-dismissed:v1
IndexedDB: spectrum-player-library / tracks
```

---

## 9. GitHub Pages deploy

`vite.config.ts`:

```ts
import { defineConfig } from 'vite';

export default defineConfig({
  base: './',
  build: { outDir: 'dist', sourcemap: true },
});
```

`.github/workflows/pages.yml` (outline):

- Trigger: `push` to `main`.
- `actions/setup-node` with pnpm cache.
- `pnpm install --frozen-lockfile && pnpm test && pnpm build`.
- `actions/upload-pages-artifact` of `dist`.
- `actions/deploy-pages`.
- Repo Settings → Pages → Source: GitHub Actions.

**Audio on Pages**

- Bundled demo in `public/demo/` → same origin → analyser works.
- User files via IndexedDB → blob URLs → analyser works.
- Do not hotlink random `https://` mp3s unless that host sends CORS headers.

---

## 10. Definition of done (v1)

- [ ] Vite + TS app deploys to GitHub Pages
- [ ] Play / pause / seek / volume / mute for demo + imported files
- [ ] Live 3D spectrum (bars) + at least one extra mode
- [ ] Analyser tap does not block playback if WebGL fails (2D fallback)
- [ ] Settings persist in `localStorage` with version + safe parse
- [ ] Last track + position restore via session + IndexedDB
- [ ] Quota / private-mode failures are non-fatal
- [ ] Reduced motion respected
- [ ] rAF and AudioContext do not run when paused
- [ ] README + attributions for the demo track
- [ ] Tests for settings migrate + FFT grouping

---

## 11. Suggested tickets / PR slices

| ID | Title | Phase | Depends on |
|----|--------|-------|------------|
| P0-01 | Vite TS scaffold + Pages workflow + `base: './'` | 0 | — |
| P0-02 | Demo CC0 track + attributions | 0 | P0-01 |
| P1-01 | HTMLAudio player + transport UI | 1 | P0-01 |
| P2-01 | Web Audio graph + `getBands` + tests | 2 | P1-01 |
| P2-02 | 2D debug spectrum | 2 | P2-01 |
| P3-01 | Three.js instanced bars + OrbitControls | 3 | P2-01 |
| P3-02 | Reduced motion + WebGL fallback | 3 | P3-01 |
| P4-01 | Settings model + localStorage | 4 | P3-01 |
| P4-02 | Radial + particle modes | 4 | P3-01 |
| P5-01 | IndexedDB library | 5 | P1-01 |
| P5-02 | Session restore (src + time) | 5 | P4-01, P5-01 |
| P6-01 | Keyboard + Media Session + a11y | 6 | P5-02 |

Execute in that order. After each PR: code → verify list → adjust → only then merge.

---

## 12. What not to do

- Do not start with React/Svelte/Three editor templates — they hide the audio graph.
- Do not put the visualizer on `CanvasTexture` from a 2D draw unless you already have FPS headroom.
- Do not use `AudioContext.decodeAudioData` as the **only** playback path if you want easy seek + Media Session; keep the media element.
- Do not create a new `AudioContext` per track.
- Do not persist the Three.js camera every frame.
- Do not assume this Ambient Sound repo’s session/preset format. This app is a clean break.

---

## 13. Immediate next step

Create a **new empty repo**, copy this file to `docs/plan.md`, run Phase 0 (`P0-01`). Do not write Three.js until Phase 2’s 2D spectrum is proven.
