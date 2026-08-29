#!/usr/bin/env node

/**
 * ApiFix Bin - 统一打包脚本
 * 同时构建 Chrome 扩展版和 Electron 桌面版
 *
 * 用法:
 *   node build.js              # 构建扩展版 + 桌面版(当前平台)
 *   node build.js --ext-only   # 仅构建扩展版
 *   node build.js --desktop-only # 仅构建桌面版
 *   node build.js --win        # 桌面版构建 Windows
 *   node build.js --mac        # 桌面版构建 macOS
 *   node build.js --all        # 桌面版构建全平台 (Win + Mac)
 *   node build.js --no-typecheck # 跳过 vue-tsc 类型检查
 */

import { execSync } from 'child_process'
import { existsSync, copyFileSync, mkdirSync, rmSync, readdirSync, readFileSync } from 'fs'
import { resolve, join } from 'path'

const ROOT = resolve(import.meta.dirname)
const DIST = join(ROOT, 'dist')
const DIST_EXTENSION = join(ROOT, 'dist-extension')
const DIST_ASSETS = join(DIST, 'assets')

// 解析命令行参数
const args = process.argv.slice(2)
const extOnly = args.includes('--ext-only')
const desktopOnly = args.includes('--desktop-only')
const buildWin = args.includes('--win')
const buildMac = args.includes('--mac')
const buildAll = args.includes('--all')
const noTypeCheck = args.includes('--no-typecheck')

function run(cmd, cwd = ROOT) {
  console.log(`\x1b[36m> ${cmd}\x1b[0m`)
  execSync(cmd, { stdio: 'inherit', cwd })
}

function logStep(msg) {
  console.log(`\n\x1b[1;33m━━━ ${msg} ━━━\x1b[0m`)
}

function logSuccess(msg) {
  console.log(`\x1b[32m✓ ${msg}\x1b[0m`)
}

function logError(msg) {
  console.log(`\x1b[31m✗ ${msg}\x1b[0m`)
}

// ─── Step 0:构建 pm 门面 IIFE(Phase 4.3)───
function buildFacade() {
  logStep('Step 0: 构建 pm 门面 (src/scripting/pm-facade.ts → extension/pm-facade.js)')
  run('npx vite build --config vite.facade.config.ts')
  if (!existsSync(join(ROOT, 'extension', 'pm-facade.js'))) {
    logError('extension/pm-facade.js 未生成,请检查 vite.facade.config.ts')
    process.exit(1)
  }
  logSuccess('pm 门面构建完成')
}

// ─── Step 1: Vite 构建 ───
function buildVite() {
  logStep('Step 1: Vite 构建 (Vue 3 → dist/)')

  if (!existsSync(join(ROOT, 'node_modules'))) {
    logError('node_modules 不存在，请先运行 npm install')
    logError('npm v11 可能遇到 lightningcss 解析错误，可尝试: npm install --ignore-optional')
    process.exit(1)
  }

  if (noTypeCheck) {
    logStep('跳过类型检查 (--no-typecheck)')
    run('npx vite build')
  } else {
    run('npm run build')
  }
  logSuccess('Vite 构建完成')
}

// ─── Step 2: 打包 Chrome 扩展 ───
function buildExtension() {
  logStep('Step 2: 打包 Chrome 扩展')

  // 清理旧输出
  if (existsSync(DIST_EXTENSION)) {
    rmSync(DIST_EXTENSION, { recursive: true })
  }
  mkdirSync(DIST_EXTENSION, { recursive: true })

  // 复制 Vite 构建产物
  const viteFiles = ['index.html', 'main.html', 'popup.html', 'sidepanel.html']
  for (const f of viteFiles) {
    const src = join(DIST, f)
    if (existsSync(src)) {
      copyFileSync(src, join(DIST_EXTENSION, f))
    }
  }

  // 复制 assets 目录
  if (existsSync(DIST_ASSETS)) {
    cpDir(DIST_ASSETS, join(DIST_EXTENSION, 'assets'))
  }

  // 复制扩展专用文件
  const extDir = join(ROOT, 'extension')
  const extFiles = [
    'manifest.json',
    'background.js',
    'content.js',
    'devtools.html',
    'devtools.js',
    'devtools-panel.html',
    'devtools-panel.js',
    'sandbox.html',
    'script-worker.js',
    'pm-facade.js',
  ]
  for (const f of extFiles) {
    const src = join(extDir, f)
    if (existsSync(src)) {
      copyFileSync(src, join(DIST_EXTENSION, f))
    }
  }

  // Phase 4.3:校验门面双副本收敛 —— 两处消费端必须引用同一产物且产物存在
  const facadeDist = join(DIST_EXTENSION, 'pm-facade.js')
  const workerDist = join(DIST_EXTENSION, 'script-worker.js')
  const sandboxDist = join(DIST_EXTENSION, 'sandbox.html')
  if (!existsSync(facadeDist)) {
    logError('dist-extension/pm-facade.js 缺失:pm 门面收敛校验失败')
    process.exit(1)
  }
  if (!existsSync(workerDist) || !readFileSync(workerDist, 'utf8').includes("importScripts('pm-facade.js')")) {
    logError('script-worker.js 未加载 pm-facade.js:pm 门面收敛校验失败')
    process.exit(1)
  }
  if (!existsSync(sandboxDist) || !readFileSync(sandboxDist, 'utf8').includes('src="pm-facade.js"')) {
    logError('sandbox.html 未加载 pm-facade.js:pm 门面收敛校验失败')
    process.exit(1)
  }
  logSuccess('pm 门面收敛校验通过(worker/sandbox 共用同一产物)')

  // 复制扩展图标
  const iconsDir = join(extDir, 'icons')
  if (existsSync(iconsDir)) {
    cpDir(iconsDir, join(DIST_EXTENSION, 'icons'))
  }

  logSuccess(`Chrome 扩展已打包到 dist-extension/`)
}

// ─── Step 3: 打包 Electron 桌面版 ───
function buildDesktop() {
  logStep('Step 3: 打包 Electron 桌面版')

  const desktopDir = join(ROOT, 'desktop')

  if (!existsSync(join(desktopDir, 'node_modules'))) {
    logError('desktop/node_modules 不存在，请先运行 cd desktop && npm install')
    process.exit(1)
  }

  // 将 Vite 构建的 index.html 复制到 desktop 目录
  const viteIndex = join(DIST, 'index.html')
  if (existsSync(viteIndex)) {
    copyFileSync(viteIndex, join(desktopDir, 'index.html'))
    logSuccess('已复制 index.html 到 desktop/')
  } else {
    logError('dist/index.html 不存在，请先完成 Vite 构建')
    process.exit(1)
  }

  // 将 Vite 构建的 assets 也复制到 desktop
  const desktopAssets = join(desktopDir, 'assets')
  if (existsSync(desktopAssets)) {
    rmSync(desktopAssets, { recursive: true })
  }
  if (existsSync(DIST_ASSETS)) {
    cpDir(DIST_ASSETS, desktopAssets)
    logSuccess('已复制 assets 到 desktop/')
  }

  // 确定构建目标
  let builderTarget
  if (buildAll) {
    builderTarget = '--win --mac'
  } else if (buildWin) {
    builderTarget = '--win'
  } else if (buildMac) {
    builderTarget = '--mac'
  } else {
    // 默认: 当前平台
    builderTarget = process.platform === 'darwin' ? '--mac' : '--win'
  }

  // 直接运行 electron-builder (跳过 copy-html.js，已手动复制)
  logStep(`运行 electron-builder (${buildAll ? '全平台' : buildWin ? 'Windows' : buildMac ? 'macOS' : '当前平台'})`)
  run(`npx electron-builder ${builderTarget} --publish never`, desktopDir)

  logSuccess('Electron 桌面版构建完成')
}

// ─── 辅助函数 ───
function cpDir(src, dest) {
  if (!existsSync(dest)) {
    mkdirSync(dest, { recursive: true })
  }
  const entries = readdirSync(src, { withFileTypes: true })
  for (const entry of entries) {
    const srcPath = join(src, entry.name)
    const destPath = join(dest, entry.name)
    if (entry.isDirectory()) {
      cpDir(srcPath, destPath)
    } else {
      copyFileSync(srcPath, destPath)
    }
  }
}

// ─── 主流程 ───
function main() {
  console.log('\x1b[1;34m')
  console.log('╔══════════════════════════════════╗')
  console.log('║     ApiFix Bin 统一打包脚本      ║')
  console.log('╚══════════════════════════════════╝')
  console.log('\x1b[0m')

  const startTime = Date.now()

  // Step 0: pm 门面(扩展所需;桌面版沙箱经页面内联降级仍可用)
  if (!desktopOnly) {
    buildFacade()
  }

  // Step 1: Vite 构建 (除非只构建桌面版且已有 dist)
  if (!desktopOnly || !existsSync(DIST)) {
    buildVite()
  } else {
    logStep('跳过 Vite 构建 (--desktop-only 且 dist/ 已存在)')
  }

  // Step 2: Chrome 扩展
  if (!desktopOnly) {
    buildExtension()
  }

  // Step 3: Electron 桌面版
  if (!extOnly) {
    buildDesktop()
  }

  const elapsed = ((Date.now() - startTime) / 1000).toFixed(1)

  console.log('\n\x1b[1;32m')
  console.log('╔══════════════════════════════════╗')
  console.log('║          打包完成!               ║')
  console.log('╚══════════════════════════════════╝')
  console.log(`\x1b[0m耗时: ${elapsed}s`)

  if (!desktopOnly) {
    console.log(`Chrome 扩展: ${DIST_EXTENSION}`)
  }
  if (!extOnly) {
    console.log(`Electron 桌面版: ${join(ROOT, 'desktop', 'dist')}`)
  }
  console.log()
}

main()
