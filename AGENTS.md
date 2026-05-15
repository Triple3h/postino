# Repository Guidelines

## Project Structure & Module Organization

ApiFix Bin is a lightweight API debugging tool with three entry points:

- `index.html` is the canonical single-page app and contains the main UI, styles, and browser-side logic.
- `desktop/` contains the Electron wrapper. `desktop/copy-html.js` copies the root `index.html` into the desktop app before running or building.
- `extension/` contains the Chrome extension wrapper, including `manifest.json`, `background.js`, `popup.js`, `main.html`, and extension icons.
- `examples/` contains sample assets or usage material.
- Build output belongs in `desktop/dist/` and must not be committed.

There is no dedicated `src/` or test directory yet. Keep new files close to the entry point they support unless a broader refactor introduces modules.

## Build, Test, and Development Commands

Run commands from `desktop/` when working on the Electron app:

```bash
npm install
npm start
npm run build
npm run build:portable
```

- `npm start` copies `../index.html` and launches Electron.
- `npm run build` creates the Windows installer with `electron-builder`.
- `npm run build:portable` creates a portable Windows package.

The Chrome extension can be loaded from `extension/` via Chrome's "Load unpacked" developer option.

## Coding Style & Naming Conventions

Use plain JavaScript, HTML, and CSS. Follow the existing style: two-space indentation in JSON, semicolons in JavaScript, and descriptive camelCase function names such as `sendRequest`, `importPostman`, and `renderHistory`.

Prefer small helper functions when adding complex behavior. Avoid unrelated formatting churn in `index.html`, since it is currently a large single-file app.

## Testing Guidelines

No automated test framework is configured. For now, verify changes manually in the relevant targets:

- Browser: open `index.html`.
- Electron: run `npm start` from `desktop/`.
- Chrome extension: reload the unpacked extension and open the popup.

For request features, test GET, POST JSON, headers, params, history, and import/export paths.

## Commit & Pull Request Guidelines

Git history uses concise conventional-style prefixes, for example `feat: ...`, `fix: ...`, and `chore: ...`. Keep commit messages action-oriented and scoped to one change.

Pull requests should include a short summary, manual test steps, screenshots for UI changes, and notes for any extension permission or Electron packaging changes.

## Security & Configuration Tips

Be careful with `<all_urls>` extension access and CORS-related Electron changes. Do not log tokens, cookies, authorization headers, or API secrets. Keep local IDE files, build artifacts, and packaged binaries out of Git.
