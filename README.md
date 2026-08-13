# Spectrum Player

Static web app: play one local or bundled audio file and show a live 3D frequency spectrum. Deploys to GitHub Pages. No backend.

This repo is at **Phase 0** (empty shell). Playback, analyser, and Three.js come in later phases. See [docs/plan.md](docs/plan.md).

## Develop

Requires [pnpm](https://pnpm.io/) and Node 18.18+ (CI uses Node 22).

```bash
pnpm install
pnpm dev
```

Preview the production build:

```bash
pnpm build
pnpm preview
```

`vite.config.ts` sets `base: './'` so assets resolve on project Pages (`username.github.io/repo/`).

## Demo track

A short CC0 loop lives at `public/demo/pulse.mp3`. License notes are in [ATTRIBUTIONS.md](ATTRIBUTIONS.md).

## GitHub Pages

1. Repo Settings → Pages → Source: **GitHub Actions**.
2. Push to `main`. `.github/workflows/pages.yml` installs, tests, builds, and deploys `dist`.

Storage keys and imported-file rules are defined in the plan. Do not store audio in `localStorage`.
