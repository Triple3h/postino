<div align="center">

  <img src="./src/assets/logo/postino-logo.png" alt="Postino" width="180" />

  <h3><b>Postino</b></h3>
  <b>A lightweight, local-first API debugging workspace</b>

  <p>

[![CI](https://github.com/Bin-Hu-Ling/postino/actions/workflows/ci.yml/badge.svg)](https://github.com/Bin-Hu-Ling/postino/actions/workflows/ci.yml)
[![Release](https://img.shields.io/github/v/release/Bin-Hu-Ling/postino?include_prereleases)](https://github.com/Bin-Hu-Ling/postino/releases)
[![License: MIT](https://img.shields.io/badge/License-MIT-blue.svg)](LICENSE)

  </p>

  <p>
    <sub>Built with ❤︎ by <a href="https://github.com/Bin-Hu-Ling">@Bin-Hu-Ling</a></sub>
  </p>

</div>

---

**Postino** is a lightweight API debugging tool — no login required, supports cURL / Postman / OpenAPI import, with local-first storage persistence. It ships as both a **Chrome/Edge browser extension** and an **Electron desktop app** (Windows / macOS).

## Features

❤️ **Lightweight** — Crafted with a minimalistic, Hoppscotch-inspired UI.

⚡️ **Fast** — Send requests and get responses in real time.

🗄️ **HTTP Methods** — Full support for `GET`, `POST`, `PUT`, `PATCH`, `DELETE`, `HEAD`, `OPTIONS`, `TRACE`, and custom methods.

📁 **Collections** — Keep your API requests organized with collections, categories, and nested folders. Reuse them with a single click.

🌱 **Environments** — Postman-style environment variables with `{{variable}}` template syntax, resolved in URLs, headers, and body.

📜 **Pre-Request Scripts** — Postman-compatible `pm.*` API (`pm.environment.set/get`, `pm.request.headers.add`, …) executed before a request is sent.

📡 **Streaming** — SSE / streaming responses supported in the extension via `ReadableStream` with live chunk delivery.

📋 **Import / Export** — cURL, Postman collection, and OpenAPI formats. Share requests via encoded links.

⌨️ **Keyboard Shortcuts** — Optimized for efficiency (Spotlight-style `⌘K` search across requests, environments, history, and settings).

🎨 **Theming** — Light, dark, and black themes with accent colors. Distraction-free Zen mode.

🪟 **Multi-tab** — Edit multiple requests in tabs with unsaved-dirty indicators (Postman-style).

🔌 **CORS Bypass** — Extension uses background service worker with full host permissions; Electron disables web security. No proxy needed.

🔒 **Local-first** — All data stored locally in IndexedDB. No account, no telemetry, no cloud lock-in.

## Usage

### Browser Extension (Chrome / Edge)

1. Download the latest `postino-extension-*.zip` from the [Releases](https://github.com/Bin-Hu-Ling/postino/releases) page.
2. Unzip it to a local folder.
3. Open `chrome://extensions` (or `edge://extensions`), enable **Developer mode**.
4. Click **Load unpacked** and select the unzipped folder.

> To open Postino: click the extension icon (popup), or use the side panel / full-page view. Keyboard shortcuts: `Ctrl+Shift+A` (popup), `Ctrl+Shift+S` (side panel), `Ctrl+Shift+F` (full page).

### Desktop App (Windows / macOS)

Download the `.exe` (Windows) or `.dmg` (macOS) from the [Releases](https://github.com/Bin-Hu-Ling/postino/releases) page.

## Developing

```bash
# Install dependencies
npm install

# Start Vite dev server (hot reload)
npm run dev

# Type-check
npm run typecheck

# Run unit tests
npm run test

# Build browser extension only
npm run build:ext

# Build desktop app only (current platform)
npm run build:desktop

# Build everything (extension + desktop, current platform)
npm run build:all
```

### Project Structure

```
postino/
├── src/                    # Vue 3 + TypeScript SPA source
│   ├── components/         # UI components (editor, sidebar, shell, response)
│   ├── composables/        # Vue composables
│   ├── db/                 # Dexie (IndexedDB) data layer
│   ├── scripting/          # Pre-request script runtime (pm.* facade)
│   ├── stores/             # Pinia stores
│   ├── views/              # Page views (popup, side panel, full page, settings)
│   └── utils/              # Utilities
├── extension/              # Chrome/Edge extension (MV3)
│   ├── background.js       # Service worker (CORS-bypassing fetch, streaming)
│   ├── content.js          # Content bridge (page integration, JSON formatter)
│   ├── manifest.json       # Extension manifest
│   └── sandbox.html        # Sandboxed iframe for pre-request scripts
├── desktop/                # Electron desktop app
│   ├── main.js             # Main process
│   └── preload.js          # Preload script
├── build.js                # Unified build script (extension + desktop)
├── vite.config.ts          # Vite config (main app)
└── vite.facade.config.ts   # Vite config (pm-facade IIFE build)
```

## Continuous Integration

[GitHub Actions](https://github.com/Bin-Hu-Ling/postino/actions) runs CI on every push and PR (type-check + tests), and publishes releases on `v*` tags (Windows `.exe`, macOS `.dmg`, extension `.zip`).

## License

This project is licensed under the [MIT License](LICENSE).
