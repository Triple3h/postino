/**
 * ApiFix Bin content bridge.
 * Collects page/selection context without touching app Vue components.
 */

const MAX_TEXT_LENGTH = 120000;
const MAX_META_TAGS = 30;

chrome.runtime.onMessage.addListener((message, _sender, sendResponse) => {
  if (message?.type === 'APIFIX_COLLECT_PAGE_CONTEXT') {
    sendResponse({ success: true, data: collectContext(message) });
    return false;
  }

  if (message?.type === 'APIFIX_SEND_SELECTION') {
    const context = collectContext({ mode: 'selection', selectionText: getSelectionText() });
    chrome.runtime.sendMessage({
      type: 'STORE_PENDING_IMPORT',
      data: { source: 'content-selection', context },
    }, response => sendResponse(response || { success: !chrome.runtime.lastError }));
    return true;
  }
});

window.addEventListener('message', event => {
  if (event.source !== window) return;
  const message = event.data;
  if (!message || message.source !== 'apifix-page' || message.type !== 'APIFIX_SEND_CONTEXT') return;

  const context = collectContext({
    mode: message.mode || 'page',
    selectionText: message.selectionText || getSelectionText(),
  });

  chrome.runtime.sendMessage({
    type: 'STORE_PENDING_IMPORT',
    data: {
      source: 'page-postmessage',
      context: { ...context, payload: safeClone(message.payload) },
    },
  });
});

function collectContext(options = {}) {
  const selectionText = trimText(options.selectionText || getSelectionText());
  const candidateText = selectionText || visibleJsonText() || '';
  const parsed = parseMaybeJson(candidateText);

  return {
    mode: options.mode || (selectionText ? 'selection' : 'page'),
    selectionText,
    text: trimText(candidateText),
    json: parsed.ok ? parsed.value : null,
    isJson: parsed.ok,
    pageUrl: location.href,
    pageTitle: document.title,
    contentType: document.contentType || '',
    meta: collectMeta(),
    capturedAt: Date.now(),
  };
}

function getSelectionText() {
  return window.getSelection?.().toString() || '';
}

function visibleJsonText() {
  const pre = document.querySelector('pre');
  if (pre?.innerText) return pre.innerText;

  const bodyText = document.body?.innerText || '';
  const trimmed = bodyText.trim();
  if ((trimmed.startsWith('{') && trimmed.endsWith('}')) || (trimmed.startsWith('[') && trimmed.endsWith(']'))) {
    return trimmed;
  }
  return '';
}

function parseMaybeJson(text) {
  const trimmed = (text || '').trim();
  if (!trimmed) return { ok: false };
  if (!trimmed.startsWith('{') && !trimmed.startsWith('[')) return { ok: false };
  try {
    return { ok: true, value: JSON.parse(trimmed) };
  } catch (_err) {
    return { ok: false };
  }
}

function collectMeta() {
  return [...document.querySelectorAll('meta')]
    .slice(0, MAX_META_TAGS)
    .map(meta => ({
      name: meta.getAttribute('name') || meta.getAttribute('property') || meta.getAttribute('http-equiv') || '',
      content: meta.getAttribute('content') || '',
    }))
    .filter(item => item.name || item.content);
}

function trimText(text) {
  const value = String(text || '');
  return value.length > MAX_TEXT_LENGTH ? value.slice(0, MAX_TEXT_LENGTH) : value;
}

function safeClone(value) {
  if (value == null) return null;
  try {
    return JSON.parse(JSON.stringify(value));
  } catch (_err) {
    return String(value);
  }
}
