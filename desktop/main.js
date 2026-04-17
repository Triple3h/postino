/**
 * ApiFix Bin - Electron Main Process
 * 加载 index.html 并绕过 CORS 限制，让 API 调试工具可以自由请求任何 URL
 * 同时处理 prompt() 对话框
 */

const { app, BrowserWindow, session, ipcMain, dialog } = require('electron');
const path = require('path');

let mainWindow;

function createWindow() {
  mainWindow = new BrowserWindow({
    width: 1280,
    height: 800,
    minWidth: 900,
    minHeight: 600,
    title: 'ApiFix Bin',
    webPreferences: {
      preload: path.join(__dirname, 'preload.js'),
      nodeIntegration: false,
      contextIsolation: true,
      webSecurity: false
    }
  });

  mainWindow.loadFile(path.join(__dirname, 'index.html'));
  mainWindow.setMenuBarVisibility(false);

  mainWindow.on('closed', () => {
    mainWindow = null;
  });
}

// 同步处理 prompt —— 使用 dialog.showMessageBoxSync 配合输入方案
// 由于 Electron dialog 不支持输入框，使用自定义窗口方案
ipcMain.on('sync-prompt', (event, options) => {
  const { title = '提示', message = '', defaultValue = '' } = options;

  // 创建模态对话框窗口
  const promptWindow = new BrowserWindow({
    width: 420,
    height: 210,
    parent: mainWindow,
    modal: true,
    show: false,
    resizable: false,
    minimizable: false,
    maximizable: false,
    title: title,
    autoHideMenuBar: true,
    webPreferences: {
      nodeIntegration: false,
      contextIsolation: true,
      preload: path.join(__dirname, 'prompt-preload.js')
    }
  });

  const escapedMsg = message.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');
  const escapedDefault = defaultValue.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');

  const html = `<!DOCTYPE html>
<html>
<head><meta charset="utf-8"><title>${title}</title>
<style>
* { margin:0; padding:0; box-sizing:border-box; }
body { font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', sans-serif; padding: 24px; background: #1e1e2e; color: #cdd6f4; }
p { margin-bottom: 14px; font-size: 14px; line-height: 1.5; word-break: break-word; }
input { width: 100%; padding: 8px 12px; border: 1px solid #45475a; border-radius: 6px; background: #313244; color: #cdd6f4; font-size: 14px; outline: none; }
input:focus { border-color: #89b4fa; }
.btns { display: flex; gap: 8px; margin-top: 18px; justify-content: flex-end; }
button { padding: 7px 22px; border-radius: 6px; font-size: 13px; cursor: pointer; border: 1px solid #45475a; }
.cancel { background: #313244; color: #a6adc8; }
.ok { background: #89b4fa; color: #1e1e2e; border-color: #89b4fa; font-weight: 600; }
</style>
</head>
<body>
<p>${escapedMsg}</p>
<input id="input" value="${escapedDefault}" autofocus />
<div class="btns">
  <button class="cancel" data-action="cancel">取消</button>
  <button class="ok" data-action="ok">确定</button>
</div>
</body></html>`;

  promptWindow.loadURL('data:text/html;charset=utf-8,' + encodeURIComponent(html));

  promptWindow.once('ready-to-show', () => {
    promptWindow.show();
  });

  promptWindow.on('closed', () => {
    // 如果窗口关闭但还没返回值，返回 null
    if (event.returnValue === undefined) {
      event.returnValue = null;
    }
  });

  // 监听子窗口返回结果
  ipcMain.once('prompt-result', (e, value) => {
    event.returnValue = value;
    if (!promptWindow.isDestroyed()) promptWindow.close();
  });
});

// 绕过 CORS
app.whenReady().then(() => {
  session.defaultSession.webRequest.onHeadersReceived((details, callback) => {
    const responseHeaders = {
      ...details.responseHeaders,
      'Access-Control-Allow-Origin': ['*'],
      'Access-Control-Allow-Methods': ['GET, POST, PUT, PATCH, DELETE, HEAD, OPTIONS'],
      'Access-Control-Allow-Headers': ['*'],
      'Access-Control-Allow-Credentials': ['true']
    };
    callback({ responseHeaders });
  });

  session.defaultSession.webRequest.onBeforeSendHeaders((details, callback) => {
    callback({
      requestHeaders: {
        ...details.requestHeaders,
        'Origin': details.url
      }
    });
  });

  createWindow();

  app.on('activate', () => {
    if (BrowserWindow.getAllWindows().length === 0) {
      createWindow();
    }
  });
});

app.on('window-all-closed', () => {
  if (process.platform !== 'darwin') {
    app.quit();
  }
});