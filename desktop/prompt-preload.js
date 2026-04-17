/**
 * Prompt 对话框的 preload —— 将输入结果发回主进程
 * 通过 data-action 属性 + 事件委托处理按钮点击
 */

const { contextBridge, ipcRenderer } = require('electron');

contextBridge.exposeInMainWorld('promptAPI', {
  sendResult: (value) => ipcRenderer.send('prompt-result', value)
});

window.addEventListener('DOMContentLoaded', () => {
  const input = document.getElementById('input');
  if (input) {
    input.select();
    input.focus();
    input.addEventListener('keydown', (e) => {
      if (e.key === 'Enter') {
        e.preventDefault();
        window.promptAPI.sendResult(input.value);
      }
      if (e.key === 'Escape') {
        e.preventDefault();
        window.promptAPI.sendResult(null);
      }
    });
  }

  // 事件委托处理按钮点击
  document.addEventListener('click', (e) => {
    const btn = e.target.closest('button');
    if (!btn) return;
    const action = btn.dataset.action;
    if (action === 'ok') {
      const input = document.getElementById('input');
      window.promptAPI.sendResult(input ? input.value : null);
    } else if (action === 'cancel') {
      window.promptAPI.sendResult(null);
    }
  });
});
