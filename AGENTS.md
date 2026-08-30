# AGENTS.md

This file provides guidance to AI coding agents when working with this repository.

## Project Overview

**Postino** is a lightweight, local-first API debugging workspace — no login required, supports cURL / Postman / OpenAPI import, with local-first storage persistence. It ships as both a **Chrome/Edge browser extension** (MV3) and an **Electron desktop app** (Windows / macOS).

The UI is built with **Vue 3 + TypeScript + Vite + Pinia**, sharing a single codebase across the extension and desktop targets.

## Build Commands

```bash
# Install dependencies
npm install

# Vite dev server with hot reload
npm run dev

# Type-check (vue-tsc)
npm run typecheck

# Run unit tests (vitest)
npm run test

# Build browser extension only → dist-extension/
npm run build:ext

# Build desktop app only (current platform)
npm run build:desktop

# Build desktop app — Windows
npm run build:desktop:win

# Build desktop app — macOS
npm run build:desktop:mac

# Build desktop app — all platforms
npm run build:desktop:all

# Build everything — extension + desktop (current platform)
npm run build:all

# Build pm-facade IIFE bundle only (extension pre-request script runtime)
npm run build:facade
```

Releases are triggered via GitHub Actions on `v*` tags (e.g., `git tag v1.1.0 && git push --tags`). The workflow builds Windows (.exe), macOS (.dmg), and the browser extension (.zip) and publishes a GitHub Release.

## Architecture

### Tech Stack

- **Framework**: Vue 3 (`<script setup>` SFCs) + TypeScript
- **Build**: Vite 8
- **State**: Pinia stores (`src/stores/`)
- **Data Layer**: Dexie (IndexedDB wrapper, `src/db/index.ts`)
- **Editor**: CodeMirror 6 (JSON / headers / body editing)
- **Styling**: Tailwind CSS 4 + CSS custom properties (design tokens in `src/assets/styles/tokens.css`)
- **Routing**: Vue Router 4 (popup / side-panel / full-page views)
- **Desktop**: Electron 33 + electron-builder
- **Extension**: Manifest V3 service worker

### Codebase Layout

```
src/                        # Shared Vue 3 SPA source (single codebase for all targets)
├── App.vue
├── main.ts                 # App entry point
├── components/
│   ├── common/             # Reusable components (CodeMirror editor, KV editor, history, search, …)
│   ├── editor/             # Request editor (URL bar, body, tabs, headers)
│   ├── response/           # Response viewer (body, headers, timing)
│   ├── shell/              # App shell (header, layout, pane layout)
│   └── sidebar/            # Collections tree, save modal
├── composables/            # Vue composables (keyboard shortcuts, context menu, settings)
├── db/                     # Dexie database schema + migration
├── scripting/              # Pre-request script runtime (pm.* facade source)
├── stores/                 # Pinia stores (app state)
├── types/                  # TypeScript type definitions
├── utils/                  # Utilities (template vars, migration, data-source sync)
└── views/                  # Page views
    ├── PopupView.vue       # Extension popup
    ├── SidePanelView.vue   # Extension side panel
    └── SettingsView.vue    # In-app settings

extension/                  # Chrome/Edge extension (MV3)
├── manifest.json           # Extension manifest (<all_urls> host permissions)
├── background.js           # Service worker — CORS-bypassing fetch + streaming
├── content.js              # Content bridge — page integration, JSON formatter, drag-and-drop
├── devtools.js / devtools-panel.html  # DevTools network capture panel
├── popup-fit.js            # Popup window sizing
├── pm-facade.js            # Built IIFE — pre-request script runtime (build:facade)
├── script-worker.js        # Web Worker — runs pre-request scripts (imports pm-facade.js)
└── sandbox.html            # Sandboxed iframe fallback for pre-request scripts (CSP)

desktop/                    # Electron desktop app
├── main.js                 # Main process — BrowserWindow with webSecurity: false
├── preload.js              # Preload script — exposes window.electronAPI
├── copy-html.js            # Pre-build: copies index.html into desktop/
└── package.json            # Electron-builder config (appId: com.postino.app)

build.js                    # Unified build script — orchestrates extension + desktop builds
vite.config.ts              # Vite config — main app build
vite.facade.config.ts       # Vite config — pm-facade IIFE build for extension
```

### Shared Codebase Model

Unlike the earlier version of this project, the UI is now a **single shared codebase** (`src/`). The extension and desktop app both import the same Vue app — there is no duplicated logic. View selection is by route:

- `/popup` → `PopupView` (compact)
- `/side-panel` → `SidePanelView` (narrow sidebar)
- `/` → full-page view (default for standalone / desktop)

### Data Layer (`src/db/`)

All persistent data lives in **IndexedDB via Dexie** (database name: `PostinoDB`).

Key tables:
- `apis` — API request configurations (id, name, method, folder, updatedAt)
- `environments` — Postman-style environment sets
- `history` — Request/response history
- `settings` — Key-value app settings
- `categories` / `modules` / `interfaces` — Collection tree structure

> **Note**: Vue reactive proxies cannot be stored directly in IndexedDB (throws `DataCloneError`). The DB layer installs Dexie hooks to deep-clone objects before write.

Legacy localStorage keys (`postino_bin_data`, `postino_env_vars`, `postino_history`) are still supported for migration but the primary store is IndexedDB.

### Electron Desktop App (`desktop/`)

- `main.js` — Creates `BrowserWindow` with `webSecurity: false` to bypass CORS. Injects `Access-Control-Allow-Origin: *` via `onHeadersReceived`.
- `preload.js` — Exposes `window.electronAPI` (isDesktop flag, platform metadata).
- Build: `npm run build:desktop` → electron-builder packages the app.

### Chrome/Edge Extension (`extension/`)

Manifest V3 extension:

- `background.js` — Service worker with `<all_urls>` host permissions. Handles `API_REQUEST` (CORS-bypassing fetch), `STREAMING_REQUEST` (SSE via ReadableStream), `CANCEL_STREAMING`, and `DOWNLOAD_REQUEST`.
- `content.js` — Injected into all pages. Provides: text selection → send to side panel, drag-and-drop request insertion, JSON formatting overlay, page context capture.
- `devtools.js` / `devtools-panel.html` — DevTools panel for capturing network requests from the Network tab.
- **Pre-request scripts**: Run in a Web Worker (`script-worker.js`) that imports the `pm-facade.js` IIFE. CSP blocks `new Function()`, so a sandboxed iframe (`sandbox.html`) is used as a fallback.

## Key Features Implementation

### CORS Handling

- **Electron**: `webSecurity: false` + `onHeadersReceived` header injection.
- **Extension**: Background service worker with full host permissions performs the actual fetch — no proxy needed.

### Pre-request Scripts

Postman-compatible `pm.*` API (`src/scripting/pm-facade.ts`, built to `extension/pm-facade.js`):

```javascript
pm.environment.set(key, value)
pm.environment.get(key)
pm.environment.unset(key)
pm.request.headers.add({ key, value })
pm.request.url.addQueryParams([{ key, value }])
pm.request.body.urlencoded.add({ key, value })
```

A `crypto-shim` provides SHA-256 for `pm` script compatibility. Scripts run in a Web Worker in the extension; the desktop uses in-page execution.

### Environment Variables

Template syntax `{{variableName}}` resolved in URLs, headers, and body (`resolveTemplateVars()` in `src/utils/`). Stored in the `environments` table.

### Streaming (Extension Only)

SSE/streaming via `STREAMING_REQUEST` → background service worker reads `ReadableStream` → `STREAM_CHUNK` messages pushed to the UI. `CANCEL_STREAMING` aborts the `AbortController`.

### Request Import

cURL, Postman collection (v2.1), and OpenAPI formats (`src/utils/`).

## Important Notes

- The UI is a **single shared Vue 3 codebase** — changes to `src/` propagate to both extension and desktop.
- Storage uses **IndexedDB (Dexie)**; the database name is `PostinoDB`.
- Unit tests live in `src/**/__tests__/*.test.ts` (vitest). Run with `npm run test`.
- The app UI is localized in **Chinese (zh-CN)**.
- `build.js` orchestrates the full build — use it instead of calling vite/electron-builder directly.
- The `pm-facade.js` IIFE bundle must be rebuilt (`npm run build:facade`) after changes to `src/scripting/pm-facade.ts`.
