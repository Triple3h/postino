/**
 * 构建前脚本：将上级目录的 index.html 复制到 desktop 目录
 * 这样 electron-builder 可以正确打包（不支持打包上级目录的文件）
 */

const fs = require('fs');
const path = require('path');

const src = path.join(__dirname, '..', 'index.html');
const dest = path.join(__dirname, 'index.html');

if (!fs.existsSync(src)) {
  console.error('Error: index.html not found at', src);
  process.exit(1);
}

fs.copyFileSync(src, dest);
const stats = fs.statSync(dest);
console.log(`✓ Copied index.html to desktop/ (${(stats.size / 1024).toFixed(1)} KB)`);
