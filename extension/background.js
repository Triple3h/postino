/**
 * ApiFix Bin - Background Service Worker
 * 通过 chrome.runtime.sendMessage 处理来自popup的跨域请求，并协调浏览器原生入口。
 */

// Active stream controllers for cancellation
const _activeStreams = new Map();
const _activeSockets = new Map();
const _recentWebRequests = new Map();

const PENDING_IMPORT_KEY = 'apifix_pending_import';
const RECENT_WEB_REQUESTS_KEY = 'apifix_recent_web_requests';
const MAX_RECENT_WEB_REQUESTS = 50;

const CONTEXT_MENU_IDS = {
  sendSelectionToSidePanel: 'apifix-send-selection-sidepanel',
  formatSelectionJson: 'apifix-format-selection-json',
  sendPageToSidePanel: 'apifix-send-page-sidepanel',
  openSidePanel: 'apifix-open-sidepanel',
  openFullPage: 'apifix-open-full-page',
};

chrome.runtime.onInstalled.addListener(() => {
  createContextMenus();
});

chrome.runtime.onStartup?.addListener(() => {
  createContextMenus();
});

// --- WebSocket 调试通道(Phase 3.5)---
// UI 通过 named port「ws-control」控制 SW 内的 WebSocket:
// WS_OPEN/WS_SEND/WS_CLOSE/WS_PING(UI→SW),WS_STATE/WS_MESSAGE(SW→UI)。
// 端口断开(SW 回收或页面关闭)时关闭该端口名下的全部连接。
chrome.runtime.onConnect.addListener((port) => {
  if (port.name !== 'ws-control') return;

  port.onMessage.addListener((message) => {
    if (!message || typeof message.wsId !== 'string') return;
    const { wsId } = message;

    if (message.type === 'WS_OPEN') {
      openWebSocket(wsId, message.url || '', message.protocols || [], port);
      return;
    }

    if (message.type === 'WS_SEND') {
      const record = _activeSockets.get(wsId);
      if (!record) {
        port.postMessage({ type: 'WS_LOG', wsId, level: 'error', text: '连接不存在或已关闭' });
        return;
      }
      try {
        record.socket.send(message.data);
      } catch (err) {
        port.postMessage({ type: 'WS_LOG', wsId, level: 'error', text: `发送失败:${err.message}` });
      }
      return;
    }

    if (message.type === 'WS_CLOSE') {
      closeWebSocket(wsId, message.code, message.reason);
      return;
    }

    if (message.type === 'WS_PING') {
      port.postMessage({ type: 'WS_PONG', wsId });
    }
  });

  port.onDisconnect.addListener(() => {
    for (const [wsId, record] of [..._activeSockets.entries()]) {
      if (record.port === port) closeWebSocket(wsId);
    }
  });
});

function openWebSocket(wsId, url, protocols, port) {
  const existing = _activeSockets.get(wsId);
  if (existing) closeWebSocket(wsId);

  let socket;
  try {
    socket = new WebSocket(url, protocols.filter(Boolean));
  } catch (err) {
    port.postMessage({ type: 'WS_STATE', wsId, state: 'error', detail: err.message });
    return;
  }
  socket.binaryType = 'arraybuffer';
  _activeSockets.set(wsId, { socket, port, url });

  port.postMessage({ type: 'WS_STATE', wsId, state: 'connecting', detail: url });

  socket.onopen = () => {
    port.postMessage({ type: 'WS_STATE', wsId, state: 'open', detail: url });
  };
  socket.onmessage = (event) => {
    let data;
    let binary;
    if (typeof event.data === 'string') {
      data = event.data;
    } else {
      const bytes = new Uint8Array(event.data);
      data = new TextDecoder('utf-8').decode(bytes);
      binary = bytes.length;
    }
    port.postMessage({
      type: 'WS_MESSAGE',
      wsId,
      message: {
        id: `wsmsg:${Date.now().toString(36)}:${Math.random().toString(36).slice(2, 8)}`,
        direction: 'in',
        data,
        binary,
        timestamp: Date.now(),
      },
    });
  };
  socket.onerror = () => {
    port.postMessage({ type: 'WS_STATE', wsId, state: 'error', detail: '连接错误' });
  };
  socket.onclose = (event) => {
    _activeSockets.delete(wsId);
    port.postMessage({
      type: 'WS_STATE',
      wsId,
      state: 'closed',
      detail: `code=${event.code}${event.reason ? ` ${event.reason}` : ''}${event.wasClean ? '' : '（异常断开）'}`,
    });
  };
}

function closeWebSocket(wsId, code, reason) {
  const record = _activeSockets.get(wsId);
  if (!record) return;
  _activeSockets.delete(wsId);
  try {
    record.socket.onclose = null;
    record.socket.close(code, reason);
  } catch (err) {
    // 忽略已关闭/正在关闭的 socket
  }
  try {
    record.port.postMessage({ type: 'WS_STATE', wsId, state: 'closed', detail: '已手动关闭' });
  } catch (err) {
    // 端口已断开
  }
}

chrome.runtime.onMessage.addListener((message, sender, sendResponse) => {
  if (message.type === 'API_REQUEST') {
    handleApiRequest(message.data)
      .then(result => sendResponse({ success: true, data: result }))
      .catch(err => sendResponse({ success: false, error: err.message }));
    return true; // 保持消息通道开启（异步响应）
  }

  if (message.type === 'STREAMING_REQUEST') {
    handleStreamingRequest(message.data, sender.tab?.id || 0)
      .then(() => sendResponse({ success: true }))
      .catch(err => sendResponse({ success: false, error: err.message }));
    return true;
  }

  if (message.type === 'CANCEL_STREAMING' || message.type === 'CANCEL_STREAM') {
    const streamId = message.streamId;
    if (streamId && _activeStreams.has(streamId)) {
      const controller = _activeStreams.get(streamId);
      try { controller.abort(); } catch(e) {}
      _activeStreams.delete(streamId);
    }
    sendResponse({ success: true });
    return false;
  }

  if (message.type === 'DOWNLOAD_REQUEST') {
    handleDownloadRequest(message.data)
      .then(result => sendResponse({ success: true, data: result }))
      .catch(err => sendResponse({ success: false, error: err.message }));
    return true;
  }

  if (message.type === 'STORE_PENDING_IMPORT') {
    storePendingImport(message.data, sender)
      .then(result => sendResponse({ success: true, data: result }))
      .catch(err => sendResponse({ success: false, error: err.message }));
    return true;
  }

  if (message.type === 'GET_PENDING_IMPORT') {
    getPendingImport()
      .then(result => sendResponse({ success: true, data: result }))
      .catch(err => sendResponse({ success: false, error: err.message }));
    return true;
  }

  if (message.type === 'CLEAR_PENDING_IMPORT') {
    chrome.storage.local.remove(PENDING_IMPORT_KEY, () => sendResponse({ success: true }));
    return true;
  }

  if (message.type === 'OPEN_SIDE_PANEL') {
    openSidePanelForSender(sender)
      .then(() => sendResponse({ success: true }))
      .catch(err => sendResponse({ success: false, error: err.message }));
    return true;
  }

  if (message.type === 'OPEN_FULL_PAGE') {
    openFullPage(message.importId)
      .then(tab => sendResponse({ success: true, data: { tabId: tab?.id } }))
      .catch(err => sendResponse({ success: false, error: err.message }));
    return true;
  }

  if (message.type === 'GET_RECENT_WEB_REQUESTS') {
    getRecentWebRequests()
      .then(result => sendResponse({ success: true, data: result }))
      .catch(err => sendResponse({ success: false, error: err.message }));
    return true;
  }

  if (message.type === 'APIFIX_STATE_CHANGED' || message.type === 'APIFIX_EDITOR_ACTIVITY') {
    if (!message.relayedByBackground) {
      chrome.runtime.sendMessage({ ...message, relayedByBackground: true }).catch(() => {});
    }
    sendResponse({ success: true });
    return false;
  }

  if (message.type === 'TRIGGER_DATA_SOURCE_SYNC' || message.type === 'APIFIX_TRIGGER_DATASOURCE_SYNC') {
    chrome.runtime.sendMessage({ type: 'APIFIX_TRIGGER_DATASOURCE_SYNC', moduleId: message.moduleId || null, secret: message.secret || '' }).catch(() => {});
    sendResponse({ success: true });
    return false;
  }

  if (message.type === 'CANCEL_REQUEST') {
    // 预留：取消请求
    sendResponse({ success: true });
    return false;
  }
});


chrome.runtime.onMessageExternal?.addListener((message, _sender, sendResponse) => {
  if (message?.type === 'TRIGGER_DATA_SOURCE_SYNC' || message?.type === 'APIFIX_TRIGGER_DATASOURCE_SYNC') {
    chrome.runtime.sendMessage({ type: 'APIFIX_TRIGGER_DATASOURCE_SYNC', moduleId: message.moduleId || null, secret: message.secret || '' }).catch(() => {});
    sendResponse({ success: true });
    return false;
  }
  sendResponse({ success: false, error: 'Unsupported message type' });
  return false;
});

chrome.contextMenus?.onClicked.addListener(async (info, tab) => {
  if (info.menuItemId === CONTEXT_MENU_IDS.openFullPage) {
    await openFullPage();
    return;
  }

  if (info.menuItemId === CONTEXT_MENU_IDS.openSidePanel) {
    await openSidePanelForTab(tab);
    return;
  }

  if (info.menuItemId === CONTEXT_MENU_IDS.sendSelectionToSidePanel) {
    const context = await collectPageContext(tab, info.selectionText || '', 'selection');
    await storePendingImport({ source: 'context-menu-selection', context }, { tab });
    await openSidePanelForTab(tab);
    return;
  }

  if (info.menuItemId === CONTEXT_MENU_IDS.formatSelectionJson) {
    const context = await collectPageContext(tab, info.selectionText || '', 'selection-json-format');
    if (context?.isJson) {
      await storePendingImport({ source: 'context-menu-json-format', context }, { tab });
      if (tab?.id) {
        await chrome.tabs.sendMessage(tab.id, {
          type: 'APIFIX_FORMAT_SELECTION',
          selectionText: info.selectionText || '',
        }).catch(() => null);
      }
      await openSidePanelForTab(tab);
      return;
    }
    if (tab?.id) {
      await chrome.tabs.sendMessage(tab.id, {
        type: 'APIFIX_FORMAT_SELECTION',
        selectionText: info.selectionText || '',
      }).catch(() => null);
    }
    return;
  }

  if (info.menuItemId === CONTEXT_MENU_IDS.sendPageToSidePanel) {
    const context = await collectPageContext(tab, '', 'page');
    await storePendingImport({ source: 'context-menu-page', context }, { tab });
    await openSidePanelForTab(tab);
  }
});

chrome.commands?.onCommand.addListener(async (command) => {
  if (command === 'open-full-page') {
    await openFullPage();
    return;
  }

  if (command === 'open-side-panel') {
    const [tab] = await chrome.tabs.query({ active: true, currentWindow: true });
    await openSidePanelForTab(tab);
    return;
  }

  if (command === 'open-popup') {
    await openPopupPage();
  }
});

chrome.webRequest?.onBeforeRequest.addListener(
  details => {
    if (details.type === 'main_frame' || details.url.startsWith('chrome-extension://')) return;
    upsertRecentWebRequest(details.requestId, {
      requestId: details.requestId,
      tabId: details.tabId,
      method: details.method,
      url: details.url,
      type: details.type,
      startedAt: Date.now(),
    });
  },
  { urls: ['<all_urls>'] },
  ['requestBody']
);

chrome.webRequest?.onBeforeSendHeaders.addListener(
  details => {
    upsertRecentWebRequest(details.requestId, {
      requestHeaders: normalizeChromeHeaders(details.requestHeaders || []),
    });
  },
  { urls: ['<all_urls>'] },
  ['requestHeaders', 'extraHeaders']
);

chrome.webRequest?.onCompleted.addListener(
  details => {
    upsertRecentWebRequest(details.requestId, {
      statusCode: details.statusCode,
      statusLine: details.statusLine,
      completedAt: Date.now(),
      fromCache: details.fromCache,
      responseHeaders: normalizeChromeHeaders(details.responseHeaders || []),
    });
  },
  { urls: ['<all_urls>'] },
  ['responseHeaders', 'extraHeaders']
);

chrome.webRequest?.onErrorOccurred.addListener(
  details => {
    upsertRecentWebRequest(details.requestId, {
      error: details.error,
      completedAt: Date.now(),
    });
  },
  { urls: ['<all_urls>'] }
);

function createContextMenus() {
  if (!chrome.contextMenus) return;
  chrome.contextMenus.removeAll(() => {
    chrome.contextMenus.create({
      id: CONTEXT_MENU_IDS.sendSelectionToSidePanel,
      title: '发送选中文本到 ApiFix 侧边栏',
      contexts: ['selection'],
    });
    chrome.contextMenus.create({
      id: CONTEXT_MENU_IDS.formatSelectionJson,
      title: '发送选中 JSON 到 Side Panel 格式化',
      contexts: ['selection'],
    });
    chrome.contextMenus.create({
      id: CONTEXT_MENU_IDS.sendPageToSidePanel,
      title: '发送当前页面上下文到 ApiFix',
      contexts: ['page'],
    });
    chrome.contextMenus.create({
      id: CONTEXT_MENU_IDS.openSidePanel,
      title: '打开 ApiFix 侧边栏',
      contexts: ['action', 'page'],
    });
    chrome.contextMenus.create({
      id: CONTEXT_MENU_IDS.openFullPage,
      title: '打开 ApiFix 全屏页',
      contexts: ['action', 'page'],
    });
  });
}

async function collectPageContext(tab, fallbackSelection, mode) {
  const fallbackJson = parseJsonCandidate(fallbackSelection || '');
  const base = {
    mode,
    selectionText: fallbackSelection || '',
    text: fallbackSelection || '',
    json: fallbackJson.ok ? fallbackJson.value : null,
    isJson: fallbackJson.ok,
    pageUrl: tab?.url || '',
    pageTitle: tab?.title || '',
    capturedAt: Date.now(),
  };

  if (!tab?.id) return base;

  try {
    const response = await chrome.tabs.sendMessage(tab.id, {
      type: 'APIFIX_COLLECT_PAGE_CONTEXT',
      mode,
      selectionText: fallbackSelection || '',
    });
    return { ...base, ...(response?.data || response || {}) };
  } catch (err) {
    return base;
  }
}

function parseJsonCandidate(text) {
  const value = String(text || '').trim();
  if (!value || (!value.startsWith('{') && !value.startsWith('['))) return { ok: false };
  try {
    return { ok: true, value: JSON.parse(value) };
  } catch (_err) {
    return { ok: false };
  }
}

async function storePendingImport(data, sender = {}) {
  const pendingImport = normalizePendingImport(data, sender);
  await chrome.storage.local.set({ [PENDING_IMPORT_KEY]: pendingImport });
  chrome.runtime.sendMessage({ type: 'PENDING_IMPORT_UPDATED', data: pendingImport }).catch(() => {});
  return pendingImport;
}

async function getPendingImport() {
  const result = await chrome.storage.local.get(PENDING_IMPORT_KEY);
  return result[PENDING_IMPORT_KEY] || null;
}

function normalizePendingImport(data = {}, sender = {}) {
  const tab = sender.tab || data.tab || null;
  return {
    id: data.id || `import_${Date.now()}_${Math.random().toString(36).slice(2, 8)}`,
    source: data.source || 'extension',
    createdAt: Date.now(),
    tab: tab ? {
      id: tab.id,
      url: tab.url,
      title: tab.title,
      windowId: tab.windowId,
    } : undefined,
    request: data.request || null,
    context: data.context || null,
    raw: data.raw || null,
  };
}

async function openSidePanelForSender(sender) {
  if (sender?.tab) return openSidePanelForTab(sender.tab);
  const [tab] = await chrome.tabs.query({ active: true, currentWindow: true });
  return openSidePanelForTab(tab);
}

async function openSidePanelForTab(tab) {
  if (!tab?.windowId) throw new Error('未找到可打开侧边栏的窗口');
  await chrome.sidePanel.open({ windowId: tab.windowId });
}

async function focusExistingExtensionPage(path) {
  const baseUrl = chrome.runtime.getURL(path);
  const tabs = await chrome.tabs.query({ url: `${baseUrl}*` });
  const tab = tabs[0];
  if (!tab?.id) return null;
  if (tab.windowId) await chrome.windows.update(tab.windowId, { focused: true }).catch(() => null);
  await chrome.tabs.update(tab.id, { active: true }).catch(() => null);
  return tab;
}

async function openOrFocusExtensionPage(path, query = '') {
  if (!query) {
    const existing = await focusExistingExtensionPage(path);
    if (existing) return existing;
  }
  return chrome.tabs.create({ url: chrome.runtime.getURL(`${path}${query}`) });
}

async function openPopupPage() {
  if (chrome.action?.openPopup) {
    try {
      await chrome.action.openPopup();
      return null;
    } catch (err) {
      // Fall back to a regular extension tab when the browser disallows programmatic popup opening.
    }
  }
  return openOrFocusExtensionPage('popup.html');
}

async function openFullPage(importId) {
  const suffix = importId ? `?pendingImport=${encodeURIComponent(importId)}` : '';
  return openOrFocusExtensionPage('main.html', suffix);
}

function normalizeChromeHeaders(headers) {
  return headers.map(header => ({
    key: header.name || header.key || '',
    value: header.value || '',
  })).filter(header => header.key);
}


async function getCookieHeaderForUrl(url) {
  if (!chrome.cookies?.getAll) return '';
  try {
    const cookies = await chrome.cookies.getAll({ url });
    return cookies.map(cookie => `${cookie.name}=${cookie.value}`).join('; ');
  } catch (err) {
    return '';
  }
}

async function applyBrowserCookies(fetchOptions, url, autoCarryCookies) {
  if (!autoCarryCookies) return;
  const cookieHeader = await getCookieHeaderForUrl(url);
  if (!cookieHeader) return;
  const existing = fetchOptions.headers.Cookie || fetchOptions.headers.cookie;
  fetchOptions.headers.Cookie = existing ? `${existing}; ${cookieHeader}` : cookieHeader;
}

function upsertRecentWebRequest(requestId, patch) {
  if (!requestId) return;
  const previous = _recentWebRequests.get(requestId) || { requestId };
  const next = { ...previous, ...patch, updatedAt: Date.now() };
  _recentWebRequests.set(requestId, next);

  const sorted = [..._recentWebRequests.values()]
    .sort((a, b) => (b.updatedAt || 0) - (a.updatedAt || 0));
  if (sorted.length > MAX_RECENT_WEB_REQUESTS) {
    for (const item of sorted.slice(MAX_RECENT_WEB_REQUESTS)) {
      _recentWebRequests.delete(item.requestId);
    }
  }

  chrome.storage.local.set({ [RECENT_WEB_REQUESTS_KEY]: sorted.slice(0, MAX_RECENT_WEB_REQUESTS) }).catch(() => {});
}

async function getRecentWebRequests() {
  const memoryItems = [..._recentWebRequests.values()]
    .sort((a, b) => (b.updatedAt || 0) - (a.updatedAt || 0));
  if (memoryItems.length) return memoryItems;
  const stored = await chrome.storage.local.get(RECENT_WEB_REQUESTS_KEY);
  return stored[RECENT_WEB_REQUESTS_KEY] || [];
}


function isBinaryContentType(contentType) {
  const ct = String(contentType || '').toLowerCase();
  return ct.includes('application/octet-stream') ||
    ct.includes('application/pdf') ||
    ct.includes('image/') ||
    ct.includes('audio/') ||
    ct.includes('video/') ||
    ct.includes('font/') ||
    ct.includes('application/zip') ||
    ct.includes('application/gzip') ||
    ct.includes('application/x-');
}

function arrayBufferToBase64(arrayBuffer) {
  const bytes = new Uint8Array(arrayBuffer);
  const chunkSize = 0x8000;
  const chunks = [];
  for (let i = 0; i < bytes.length; i += chunkSize) {
    chunks.push(String.fromCharCode(...bytes.subarray(i, i + chunkSize)));
  }
  return btoa(chunks.join(''));
}

// --- MD5 implementation (inline, no external dependency) ---
function md5(input) {
  function safeAdd(x, y) {
    const lsw = (x & 0xffff) + (y & 0xffff);
    const msw = (x >> 16) + (y >> 16) + (lsw >> 16);
    return (msw << 16) | (lsw & 0xffff);
  }
  function bitRotateLeft(num, cnt) {
    return (num << cnt) | (num >>> (32 - cnt));
  }
  function md5cmn(q, a, b, x, s, t) {
    return safeAdd(bitRotateLeft(safeAdd(safeAdd(a, q), safeAdd(x, t)), s), b);
  }
  function md5ff(a, b, c, d, x, s, t) { return md5cmn((b & c) | (~b & d), a, b, x, s, t); }
  function md5gg(a, b, c, d, x, s, t) { return md5cmn((b & d) | (c & ~d), a, b, x, s, t); }
  function md5hh(a, b, c, d, x, s, t) { return md5cmn(b ^ c ^ d, a, b, x, s, t); }
  function md5ii(a, b, c, d, x, s, t) { return md5cmn(c ^ (b | ~d), a, b, x, s, t); }
  function binlMD5(x, len) {
    x[len >> 5] |= 0x80 << (len % 32);
    x[(((len + 64) >>> 9) << 4) + 14] = len;
    let a = 1732584193, b = -271733879, c = -1732584194, d = 271733878;
    for (let i = 0; i < x.length; i += 16) {
      const olda = a, oldb = b, oldc = c, oldd = d;
      a=md5ff(a,b,c,d,x[i],7,-680876936);d=md5ff(d,a,b,c,x[i+1],12,-389564586);
      c=md5ff(c,d,a,b,x[i+2],17,606105819);b=md5ff(b,c,d,a,x[i+3],22,-1044525330);
      a=md5ff(a,b,c,d,x[i+4],7,-176418897);d=md5ff(d,a,b,c,x[i+5],12,1200080426);
      c=md5ff(c,d,a,b,x[i+6],17,-1473231341);b=md5ff(b,c,d,a,x[i+7],22,-45705983);
      a=md5ff(a,b,c,d,x[i+8],7,1770035416);d=md5ff(d,a,b,c,x[i+9],12,-1958414417);
      c=md5ff(c,d,a,b,x[i+10],17,-42063);b=md5ff(b,c,d,a,x[i+11],22,-1990404162);
      a=md5ff(a,b,c,d,x[i+12],7,1804603682);d=md5ff(d,a,b,c,x[i+13],12,-40341101);
      c=md5ff(c,d,a,b,x[i+14],17,-1502002290);b=md5ff(b,c,d,a,x[i+15],22,1236535329);
      a=md5gg(a,b,c,d,x[i+1],5,-165796510);d=md5gg(d,a,b,c,x[i+6],9,-1069501632);
      c=md5gg(c,d,a,b,x[i+11],14,643717713);b=md5gg(b,c,d,a,x[i],20,-373897302);
      a=md5gg(a,b,c,d,x[i+5],5,-701558691);d=md5gg(d,a,b,c,x[i+10],9,38016083);
      c=md5gg(c,d,a,b,x[i+15],14,-660478335);b=md5gg(b,c,d,a,x[i+4],20,-405537848);
      a=md5gg(a,b,c,d,x[i+9],5,568446438);d=md5gg(d,a,b,c,x[i+14],9,-1019803690);
      c=md5gg(c,d,a,b,x[i+3],14,-187363961);b=md5gg(b,c,d,a,x[i+8],20,1163531501);
      a=md5gg(a,b,c,d,x[i+13],5,-1444681467);d=md5gg(d,a,b,c,x[i+2],9,-51403784);
      c=md5gg(c,d,a,b,x[i+7],14,1735328473);b=md5gg(b,c,d,a,x[i+12],20,-1926607734);
      a=md5hh(a,b,c,d,x[i+5],4,-378558);d=md5hh(d,a,b,c,x[i+8],11,-2022574463);
      c=md5hh(c,d,a,b,x[i+11],16,1839030562);b=md5hh(b,c,d,a,x[i+14],23,-35309556);
      a=md5hh(a,b,c,d,x[i+1],4,-1530992060);d=md5hh(d,a,b,c,x[i+4],11,1272893353);
      c=md5hh(c,d,a,b,x[i+7],16,-155497632);b=md5hh(b,c,d,a,x[i+10],23,-1094730640);
      a=md5hh(a,b,c,d,x[i+13],4,681279174);d=md5hh(d,a,b,c,x[i],11,-358537222);
      c=md5hh(c,d,a,b,x[i+3],16,-722521979);b=md5hh(b,c,d,a,x[i+6],23,76029189);
      a=md5hh(a,b,c,d,x[i+9],4,-640364487);d=md5hh(d,a,b,c,x[i+12],11,-421815835);
      c=md5hh(c,d,a,b,x[i+15],16,530742520);b=md5hh(b,c,d,a,x[i+2],23,-995338651);
      a=md5ii(a,b,c,d,x[i],6,-198630844);d=md5ii(d,a,b,c,x[i+7],10,1126891415);
      c=md5ii(c,d,a,b,x[i+14],15,-1416354905);b=md5ii(b,c,d,a,x[i+5],21,-57434055);
      a=md5ii(a,b,c,d,x[i+12],6,1700485571);d=md5ii(d,a,b,c,x[i+3],10,-1894986606);
      c=md5ii(c,d,a,b,x[i+10],15,-1051523);b=md5ii(b,c,d,a,x[i+1],21,-2054922799);
      a=md5ii(a,b,c,d,x[i+8],6,1873313359);d=md5ii(d,a,b,c,x[i+15],10,-30611744);
      c=md5ii(c,d,a,b,x[i+6],15,-1560198380);b=md5ii(b,c,d,a,x[i+13],21,1309151649);
      a=md5ii(a,b,c,d,x[i+4],6,-145523070);d=md5ii(d,a,b,c,x[i+11],10,-1120210379);
      c=md5ii(c,d,a,b,x[i+2],15,718787259);b=md5ii(b,c,d,a,x[i+9],21,-343485551);
      a=safeAdd(a,olda);b=safeAdd(b,oldb);c=safeAdd(c,oldc);d=safeAdd(d,oldd);
    }
    return [a, b, c, d];
  }
  function str2binl(str) {
    const bin = [];
    const mask = (1 << 8) - 1;
    for (let i = 0; i < str.length * 8; i += 8) {
      bin[i >> 5] |= (str.charCodeAt(i / 8) & mask) << (i % 32);
    }
    return bin;
  }
  function binl2hex(binarray) {
    const hexTab = '0123456789abcdef';
    let str = '';
    for (let i = 0; i < binarray.length * 4; i++) {
      str += hexTab.charAt((binarray[i >> 2] >> ((i % 4) * 8 + 4)) & 0xf) +
             hexTab.charAt((binarray[i >> 2] >> ((i % 4) * 8)) & 0xf);
    }
    return str;
  }
  const utf8 = unescape(encodeURIComponent(input));
  return binl2hex(binlMD5(str2binl(utf8), utf8.length * 8));
}

function parseDigestChallenge(wwwAuth) {
  const digestMatch = wwwAuth.match(/^Digest\s+(.+)$/i);
  if (!digestMatch) return null;
  const params = digestMatch[1];
  const result = {};
  const regex = /(\w+)=(?:"([^"]+)"|([\w/+=]+))/g;
  let match;
  while ((match = regex.exec(params)) !== null) {
    const key = match[1];
    const value = match[2] || match[3];
    if (key === 'realm' || key === 'nonce' || key === 'qop' || key === 'algorithm' || key === 'opaque') {
      result[key] = value;
    }
  }
  return result;
}

function generateCnonce() {
  const chars = 'abcdef0123456789';
  let result = '';
  for (let i = 0; i < 16; i++) {
    result += chars.charAt(Math.floor(Math.random() * chars.length));
  }
  return result;
}

function buildDigestAuthHeader(challenge, username, password, method, uri) {
  const realm = challenge.realm || '';
  const nonce = challenge.nonce || '';
  const qop = challenge.qop;
  const opaque = challenge.opaque;
  const algorithm = (challenge.algorithm || 'MD5').toUpperCase();
  const nc = 1;
  const cnonce = generateCnonce();

  let ha1;
  if (algorithm === 'MD5-SESS') {
    ha1 = md5(md5(username + ':' + realm + ':' + password) + ':' + cnonce);
  } else {
    ha1 = md5(username + ':' + realm + ':' + password);
  }
  const ha2 = md5(method + ':' + uri);

  let response;
  if (qop) {
    const qopValue = qop.split(',').map(s => s.trim()).includes('auth') ? 'auth' : qop.split(',')[0].trim();
    const ncStr = nc.toString().padStart(8, '0');
    response = md5(ha1 + ':' + nonce + ':' + ncStr + ':' + cnonce + ':' + qopValue + ':' + ha2);
    let header = 'Digest username="' + username + '", realm="' + realm + '", nonce="' + nonce + '", uri="' + uri + '", qop=' + qopValue + ', nc=' + ncStr + ', cnonce="' + cnonce + '", response="' + response + '"';
    if (opaque) header += ', opaque="' + opaque + '"';
    if (algorithm !== 'MD5') header += ', algorithm=' + algorithm;
    return header;
  } else {
    response = md5(ha1 + ':' + nonce + ':' + ha2);
    let header = 'Digest username="' + username + '", realm="' + realm + '", nonce="' + nonce + '", uri="' + uri + '", response="' + response + '"';
    if (opaque) header += ', opaque="' + opaque + '"';
    if (algorithm !== 'MD5') header += ', algorithm=' + algorithm;
    return header;
  }
}

function dataUrlToBytes(dataUrl) {
  const parts = dataUrl.split(',');
  const b64 = atob(parts[1]);
  const bytes = new Uint8Array(b64.length);
  for (let i = 0; i < b64.length; i++) {
    bytes[i] = b64.charCodeAt(i);
  }
  return bytes;
}

function dataUrlToMime(dataUrl) {
  const mimeMatch = dataUrl.split(',')[0].match(/:(.*?);/);
  return mimeMatch ? mimeMatch[1] : 'application/octet-stream';
}

function buildFormdataBody(formdataFields, boundary) {
  const parts = [];
  for (const field of formdataFields) {
    if (field.enabled && field.key.trim()) {
      if (field.type === 'file' && field.value && field.value.startsWith('data:')) {
        const bytes = dataUrlToBytes(field.value);
        const fileName = field.fileName || 'file';
        // For binary file parts, we store as a placeholder string since
        // service workers cannot easily mix binary and text in multipart.
        // We use a Uint8Array marker approach: encode the binary as base64
        // and mark it so the fetch body can be reconstructed.
        // However, since we're building as string, we'll use base64 encoding
        // within the multipart body with a transfer encoding marker.
        const b64 = btoa(String.fromCharCode(...bytes));
        parts.push(
          `--${boundary}\r\nContent-Disposition: form-data; name="${field.key}"; filename="${fileName}"\r\nContent-Type: ${dataUrlToMime(field.value)}\r\nContent-Transfer-Encoding: base64\r\n\r\n${b64}`
        );
      } else {
        parts.push(
          `--${boundary}\r\nContent-Disposition: form-data; name="${field.key}"\r\n\r\n${field.value}`
        );
      }
    }
  }
  parts.push(`--${boundary}--`);
  return parts.join('\r\n');
}

async function handleApiRequest(data) {
  const { method, url, headers, body, bodyType, autoCarryCookies, timeoutMs, followRedirects, auth } = data;

  const fetchOptions = {
    method: method,
    headers: headers || {},
    redirect: followRedirects === false ? 'manual' : 'follow',
  };
  await applyBrowserCookies(fetchOptions, url, autoCarryCookies);

  // 设置body
  if (body && !['GET', 'HEAD'].includes(method)) {
    if (bodyType === 'formdata') {
      // FormData 不能直接在 service worker 中使用，需要手动构建
      const boundary = '----FormBoundary' + Math.random().toString(36).substring(2);

      if (data.formdataFields) {
        fetchOptions.body = buildFormdataBody(data.formdataFields, boundary);
      }
      fetchOptions.headers['Content-Type'] = `multipart/form-data; boundary=${boundary}`;
    } else {
      fetchOptions.body = body;
    }
  }

  const startTime = performance.now();
  const controller = typeof AbortController !== 'undefined' && timeoutMs && timeoutMs > 0 ? new AbortController() : null;
  let timeoutId;
  if (controller) {
    fetchOptions.signal = controller.signal;
    timeoutId = setTimeout(() => controller.abort(), timeoutMs);
  }

  try {
    let response = await fetch(url, fetchOptions);

    // Digest Auth: handle 401 with WWW-Authenticate: Digest challenge
    if (response.status === 401 && auth && auth.type === 'digest' && auth.digestUsername) {
      const wwwAuth = response.headers.get('www-authenticate') || '';
      const challenge = parseDigestChallenge(wwwAuth);
      if (challenge && challenge.nonce) {
        let uri;
        try {
          const urlObj = new URL(url);
          uri = urlObj.pathname + urlObj.search;
        } catch (e) {
          uri = '/';
        }
        const digestHeader = buildDigestAuthHeader(
          challenge,
          auth.digestUsername,
          auth.digestPassword,
          method,
          uri || '/',
        );
        fetchOptions.headers['Authorization'] = digestHeader;

        // Rebuild body for retry (body stream is consumed)
        const retryOptions = { ...fetchOptions };
        if (body && !['GET', 'HEAD'].includes(method)) {
          if (bodyType === 'formdata') {
            retryOptions.body = fetchOptions.body;
          } else {
            retryOptions.body = body;
          }
        }
        if (controller) retryOptions.signal = controller.signal;
        response = await fetch(url, retryOptions);
      }
    }

    if (timeoutId) clearTimeout(timeoutId);
    const endTime = performance.now();
    const duration = Math.round(endTime - startTime);

    // 获取响应头
    const respHeaders = [];
    response.headers.forEach((value, key) => {
      respHeaders.push({ key, value });
    });

    // 获取响应体
    const contentType = response.headers.get('content-type') || '';
    let responseText = '';
    let bodyEncoding = 'text';
    let size = 0;
    let isJson = false;

    if (isBinaryContentType(contentType)) {
      const arrayBuffer = await response.arrayBuffer();
      responseText = arrayBufferToBase64(arrayBuffer);
      bodyEncoding = 'base64';
      size = arrayBuffer.byteLength;
    } else if (contentType.includes('json') || contentType.includes('javascript')) {
      try {
        const json = await response.json();
        responseText = JSON.stringify(json, null, 2);
        isJson = true;
      } catch (e) {
        responseText = await response.text();
      }
    } else {
      responseText = await response.text();
    }

    // 尝试将非JSON响应解析为JSON
    if (bodyEncoding === 'text' && !isJson && responseText) {
      try {
        const json = JSON.parse(responseText);
        responseText = JSON.stringify(json, null, 2);
        isJson = true;
      } catch (e) {}
    }

    if (bodyEncoding === 'text') size = new Blob([responseText]).size;

    return {
      status: response.status,
      statusText: response.statusText,
      headers: respHeaders,
      body: responseText,
      bodyEncoding,
      contentType: contentType,
      duration: duration,
      size: size,
    };
  } catch (err) {
    if (timeoutId) clearTimeout(timeoutId);
    const endTime = performance.now();
    const timeoutSuffix = err?.name === 'AbortError' ? `（超时 ${timeoutMs}ms）` : '';
    throw new Error(`请求失败${timeoutSuffix}: ${err.message}`);
  }
}

async function handleStreamingRequest(data, tabId) {
  const { method, url, headers, body, bodyType, streamId, autoCarryCookies } = data;

  const fetchOptions = {
    method: method,
    headers: headers || {},
  };
  await applyBrowserCookies(fetchOptions, url, autoCarryCookies);

  // 设置body（与普通请求相同逻辑）
  if (body && !['GET', 'HEAD'].includes(method)) {
    if (bodyType === 'formdata') {
      const boundary = '----FormBoundary' + Math.random().toString(36).substring(2);
      if (data.formdataFields) {
        fetchOptions.body = buildFormdataBody(data.formdataFields, boundary);
      }
      fetchOptions.headers['Content-Type'] = `multipart/form-data; boundary=${boundary}`;
    } else {
      fetchOptions.body = body;
    }
  }

  const controller = new AbortController();
  _activeStreams.set(streamId, controller);
  fetchOptions.signal = controller.signal;

  const startTime = performance.now();

  try {
    const response = await fetch(url, fetchOptions);

    // 获取响应头
    const respHeaders = [];
    response.headers.forEach((value, key) => {
      respHeaders.push({ key, value });
    });

    const contentType = response.headers.get('content-type') || '';

    // 发送初始响应信息（状态码、响应头）
    chrome.runtime.sendMessage({
      type: 'STREAM_CHUNK',
      streamId,
      phase: 'headers',
      data: {
        status: response.status,
        statusText: response.statusText,
        headers: respHeaders,
        contentType,
        duration: Math.round(performance.now() - startTime),
      }
    }).catch(() => {});

    // 读取响应体流
    const reader = response.body.getReader();
    const decoder = new TextDecoder('utf-8');
    let fullBody = '';
    let totalSize = 0;

    while (true) {
      const { done, value } = await reader.read();
      if (done) break;

      totalSize += value.length;
      const chunk = decoder.decode(value, { stream: true });
      fullBody += chunk;

      // 发送数据块
      chrome.runtime.sendMessage({
        type: 'STREAM_CHUNK',
        streamId,
        phase: 'body',
        data: {
          chunk,
          totalSize,
        }
      }).catch(() => {});
    }

    // 尝试格式化完整JSON
    let formattedBody = fullBody;
    try {
      const json = JSON.parse(fullBody);
      formattedBody = JSON.stringify(json, null, 2);
    } catch (e) {}

    // 发送完成消息
    chrome.runtime.sendMessage({
      type: 'STREAM_CHUNK',
      streamId,
      phase: 'done',
      data: {
        body: formattedBody !== fullBody ? formattedBody : fullBody,
        size: new Blob([fullBody]).size,
        isFormatted: formattedBody !== fullBody,
      }
    }).catch(() => {});

  } catch (err) {
    if (err.name === 'AbortError') {
      chrome.runtime.sendMessage({
        type: 'STREAM_CHUNK',
        streamId,
        phase: 'aborted',
        data: { error: '请求已取消' }
      }).catch(() => {});
    } else {
      chrome.runtime.sendMessage({
        type: 'STREAM_CHUNK',
        streamId,
        phase: 'error',
        data: { error: err.message }
      }).catch(() => {});
    }
  } finally {
    _activeStreams.delete(streamId);
  }
}

async function handleDownloadRequest(data) {
  const { method, url, headers, body, bodyType, autoCarryCookies } = data;

  const fetchOptions = {
    method: method,
    headers: headers || {},
  };
  await applyBrowserCookies(fetchOptions, url, autoCarryCookies);

  if (body && !['GET', 'HEAD'].includes(method)) {
    if (bodyType === 'formdata') {
      const boundary = '----FormBoundary' + Math.random().toString(36).substring(2);

      if (data.formdataFields) {
        fetchOptions.body = buildFormdataBody(data.formdataFields, boundary);
      }
      fetchOptions.headers['Content-Type'] = `multipart/form-data; boundary=${boundary}`;
    } else {
      fetchOptions.body = body;
    }
  }

  const response = await fetch(url, fetchOptions);

  if (!response.ok && response.status === 0) {
    throw new Error('网络请求失败');
  }

  // Determine filename from Content-Disposition
  const disposition = response.headers.get('content-disposition') || '';
  let filename = 'download';
  const filenameMatch = disposition.match(/filename[^;=\n]*=((['"]).*?\2|[^;\n]*)/);
  if (filenameMatch) filename = filenameMatch[1].replace(/['"]/g, '');
  else {
    try {
      const urlPath = new URL(url).pathname;
      const urlFile = urlPath.split('/').pop();
      if (urlFile && urlFile.includes('.')) filename = urlFile;
    } catch (e) {}
  }

  const contentType = response.headers.get('content-type') || 'application/octet-stream';

  // Read as ArrayBuffer and convert to base64
  const arrayBuffer = await response.arrayBuffer();
  const base64 = arrayBufferToBase64(arrayBuffer);

  return {
    base64,
    contentType,
    filename,
  };
}
