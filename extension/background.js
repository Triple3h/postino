/**
 * ApiFix Bin - Background Service Worker
 * 通过 chrome.runtime.sendMessage 处理来自popup的跨域请求
 */

chrome.runtime.onMessage.addListener((message, sender, sendResponse) => {
  if (message.type === 'API_REQUEST') {
    handleApiRequest(message.data)
      .then(result => sendResponse({ success: true, data: result }))
      .catch(err => sendResponse({ success: false, error: err.message }));
    return true; // 保持消息通道开启（异步响应）
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
