const MAX_REQUESTS = 100;

const requests = [];
let selectedId = null;

const listEl = document.getElementById('requestList');
const detailTitleEl = document.getElementById('detailTitle');
const detailPreEl = document.getElementById('detailPre');
const importBtn = document.getElementById('importBtn');
const clearBtn = document.getElementById('clearBtn');
const openBtn = document.getElementById('openBtn');
const sidePanelBtn = document.getElementById('sidePanelBtn');

chrome.devtools.network.onRequestFinished.addListener(entry => {
  const item = toRequestItem(entry);
  requests.unshift(item);
  if (requests.length > MAX_REQUESTS) requests.pop();
  renderList();
});

clearBtn.addEventListener('click', () => {
  requests.splice(0, requests.length);
  selectedId = null;
  renderList();
  renderDetail();
});

importBtn.addEventListener('click', async () => {
  const selected = getSelectedRequest();
  if (!selected) return;
  const withBody = await hydrateRequestBody(selected);
  chrome.runtime.sendMessage({
    type: 'STORE_PENDING_IMPORT',
    data: {
      source: 'devtools-network',
      request: withBody.request,
      raw: withBody,
    },
  }, response => {
    if (!response?.success) {
      setDetailMessage(`导入失败：${response?.error || chrome.runtime.lastError?.message || '未知错误'}`);
      return;
    }
    setDetailMessage(`已存入待导入队列：${withBody.request.method} ${withBody.request.url}`);
  });
});

openBtn.addEventListener('click', () => {
  chrome.runtime.sendMessage({ type: 'OPEN_FULL_PAGE' });
});

sidePanelBtn.addEventListener('click', () => {
  chrome.runtime.sendMessage({ type: 'OPEN_SIDE_PANEL' });
});

function toRequestItem(entry) {
  const request = entry.request || {};
  const response = entry.response || {};
  const id = `${Date.now()}_${Math.random().toString(36).slice(2, 8)}`;
  return {
    id,
    startedDateTime: entry.startedDateTime,
    time: entry.time,
    request: {
      method: request.method || 'GET',
      url: request.url || '',
      headers: normalizeHarHeaders(request.headers),
      queryString: request.queryString || [],
      postData: normalizePostData(request.postData),
    },
    response: {
      status: response.status,
      statusText: response.statusText,
      headers: normalizeHarHeaders(response.headers),
      content: response.content || null,
    },
    raw: entry,
  };
}

function normalizePostData(postData) {
  if (!postData) return null;
  return {
    mimeType: postData.mimeType || '',
    text: postData.text || '',
    params: postData.params || [],
  };
}

function normalizeHarHeaders(headers = []) {
  return headers.map(header => ({
    key: header.name || header.key || '',
    value: header.value || '',
  })).filter(header => header.key);
}

function renderList() {
  if (!requests.length) {
    listEl.innerHTML = '<div class="empty">打开页面并发起请求后会显示在这里。</div>';
    return;
  }

  listEl.textContent = '';
  for (const item of requests) {
    const row = document.createElement('div');
    row.className = `request${item.id === selectedId ? ' selected' : ''}`;
    row.addEventListener('click', () => {
      selectedId = item.id;
      renderList();
      renderDetail();
    });

    const method = document.createElement('div');
    method.className = 'method';
    method.textContent = item.request.method;

    const url = document.createElement('div');
    url.className = 'url';
    url.title = item.request.url;
    url.textContent = item.request.url;

    const status = document.createElement('div');
    const statusCode = Number(item.response.status || 0);
    status.className = `status ${statusCode >= 400 ? 'err' : 'ok'}`;
    status.textContent = statusCode || '-';

    const time = document.createElement('div');
    time.textContent = item.time != null ? `${Math.round(item.time)}ms` : '-';

    row.append(method, url, status, time);
    listEl.append(row);
  }
}

function renderDetail() {
  const selected = getSelectedRequest();
  importBtn.disabled = !selected;
  if (!selected) {
    detailTitleEl.textContent = '未选择请求';
    detailPreEl.textContent = '选择左侧请求查看可导入内容。';
    return;
  }

  detailTitleEl.textContent = `${selected.request.method} ${selected.request.url}`;
  detailPreEl.textContent = JSON.stringify({
    request: selected.request,
    response: selected.response,
    time: selected.time,
    startedDateTime: selected.startedDateTime,
  }, null, 2);
}

function getSelectedRequest() {
  return requests.find(item => item.id === selectedId) || null;
}

function hydrateRequestBody(item) {
  return new Promise(resolve => {
    const base = {
      id: item.id,
      startedDateTime: item.startedDateTime,
      time: item.time,
      request: item.request,
      response: item.response,
    };

    try {
      item.raw.getContent((body, encoding) => {
        resolve({
          ...base,
          responseBody: { body, encoding },
        });
      });
    } catch (_err) {
      resolve(base);
    }
  });
}

function setDetailMessage(message) {
  detailPreEl.textContent = `${message}\n\n${detailPreEl.textContent}`;
}

renderList();
renderDetail();
