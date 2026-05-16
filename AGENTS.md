# AGENTS.md

This file provides guidance to Codex (Codex.ai/code) when working with code in this repository.

## Project Overview

ApiFix Bin is a lightweight API debugging tool — no login required, supports cURL/Postman import, with local storage persistence. It ships as both an Electron desktop app and a Chrome browser extension.

## Build Commands

```bash
# Run Electron desktop app (copies index.html to desktop/, then starts)
cd desktop && npm start

# Build Windows executable (.exe)
cd desktop && npm run build

# Build macOS DMG
cd desktop && npm run build:mac

# Build both platforms
cd desktop && npm run build:all

# Build Windows portable version
cd desktop && npm run build:portable
```

Releases are triggered via GitHub Actions on `v*` tags (e.g., `git tag v1.0.0 && git push --tags`). The workflow builds both Windows (.exe) and macOS (.dmg) and publishes a GitHub Release.

## Architecture

### Codebase Layout

There are **two independent copies** of the UI logic — they are not shared at build time:

- **`index.html`** (~6270 lines) — Self-contained HTML/CSS/JS for the Electron app and standalone browser use. Uses inline `<script>` and `onclick=""` handlers.
- **`extension/main.html`** + **`extension/main.js`** (~8900 lines combined) — CSP-compliant version for the Chrome extension. `main.html` has the markup (no inline scripts); `main.js` has all logic with `addEventListener`-style binding (no inline event handlers). This version also has streaming support via `chrome.runtime.sendMessage`.

When editing features, you typically need to update **both** copies unless the feature is extension-specific (streaming, sandbox) or Electron-specific (IPC prompt).

### Single-File Application (index.html)

All UI logic resides in `index.html` — no framework, vanilla JS only. 112 functions total.

**State Management**: A global `STATE` object with localStorage persistence:
- `STATE.apis` — API request configurations keyed by ID
- `STATE.groups` — Group names → array of API IDs
- `STATE.groupOrder` — Ordered list of group names
- `_environmentVars` — Postman-style environment variables (stored in `apifix_env_vars`)
- `_history` — Request history (stored in `apifix_history`)

**Key Functions** (line numbers in index.html):
- `renderSidebar()` :3302 — Renders API groups/items list
- `loadApi(id)` :3564 / `syncCurrentApi()` :3618 — Load/save current API config to editor
- `sendRequest()` :4178 — Executes HTTP requests with CORS/proxy/no-cors modes
- `importCurl()` :4848 / `importPostman()` :5201 — Parse and import external formats
- `executePreRequestScript()` :6049 — Runs Postman-compatible pre-request scripts with `pm.environment` API
- `resolveTemplateVars()` :6243 — Replaces `{{variable}}` patterns with environment values

### Electron Desktop App (`desktop/`)

- `main.js` — Main process; creates BrowserWindow with `webSecurity: false` to bypass CORS. Also handles custom prompt dialogs via IPC.
- `preload.js` — Exposes `window.electronAPI.isDesktop` and overrides `window.prompt` via IPC.
- `prompt-preload.js` — Preload for prompt dialog windows.
- `copy-html.js` — Pre-build script that copies `../index.html` into `desktop/` for packaging.
- `package.json` — Electron Builder config for Windows (.exe) and macOS (.dmg) builds.

### Chrome Extension (`extension/`)

Manifest V3 extension for browser usage:
- `manifest.json` — Extension config with `<all_urls>` host permissions.
- `background.js` — Service worker handling cross-origin requests via `chrome.runtime.sendMessage`. Supports message types: `API_REQUEST`, `STREAMING_REQUEST`, `CANCEL_STREAMING`, `DOWNLOAD_REQUEST`.
- `popup.js` — Opens `main.html` in a new tab when extension icon clicked.
- `main.html`, `main.js` — Extension pages with CSP-compliant UI logic (separate from root `index.html`).
- `sandbox.html` — Sandboxed iframe for executing pre-request scripts when CSP blocks `new Function()`.

The extension uses message passing: popup sends `API_REQUEST`, background service worker executes fetch (bypassing CORS via extension privileges), returns response.

## Key Features Implementation

### CORS Handling

- **Electron**: `webSecurity: false` in BrowserWindow config + `onHeadersReceived` injects `Access-Control-Allow-Origin: *`.
- **Extension**: Background service worker with full host permissions performs the actual fetch.
- **Browser (no extension)**: Offers CORS/proxy/no-cors modes via dropdown. Proxy mode uses `corsproxy.io` and `api.allorigins.win`.

### Pre-request Scripts

Postman-compatible API in `executePreRequestScript()`:
```javascript
pm.environment.set(key, value)
pm.environment.get(key)
pm.environment.unset(key)
pm.request.headers.add({ key, value })
pm.request.url.addQueryParams([{ key, value }])
pm.request.body.urlencoded.add({ key, value })
```

In the extension, CSP blocks `new Function()`, so scripts fall back to a sandboxed iframe (`sandbox.html`) via `postMessage`. An inline CryptoJS SHA-256 polyfill is included for `pm` script compatibility.

### Environment Variables

Template syntax `{{variableName}}` resolved in URLs, headers, and body via `resolveTemplateVars()`. Variables stored in localStorage key `apifix_env_vars`.

### Streaming (Extension Only)

The extension supports SSE/streaming responses. `STREAMING_REQUEST` messages go to the background service worker, which reads the response body via `ReadableStream` and sends `STREAM_CHUNK` messages back. Cancellation via `CANCEL_STREAMING` aborts the `AbortController`.

## Important Notes

- The entire application is one file (`index.html`). When editing, search within this file for relevant functions.
- The extension has a **separate** copy of the UI logic — changes to `index.html` do not automatically propagate to the extension.
- No test infrastructure exists in this project.
- Storage keys: `apifix_bin_data` (APIs/groups), `apifix_env_vars` (environment), `apifix_history` (history).
- Electron build requires `copy-html.js` to run first — it copies `index.html` from parent directory into `desktop/`.
- The app is localized in Chinese (zh-CN) — UI strings are in Chinese.
