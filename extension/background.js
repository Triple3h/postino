/**
 * ApiFix Bin - Background Service Worker
 * 通过 chrome.runtime.sendMessage 处理来自popup的跨域请求
 */

// Active stream controllers for cancellation
const _activeStreams = new Map();

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

  if (message.type === 'CANCEL_REQUEST') {
    // 预留：取消请求
    sendResponse({ success: true });
    return false;
  }
});

chrome.commands?.onCommand.addListener(async (command) => {
  if (command === 'open-full-page') {
    await chrome.tabs.create({ url: chrome.runtime.getURL('main.html') });
    return;
  }

  if (command === 'open-side-panel') {
    const [tab] = await chrome.tabs.query({ active: true, currentWindow: true });
    if (tab?.windowId != null) {
      await chrome.sidePanel.open({ windowId: tab.windowId });
    }
    return;
  }

  if (command === 'open-popup') {
    await chrome.tabs.create({ url: chrome.runtime.getURL('popup.html') });
  }
});

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
