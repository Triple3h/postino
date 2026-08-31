# AGENTS.md

Guidance for coding agents working on Postino. Keep this file limited to repository-specific rules that cannot be inferred reliably from the code or `package.json`.

## Project

Postino is a local-first API debugging workspace delivered from one Vue 3 + TypeScript codebase as:

- a Chrome/Edge Manifest V3 extension;
- an Electron desktop app for Windows and macOS.

The user interface is localized in Chinese (`zh-CN`). New user-facing copy should remain consistent with the existing Chinese UI.

## Code Navigation

This repository is indexed by CodeGraph (`.codegraph/`). Before using `rg`, `find`, or opening many files to understand or locate code, use:

```bash
codegraph explore "<question or symbol>"
codegraph node <symbol-or-file>
```

Use normal filesystem tools when CodeGraph does not answer the question or for non-code files.

## Architecture Guardrails

- `src/` is shared by the extension and desktop app. Do not create target-specific copies of shared UI or business logic.
- Persistent data uses Dexie/IndexedDB (`PostinoDB`). Do not write Vue reactive proxies directly; values must be converted to cloneable plain data.
- Extension requests run through `extension/background.js` to bypass browser CORS restrictions. Desktop requests rely on Electron's configuration in `desktop/main.js`.
- Pre-request script compatibility lives in `src/scripting/pm-facade.ts`. After changing it, run `npm run build:facade` and include the rebuilt `extension/pm-facade.js`.
- Use `build.js` through the npm scripts for packaged builds instead of invoking Vite or electron-builder directly.
- Unit tests belong in `src/**/__tests__/*.test.ts`.

## Common Commands

```bash
npm install                 # install dependencies
npm run dev                 # development server
npm run typecheck           # Vue/TypeScript checks
npm run test                # Vitest unit tests
npm run build:ext           # extension build
npm run build:desktop       # desktop build for the current platform
npm run build:all           # extension and desktop builds
npm run build:facade        # rebuild extension pm facade
```

For normal code changes, run `npm run typecheck` and `npm run test`. Also run the relevant target build when changing build configuration, extension code, Electron code, or cross-target behavior.

## GitHub Development Workflow

Protect `main` as the releasable branch. Make changes on short-lived branches and merge them through pull requests.

1. Create an Issue for user-visible features, bugs, or work that needs discussion or acceptance criteria. Trivial maintenance, documentation, and small refactors may skip the Issue.
2. Create one focused branch per change from the latest `main`, using names such as `feat/...`, `fix/...`, `refactor/...`, or `release/...`.
3. Use clear commits, preferably Conventional Commit prefixes such as `feat:`, `fix:`, `refactor:`, `test:`, `docs:`, and `chore:`.
4. Open a pull request into `main`. Explain the behavior change, verification performed, and any migration or platform impact. Link the Issue with `Closes #<number>` when applicable.
5. Keep each pull request focused and require CI (`typecheck`, unit tests, and extension build) to pass before merging.
6. Merge only reviewed, releasable changes. Do not push feature work directly to remote `main` except for an explicitly approved emergency fix.

An Issue records why and what to build; a pull request records and validates the implementation. An Issue is recommended, not mandatory for every commit.

## Releases

Use Semantic Versioning:

- patch (`1.2.1`) for backward-compatible bug fixes;
- minor (`1.3.0`) for backward-compatible features;
- major (`2.0.0`) for breaking changes.

Before release, synchronize the version in `package.json`, `package-lock.json`, `desktop/package.json`, `desktop/package-lock.json`, and `extension/manifest.json`. Merge the release change into `main`, verify CI, then tag that exact commit and push the single tag:

```bash
git tag vX.Y.Z
git push origin vX.Y.Z
```

Tags matching `v*` trigger `.github/workflows/release.yml`, which builds the Windows app, macOS app, and browser extension and publishes a GitHub Release. Do not create or move a release tag until the version commit is on `main` and checks have passed.
