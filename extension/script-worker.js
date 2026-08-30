/**
 * Postino - Script execution worker (Phase 4.3 converged)
 *
 * The pm.* runtime facade is no longer inlined here; it is provided by the
 * built artifact pm-facade.js (single source of truth: src/scripting/pm-facade.ts;
 * build via `npm run build:facade` or `node build.js`).
 * sandbox.html loads the same artifact via <script src="pm-facade.js">.
 */
importScripts('pm-facade.js');
