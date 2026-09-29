# GMC Maritime Academy Student Registry — build notes

Source of the UI and logic: `gmc-registry/src` (plain HTML/CSS/JS, Greek UI).

## Lightweight Windows build (delivered): Neutralinojs + WebView2
- Project: `gmc-neu/` (config in `neutralino.config.json`, binaries v6.9.0 in `gmc-neu/bin/`).
- `npm i -g @neutralinojs/neu@11.7.2`, download `neutralinojs-v6.9.0.zip` into `gmc-neu/bin/`.
- `gmc-neu/build.sh` copies `gmc-registry/src` into `resources/` and runs `neu build --embed-resources`
  → `dist/GMC-Student-Registry/GMC-Student-Registry-win_x64.exe` (single ~5 MB exe).
- Platform layer: `src/platform-neu.js` (file dialogs, atomic JSON save, backups, single-instance guard).

## Electron build (alternative, ~100 MB installer)
- `cd gmc-registry && npm install && npm run dist` (needs wine + wine32 on Linux).

## Tests
- `node test/core.test.js` — data logic.
- `xvfb-run node test/e2e.js` — Electron E2E; `E2E_DRIVER=neu xvfb-run node test/e2e.js` — Neutralino build (browser mode).

Data file on Windows: `%APPDATA%\GMC Maritime Academy Student Registry\data\registry.json` (+ `backups\`).
