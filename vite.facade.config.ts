import { defineConfig } from 'vite'
import { resolve } from 'path'

/**
 * Phase 4.3:pm 门面单独构建为 IIFE,输出 extension/pm-facade.js。
 * script-worker.js(importScripts)与 sandbox.html(<script src>)消费同一产物。
 */
export default defineConfig({
  build: {
    outDir: 'extension',
    emptyOutDir: false,
    lib: {
      entry: resolve(__dirname, 'src/scripting/pm-facade.ts'),
      formats: ['iife'],
      name: 'ApiFixPmFacade',
      fileName: () => 'pm-facade.js',
    },
    target: 'es2020',
    minify: false,
    sourcemap: false,
  },
})
