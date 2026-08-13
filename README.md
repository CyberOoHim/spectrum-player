# Spectrum Player

A high-performance standalone web audio player and interactive 3D frequency spectrum visualizer. Built with TypeScript, Three.js, and Web Audio API. Deploys statically to GitHub Pages with no backend required.

---

## Key Features

- **3D Spectrum Visualizations**: Multiple interactive rendering modes using Three.js:
  - **3D Bars**: Instanced frequency spectrum bars.
  - **3D Radial**: Circular spectrum ring.
  - **3D Particles**: Audio-reactive particle system responding to bass, mid, and high bands.
  - **2D Canvas Fallback**: Lightweight 2D canvas mode for low-power devices or WebGL fallback.
- **Audio Playback & Analysis**:
  - Pre-gain analyser node so visuals remain active even when listening at low volume.
  - Support for local audio file imports (`.mp3`, `.wav`, `.ogg`, `.m4a`, `.flac`, `.aac`, `.webm`, `.opus`).
  - Drag-and-drop file loading directly into the browser window.
- **Local Storage & Library**:
  - Settings persisted in `localStorage` (`spectrum-player:settings:v1`).
  - Last track session & progress restored automatically (`spectrum-player:session:v1`).
  - Imported audio files stored securely in browser `IndexedDB` (`spectrum-player-library`).
- **Keyboard & Hardware Controls**:
  - `Space`: Toggle Play / Pause.
  - `←` / `→`: Seek -5s / +5s.
  - `↑` / `↓`: Increase / decrease volume by 5%.
  - `M`: Toggle mute.
  - `L`: Toggle loop playback.
  - Integration with OS **Media Session API** (Play/Pause/Seek keys & hardware controls).
- **Accessibility & Polish**:
  - Screen reader accessible DOM structure and `aria-live` status notifications.
  - Clear `:focus-visible` focus rings across controls.
  - Reduced motion: system preference or an in-app override disables camera orbit and particle/orb motion.

---

## Getting Started

### Prerequisites

- [Node.js](https://nodejs.org/) v18.18+ (CI uses Node 22)
- [pnpm](https://pnpm.io/) package manager

### Development

```bash
pnpm install
pnpm dev
```

Open your browser at `http://localhost:5173`.

### Running Tests

```bash
pnpm test
```

### Production Build & Preview

```bash
pnpm build
pnpm preview
```

Assets are built to the `dist/` directory with relative base path (`./`) for static subpath hosting on GitHub Pages.

---

## Adding a demo track

1. Put a short CC0 file (≤ 1 MB recommended) in `public/demo/`, e.g. `public/demo/pulse.mp3`.
2. Point the default source in `src/app.ts` / `src/ui/controls.ts` at `./demo/<filename>`.
3. Document the license in [ATTRIBUTIONS.md](ATTRIBUTIONS.md).

The bundled file is served same-origin, so it can feed `AnalyserNode` on GitHub Pages.

---

## Storage keys

| Store | Key / name | Contents |
|-------|------------|----------|
| `localStorage` | `spectrum-player:settings:v1` | Volume, mode, color, FFT, bar count, motion |
| `localStorage` | `spectrum-player:session:v1` | Last track metadata and seek position (not audio bytes) |
| IndexedDB | `spectrum-player-library` / `tracks` | Imported `ArrayBuffer`s |

`https://user.github.io` and `https://user.github.io/repo/` are **different origins**. Settings, session, and the library will not follow a path change. Pick one Pages URL and keep it.

Private / quota-restricted browsers still run the player; persist is best-effort and the status bar will say settings will not persist if `localStorage` writes fail.

---

## GitHub Pages Deployment

This repository includes a GitHub Actions workflow (`.github/workflows/pages.yml`) configured to automatically build and deploy the app to GitHub Pages on every push to `main`.

1. Go to **Settings** → **Pages** in your repository.
2. Under **Source**, select **GitHub Actions**.
3. Push changes to `main`.

The production service worker is network-first for HTML so a new deploy is not stuck on a stale `index.html`. Hashed JS/CSS are cached after the first fetch. Cache name is `spectrum-player-v2`.

---

## Audio Attribution

The bundled demo track (`pulse.mp3`) is CC0 (Public Domain). Licensing details are documented in [ATTRIBUTIONS.md](ATTRIBUTIONS.md).

---

## Specification & Plan

See [docs/plan.md](docs/plan.md) for the complete architecture document and phase breakdown.
