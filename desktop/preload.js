/**
 * ApiFix Bin - Electron Preload Script
 * 劫持 window.prompt 使其在 Electron 中正常工作
 * Electron 默认 prompt() 返回 null，导致添加分组等功能失效
 */

const { contextBridge, ipcRenderer } = require('electron');

contextBridge.exposeInMainWorld('electronAPI', {
  isDesktop: true,
  platform: process.platform
});

// 劫持 window.prompt —— 使用同步 IPC 调用主进程的自定义对话框
window.prompt = function(message, defaultValue) {
  return ipcRenderer.sendSync('sync-prompt', {
    title: '提示',
    message: message || '',
    defaultValue: defaultValue || ''
  });
};
