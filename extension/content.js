/**
 * Postino content bridge.
 * Collects page/selection context without touching app Vue components.
 */

const MAX_TEXT_LENGTH = 120000;
const MAX_META_TAGS = 30;
let pendingInterfaceDrop = null;
let pendingDropTimer = null;
let dropOverlay = null;
let jsonFormatOverlay = null;
let acceptedDropToken = '';

chrome.runtime.onMessage.addListener((message, _sender, sendResponse) => {
  if (message?.type === 'POSTINO_COLLECT_PAGE_CONTEXT') {
    sendResponse({ success: true, data: collectContext(message) });
    return false;
  }

  if (message?.type === 'POSTINO_SEND_SELECTION') {
    const context = collectContext({ mode: 'selection', selectionText: getSelectionText() });
    chrome.runtime.sendMessage({
      type: 'STORE_PENDING_IMPORT',
      data: { source: 'content-selection', context },
    }, response => sendResponse(response || { success: !chrome.runtime.lastError }));
    return true;
  }

  if (message?.type === 'POSTINO_PREPARE_INTERFACE_DROP') {
    prepareInterfaceDrop(message.payload || {});
    sendResponse({ success: true });
    return false;
  }

  if (message?.type === 'POSTINO_FORMAT_SELECTION') {
    const result = showJsonFormatter(message.selectionText || getSelectionText());
    sendResponse(result);
    return false;
  }
});

document.addEventListener('dragover', event => {
  if (!pendingInterfaceDrop) return;
  event.preventDefault();
  if (event.dataTransfer) event.dataTransfer.dropEffect = 'copy';
  updateDropOverlay(event.clientX, event.clientY);
}, true);

document.addEventListener('drop', event => {
  if (!pendingInterfaceDrop) return;
  event.preventDefault();
  event.stopPropagation();
  const payload = pendingInterfaceDrop;
  const token = payload.dropToken || createDropToken();
  payload.dropToken = token;
  pendingInterfaceDrop.dropToken = token;
  const target = resolveDeepElementFromPoint(event.clientX, event.clientY) || event.composedPath?.()[0] || event.target;
  const fallbackText = payload.curl || event.dataTransfer?.getData('text/plain') || '';
  const dropEvent = new CustomEvent('postino:request-drop', {
    bubbles: true,
    composed: true,
    detail: {
      ...payload,
      token,
      accepted: false,
      target: describeDropTarget(target),
      formats: ['application/x-postino-interface', 'text/x-curl', 'text/plain'],
      droppedAt: Date.now(),
      pageUrl: location.href,
      pageTitle: document.title,
      acceptVia: 'window.postMessage({ source: "postino-page", type: "POSTINO_ACCEPT_REQUEST_DROP", token })',
    },
  });
  window.dispatchEvent(dropEvent);
  if (target?.dispatchEvent) target.dispatchEvent(new CustomEvent('postino:request-drop', { bubbles: true, composed: true, detail: dropEvent.detail }));
  setTimeout(() => {
    if (!pendingInterfaceDrop || pendingInterfaceDrop.dropToken !== token) return;
    if (acceptedDropToken === token) {
      showDropToast('Postino 请求已由页面自定义协议接收');
      clearPendingInterfaceDrop();
      return;
    }
    const inserted = insertTextIntoEditable(target, fallbackText);
    showDropToast(inserted ? 'Postino 请求已插入当前输入区域' : 'Postino 请求已投递到页面事件 postino:request-drop');
    clearPendingInterfaceDrop();
  }, 0);
}, true);

window.addEventListener('message', event => {
  if (event.source !== window) return;
  const message = event.data;
  if (!message || message.source !== 'postino-page' || message.type !== 'POSTINO_SEND_CONTEXT') return;

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

window.addEventListener('message', event => {
  if (event.source !== window) return;
  const message = event.data;
  if (!message || message.source !== 'postino-page' || message.type !== 'POSTINO_ACCEPT_REQUEST_DROP') return;
  const token = String(message.token || '');
  if (!token || !pendingInterfaceDrop || pendingInterfaceDrop.dropToken !== token) return;
  acceptedDropToken = token;
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
    referrer: document.referrer || '',
    language: navigator.language || '',
    viewport: `${window.innerWidth || 0}x${window.innerHeight || 0}`,
    frame: frameContext(),
    contentType: document.contentType || '',
    meta: collectMeta(),
    capturedAt: Date.now(),
  };
}

function frameContext() {
  let isTop = true;
  try {
    isTop = window.top === window;
  } catch (_err) {
    isTop = false;
  }
  return {
    isTop,
    url: location.href,
    name: window.name || '',
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

function prepareInterfaceDrop(payload) {
  pendingInterfaceDrop = safeClone(payload) || {};
  pendingInterfaceDrop.dropToken = createDropToken();
  acceptedDropToken = '';
  if (pendingDropTimer) clearTimeout(pendingDropTimer);
  pendingDropTimer = setTimeout(clearPendingInterfaceDrop, 30000);
  ensureDropOverlay();
  window.dispatchEvent(new CustomEvent('postino:request-drop-ready', {
    detail: {
      ...pendingInterfaceDrop,
      token: pendingInterfaceDrop.dropToken,
      pageUrl: location.href,
      pageTitle: document.title,
      expiresInMs: 30000,
    },
  }));
}

function clearPendingInterfaceDrop() {
  pendingInterfaceDrop = null;
  acceptedDropToken = '';
  if (pendingDropTimer) {
    clearTimeout(pendingDropTimer);
    pendingDropTimer = null;
  }
  if (dropOverlay?.parentNode) dropOverlay.parentNode.removeChild(dropOverlay);
  dropOverlay = null;
}

function ensureDropOverlay() {
  if (dropOverlay) return dropOverlay;
  dropOverlay = document.createElement('div');
  dropOverlay.textContent = '拖放 Postino 接口：可插入输入框，或由页面监听 postino:request-drop 并 postMessage 接收';
  dropOverlay.style.cssText = [
    'position:fixed',
    'z-index:2147483647',
    'left:12px',
    'top:12px',
    'max-width:360px',
    'padding:8px 10px',
    'border-radius:10px',
    'background:rgba(17,24,39,.92)',
    'color:#fff',
    'font:12px/1.5 -apple-system,BlinkMacSystemFont,Segoe UI,sans-serif',
    'box-shadow:0 10px 30px rgba(0,0,0,.28)',
    'pointer-events:none',
  ].join(';');
  document.documentElement.appendChild(dropOverlay);
  return dropOverlay;
}

function createDropToken() {
  return `drop_${Date.now().toString(36)}_${Math.random().toString(36).slice(2, 8)}`;
}

function describeDropTarget(target) {
  if (!target || target.nodeType !== Node.ELEMENT_NODE) return null;
  const element = target;
  return {
    tagName: element.tagName?.toLowerCase() || '',
    id: element.id || '',
    className: typeof element.className === 'string' ? element.className.slice(0, 160) : '',
    name: element.getAttribute?.('name') || '',
    role: element.getAttribute?.('role') || '',
    editable: isEditableElement(element),
  };
}

function updateDropOverlay(x, y) {
  const overlay = ensureDropOverlay();
  overlay.style.left = `${Math.min(window.innerWidth - 80, Math.max(8, x + 12))}px`;
  overlay.style.top = `${Math.min(window.innerHeight - 40, Math.max(8, y + 12))}px`;
}

function isEditableElement(element) {
  if (!element || element.nodeType !== Node.ELEMENT_NODE) return false;
  const el = element;
  if (el.isContentEditable) return true;
  const tag = el.tagName?.toLowerCase();
  if (tag === 'textarea') return true;
  if (tag !== 'input') return false;
  const type = (el.getAttribute('type') || 'text').toLowerCase();
  return !['button', 'checkbox', 'color', 'file', 'hidden', 'image', 'radio', 'range', 'reset', 'submit'].includes(type);
}

function findNestedEditorElement(element) {
  if (!element?.querySelector) return null;
  return element.querySelector([
    '.cm-content[contenteditable="true"]',
    '.ProseMirror[contenteditable="true"]',
    '.ql-editor[contenteditable="true"]',
    '.monaco-editor textarea.inputarea',
    '[role="textbox"][contenteditable="true"]',
    '[contenteditable="true"]',
    'textarea',
    'input:not([type]), input[type="text"], input[type="search"], input[type="url"], input[type="email"]',
  ].join(','));
}

function resolveDeepElementFromPoint(x, y, root = document) {
  let element = root.elementFromPoint?.(x, y) || null;
  while (element?.shadowRoot) {
    const nested = element.shadowRoot.elementFromPoint?.(x, y);
    if (!nested || nested === element) break;
    element = nested;
  }
  return element;
}

function getDeepActiveElement(root = document) {
  let active = root.activeElement;
  while (active?.shadowRoot?.activeElement) active = active.shadowRoot.activeElement;
  return active;
}

function findEditableTarget(target) {
  const visited = new Set();
  let current = target && target.nodeType === Node.ELEMENT_NODE ? target : target?.parentElement;
  while (current && current !== document.documentElement && !visited.has(current)) {
    visited.add(current);
    if (isEditableElement(current)) return current;
    const nestedEditor = findNestedEditorElement(current);
    if (isEditableElement(nestedEditor)) return nestedEditor;
    if (current.shadowRoot) {
      const active = getDeepActiveElement(current.shadowRoot);
      if (isEditableElement(active)) return active;
      const nestedShadowEditor = findNestedEditorElement(current.shadowRoot);
      if (isEditableElement(nestedShadowEditor)) return nestedShadowEditor;
    }
    current = current.parentElement || current.getRootNode?.()?.host || null;
  }
  const activeElement = getDeepActiveElement();
  return activeElement && isEditableElement(activeElement) ? activeElement : null;
}

function setNativeValue(input, value) {
  const descriptor = Object.getOwnPropertyDescriptor(input.constructor?.prototype || {}, 'value')
    || Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, 'value')
    || Object.getOwnPropertyDescriptor(HTMLTextAreaElement.prototype, 'value');
  if (descriptor?.set) descriptor.set.call(input, value);
  else input.value = value;
}

function dispatchPasteFallback(editable, text) {
  try {
    const clipboardData = new DataTransfer();
    clipboardData.setData('text/plain', text);
    const pasteEvent = new ClipboardEvent('paste', {
      bubbles: true,
      cancelable: true,
      clipboardData,
    });
    return !editable.dispatchEvent(pasteEvent);
  } catch (_err) {
    return false;
  }
}

function insertTextIntoEditable(target, text) {
  const editable = findEditableTarget(target);
  if (!editable || !text) return false;
  if (editable.isContentEditable) {
    editable.focus();
    if (dispatchPasteFallback(editable, text)) return true;
    document.execCommand('insertText', false, text);
    editable.dispatchEvent(new InputEvent('input', { bubbles: true, inputType: 'insertText', data: text }));
    return true;
  }
  const input = editable;
  input.focus();
  if (dispatchPasteFallback(input, text)) return true;
  const start = Number.isFinite(input.selectionStart) ? input.selectionStart : input.value.length;
  const end = Number.isFinite(input.selectionEnd) ? input.selectionEnd : start;
  setNativeValue(input, `${input.value.slice(0, start)}${text}${input.value.slice(end)}`);
  const next = start + text.length;
  input.setSelectionRange?.(next, next);
  input.dispatchEvent(new InputEvent('input', { bubbles: true, inputType: 'insertText', data: text }));
  input.dispatchEvent(new Event('change', { bubbles: true }));
  return true;
}

function showDropToast(message) {
  const toast = document.createElement('div');
  toast.textContent = message;
  toast.style.cssText = [
    'position:fixed',
    'z-index:2147483647',
    'right:12px',
    'bottom:12px',
    'padding:8px 10px',
    'border-radius:10px',
    'background:rgba(79,70,229,.95)',
    'color:#fff',
    'font:12px/1.5 -apple-system,BlinkMacSystemFont,Segoe UI,sans-serif',
    'box-shadow:0 10px 30px rgba(0,0,0,.25)',
  ].join(';');
  document.documentElement.appendChild(toast);
  setTimeout(() => toast.remove(), 2200);
}

function showJsonFormatter(text) {
  const parsed = parseMaybeJson(text || getSelectionText() || visibleJsonText());
  if (!parsed.ok) {
    showDropToast('Postino：选中内容不是有效 JSON');
    return { success: false, error: 'Invalid JSON' };
  }
  const pretty = JSON.stringify(parsed.value, null, 2);
  if (jsonFormatOverlay?.parentNode) jsonFormatOverlay.parentNode.removeChild(jsonFormatOverlay);

  jsonFormatOverlay = document.createElement('div');
  jsonFormatOverlay.style.cssText = [
    'position:fixed',
    'z-index:2147483647',
    'inset:24px',
    'display:flex',
    'flex-direction:column',
    'gap:10px',
    'padding:14px',
    'border-radius:16px',
    'background:rgba(15,23,42,.96)',
    'color:#e5e7eb',
    'box-shadow:0 24px 80px rgba(0,0,0,.42)',
    'font:13px/1.5 -apple-system,BlinkMacSystemFont,Segoe UI,sans-serif',
  ].join(';');

  const header = document.createElement('div');
  header.style.cssText = 'display:flex;align-items:center;justify-content:space-between;gap:12px;';
  const title = document.createElement('strong');
  title.textContent = `Postino JSON 格式化 · ${pretty.length.toLocaleString()} 字符`;
  title.style.cssText = 'font-size:14px;color:#fff;';
  const actions = document.createElement('div');
  actions.style.cssText = 'display:flex;gap:8px;flex-wrap:wrap;';
  const copyButton = createFormatterButton('复制');
  const sendButton = createFormatterButton('发送到 Postino');
  const closeButton = createFormatterButton('关闭');
  actions.append(copyButton, sendButton, closeButton);
  header.append(title, actions);

  const pre = document.createElement('pre');
  pre.textContent = pretty;
  pre.style.cssText = [
    'flex:1',
    'min-height:0',
    'overflow:auto',
    'margin:0',
    'padding:12px',
    'border:1px solid rgba(148,163,184,.28)',
    'border-radius:12px',
    'background:rgba(2,6,23,.92)',
    'color:#dbeafe',
    'font:12px/1.6 ui-monospace,SFMono-Regular,Menlo,Monaco,Consolas,monospace',
    'white-space:pre',
  ].join(';');

  copyButton.addEventListener('click', async () => {
    await navigator.clipboard?.writeText(pretty).catch(() => null);
    showDropToast('Postino：已复制格式化 JSON');
  });
  sendButton.addEventListener('click', () => {
    chrome.runtime.sendMessage({
      type: 'STORE_PENDING_IMPORT',
      data: {
        source: 'content-json-formatter',
        context: {
          mode: 'selection-json-format',
          selectionText: text || getSelectionText(),
          text: pretty,
          json: parsed.value,
          isJson: true,
          pageUrl: location.href,
          pageTitle: document.title,
          referrer: document.referrer || '',
          language: navigator.language || '',
          viewport: `${window.innerWidth || 0}x${window.innerHeight || 0}`,
          frame: frameContext(),
          capturedAt: Date.now(),
        },
      },
    }, () => {
      chrome.runtime.sendMessage({ type: 'OPEN_SIDE_PANEL' }, () => {
        showDropToast('Postino：已打开侧边栏并粘贴到 Body');
      });
    });
  });
  closeButton.addEventListener('click', () => {
    jsonFormatOverlay?.remove();
    jsonFormatOverlay = null;
  });

  jsonFormatOverlay.append(header, pre);
  document.documentElement.appendChild(jsonFormatOverlay);
  return { success: true, isJson: true, length: pretty.length };
}

function createFormatterButton(label) {
  const button = document.createElement('button');
  button.type = 'button';
  button.textContent = label;
  button.style.cssText = [
    'border:1px solid rgba(148,163,184,.36)',
    'border-radius:999px',
    'background:rgba(79,70,229,.95)',
    'color:#fff',
    'padding:5px 10px',
    'font:12px/1.4 -apple-system,BlinkMacSystemFont,Segoe UI,sans-serif',
    'cursor:pointer',
  ].join(';');
  return button;
}
