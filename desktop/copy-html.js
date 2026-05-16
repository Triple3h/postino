/**
 * Electron 运行/打包前准备桌面端静态资源。
 *
 * Vue/Vite 迁移后，根目录 index.html 只是开发入口，里面引用 /src/main.ts。
 * Electron 的 loadFile() 不能像 Vite dev server 一样编译 TypeScript/Vue SFC，
 * 因此桌面端必须加载 dist/ 中已经构建好的 index.html 和 assets。
 */

const fs = require('fs');
const path = require('path');
const { execSync } = require('child_process');

const rootDir = path.join(__dirname, '..');
const distDir = path.join(rootDir, 'dist');
const distIndex = path.join(distDir, 'index.html');
const distAssets = path.join(distDir, 'assets');
const destIndex = path.join(__dirname, 'index.html');
const destAssets = path.join(__dirname, 'assets');

function copyDir(src, dest) {
  fs.mkdirSync(dest, { recursive: true });
  for (const entry of fs.readdirSync(src, { withFileTypes: true })) {
    const srcPath = path.join(src, entry.name);
    const destPath = path.join(dest, entry.name);
    if (entry.isDirectory()) {
      copyDir(srcPath, destPath);
    } else {
      fs.copyFileSync(srcPath, destPath);
    }
  }
}

function ensureDist() {
  if (fs.existsSync(distIndex) && fs.existsSync(distAssets)) {
    return;
  }

  console.log('dist/ not found; building Vue app first...');
  execSync('npm run build', {
    cwd: rootDir,
    stdio: 'inherit',
  });
}

ensureDist();

if (!fs.existsSync(distIndex)) {
  console.error('Error: dist/index.html not found. Run npm run build from the project root first.');
  process.exit(1);
}

fs.copyFileSync(distIndex, destIndex);

if (fs.existsSync(destAssets)) {
  fs.rmSync(destAssets, { recursive: true, force: true });
}
if (fs.existsSync(distAssets)) {
  copyDir(distAssets, destAssets);
}

const stats = fs.statSync(destIndex);
console.log(`✓ Copied built desktop assets (${(stats.size / 1024).toFixed(1)} KB index.html + assets/)`);
