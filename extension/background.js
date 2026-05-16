/**
 * ApiFix Bin - Background Service Worker
 * 通过 chrome.runtime.sendMessage 处理来自popup的跨域请求，并协调浏览器原生入口。
 */

// Active stream controllers for cancellation
const _activeStreams = new Map();
const _recentWebRequests = new Map();

const PENDING_IMPORT_KEY = 'apifix_pending_import';
const RECENT_WEB_REQUESTS_KEY = 'apifix_recent_web_requests';
const MAX_RECENT_WEB_REQUESTS = 50;

const CONTEXT_MENU_IDS = {
  sendSelectionToSidePanel: 'apifix-send-selection-sidepanel',
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

  if (message.type === 'CANCEL_REQUEST') {
    // 预留：取消请求
    sendResponse({ success: true });
    return false;
  }
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
    await chrome.tabs.create({ url: chrome.runtime.getURL('popup.html') });
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
  const base = {
    mode,
    selectionText: fallbackSelection || '',
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

async function openFullPage(importId) {
  const suffix = importId ? `?pendingImport=${encodeURIComponent(importId)}` : '';
  return chrome.tabs.create({ url: chrome.runtime.getURL(`main.html${suffix}`) });
}

function normalizeChromeHeaders(headers) {
  return headers.map(header => ({
    key: header.name || header.key || '',
    value: header.value || '',
  })).filter(header => header.key);
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

async function handleApiRequest(data) {
  const { method, url, headers, body, bodyType } = data;

  const fetchOptions = {
    method: method,
    headers: headers || {},
  };

  // 设置body
  if (body && !['GET', 'HEAD'].includes(method)) {
    if (bodyType === 'formdata') {
      // FormData 不能直接在 service worker 中使用，需要手动构建
      const formDataHeaders = {};
      const boundary = '----FormBoundary' + Math.random().toString(36).substring(2);
      const parts = [];

      if (data.formdataFields) {
        for (const field of data.formdataFields) {
          if (field.enabled && field.key.trim()) {
            parts.push(
              `--${boundary}\r\nContent-Disposition: form-data; name="${field.key}"\r\n\r\n${field.value}`
            );
          }
        }
      }
      parts.push(`--${boundary}--`);

      fetchOptions.body = parts.join('\r\n');
      fetchOptions.headers['Content-Type'] = `multipart/form-data; boundary=${boundary}`;
    } else {
      fetchOptions.body = body;
    }
  }

  const startTime = performance.now();

  try {
    const response = await fetch(url, fetchOptions);
    const endTime = performance.now();
    const duration = Math.round(endTime - startTime);

    // 获取响应头
    const respHeaders = [];
    response.headers.forEach((value, key) => {
      respHeaders.push({ key, value });
    });

    // 获取响应体
    const contentType = response.headers.get('content-type') || '';
    let responseText;
    let isJson = false;

    if (contentType.includes('json') || contentType.includes('javascript')) {
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
    if (!isJson && responseText) {
      try {
        const json = JSON.parse(responseText);
        responseText = JSON.stringify(json, null, 2);
        isJson = true;
      } catch (e) {}
    }

    const size = new Blob([responseText]).size;

    return {
      status: response.status,
      statusText: response.statusText,
      headers: respHeaders,
      body: responseText,
      contentType: contentType,
      duration: duration,
      size: size,
    };
  } catch (err) {
    const endTime = performance.now();
    throw new Error(`请求失败: ${err.message}`);
  }
}

async function handleStreamingRequest(data, tabId) {
  const { method, url, headers, body, bodyType, streamId } = data;

  const fetchOptions = {
    method: method,
    headers: headers || {},
  };

  // 设置body（与普通请求相同逻辑）
  if (body && !['GET', 'HEAD'].includes(method)) {
    if (bodyType === 'formdata') {
      const boundary = '----FormBoundary' + Math.random().toString(36).substring(2);
      const parts = [];
      if (data.formdataFields) {
        for (const field of data.formdataFields) {
          if (field.enabled && field.key.trim()) {
            parts.push(
              `--${boundary}\r\nContent-Disposition: form-data; name="${field.key}"\r\n\r\n${field.value}`
            );
          }
        }
      }
      parts.push(`--${boundary}--`);
      fetchOptions.body = parts.join('\r\n');
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
  const { method, url, headers, body, bodyType } = data;

  const fetchOptions = {
    method: method,
    headers: headers || {},
  };

  if (body && !['GET', 'HEAD'].includes(method)) {
    if (bodyType === 'formdata') {
      const formDataHeaders = {};
      const boundary = '----FormBoundary' + Math.random().toString(36).substring(2);
      const parts = [];

      if (data.formdataFields) {
        for (const field of data.formdataFields) {
          if (field.enabled && field.key.trim()) {
            parts.push(
              `--${boundary}\r\nContent-Disposition: form-data; name="${field.key}"\r\n\r\n${field.value}`
            );
          }
        }
      }
      parts.push(`--${boundary}--`);
      fetchOptions.body = parts.join('\r\n');
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
  const bytes = new Uint8Array(arrayBuffer);
  let binary = '';
  for (let i = 0; i < bytes.length; i++) {
    binary += String.fromCharCode(bytes[i]);
  }
  const base64 = btoa(binary);

  return {
    base64,
    contentType,
    filename,
  };
}
