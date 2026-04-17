/**
 * ApiFix Bin - Extension Main Script
 * CSP-compliant: no inline scripts, no inline event handlers
 */

// ============================================
// STATE MANAGEMENT
// ============================================
const STATE = {
  apis: {},           // id -> api object
  groups: {},         // groupName -> { apiIds: [], preRequestScript: '' }
  groupOrder: [],     // ordered group names
  currentApiId: null,
  currentMethod: 'GET',
  bodyType: 'json',
  authType: 'none',
  importType: 'curl',
  collapsedGroups: {},
  response: null,
  theme: 'dark',
  sidebarTab: 'apis',
  streamingEnabled: false,  // 流式请求开关
  activeStreamId: null,     // 当前流式请求ID
};

let contextMenuGroup = null;
let _history = []; // separate from STATE to avoid bloat

// ============================================
// ENVIRONMENT MANAGEMENT (多环境支持)
// ============================================
let _environments = {};       // { envName: { key: value, ... } }
let _environmentOrder = [];   // ordered environment names
let _activeEnvironment = '';  // 当前激活的环境名
let _environmentVars = {};    // 当前环境的变量（运行时）

// ============================================
// INITIALIZATION
// ============================================
function init() {
  try {
    loadFromStorage();
  } catch (e) {
    console.warn('Failed to load storage:', e);
  }

  try {
    loadHistory();
  } catch (e) {
    console.warn('Failed to load history:', e);
  }

  try {
    loadEnvironments();
  } catch (e) {
    console.warn('Failed to load environments:', e);
  }

  try {
    applyTheme();
  } catch (e) {
    console.warn('Failed to apply theme:', e);
  }

  try {
    applySidebarTab();
  } catch (e) {
    console.warn('Failed to apply sidebar tab:', e);
  }

  try {
    renderSidebar();
  } catch (e) {
    console.warn('Failed to render sidebar:', e);
  }

  try {
    updateGroupSelects();
  } catch (e) {
    console.warn('Failed to update group selects:', e);
  }

  try {
    updateEnvironmentSelector();
  } catch (e) {
    console.warn('Failed to update environment selector:', e);
  }

  // Bind all event listeners (replaces inline event handlers)
  bindEvents();

  // Resize handle
  try {
    initResize();
  } catch (e) {
    console.warn('Failed to init resize:', e);
  }
}

// ============================================
// EVENT BINDING (CSP-compliant, no inline handlers)
// ============================================
function bindEvents() {
  // Close dropdowns on outside click
  document.addEventListener('click', (e) => {
    try {
      const dd = document.getElementById('methodDropdown');
      if (dd && !e.target.closest('.method-select')) dd.classList.remove('show');
      const cm = document.getElementById('contextMenu');
      if (cm && !e.target.closest('.context-menu')) cm.classList.remove('show');
    } catch (err) {}
  });

  // Keyboard shortcuts
  document.addEventListener('keydown', (e) => {
    try {
      if ((e.ctrlKey || e.metaKey) && e.key === 'Enter') {
        e.preventDefault();
        sendRequest();
      }
      if ((e.ctrlKey || e.metaKey) && e.key === 's') {
        e.preventDefault();
        if (STATE.currentApiId) showSaveModal();
      }
    } catch (err) {}
  });

  // --- Sidebar buttons ---
  const $ = (sel) => document.querySelector(sel);
  const $$ = (sel) => document.querySelectorAll(sel);

  // Search input
  const searchInput = $('#searchInput');
  if (searchInput) searchInput.addEventListener('input', filterApis);

  // Sidebar action buttons (use data-action)
  $$('[data-action]').forEach(el => {
    const action = el.getAttribute('data-action');
    el.addEventListener('click', () => {
      switch (action) {
        case 'create-new-api': createNewApi(); break;
        case 'show-import-modal': showImportModal(); break;
        case 'show-export-modal': showExportModal(); break;
        case 'close-export-modal': closeExportModal(); break;
        case 'do-export': doExport(); break;
        case 'toggle-theme': toggleTheme(); break;
        case 'toggle-method-dropdown': toggleMethodDropdown(); break;
        case 'send-request': sendRequest(); closeSendDropdown(); break;
        case 'send-and-download': sendAndDownload(); closeSendDropdown(); break;
        case 'generate-curl': generateCurl(); closeSendDropdown(); break;
        case 'toggle-send-dropdown': toggleSendDropdown(); break;
        case 'toggle-bulk-edit': toggleBulkEdit(el.dataset.bulkType); break;
        case 'show-save-modal': showSaveModal(); break;
        case 'close-import-modal': closeImportModal(); break;
        case 'close-save-modal': closeSaveModal(); break;
        case 'do-import': doImport(); break;
        case 'do-save': doSave(); break;
        case 'clear-script-console': clearScriptConsole(); break;
        case 'rename-group': renameGroup(); break;
        case 'delete-group': deleteGroup(); break;
        case 'create-new-group': createNewGroup(); break;
        case 'clear-history': clearHistory(); break;
        case 'close-prompt-ok': closeCustomPrompt(true); break;
        case 'close-prompt-cancel': closeCustomPrompt(false); break;
        case 'close-confirm-ok': closeCustomConfirm(true); break;
        case 'close-confirm-cancel': closeCustomConfirm(false); break;
        case 'toggle-streaming': toggleStreaming(); break;
        case 'cancel-streaming': cancelStreaming(); break;
        case 'show-environment-modal': showEnvironmentModal(); break;
        case 'close-group-script-modal': closeGroupScriptModal(); break;
        case 'save-group-script': saveGroupScript(); break;
        case 'edit-group-script': editGroupScript(contextMenuGroup); break;
      }
    });
  });

  // Environment modal event delegation (handles dynamically generated buttons)
  const envModal = document.getElementById('environmentModal');
  if (envModal) {
    envModal.addEventListener('click', (e) => {
      const btn = e.target.closest('[data-action]');
      if (!btn) return;
      const action = btn.getAttribute('data-action');
      switch (action) {
        case 'close-environment-modal': closeEnvironmentModal(); break;
        case 'add-environment': addEnvironment(); break;
        case 'delete-environment': deleteEnvironment(btn.dataset.envName); break;
        case 'edit-environment': editEnvironment(btn.dataset.envName); break;
        case 'save-environment-vars': saveEnvironmentVarsEdit(); break;
        case 'env-back-to-list': envBackToList(); break;
        case 'add-env-var-row': addEnvVarRow(); break;
        case 'remove-env-var': {
          const row = btn.closest('.env-var-row');
          if (row) row.remove();
          break;
        }
      }
    });
    // Handle type change: toggle password/text for current value
    envModal.addEventListener('change', (e) => {
      if (e.target.matches('[data-field="type"]')) {
        const row = e.target.closest('.env-var-row');
        if (!row) return;
        const currentInput = row.querySelector('[data-field="current"]');
        if (currentInput) {
          currentInput.type = e.target.value === 'secret' ? 'password' : 'text';
        }
      }
      // Toggle enabled/disabled row style
      if (e.target.matches('[data-field="enabled"]')) {
        const row = e.target.closest('.env-var-row');
        if (row) {
          row.classList.toggle('disabled-row', !e.target.checked);
        }
      }
    });
    // Enter key on new env name input
    const newEnvInput = document.getElementById('newEnvNameInput');
    if (newEnvInput) {
      newEnvInput.addEventListener('keydown', (e) => {
        if (e.key === 'Enter') {
          e.preventDefault();
          addEnvironment();
        }
      });
    }
  }

  // Method dropdown options
  $$('.method-option').forEach(el => {
    el.addEventListener('click', () => {
      const method = el.textContent.trim();
      selectMethod(method);
    });
  });

  // Request tabs
  $$('.request-panel .tab[data-tab]').forEach(el => {
    el.addEventListener('click', () => switchRequestTab(el.dataset.tab));
  });

  // Response tabs
  $$('.response-panel .tab[data-rtab]').forEach(el => {
    el.addEventListener('click', () => switchResponseTab(el.dataset.rtab));
  });

  // Body type buttons
  $$('.body-type-btn[data-btype]').forEach(el => {
    el.addEventListener('click', () => { selectBodyType(el.dataset.btype); syncCurrentApi(); });
  });

  // Auth type buttons
  $$('.auth-type-btn[data-auth]').forEach(el => {
    el.addEventListener('click', () => { selectAuthType(el.dataset.auth); syncCurrentApi(); });
  });

  // Import type buttons
  $$('.import-type-btn[data-itype]').forEach(el => {
    el.addEventListener('click', () => selectImportType(el.dataset.itype));
  });

  // Import file pick button
  const importFileBtn = document.querySelector('[data-action="pick-import-file"]');
  if (importFileBtn) {
    importFileBtn.addEventListener('click', () => {
      const fileInput = document.getElementById('importFileInput');
      if (fileInput) fileInput.click();
    });
  }

  // Import file input change
  const importFileInput = document.getElementById('importFileInput');
  if (importFileInput) {
    importFileInput.addEventListener('change', function() {
      handleImportFile(this);
    });
  }

  // Environment selector
  const envSelector = document.getElementById('envSelector');
  if (envSelector) {
    envSelector.addEventListener('change', function() {
      switchEnvironment(this.value);
    });
  }

  // Stream toggle indicator initial state
  const streamInd = document.getElementById('streamToggleIndicator');
  if (streamInd && STATE.streamingEnabled) {
    streamInd.classList.add('active');
  }

  // Sidebar tabs
  $$('.sidebar-tab[data-sidebar-tab]').forEach(el => {
    el.addEventListener('click', () => switchSidebarTab(el.dataset.sidebarTab));
  });

  // KV add-row buttons (use data-editor and data-kv-type)
  $$('.kv-add-btn[data-editor]').forEach(el => {
    el.addEventListener('click', () => addKvRow(el.dataset.editor, el.dataset.kvType));
  });

  // --- Event delegation for dynamically created elements ---
  // Sidebar body: clicks on group headers, api items
  document.getElementById('sidebarBody').addEventListener('click', (e) => {
    // Chevron or group name click -> toggle group
    const chevron = e.target.closest('.chevron');
    const groupName = e.target.closest('.group-name');
    if (chevron || groupName) {
      const header = e.target.closest('.api-group-header');
      if (header) {
        toggleGroup(header.dataset.group);
      }
      return;
    }

    // Group "+" button -> create new API in group
    const addBtn = e.target.closest('.group-actions button');
    if (addBtn) {
      const header = addBtn.closest('.api-group-header');
      if (header) {
        createNewApiInGroup(header.dataset.group);
      }
      return;
    }

    // API item delete button
    const deleteBtn = e.target.closest('.api-item-actions button');
    if (deleteBtn) {
      e.stopPropagation();
      const item = deleteBtn.closest('.api-item');
      if (item) deleteApi(item.dataset.apiId);
      return;
    }

    // API item click -> load
    const apiItem = e.target.closest('.api-item');
    if (apiItem) {
      loadApi(apiItem.dataset.apiId);
      return;
    }
  });

  // Sidebar: context menu on group headers
  document.getElementById('sidebarBody').addEventListener('contextmenu', (e) => {
    const header = e.target.closest('.api-group-header');
    if (header) {
      e.preventDefault();
      showGroupContextMenu(e, header.dataset.group);
    }
  });

  // Sidebar: drag and drop for API items
  document.getElementById('sidebarBody').addEventListener('dragstart', (e) => {
    const apiItem = e.target.closest('.api-item');
    if (apiItem) {
      handleDragStart(e, apiItem.dataset.apiId);
    }
  });

  document.getElementById('sidebarBody').addEventListener('dragend', (e) => {
    const apiItem = e.target.closest('.api-item');
    if (apiItem) handleDragEnd(e);
  });

  document.getElementById('sidebarBody').addEventListener('dragover', (e) => {
    const header = e.target.closest('.api-group-header');
    if (header) handleDragOver(e);
  });

  document.getElementById('sidebarBody').addEventListener('dragleave', (e) => {
    const header = e.target.closest('.api-group-header');
    if (header) handleDragLeave(e);
  });

  document.getElementById('sidebarBody').addEventListener('drop', (e) => {
    const header = e.target.closest('.api-group-header');
    if (header) {
      handleDrop(e, header.dataset.dropGroup);
    }
  });

  // History: event delegation
  const historyEl = document.getElementById('sidebarHistory');
  if (historyEl) {
    historyEl.addEventListener('click', (e) => {
      // Delete button
      const deleteBtn = e.target.closest('.history-delete');
      if (deleteBtn) {
        e.stopPropagation();
        const item = deleteBtn.closest('.history-item');
        if (item) deleteHistoryEntry(item.dataset.historyId);
        return;
      }
      // Item click -> load
      const historyItem = e.target.closest('.history-item');
      if (historyItem) {
        loadHistoryEntry(historyItem.dataset.historyId);
      }
    });
  }

  // KV editors: event delegation for remove buttons and toggles
  document.addEventListener('click', (e) => {
    // KV remove button
    if (e.target.closest('.kv-remove')) {
      const btn = e.target.closest('.kv-remove');
      const editor = btn.closest('.kv-editor');
      const row = btn.closest('.kv-row');
      if (editor && row) {
        const editorId = editor.id;
        const typeMap = { 'paramsEditor': 'params', 'headersEditor': 'headers', 'formdataEditor': 'formdata', 'urlencodedEditor': 'urlencoded' };
        const type = typeMap[editorId] || editorId.replace('Editor', '');
        removeKvRow(btn, editorId, type);
      }
      return;
    }
  });

  // KV editors: sync on input change
  document.addEventListener('input', (e) => {
    if (e.target.matches('.kv-key') || e.target.matches('.kv-value') || e.target.matches('.kv-desc')) {
      syncCurrentApi();
      const row = e.target.closest('.kv-row');
      const editor = row ? row.closest('.kv-editor') : null;
      if (editor && e.target.matches('.kv-key')) {
        // Determine type from editor id
        const editorId = editor.id;
        const typeMap = { 'paramsEditor': 'params', 'headersEditor': 'headers', 'formdataEditor': 'formdata', 'urlencodedEditor': 'urlencoded' };
        const type = typeMap[editorId];
        if (type) updateKvCount(type);
      }
    }
  });

  // KV editors: sync on toggle change + visual state
  document.addEventListener('change', (e) => {
    if (e.target.matches('.kv-toggle')) {
      syncCurrentApi();
      toggleKvRowState(e.target);
    }
  });

  // Body toolbar: format/compress JSON
  document.addEventListener('click', (e) => {
    const actionBtn = e.target.closest('.body-action-btn');
    if (actionBtn) {
      const action = actionBtn.dataset.action;
      if (action === 'format-json') formatJsonBody();
      if (action === 'compress-json') compressJsonBody();
    }
  });

  // Bulk edit textarea sync
  document.addEventListener('input', (e) => {
    if (e.target.matches('.bulk-edit-textarea')) {
      syncCurrentApi();
    }
  });

  // Send dropdown: close on outside click
  document.addEventListener('click', (e) => {
    if (!e.target.closest('.send-dropdown-wrap')) {
      const dd = document.getElementById('sendDropdown');
      if (dd) dd.classList.remove('open');
    }
  });

  // Copy response button (delegation)
  document.addEventListener('click', (e) => {
    if (e.target.closest('.copy-btn')) {
      copyResponse();
    }
  });

  // cURL modal actions (delegation)
  document.addEventListener('click', (e) => {
    const action = e.target.closest('[data-action]');
    if (!action) return;
    const act = action.dataset.action;
    if (act === 'close-curl-modal') {
      const overlay = action.closest('.curl-modal-overlay');
      if (overlay) overlay.remove();
    }
    if (act === 'copy-curl') {
      copyCurl();
    }
  });
}

// ============================================
// LOCAL STORAGE
// ============================================
function saveToStorage() {
  try {
    const data = {
      apis: STATE.apis,
      groups: STATE.groups,
      groupOrder: STATE.groupOrder,
      collapsedGroups: STATE.collapsedGroups,
      theme: STATE.theme,
      streamingEnabled: STATE.streamingEnabled,
    };
    localStorage.setItem('apifix_bin_data', JSON.stringify(data));
  } catch (e) {
    console.warn('Storage save failed:', e);
  }
}

function loadFromStorage() {
  try {
    const raw = localStorage.getItem('apifix_bin_data');
    if (!raw) return;
    const data = JSON.parse(raw);
    // Ensure all data structures are valid
    STATE.apis = (data.apis && typeof data.apis === 'object') ? data.apis : {};
    STATE.groups = (data.groups && typeof data.groups === 'object') ? data.groups : {};
    STATE.groupOrder = Array.isArray(data.groupOrder) ? data.groupOrder : Object.keys(STATE.groups);
    STATE.collapsedGroups = (data.collapsedGroups && typeof data.collapsedGroups === 'object') ? data.collapsedGroups : {};
    STATE.theme = data.theme === 'light' ? 'light' : 'dark';
    STATE.streamingEnabled = !!data.streamingEnabled;
    // Validate apis - remove corrupted entries
    for (const id of Object.keys(STATE.apis)) {
      const api = STATE.apis[id];
      if (!api || typeof api !== 'object' || !api.id) {
        delete STATE.apis[id];
      }
    }
    // Migrate groups: support both old format (array) and new format (object with apiIds + preRequestScript)
    for (const name of Object.keys(STATE.groups)) {
      const g = STATE.groups[name];
      if (Array.isArray(g)) {
        // Old format: array of apiIds
        STATE.groups[name] = { apiIds: g.filter(id => STATE.apis[id]), preRequestScript: '' };
      } else if (g && typeof g === 'object') {
        // New format: ensure apiIds array exists
        if (!Array.isArray(g.apiIds)) g.apiIds = [];
        if (typeof g.preRequestScript !== 'string') g.preRequestScript = '';
        g.apiIds = g.apiIds.filter(id => STATE.apis[id]);
      } else {
        STATE.groups[name] = { apiIds: [], preRequestScript: '' };
      }
    }
  } catch (e) {
    console.warn('Storage load failed, resetting:', e);
    localStorage.removeItem('apifix_bin_data');
  }
}

// ============================================
// THEME
// ============================================
function toggleTheme() {
  STATE.theme = STATE.theme === 'dark' ? 'light' : 'dark';
  applyTheme();
  saveToStorage();
}

function applyTheme() {
  document.documentElement.setAttribute('data-theme', STATE.theme);
  document.getElementById('themeIcon').textContent = STATE.theme === 'dark' ? '🌙' : '☀️';
  document.getElementById('themeLabel').textContent = STATE.theme === 'dark' ? '暗色' : '亮色';
}

// ============================================
// SIDEBAR RENDERING
// ============================================
function renderSidebar() {
  const body = document.getElementById('sidebarBody');
  const searchVal = (document.getElementById('searchInput')?.value || '').toLowerCase();

  // Ensure default group
  if (STATE.groupOrder.length === 0) {
    STATE.groupOrder = ['默认分组'];
    ensureGroupFormat('默认分组');
  }
  if (!STATE.groups['默认分组']) {
    ensureGroupFormat('默认分组');
  }

  let html = '';
  for (const groupName of STATE.groupOrder) {
    const apiIds = getGroupApiIds(groupName);
    const isCollapsed = STATE.collapsedGroups[groupName];

    // Filter by search
    const filteredIds = apiIds.filter(id => {
      const api = STATE.apis[id];
      if (!api) return false;
      if (!searchVal) return true;
      return api.name.toLowerCase().includes(searchVal) ||
             api.url.toLowerCase().includes(searchVal) ||
             api.method.toLowerCase().includes(searchVal);
    });

    if (searchVal && filteredIds.length === 0) continue;

    html += `
      <div class="api-group">
        <div class="api-group-header" data-group="${escapeHtml(groupName)}" data-drop-group="${escapeHtml(groupName)}">
          <span class="chevron ${isCollapsed ? 'collapsed' : ''}">▶</span>
          <span class="group-name">${escapeHtml(groupName)}</span>
          ${getGroupScript(groupName) ? '<span class="group-script-badge" title="分组有 Pre-request Script">⚡</span>' : ''}
          <span class="group-count">${filteredIds.length}</span>
          <div class="group-actions">
            <button title="添加请求">+</button>
          </div>
        </div>
        <div class="api-group-items ${isCollapsed ? 'collapsed' : ''}" style="max-height:${isCollapsed ? '0' : filteredIds.length * 40 + 'px'}">
    `;

    for (const id of filteredIds) {
      const api = STATE.apis[id];
      if (!api) continue;
      const methodClass = api.method.toLowerCase();
      const isActive = id === STATE.currentApiId;
      html += `
        <div class="api-item ${isActive ? 'active' : ''}" data-api-id="${id}" draggable="true">
          <span class="method-badge ${methodClass}">${api.method}</span>
          <span class="api-name" title="${escapeHtml(api.url)}">${escapeHtml(api.name)}</span>
          <div class="api-item-actions">
            <button title="删除">✕</button>
          </div>
        </div>
      `;
    }

    html += `</div></div>`;
  }

  // When searching, also show matching history entries
  if (searchVal) {
    const matchedHistory = _history.filter(entry => {
      return (entry.url || '').toLowerCase().includes(searchVal) ||
             (entry.method || '').toLowerCase().includes(searchVal) ||
             (entry.name || '').toLowerCase().includes(searchVal);
    });
    if (matchedHistory.length > 0) {
      html += `
        <div class="api-group">
          <div class="api-group-header">
            <span class="chevron">▶</span>
            <span class="group-name">🔍 历史匹配</span>
            <span class="group-count">${matchedHistory.length}</span>
          </div>
          <div class="api-group-items" style="max-height:${matchedHistory.length * 56 + 'px'}">
      `;
      for (const entry of matchedHistory) {
        const methodClass = entry.method?.toLowerCase() || 'get';
        const statusClass = !entry.status ? '' :
          entry.status < 300 ? 'success' :
          entry.status < 400 ? 'redirect' :
          entry.status < 500 ? 'client-err' : 'server-err';
        const timeStr = entry.timestamp ? new Date(entry.timestamp).toLocaleString('zh-CN', { month: '2-digit', day: '2-digit', hour: '2-digit', minute: '2-digit' }) : '';
        html += `
          <div class="history-item" data-history-id="${entry.id}">
            <span class="method-badge ${methodClass}">${entry.method || 'GET'}</span>
            <div class="history-info">
              <span class="history-url" title="${escapeHtml(entry.url || '')}">${escapeHtml(entry.url || '无URL')}</span>
              <div class="history-meta">
                ${entry.status ? `<span class="history-status ${statusClass}">${entry.status}</span>` : ''}
                ${entry.duration ? `<span>${entry.duration}ms</span>` : ''}
                <span>${timeStr}</span>
              </div>
            </div>
            <button class="history-delete" title="删除">✕</button>
          </div>
        `;
      }
      html += `</div></div>`;
    }
  }

  body.innerHTML = html || '<div class="empty-state" style="padding:40px 20px"><div class="empty-icon">📭</div><div class="empty-title">暂无接口</div><div class="empty-desc">点击"新建"或"导入"开始</div></div>';
}

function toggleGroup(name) {
  STATE.collapsedGroups[name] = !STATE.collapsedGroups[name];
  saveToStorage();
  renderSidebar();
}

// Drag and Drop for API items between groups
let _dragApiId = null;

function handleDragStart(e, apiId) {
  _dragApiId = apiId;
  e.dataTransfer.effectAllowed = 'move';
  e.dataTransfer.setData('text/plain', apiId);
  requestAnimationFrame(() => {
    const el = e.target.closest('.api-item');
    if (el) el.classList.add('dragging');
  });
}

function handleDragEnd(e) {
  _dragApiId = null;
  document.querySelectorAll('.api-item.dragging').forEach(el => el.classList.remove('dragging'));
  document.querySelectorAll('.api-group-header.drag-over').forEach(el => el.classList.remove('drag-over'));
  document.querySelectorAll('.api-item.drag-over-item').forEach(el => el.classList.remove('drag-over-item'));
}

function handleDragOver(e) {
  e.preventDefault();
  e.dataTransfer.dropEffect = 'move';
  const header = e.target.closest('.api-group-header');
  if (header) header.classList.add('drag-over');
}

function handleDragLeave(e) {
  const header = e.target.closest('.api-group-header');
  if (header) header.classList.remove('drag-over');
}

function handleDrop(e, targetGroup) {
  e.preventDefault();
  const apiId = e.dataTransfer.getData('text/plain') || _dragApiId;
  if (!apiId) return;

  document.querySelectorAll('.api-group-header.drag-over').forEach(el => el.classList.remove('drag-over'));
  document.querySelectorAll('.api-item.dragging').forEach(el => el.classList.remove('dragging'));

  let sourceGroup = null;
  for (const gName of STATE.groupOrder) {
    if (getGroupApiIds(gName).includes(apiId)) {
      sourceGroup = gName;
      break;
    }
  }

  if (!sourceGroup) return;
  if (sourceGroup === targetGroup) return;

  const srcArr = getGroupApiIds(sourceGroup);
  const idx = srcArr.indexOf(apiId);
  if (idx !== -1) {
    srcArr.splice(idx, 1);
    setGroupApiIds(sourceGroup, srcArr);
  }

  addToGroup(targetGroup, apiId);

  saveToStorage();
  renderSidebar();
  toast(`已移动到「${targetGroup}」`, 'success');
}

function filterApis() {
  renderSidebar();
  if (STATE.sidebarTab === 'history') renderHistory();
}

// ============================================
// API CRUD
// ============================================
function generateId() {
  return 'api_' + Date.now() + '_' + Math.random().toString(36).substring(2, 8);
}

// ============================================
// GROUP HELPERS (new format: { apiIds: [], preRequestScript: '' })
// ============================================
function getGroupApiIds(groupName) {
  const g = STATE.groups[groupName];
  if (!g) return [];
  if (Array.isArray(g)) return g;
  return g.apiIds || [];
}

function getGroupScript(groupName) {
  const g = STATE.groups[groupName];
  if (!g || Array.isArray(g)) return '';
  return g.preRequestScript || '';
}

function setGroupApiIds(groupName, ids) {
  if (!STATE.groups[groupName]) {
    STATE.groups[groupName] = { apiIds: ids, preRequestScript: '' };
  } else if (Array.isArray(STATE.groups[groupName])) {
    STATE.groups[groupName] = { apiIds: ids, preRequestScript: '' };
  } else {
    STATE.groups[groupName].apiIds = ids;
  }
}

function addToGroup(groupName, apiId) {
  if (!STATE.groups[groupName]) {
    STATE.groups[groupName] = { apiIds: [apiId], preRequestScript: '' };
  } else if (Array.isArray(STATE.groups[groupName])) {
    STATE.groups[groupName] = { apiIds: [...STATE.groups[groupName], apiId], preRequestScript: '' };
  } else {
    STATE.groups[groupName].apiIds.push(apiId);
  }
}

function removeFromGroup(groupName, apiId) {
  const ids = getGroupApiIds(groupName);
  setGroupApiIds(groupName, ids.filter(x => x !== apiId));
}

function ensureGroupFormat(groupName) {
  if (!STATE.groups[groupName]) {
    STATE.groups[groupName] = { apiIds: [], preRequestScript: '' };
  } else if (Array.isArray(STATE.groups[groupName])) {
    STATE.groups[groupName] = { apiIds: STATE.groups[groupName], preRequestScript: '' };
  }
}

function createNewApi() {
  createNewApiInGroup('');
}

function createNewApiInGroup(groupName) {
  const id = generateId();
  const group = groupName || '默认分组';

  STATE.apis[id] = {
    id,
    name: '新请求',
    method: 'GET',
    url: '',
    headers: [],
    params: [],
    bodyType: 'json',
    body: '',
    formdata: [],
    urlencoded: [],
    authType: 'none',
    bearerToken: '',
    basicUser: '',
    basicPass: '',
    preRequestScript: '',
    group,
    createdAt: Date.now(),
    updatedAt: Date.now(),
  };

  if (!STATE.groups[group]) {
    ensureGroupFormat(group);
    if (!STATE.groupOrder.includes(group)) {
      STATE.groupOrder.push(group);
    }
  }
  addToGroup(group, id);

  saveToStorage();
  renderSidebar();
  updateGroupSelects();
  loadApi(id);
}

async function deleteApi(id) {
  const api = STATE.apis[id];
  if (!api) return;
  if (!await customConfirm('删除接口', `确定删除接口"${api.name}"？`, { icon: '🗑️', okText: '删除', danger: true })) return;

  // Remove from group
  const group = api.group || '默认分组';
  removeFromGroup(group, id);

  delete STATE.apis[id];

  if (STATE.currentApiId === id) {
    STATE.currentApiId = null;
    showWelcome();
  }

  saveToStorage();
  renderSidebar();
  updateGroupSelects();
  toast('接口已删除', 'success');
}

function loadApi(id) {
  const api = STATE.apis[id];
  if (!api) return;

  STATE.currentApiId = id;
  STATE.currentMethod = api.method;
  STATE.bodyType = api.bodyType || 'json';
  STATE.authType = api.authType || 'none';

  // Show editor
  document.getElementById('welcomeScreen').style.display = 'none';
  document.getElementById('editorView').style.display = 'flex';

  // Method
  updateMethodDisplay(api.method);

  // URL
  document.getElementById('urlInput').value = api.url || '';

  // Params
  renderKvEditor('paramsEditor', api.params || [], 'params');

  // Headers
  renderKvEditor('headersEditor', api.headers || [], 'headers');

  // Body
  selectBodyType(STATE.bodyType);
  document.getElementById('bodyTextarea').value = api.body || '';
  renderKvEditor('formdataEditor', api.formdata || [], 'formdata');
  renderKvEditor('urlencodedEditor', api.urlencoded || [], 'urlencoded');

  // Auth
  selectAuthType(STATE.authType);
  document.getElementById('bearerToken').value = api.bearerToken || '';
  document.getElementById('basicUser').value = api.basicUser || '';
  document.getElementById('basicPass').value = api.basicPass || '';

  // Pre-request Script
  document.getElementById('preRequestScript').value = api.preRequestScript || '';
  updateScriptBadge(api.preRequestScript);

  // Clear response
  clearResponse();

  // Update sidebar active state
  renderSidebar();
}

function showWelcome() {
  document.getElementById('welcomeScreen').style.display = 'flex';
  document.getElementById('editorView').style.display = 'none';
}

function syncCurrentApi() {
  if (!STATE.currentApiId) return;
  const api = STATE.apis[STATE.currentApiId];
  if (!api) return;

  api.method = STATE.currentMethod;
  api.url = document.getElementById('urlInput').value;
  api.params = getEffectiveKvData('paramsEditor', 'params');
  api.headers = getEffectiveKvData('headersEditor', 'headers');
  api.bodyType = STATE.bodyType;
  api.body = document.getElementById('bodyTextarea').value;
  api.formdata = getEffectiveKvData('formdataEditor', 'formdata');
  api.urlencoded = getEffectiveKvData('urlencodedEditor', 'urlencoded');
  api.authType = STATE.authType;
  api.bearerToken = document.getElementById('bearerToken').value;
  api.basicUser = document.getElementById('basicUser').value;
  api.basicPass = document.getElementById('basicPass').value;
  api.preRequestScript = document.getElementById('preRequestScript').value;
  api.updatedAt = Date.now();
}

// ============================================
// METHOD SELECTOR
// ============================================
function toggleMethodDropdown() {
  document.getElementById('methodDropdown').classList.toggle('show');
}

function selectMethod(method) {
  STATE.currentMethod = method;
  updateMethodDisplay(method);
  document.getElementById('methodDropdown').classList.remove('show');
  syncCurrentApi();
}

function updateMethodDisplay(method) {
  const btn = document.getElementById('methodBtn');
  const text = document.getElementById('methodText');
  text.textContent = method;
  const m = method.toLowerCase();
  const colorVar = `var(--method-${m})`;
  btn.style.color = colorVar;
}

// ============================================
// TABS
// ============================================
function switchRequestTab(tab) {
  document.querySelectorAll('.request-panel .tab').forEach(t => t.classList.remove('active'));
  document.querySelector(`.request-panel .tab[data-tab="${tab}"]`).classList.add('active');
  document.querySelectorAll('#tab-params, #tab-headers, #tab-body, #tab-auth, #tab-script').forEach(p => p.classList.remove('active'));
  document.getElementById(`tab-${tab}`).classList.add('active');
}

function switchResponseTab(tab) {
  document.querySelectorAll('.response-panel .tab').forEach(t => t.classList.remove('active'));
  document.querySelector(`.response-panel .tab[data-rtab="${tab}"]`).classList.add('active');
  document.querySelectorAll('#rtab-body, #rtab-headers').forEach(p => p.classList.remove('active'));
  document.getElementById(`rtab-${tab}`).classList.add('active');
}

// ============================================
// KEY-VALUE EDITOR
// ============================================
function renderKvEditor(editorId, data, type) {
  const editor = document.getElementById(editorId);
  let html = '';
  data.forEach((item, i) => {
    html += `
      <div class="kv-row${item.enabled === false ? ' kv-disabled' : ''}">
        <input type="checkbox" class="kv-toggle" ${item.enabled !== false ? 'checked' : ''}>
        <input class="kv-key" type="text" placeholder="Key" value="${escapeHtml(item.key)}">
        <input class="kv-value" type="text" placeholder="Value" value="${escapeHtml(item.value)}">
        <input class="kv-desc" type="text" placeholder="Description" value="${escapeHtml(item.description || '')}">
        <button class="kv-remove">✕</button>
      </div>
    `;
  });
  editor.innerHTML = html;
  updateKvCount(type);
}

function addKvRow(editorId, type) {
  const editor = document.getElementById(editorId);
  const row = document.createElement('div');
  row.className = 'kv-row';
  row.innerHTML = `
    <input type="checkbox" class="kv-toggle" checked>
    <input class="kv-key" type="text" placeholder="Key">
    <input class="kv-value" type="text" placeholder="Value">
    <input class="kv-desc" type="text" placeholder="Description">
    <button class="kv-remove">✕</button>
  `;
  editor.appendChild(row);
  row.querySelector('.kv-key').focus();
  syncCurrentApi();
}

function removeKvRow(btn, editorId, type) {
  btn.closest('.kv-row').remove();
  syncCurrentApi();
  updateKvCount(type);
}

function getKvData(editorId) {
  const editor = document.getElementById(editorId);
  const rows = editor.querySelectorAll('.kv-row');
  const data = [];
  rows.forEach(row => {
    const key = row.querySelector('.kv-key').value;
    const value = row.querySelector('.kv-value').value;
    const enabled = row.querySelector('.kv-toggle').checked;
    const descEl = row.querySelector('.kv-desc');
    const description = descEl ? descEl.value : '';
    data.push({ key, value, enabled, description });
  });
  return data;
}

function toggleKvRowState(checkbox) {
  const row = checkbox.closest('.kv-row');
  if (row) {
    row.classList.toggle('kv-disabled', !checkbox.checked);
  }
}

// ============================================
// BULK EDIT
// ============================================
const _bulkEditState = { params: false, headers: false, formdata: false, urlencoded: false };

function toggleBulkEdit(type) {
  _bulkEditState[type] = !_bulkEditState[type];
  const isBulk = _bulkEditState[type];
  const editorId = type + 'Editor';
  const bulkId = type + 'BulkEditor';
  const bulkTextId = type + 'BulkText';
  const addBtnId = type + 'AddBtn';
  const bulkBtnId = type + 'BulkBtn';

  const editor = document.getElementById(editorId);
  const bulkEditor = document.getElementById(bulkId);
  const bulkText = document.getElementById(bulkTextId);
  const addBtn = document.getElementById(addBtnId);
  const bulkBtn = document.getElementById(bulkBtnId);

  if (isBulk) {
    const data = getKvData(editorId);
    const lines = data.map(d => {
      const prefix = d.enabled ? '' : '// ';
      return prefix + d.key + ':' + d.value + (d.description ? ' // ' + d.description : '');
    });
    bulkText.value = lines.join('\n');
    editor.style.display = 'none';
    addBtn.style.display = 'none';
    bulkEditor.style.display = 'block';
    bulkBtn.classList.add('active');
  } else {
    const text = bulkText.value;
    const lines = text.split('\n').filter(l => l.trim());
    const newData = [];
    lines.forEach(line => {
      const trimmed = line.trim();
      if (!trimmed) return;
      let enabled = true;
      let content = trimmed;
      if (content.startsWith('// ')) {
        enabled = false;
        content = content.substring(3);
      }
      let description = '';
      const descMatch = content.match(/^(.+?)\s+\/\/\s*(.+)$/);
      if (descMatch) {
        content = descMatch[1];
        description = descMatch[2];
      }
      const colonIdx = content.indexOf(':');
      if (colonIdx > 0) {
        newData.push({
          key: content.substring(0, colonIdx).trim(),
          value: content.substring(colonIdx + 1).trim(),
          enabled,
          description
        });
      }
    });
    renderKvEditor(editorId, newData, type);
    editor.style.display = 'block';
    addBtn.style.display = 'block';
    bulkEditor.style.display = 'none';
    bulkBtn.classList.remove('active');
    syncCurrentApi();
  }
}

function getBulkEditData(type) {
  if (!_bulkEditState[type]) return null;
  const bulkText = document.getElementById(type + 'BulkText');
  if (!bulkText) return null;
  const text = bulkText.value;
  const lines = text.split('\n').filter(l => l.trim());
  const data = [];
  lines.forEach(line => {
    const trimmed = line.trim();
    if (!trimmed) return;
    let enabled = true;
    let content = trimmed;
    if (content.startsWith('// ')) {
      enabled = false;
      content = content.substring(3);
    }
    let description = '';
    const descMatch = content.match(/^(.+?)\s+\/\/\s*(.+)$/);
    if (descMatch) {
      content = descMatch[1];
      description = descMatch[2];
    }
    const colonIdx = content.indexOf(':');
    if (colonIdx > 0) {
      data.push({
        key: content.substring(0, colonIdx).trim(),
        value: content.substring(colonIdx + 1).trim(),
        enabled,
        description
      });
    }
  });
  return data;
}

function getEffectiveKvData(editorId, type) {
  const bulkData = getBulkEditData(type);
  if (bulkData) return bulkData;
  return getKvData(editorId);
}

// ============================================
// SEND DROPDOWN
// ============================================
function toggleSendDropdown() {
  document.getElementById('sendDropdown').classList.toggle('open');
}

function closeSendDropdown() {
  const dd = document.getElementById('sendDropdown');
  if (dd) dd.classList.remove('open');
}

// ============================================
// GENERATE cURL
// ============================================
function generateCurl() {
  syncCurrentApi();
  const method = STATE.currentMethod;
  const url = document.getElementById('urlInput').value.trim();
  if (!url) { toast('请输入请求URL', 'error'); return; }

  const allHeaders = {};
  const headerData = getEffectiveKvData('headersEditor', 'headers');
  headerData.forEach(h => {
    if (h.enabled && h.key.trim()) allHeaders[h.key] = h.value;
  });

  if (STATE.authType === 'bearer') {
    const token = document.getElementById('bearerToken').value;
    if (token) allHeaders['Authorization'] = `Bearer ${token}`;
  } else if (STATE.authType === 'basic') {
    const user = document.getElementById('basicUser').value;
    const pass = document.getElementById('basicPass').value;
    if (user) allHeaders['Authorization'] = `Basic ${btoa(user + ':' + pass)}`;
  }

  let finalUrl = url;
  const params = getEffectiveKvData('paramsEditor', 'params');
  const enabledParams = params.filter(p => p.enabled && p.key.trim());
  if (enabledParams.length > 0) {
    try {
      const urlObj = new URL(url.startsWith('http') ? url : 'https://' + url);
      enabledParams.forEach(p => urlObj.searchParams.append(p.key, p.value));
      finalUrl = urlObj.toString();
    } catch (e) {
      const sep = finalUrl.includes('?') ? '&' : '?';
      const qs = enabledParams.map(p => encodeURIComponent(p.key) + '=' + encodeURIComponent(p.value)).join('&');
      finalUrl = finalUrl + sep + qs;
    }
  }
  if (!finalUrl.startsWith('http://') && !finalUrl.startsWith('https://')) {
    finalUrl = 'https://' + finalUrl;
  }

  let parts = [`curl -X ${method}`];
  Object.entries(allHeaders).forEach(([k, v]) => {
    parts.push(`  -H '${k}: ${v.replace(/'/g, "'\\''")}'`);
  });

  if (!['GET', 'HEAD'].includes(method)) {
    if (STATE.bodyType === 'json') {
      const bodyVal = document.getElementById('bodyTextarea').value.trim();
      if (bodyVal) parts.push(`  -d '${bodyVal.replace(/'/g, "'\\''")}'`);
    } else if (STATE.bodyType === 'text') {
      const bodyVal = document.getElementById('bodyTextarea').value.trim();
      if (bodyVal) parts.push(`  -d '${bodyVal.replace(/'/g, "'\\''")}'`);
    } else if (STATE.bodyType === 'urlencoded') {
      const urlParams = new URLSearchParams();
      getEffectiveKvData('urlencodedEditor', 'urlencoded').forEach(d => {
        if (d.enabled && d.key.trim()) urlParams.append(d.key, d.value);
      });
      const encoded = urlParams.toString();
      if (encoded) parts.push(`  -d '${encoded}'`);
    } else if (STATE.bodyType === 'formdata') {
      getEffectiveKvData('formdataEditor', 'formdata').forEach(d => {
        if (d.enabled && d.key.trim()) {
          parts.push(`  -F '${d.key}=${d.value.replace(/'/g, "'\\''")}'`);
        }
      });
    }
  }

  parts.push(`  '${finalUrl}'`);
  const curlText = parts.join(' \\\n');
  showCurlModal(curlText);
}

function showCurlModal(curlText) {
  const overlay = document.createElement('div');
  overlay.className = 'curl-modal-overlay';
  overlay.onclick = (e) => { if (e.target === overlay) overlay.remove(); };
  overlay.innerHTML = `
    <div class="curl-modal">
      <div class="curl-modal-header">
        <span class="curl-modal-title">cURL 命令</span>
        <button class="curl-modal-close" data-action="close-curl-modal">✕</button>
      </div>
      <div class="curl-modal-body">
        <pre id="curlOutput">${escapeHtml(curlText)}</pre>
      </div>
      <div class="curl-modal-footer">
        <button class="curl-copy-btn" data-action="copy-curl">复制 cURL</button>
      </div>
    </div>
  `;
  document.body.appendChild(overlay);
}

function copyCurl() {
  const pre = document.getElementById('curlOutput');
  if (pre) {
    navigator.clipboard.writeText(pre.textContent).then(() => {
      toast('cURL 已复制到剪贴板', 'success');
    }).catch(() => {
      toast('复制失败', 'error');
    });
  }
}

// ============================================
// SEND AND DOWNLOAD (Extension: use background.js)
// ============================================
async function sendAndDownload() {
  syncCurrentApi();
  const url = document.getElementById('urlInput').value.trim();
  if (!url) { toast('请输入请求URL', 'error'); document.getElementById('urlInput').focus(); return; }

  const btn = document.getElementById('sendBtn');
  btn.classList.add('loading');
  let finalUrl = '';

  try {
    const method = STATE.currentMethod;
    const allHeaders = {};
    const headerData = getEffectiveKvData('headersEditor', 'headers');
    headerData.forEach(h => { if (h.enabled && h.key.trim()) allHeaders[h.key] = h.value; });

    if (STATE.authType === 'bearer') {
      const token = document.getElementById('bearerToken').value;
      if (token) allHeaders['Authorization'] = `Bearer ${token}`;
    } else if (STATE.authType === 'basic') {
      const user = document.getElementById('basicUser').value;
      const pass = document.getElementById('basicPass').value;
      if (user) allHeaders['Authorization'] = `Basic ${btoa(user + ':' + pass)}`;
    }

    finalUrl = url;
    const params = getEffectiveKvData('paramsEditor', 'params');
    const enabledParams = params.filter(p => p.enabled && p.key.trim());
    if (enabledParams.length > 0) {
      try {
        const urlObj = new URL(url.startsWith('http') ? url : 'https://' + url);
        enabledParams.forEach(p => urlObj.searchParams.append(p.key, p.value));
        finalUrl = urlObj.toString();
      } catch (e) {
        const sep = finalUrl.includes('?') ? '&' : '?';
        const qs = enabledParams.map(p => encodeURIComponent(p.key) + '=' + encodeURIComponent(p.value)).join('&');
        finalUrl = finalUrl + sep + qs;
      }
    }
    if (!finalUrl.startsWith('http://') && !finalUrl.startsWith('https://')) finalUrl = 'https://' + finalUrl;

    let body = null;
    let formdataFields = null;
    if (!['GET', 'HEAD'].includes(method)) {
      if (STATE.bodyType === 'json') {
        const bodyVal = document.getElementById('bodyTextarea').value;
        if (bodyVal.trim()) { body = bodyVal; if (!allHeaders['Content-Type']) allHeaders['Content-Type'] = 'application/json'; }
      } else if (STATE.bodyType === 'text') {
        const bodyVal = document.getElementById('bodyTextarea').value;
        if (bodyVal.trim()) { body = bodyVal; if (!allHeaders['Content-Type']) allHeaders['Content-Type'] = 'text/plain'; }
      } else if (STATE.bodyType === 'urlencoded') {
        const urlParams = new URLSearchParams();
        getEffectiveKvData('urlencodedEditor', 'urlencoded').forEach(d => {
          if (d.enabled && d.key.trim()) urlParams.append(d.key, d.value);
        });
        body = urlParams.toString();
        if (!allHeaders['Content-Type']) allHeaders['Content-Type'] = 'application/x-www-form-urlencoded';
      } else if (STATE.bodyType === 'formdata') {
        formdataFields = getEffectiveKvData('formdataEditor', 'formdata');
      }
    }

    // Use background.js to make the request (no CORS)
    const result = await chrome.runtime.sendMessage({
      type: 'DOWNLOAD_REQUEST',
      data: { method, url: finalUrl, headers: allHeaders, body, bodyType: STATE.bodyType, formdataFields }
    });

    if (!result.success) throw new Error(result.error || '下载失败');

    // Decode base64 data and trigger download
    const byteString = atob(result.data.base64);
    const ab = new ArrayBuffer(byteString.length);
    const ia = new Uint8Array(ab);
    for (let i = 0; i < byteString.length; i++) ia[i] = byteString.charCodeAt(i);
    const blob = new Blob([ab], { type: result.data.contentType || 'application/octet-stream' });

    const filename = result.data.filename || 'download';
    const blobUrl = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = blobUrl;
    a.download = filename;
    document.body.appendChild(a);
    a.click();
    document.body.removeChild(a);
    URL.revokeObjectURL(blobUrl);

    toast(`文件已下载: ${filename}`, 'success');
  } catch (err) {
    toast('下载失败: ' + err.message, 'error');
  } finally {
    btn.classList.remove('loading');
  }
}

function updateKvCount(type) {
  const editorId = type === 'params' ? 'paramsEditor' : 'headersEditor';
  const badgeId = type === 'params' ? 'paramsCount' : 'headersCount';
  const data = getKvData(editorId);
  const count = data.filter(d => d.key.trim()).length;
  const badge = document.getElementById(badgeId);
  if (count > 0) {
    badge.textContent = count;
    badge.style.display = 'inline';
  } else {
    badge.style.display = 'none';
  }
}

// ============================================
// BODY TYPE
// ============================================
function selectBodyType(type) {
  STATE.bodyType = type;
  document.querySelectorAll('.body-type-btn').forEach(b => b.classList.remove('active'));
  document.querySelector(`.body-type-btn[data-btype="${type}"]`).classList.add('active');

  document.getElementById('bodyTextWrap').style.display = (type === 'json' || type === 'text') ? 'block' : 'none';
  document.getElementById('bodyToolbar').style.display = type === 'json' ? 'flex' : 'none';
  document.getElementById('bodyNone').style.display = type === 'none' ? 'block' : 'none';
  document.getElementById('bodyFormdata').style.display = type === 'formdata' ? 'block' : 'none';
  document.getElementById('bodyUrlencoded').style.display = type === 'urlencoded' ? 'block' : 'none';

  if (type === 'text') {
    document.getElementById('bodyTextarea').placeholder = '输入纯文本内容...';
  } else {
    document.getElementById('bodyTextarea').placeholder = '{"key": "value"}';
  }
}

function formatJsonBody() {
  const textarea = document.getElementById('bodyTextarea');
  const raw = textarea.value.trim();
  if (!raw) return;
  try {
    const obj = JSON.parse(raw);
    textarea.value = JSON.stringify(obj, null, 2);
    syncCurrentApi();
  } catch (e) {
    textarea.style.borderColor = 'var(--method-delete)';
    setTimeout(() => { textarea.style.borderColor = ''; }, 1500);
  }
}

function compressJsonBody() {
  const textarea = document.getElementById('bodyTextarea');
  const raw = textarea.value.trim();
  if (!raw) return;
  try {
    const obj = JSON.parse(raw);
    textarea.value = JSON.stringify(obj);
    syncCurrentApi();
  } catch (e) {
    textarea.style.borderColor = 'var(--method-delete)';
    setTimeout(() => { textarea.style.borderColor = ''; }, 1500);
  }
}

// ============================================
// AUTH
// ============================================
function selectAuthType(type) {
  STATE.authType = type;
  document.querySelectorAll('.auth-type-btn').forEach(b => b.classList.remove('active'));
  document.querySelector(`.auth-type-btn[data-auth="${type}"]`).classList.add('active');

  document.getElementById('authNone').style.display = type === 'none' ? 'block' : 'none';
  document.getElementById('authBearer').style.display = type === 'bearer' ? 'block' : 'none';
  document.getElementById('authBasic').style.display = type === 'basic' ? 'block' : 'none';
}

// ============================================
// SEND REQUEST
// ============================================
async function sendRequest() {
  syncCurrentApi();

  const url = document.getElementById('urlInput').value.trim();
  if (!url) {
    toast('请输入请求URL', 'error');
    document.getElementById('urlInput').focus();
    return;
  }

  const btn = document.getElementById('sendBtn');
  btn.classList.add('loading');

  let finalUrl = '';

  try {
    const method = STATE.currentMethod;
    const allHeaders = {};
    const headerData = getEffectiveKvData('headersEditor', 'headers');
    headerData.forEach(h => {
      if (h.enabled && h.key.trim()) {
        allHeaders[h.key] = h.value;
      }
    });

    // Auth
    if (STATE.authType === 'bearer') {
      const token = document.getElementById('bearerToken').value;
      if (token) allHeaders['Authorization'] = `Bearer ${token}`;
    } else if (STATE.authType === 'basic') {
      const user = document.getElementById('basicUser').value;
      const pass = document.getElementById('basicPass').value;
      if (user) allHeaders['Authorization'] = `Basic ${btoa(user + ':' + pass)}`;
    }

    // Build URL with params
    finalUrl = url;
    const params = getEffectiveKvData('paramsEditor', 'params');
    const enabledParams = params.filter(p => p.enabled && p.key.trim());
    if (enabledParams.length > 0) {
      try {
        const urlObj = new URL(url.startsWith('http') ? url : 'https://' + url);
        enabledParams.forEach(p => urlObj.searchParams.append(p.key, p.value));
        finalUrl = urlObj.toString();
      } catch (e) {
        const sep = finalUrl.includes('?') ? '&' : '?';
        const qs = enabledParams.map(p => encodeURIComponent(p.key) + '=' + encodeURIComponent(p.value)).join('&');
        finalUrl = finalUrl + sep + qs;
      }
    }

    if (!finalUrl.startsWith('http://') && !finalUrl.startsWith('https://')) {
      finalUrl = 'https://' + finalUrl;
    }

    // Build body
    let body = null;
    let formdataFields = null;
    const currentUrlencoded = STATE.bodyType === 'urlencoded' ? getEffectiveKvData('urlencodedEditor', 'urlencoded') : [];
    const currentFormdata = STATE.bodyType === 'formdata' ? getEffectiveKvData('formdataEditor', 'formdata') : [];
    if (!['GET', 'HEAD'].includes(method)) {
      if (STATE.bodyType === 'json') {
        const bodyVal = document.getElementById('bodyTextarea').value;

        if (bodyVal.trim()) {
          body = bodyVal;
          if (!allHeaders['Content-Type']) allHeaders['Content-Type'] = 'application/json';
        }
      } else if (STATE.bodyType === 'text') {
        const bodyVal = document.getElementById('bodyTextarea').value;
        if (bodyVal.trim()) {
          body = bodyVal;
          if (!allHeaders['Content-Type']) allHeaders['Content-Type'] = 'text/plain';
        }
      } else if (STATE.bodyType === 'urlencoded') {
        const urlParams = new URLSearchParams();
        getEffectiveKvData('urlencodedEditor', 'urlencoded').forEach(d => {
          if (d.enabled && d.key.trim()) urlParams.append(d.key, d.value);
        });
        body = urlParams.toString();
        if (!allHeaders['Content-Type']) allHeaders['Content-Type'] = 'application/x-www-form-urlencoded';
      } else if (STATE.bodyType === 'formdata') {
        formdataFields = getEffectiveKvData('formdataEditor', 'formdata');
      }
    }

    // ---- Execute Pre-request Script (Group level first, then request level) ----
    const currentApi = STATE.apis[STATE.currentApiId];
    const groupName = currentApi ? (currentApi.group || '默认分组') : '';
    const groupScript = groupName ? getGroupScript(groupName) : '';

    // Execute group-level script first
    if (groupScript.trim()) {
      try {
        appendScriptLog('log', `[分组: ${groupName}] 执行分组级 Pre-request Script...`);
        const groupResult = await executePreRequestScriptAsync(
          groupScript,
          allHeaders,
          finalUrl,
          body,
          currentUrlencoded,
          currentFormdata
        );
        if (groupResult.headers) {
          Object.keys(groupResult.headers).forEach(k => { allHeaders[k] = groupResult.headers[k]; });
        }
        if (groupResult.url && groupResult.url !== finalUrl) finalUrl = groupResult.url;
        if (groupResult.body !== undefined && groupResult.body !== null) body = groupResult.body;
        if (groupResult.urlencoded && groupResult.urlencoded.length > 0 && STATE.bodyType === 'urlencoded') {
          const urlParams = new URLSearchParams();
          groupResult.urlencoded.forEach(d => { if (d.enabled && d.key.trim()) urlParams.append(d.key, d.value); });
          body = urlParams.toString();
        }
        if (groupResult.formdata && groupResult.formdata.length > 0 && STATE.bodyType === 'formdata') formdataFields = groupResult.formdata;
      } catch (scriptErr) {
        appendScriptLog('error', '分组级 Pre-request Script 执行异常: ' + scriptErr.message);
      }
    }

    // Execute request-level script
    const scriptText = document.getElementById('preRequestScript')?.value || '';
    if (scriptText.trim()) {
      try {
        const scriptResult = await executePreRequestScriptAsync(
          scriptText,
          allHeaders,
          finalUrl,
          body,
          currentUrlencoded,
          currentFormdata
        );
        // Apply script modifications
        if (scriptResult.headers) {
          Object.keys(scriptResult.headers).forEach(k => { allHeaders[k] = scriptResult.headers[k]; });
        }
        if (scriptResult.url && scriptResult.url !== finalUrl) {
          finalUrl = scriptResult.url;
        }
        if (scriptResult.body !== undefined && scriptResult.body !== null) {
          body = scriptResult.body;
        }
        if (scriptResult.urlencoded && scriptResult.urlencoded.length > 0 && STATE.bodyType === 'urlencoded') {
          const urlParams = new URLSearchParams();
          scriptResult.urlencoded.forEach(d => {
            if (d.enabled && d.key.trim()) urlParams.append(d.key, d.value);
          });
          body = urlParams.toString();
        }
        if (scriptResult.formdata && scriptResult.formdata.length > 0 && STATE.bodyType === 'formdata') {
          formdataFields = scriptResult.formdata;
        }
      } catch (scriptErr) {
        appendScriptLog('error', 'Pre-request Script 执行异常: ' + scriptErr.message);
      }
    }

    // ---- Resolve {{variable}} templates in URL and Headers ----
    finalUrl = resolveTemplateVars(finalUrl);
    Object.keys(allHeaders).forEach(k => {
      allHeaders[k] = resolveTemplateVars(allHeaders[k]);
    });
    if (body && typeof body === 'string') {
      body = resolveTemplateVars(body);
    }

    // ---- Send request (streaming or normal) ----
    if (STATE.streamingEnabled) {
      // Streaming request
      await sendStreamingRequest(method, finalUrl, allHeaders, body, formdataFields);
      return;
    }

    // ---- Send via Chrome Extension API (normal, no CORS restriction) ----
    const startTime = performance.now();
    const result = await chrome.runtime.sendMessage({
      type: 'API_REQUEST',
      data: {
        method,
        url: finalUrl,
        headers: allHeaders,
        body,
        bodyType: STATE.bodyType,
        formdataFields,
      }
    });
    const endTime = performance.now();
    const duration = Math.round(endTime - startTime);

    if (!result.success) {
      throw new Error(result.error || '请求失败');
    }

    const data = result.data;
    const statusClass = data.status < 300 ? 'success' :
                        data.status < 400 ? 'redirect' :
                        data.status < 500 ? 'client-err' : 'server-err';

    const sizeStr = data.size > 1024 ? (data.size / 1024).toFixed(1) + ' KB' : data.size + ' B';

    // Update UI - Status
    const statusEl = document.getElementById('responseStatus');
    statusEl.style.display = 'flex';
    const codeEl = document.getElementById('statusCode');
    codeEl.textContent = data.status + ' ' + data.statusText;
    codeEl.className = 'status-code ' + statusClass;
    document.getElementById('responseTime').textContent = duration;
    document.getElementById('responseSize').textContent = sizeStr;

    // Render body
    const bodyEl = document.getElementById('responseBody');
    if (data.body) {
      const highlighted = highlightJSON(data.body);
      bodyEl.innerHTML = `<button class="copy-btn">📋 复制</button><pre>${highlighted}</pre>`;
    } else {
      bodyEl.innerHTML = '<div class="empty-state"><div class="empty-icon">✓</div><div class="empty-title">空响应</div></div>';
    }

    // Render headers
    const headersEl = document.getElementById('responseHeaders');
    if (data.headers && data.headers.length > 0) {
      let hhtml = '<table class="headers-table"><thead><tr><th>Key</th><th>Value</th></tr></thead><tbody>';
      data.headers.forEach(h => {
        hhtml += `<tr><td>${escapeHtml(h.key)}</td><td>${escapeHtml(h.value)}</td></tr>`;
      });
      hhtml += '</tbody></table>';
      headersEl.innerHTML = hhtml;
    } else {
      headersEl.innerHTML = '<div class="empty-state"><div class="empty-icon">📋</div><div class="empty-title">暂无响应头</div></div>';
    }

    // Record history
    addHistoryEntry({
      id: 'hist_' + Date.now() + '_' + Math.random().toString(36).substring(2, 8),
      apiId: STATE.currentApiId,
      method,
      url: finalUrl,
      status: data.status,
      statusText: data.statusText,
      duration,
      size: sizeStr,
      timestamp: Date.now(),
      bodyType: STATE.bodyType,
      headers: getEffectiveKvData('headersEditor', 'headers'),
      params: getEffectiveKvData('paramsEditor', 'params'),
      body: STATE.bodyType === 'json' || STATE.bodyType === 'text' ? document.getElementById('bodyTextarea').value : '',
      formdata: STATE.bodyType === 'formdata' ? getEffectiveKvData('formdataEditor', 'formdata') : [],
      urlencoded: STATE.bodyType === 'urlencoded' ? getEffectiveKvData('urlencodedEditor', 'urlencoded') : [],
      authType: STATE.authType,
      bearerToken: document.getElementById('bearerToken')?.value || '',
      basicUser: document.getElementById('basicUser')?.value || '',
      basicPass: document.getElementById('basicPass')?.value || '',
    });

  } catch (err) {
    // Error case - also record to history
    addHistoryEntry({
      id: 'hist_' + Date.now() + '_' + Math.random().toString(36).substring(2, 8),
      apiId: STATE.currentApiId,
      method: STATE.currentMethod,
      url: finalUrl || '',
      status: 0,
      statusText: 'Error',
      duration: 0,
      size: '-',
      timestamp: Date.now(),
      bodyType: STATE.bodyType,
      headers: getEffectiveKvData('headersEditor', 'headers'),
      params: getEffectiveKvData('paramsEditor', 'params'),
      body: '',
      formdata: [],
      urlencoded: [],
      authType: STATE.authType,
    });
    const statusEl = document.getElementById('responseStatus');
    statusEl.style.display = 'flex';
    const codeEl = document.getElementById('statusCode');
    codeEl.textContent = 'Error';
    codeEl.className = 'status-code client-err';
    document.getElementById('responseTime').textContent = '-';
    document.getElementById('responseSize').textContent = '-';

    const bodyEl = document.getElementById('responseBody');
    bodyEl.innerHTML = `<div class="empty-state"><div class="empty-icon">❌</div><div class="empty-title">请求失败</div><div class="empty-desc">${escapeHtml(err.message)}</div></div>`;

    if (err.message.includes('Failed to fetch') || err.message.includes('NetworkError')) {
      bodyEl.innerHTML += `<div style="text-align:center;padding:16px;font-size:12px;color:var(--text-muted);max-width:500px;margin:0 auto;line-height:1.8;">
        <strong style="color:var(--status-redirect);">🔧 可能的原因：</strong><br><br>
        <strong>1. 服务器不可达</strong><br>
        <em>→ 确认URL正确，服务器运行中</em><br><br>
        <strong>2. SSL证书问题</strong><br>
        <em>→ 确认HTTPS证书有效</em><br><br>
        <strong>3. DNS解析失败</strong><br>
        <em>→ 检查域名是否正确</em>
      </div>`;
    }
  } finally {
    btn.classList.remove('loading');
  }
}

function clearResponse() {
  document.getElementById('responseStatus').style.display = 'none';
  document.getElementById('responseBody').innerHTML = '<div class="empty-state"><div class="empty-icon">📡</div><div class="empty-title">等待请求</div><div class="empty-desc">点击"发送"按钮执行请求</div></div>';
  document.getElementById('responseHeaders').innerHTML = '<div class="empty-state"><div class="empty-icon">📋</div><div class="empty-title">暂无响应头</div></div>';
}

function copyResponse() {
  const pre = document.querySelector('#responseBody pre');
  if (pre) {
    navigator.clipboard.writeText(pre.textContent).then(() => {
      toast('已复制到剪贴板', 'success');
    });
  }
}

// ============================================
// JSON SYNTAX HIGHLIGHTING
// ============================================
function highlightJSON(str) {
  // Escape HTML first
  str = escapeHtml(str);

  // Highlight JSON
  return str.replace(
    /("(\\u[a-fA-F0-9]{4}|\\[^u]|[^\\"])*"(\s*:)?|\b(true|false|null)\b|-?\d+(?:\.\d*)?(?:[eE][+\-]?\d+)?)/g,
    (match) => {
      let cls = 'json-number';
      if (/^"/.test(match)) {
        if (/:$/.test(match)) {
          cls = 'json-key';
        } else {
          cls = 'json-string';
        }
      } else if (/true|false/.test(match)) {
        cls = 'json-boolean';
      } else if (/null/.test(match)) {
        cls = 'json-null';
      }
      return `<span class="${cls}">${match}</span>`;
    }
  );
}

// ============================================
// SAVE
// ============================================
function showSaveModal() {
  syncCurrentApi();

  const api = STATE.apis[STATE.currentApiId];
  if (!api) {
    toast('请先选择或创建一个接口', 'info');
    return;
  }

  document.getElementById('saveName').value = api.name || '';
  updateGroupSelects();
  document.getElementById('saveGroup').value = api.group || '';
  document.getElementById('saveNewGroup').value = '';
  document.getElementById('saveModal').classList.add('show');
  document.getElementById('saveName').focus();
}

function closeSaveModal() {
  document.getElementById('saveModal').classList.remove('show');
}

function doSave() {
  const name = document.getElementById('saveName').value.trim();
  if (!name) {
    toast('请输入接口名称', 'error');
    return;
  }

  const api = STATE.apis[STATE.currentApiId];
  if (!api) return;

  let newGroup = document.getElementById('saveNewGroup').value.trim();
  let group = newGroup || document.getElementById('saveGroup').value || '默认分组';

  // Move between groups if changed
  const oldGroup = api.group || '默认分组';
  if (oldGroup !== group) {
    if (getGroupApiIds(oldGroup).length > 0) {
      removeFromGroup(oldGroup, api.id);
    }
    if (!STATE.groups[group]) {
      ensureGroupFormat(group);
      if (!STATE.groupOrder.includes(group)) {
        STATE.groupOrder.push(group);
      }
    }
    addToGroup(group, api.id);
  }

  api.name = name;
  api.group = group;

  saveToStorage();
  renderSidebar();
  updateGroupSelects();
  closeSaveModal();
  toast('接口已保存', 'success');
}

// ============================================
// IMPORT
// ============================================
function showImportModal() {
  document.getElementById('importTextarea').value = '';
  document.getElementById('importTextarea').placeholder = '粘贴cURL命令...\n\n示例: curl -X GET https://api.example.com/users -H \'Authorization: Bearer token123\'';
  document.getElementById('importFileRow').style.display = 'none';
  document.getElementById('importFileName').textContent = '';
  const fileInput = document.getElementById('importFileInput');
  if (fileInput) fileInput.value = '';
  updateGroupSelects();
  document.getElementById('importGroup').value = '';
  document.getElementById('importModal').classList.add('show');
  document.getElementById('importTextarea').focus();
}

function closeImportModal() {
  document.getElementById('importModal').classList.remove('show');
}

function selectImportType(type) {
  STATE.importType = type;
  document.querySelectorAll('.import-type-btn').forEach(b => b.classList.remove('active'));
  document.querySelector(`.import-type-btn[data-itype="${type}"]`).classList.add('active');
  const ta = document.getElementById('importTextarea');
  const fileRow = document.getElementById('importFileRow');
  if (type === 'curl') {
    ta.placeholder = "粘贴cURL命令...\n\n示例: curl -X GET https://api.example.com/users -H 'Authorization: Bearer token123'";
    fileRow.style.display = 'none';
  } else {
    ta.placeholder = "粘贴Postman导出的JSON，或点击上方按钮选择文件...\n\n支持Postman Collection v2.1格式";
    fileRow.style.display = 'flex';
  }
}

function handleImportFile(input) {
  const file = input.files[0];
  if (!file) return;
  if (!file.name.endsWith('.json')) {
    toast('请选择 .json 文件', 'error');
    input.value = '';
    return;
  }
  const reader = new FileReader();
  reader.onload = function(e) {
    document.getElementById('importTextarea').value = e.target.result;
    document.getElementById('importFileName').textContent = '✓ ' + file.name;
  };
  reader.onerror = function() {
    toast('文件读取失败', 'error');
  };
  reader.readAsText(file);
}

function doImport() {
  const text = document.getElementById('importTextarea').value.trim();
  if (!text) {
    toast('请粘贴内容', 'error');
    return;
  }

  try {
    if (STATE.importType === 'curl') {
      importCurl(text);
    } else {
      importPostman(text);
    }
  } catch (err) {
    toast('导入失败: ' + err.message, 'error');
  }
}

function importCurl(curlStr) {
  const api = {
    id: generateId(),
    name: '',
    method: 'GET',
    url: '',
    headers: [],
    params: [],
    bodyType: 'none',
    body: '',
    formdata: [],
    urlencoded: [],
    authType: 'none',
    bearerToken: '',
    basicUser: '',
    basicPass: '',
    preRequestScript: '',
    group: '',
    createdAt: Date.now(),
    updatedAt: Date.now(),
  };

  // Step 1: Tokenize the curl command with proper quote handling
  const tokens = tokenizeCurl(curlStr);

  // Step 2: Parse tokens into structured data
  let i = 0;

  // Skip 'curl' command itself
  if (tokens.length > 0 && tokens[0].toLowerCase() === 'curl') {
    i = 1;
  }

  while (i < tokens.length) {
    const token = tokens[i];

    if (token === '-X' || token === '--request') {
      // HTTP Method
      i++;
      if (i < tokens.length) {
        api.method = tokens[i].toUpperCase();
      }
    } else if (token === '-H' || token === '--header') {
      // Header
      i++;
      if (i < tokens.length) {
        const headerStr = tokens[i];
        const colonIdx = headerStr.indexOf(':');
        if (colonIdx > 0) {
          const key = headerStr.substring(0, colonIdx).trim();
          const value = headerStr.substring(colonIdx + 1).trim();
          api.headers.push({ key, value, enabled: true });

          // Detect auth
          if (key.toLowerCase() === 'authorization') {
            if (value.startsWith('Bearer ')) {
              api.authType = 'bearer';
              api.bearerToken = value.replace('Bearer ', '');
            } else if (value.startsWith('Basic ')) {
              api.authType = 'basic';
              try {
                const decoded = atob(value.replace('Basic ', ''));
                const [u, p] = decoded.split(':');
                api.basicUser = u || '';
                api.basicPass = p || '';
              } catch (e) {}
            }
          }
        }
      }
    } else if (token === '-b' || token === '--cookie' || token === '-c' || token === '--cookie-jar') {
      // Cookie
      i++;
      if (i < tokens.length) {
        const cookieStr = tokens[i];
        // Add as Cookie header
        const existingCookie = api.headers.find(h => h.key.toLowerCase() === 'cookie');
        if (existingCookie) {
          existingCookie.value = existingCookie.value + '; ' + cookieStr;
        } else {
          api.headers.push({ key: 'Cookie', value: cookieStr, enabled: true });
        }
      }
    } else if (token === '-d' || token === '--data' || token === '--data-raw' || token === '--data-binary') {
      // Body data
      i++;
      if (i < tokens.length) {
        api.body = tokens[i];
        api.bodyType = 'json';
        if (api.method === 'GET') api.method = 'POST';

        // Detect body type based on Content-Type header
        const hasFormUrlencoded = api.headers.some(h => h.key.toLowerCase() === 'content-type' && h.value.includes('x-www-form-urlencoded'));
        if (hasFormUrlencoded) {
          api.bodyType = 'urlencoded';
          api.urlencoded = [];
          tokens[i].split('&').forEach(pair => {
            const eqIdx = pair.indexOf('=');
            if (eqIdx > 0) {
              api.urlencoded.push({ key: decodeURIComponent(pair.substring(0, eqIdx)), value: decodeURIComponent(pair.substring(eqIdx + 1)), enabled: true });
            }
          });
        } else {
          try { JSON.parse(api.body); } catch (e) { api.bodyType = 'text'; }
        }

        // Remove Content-Type header if it's auto-managed by body type
        api.headers = api.headers.filter(h => {
          const k = h.key.toLowerCase();
          if (k === 'content-type') {
            if (api.bodyType === 'json' && h.value.toLowerCase().includes('json')) return false;
            if (api.bodyType === 'text' && h.value.toLowerCase().includes('text/plain')) return false;
            if (api.bodyType === 'urlencoded' && h.value.toLowerCase().includes('x-www-form-urlencoded')) return false;
          }
          return true;
        });
      }
    } else if (token === '-F' || token === '--form') {
      // Form data
      i++;
      if (i < tokens.length) {
        api.bodyType = 'formdata';
        if (api.method === 'GET') api.method = 'POST';
        const eqIdx = tokens[i].indexOf('=');
        if (eqIdx > 0) {
          api.formdata.push({ key: tokens[i].substring(0, eqIdx), value: tokens[i].substring(eqIdx + 1), enabled: true });
        }
      }
    } else if (token === '-u' || token === '--user') {
      // Basic auth
      i++;
      if (i < tokens.length) {
        api.authType = 'basic';
        const colonIdx = tokens[i].indexOf(':');
        if (colonIdx > 0) {
          api.basicUser = tokens[i].substring(0, colonIdx);
          api.basicPass = tokens[i].substring(colonIdx + 1);
        } else {
          api.basicUser = tokens[i];
        }
      }
    } else if (token === '-A' || token === '--user-agent') {
      // User-Agent
      i++;
      if (i < tokens.length) {
        const existing = api.headers.find(h => h.key.toLowerCase() === 'user-agent');
        if (existing) {
          existing.value = tokens[i];
        } else {
          api.headers.push({ key: 'User-Agent', value: tokens[i], enabled: true });
        }
      }
    } else if (token === '-e' || token === '--referer') {
      // Referer
      i++;
      if (i < tokens.length) {
        const existing = api.headers.find(h => h.key.toLowerCase() === 'referer');
        if (existing) {
          existing.value = tokens[i];
        } else {
          api.headers.push({ key: 'Referer', value: tokens[i], enabled: true });
        }
      }
    } else if (token === '--compressed' || token === '-k' || token === '--insecure' || token === '-L' || token === '--location' || token === '-v' || token === '--verbose' || token === '-s' || token === '--silent' || token === '-S' || token === '--show-error') {
      // Flags with no value - skip
    } else if (token === '-o' || token === '--output' || token === '--max-time' || token === '-m' || token === '--connect-timeout') {
      // Flags with value - skip value too
      i++;
    } else if (!token.startsWith('-') && !api.url) {
      // This should be the URL
      api.url = token;
    }

    i++;
  }

  if (!api.url) {
    toast('无法解析URL，请检查cURL格式', 'error');
    return;
  }

  // Parse URL query params
  try {
    const urlObj = new URL(api.url.startsWith('http') ? api.url : 'https://' + api.url);
    urlObj.searchParams.forEach((value, key) => {
      api.params.push({ key, value, enabled: true });
    });
    // Clean URL without query params
    if (api.params.length > 0) {
      api.url = urlObj.origin + urlObj.pathname;
    }
  } catch (e) {}

  // Generate name from URL
  const urlPath = api.url.replace(/^https?:\/\//, '');
  api.name = api.method + ' ' + (urlPath.split('/').pop() || urlPath);

  // Assign group
  const group = document.getElementById('importGroup').value || '默认分组';
  api.group = group;
  if (!STATE.groups[group]) {
    ensureGroupFormat(group);
    STATE.groupOrder.push(group);
  }
  addToGroup(group, api.id);
  STATE.apis[api.id] = api;

  saveToStorage();
  renderSidebar();
  updateGroupSelects();
  closeImportModal();
  loadApi(api.id);
  toast(`cURL导入成功，已解析 ${api.headers.length} 个Header`, 'success');
}

/**
 * Tokenize a curl command string, properly handling:
 * - Single and double quoted strings (with internal quotes of the other type)
 * - Line continuations (backslash + newline)
 * - Escape sequences within quotes
 */
function tokenizeCurl(input) {
  // Step 1: Remove line continuations (\ followed by newline)
  let str = input.replace(/\\\r?\n/g, ' ');

  const tokens = [];
  let pos = 0;
  const len = str.length;

  while (pos < len) {
    // Skip whitespace
    while (pos < len && /\s/.test(str[pos])) pos++;
    if (pos >= len) break;

    const char = str[pos];

    if (char === "'" || char === '"') {
      // Quoted string - read until matching close quote
      // Within single quotes: no escaping at all
      // Within double quotes: \" and \\ are escapes
      const quote = char;
      pos++; // skip opening quote
      let value = '';

      if (quote === "'") {
        // Single quotes: find closing quote, no escape processing
        const closeIdx = str.indexOf("'", pos);
        if (closeIdx === -1) {
          // No closing quote, take rest
          value = str.substring(pos);
          pos = len;
        } else {
          value = str.substring(pos, closeIdx);
          pos = closeIdx + 1;
        }
      } else {
        // Double quotes: process \" and \\ escapes
        while (pos < len) {
          if (str[pos] === '\\' && pos + 1 < len && (str[pos + 1] === '"' || str[pos + 1] === '\\')) {
            value += str[pos + 1];
            pos += 2;
          } else if (str[pos] === '"') {
            pos++; // skip closing quote
            break;
          } else {
            value += str[pos];
            pos++;
          }
        }
      }

      tokens.push(value);
    } else if (char === '-' && pos + 1 < len && /[a-zA-Z]/.test(str[pos + 1])) {
      // Option flag like -X, -H, -d, etc.
      let flag = '';
      while (pos < len && !/\s/.test(str[pos])) {
        flag += str[pos];
        pos++;
      }
      tokens.push(flag);
    } else if (char === '-' && pos + 1 < len && str[pos + 1] === '-') {
      // Long option like --data, --header
      let flag = '';
      while (pos < len && !/\s/.test(str[pos]) && str[pos] !== '=') {
        flag += str[pos];
        pos++;
      }
      // Handle --flag=value syntax (e.g. --data-raw='...')
      if (pos < len && str[pos] === '=') {
        pos++; // skip =
        if (pos < len) {
          if (str[pos] === "'" || str[pos] === '"') {
            const eq = str[pos];
            pos++;
            let val = '';
            if (eq === "'") {
              const closeIdx = str.indexOf("'", pos);
              if (closeIdx === -1) {
                val = str.substring(pos);
                pos = len;
              } else {
                val = str.substring(pos, closeIdx);
                pos = closeIdx + 1;
              }
            } else {
              while (pos < len) {
                if (str[pos] === '\\' && pos + 1 < len && (str[pos + 1] === '"' || str[pos + 1] === '\\')) {
                  val += str[pos + 1];
                  pos += 2;
                } else if (str[pos] === '"') {
                  pos++;
                  break;
                } else {
                  val += str[pos];
                  pos++;
                }
              }
            }
            tokens.push(flag);
            tokens.push(val);
          } else {
            let val = '';
            while (pos < len && !/\s/.test(str[pos])) {
              val += str[pos];
              pos++;
            }
            tokens.push(flag);
            tokens.push(val);
          }
        } else {
          tokens.push(flag);
        }
      } else {
        tokens.push(flag);
      }
    } else {
      // Unquoted word - read until whitespace
      let word = '';
      while (pos < len && !/\s/.test(str[pos])) {
        word += str[pos];
        pos++;
      }
      tokens.push(word);
    }
  }

  return tokens;
}

function importPostman(jsonStr) {
  const data = JSON.parse(jsonStr);
  const group = document.getElementById('importGroup').value || 'Postman导入';
  let importedCount = 0;

  // Postman Collection v2.1
  if (data.info && data.item) {
    if (!STATE.groups[group]) {
      ensureGroupFormat(group);
      STATE.groupOrder.push(group);
    }

    function processItems(items, parentGroup) {
      items.forEach(item => {
        if (item.item) {
          // This is a folder
          const subGroup = parentGroup + ' / ' + item.name;
          if (!STATE.groups[subGroup]) {
            ensureGroupFormat(subGroup);
            STATE.groupOrder.push(subGroup);
          }
          processItems(item.item, subGroup);
        } else if (item.request) {
          const req = item.request;
          const api = {
            id: generateId(),
            name: item.name || '未命名',
            method: (req.method || 'GET').toUpperCase(),
            url: '',
            headers: [],
            params: [],
            bodyType: 'none',
            body: '',
            formdata: [],
            urlencoded: [],
            authType: 'none',
            bearerToken: '',
            basicUser: '',
            basicPass: '',
            preRequestScript: '',
            group: parentGroup,
            createdAt: Date.now(),
            updatedAt: Date.now(),
          };

          // URL
          if (typeof req.url === 'string') {
            api.url = req.url;
          } else if (req.url && req.url.raw) {
            api.url = req.url.raw;
          }

          // Parse URL params (from raw URL + structured query array)
          try {
            const urlStr = api.url.startsWith('http') ? api.url : 'https://' + api.url;
            const urlObj = new URL(urlStr);
            urlObj.searchParams.forEach((v, k) => {
              api.params.push({ key: k, value: v, enabled: true });
            });
            api.url = urlObj.origin + urlObj.pathname;
          } catch (e) {
            if (req.url && req.url.query && req.url.query.length > 0) {
              req.url.query.forEach(q => {
                if (q.key) api.params.push({ key: q.key, value: q.value || '', enabled: !q.disabled });
              });
              const qIdx = api.url.indexOf('?');
              if (qIdx > 0) api.url = api.url.substring(0, qIdx);
            }
          }

          // Headers
          if (req.header) {
            req.header.forEach(h => {
              api.headers.push({ key: h.key, value: h.value, enabled: !h.disabled });
            });
          }

          // Body
          if (req.body) {
            if (req.body.mode === 'raw') {
              api.body = req.body.raw || '';
              const lang = req.body.options?.raw?.language || '';
              api.bodyType = lang === 'json' || api.body.trim().startsWith('{') || api.body.trim().startsWith('[') ? 'json' : 'text';
            } else if (req.body.mode === 'formdata') {
              api.bodyType = 'formdata';
              if (req.body.formdata) {
                req.body.formdata.forEach(f => {
                  api.formdata.push({ key: f.key, value: f.value || '', enabled: !f.disabled });
                });
              }
            } else if (req.body.mode === 'urlencoded') {
              api.bodyType = 'urlencoded';
              if (req.body.urlencoded) {
                req.body.urlencoded.forEach(f => {
                  api.urlencoded.push({ key: f.key, value: f.value || '', enabled: !f.disabled });
                });
              }
            }
          }

          // Auth
          if (req.auth) {
            if (req.auth.type === 'bearer') {
              api.authType = 'bearer';
              const token = req.auth.bearer?.[0]?.value;
              if (token) api.bearerToken = token;
            } else if (req.auth.type === 'basic') {
              api.authType = 'basic';
              req.auth.basic?.forEach(b => {
                if (b.key === 'username') api.basicUser = b.value;
                if (b.key === 'password') api.basicPass = b.value;
              });
            }
          }

          // Pre-request Script (from event)
          if (item.event && Array.isArray(item.event)) {
            const prerequest = item.event.find(e => e.listen === 'prerequest');
            if (prerequest && prerequest.script && prerequest.script.exec) {
              api.preRequestScript = Array.isArray(prerequest.script.exec)
                ? prerequest.script.exec.join('\n')
                : prerequest.script.exec;
            }
          }

          // Update method based on body presence
          if (api.body && api.method === 'GET') {
            api.method = 'POST';
          }

          // Remove auto-managed Content-Type headers
          api.headers = api.headers.filter(h => {
            const k = h.key.toLowerCase();
            if (k === 'content-type') {
              if (api.bodyType === 'json' && h.value.toLowerCase().includes('json')) return false;
              if (api.bodyType === 'text' && h.value.toLowerCase().includes('text/plain')) return false;
              if (api.bodyType === 'urlencoded' && h.value.toLowerCase().includes('x-www-form-urlencoded')) return false;
            }
            return true;
          });

          STATE.apis[api.id] = api;
          if (!STATE.groups[parentGroup]) {
            ensureGroupFormat(parentGroup);
            STATE.groupOrder.push(parentGroup);
          }
          addToGroup(parentGroup, api.id);
          importedCount++;
        }
      });
    }

    processItems(data.item, group);
  } else {
    toast('无法识别的Postman格式', 'error');
    return;
  }

  saveToStorage();
  renderSidebar();
  updateGroupSelects();
  closeImportModal();
  toast(`成功导入 ${importedCount} 个接口`, 'success');
}

// ============================================
// EXPORT
// ============================================
function showExportModal() {
  const apiCount = Object.keys(STATE.apis).length;
  if (apiCount === 0) {
    toast('暂无可导出的接口', 'info');
    return;
  }

  const list = document.getElementById('exportGroupList');
  let html = '';
  for (const groupName of STATE.groupOrder) {
    const apiIds = getGroupApiIds(groupName);
    if (apiIds.length === 0) continue;
    html += `
      <label class="export-group-item">
        <input type="checkbox" data-export-group="${escapeHtml(groupName)}" checked>
        <span class="export-group-name">${escapeHtml(groupName)}</span>
        <span class="export-group-count">${apiIds.length} 个接口</span>
      </label>
    `;
  }
  list.innerHTML = html;
  const selectAllCb = document.getElementById('exportSelectAll');
  selectAllCb.checked = true;
  selectAllCb.onchange = function() {
    document.querySelectorAll('#exportGroupList input[type="checkbox"]').forEach(cb => cb.checked = this.checked);
  };
  document.getElementById('exportModal').classList.add('show');
}

function closeExportModal() {
  document.getElementById('exportModal').classList.remove('show');
}

function doExport() {
  const selectedGroups = [];
  document.querySelectorAll('#exportGroupList input[type="checkbox"]:checked').forEach(cb => {
    selectedGroups.push(cb.dataset.exportGroup);
  });

  if (selectedGroups.length === 0) {
    toast('请至少选择一个分组', 'error');
    return;
  }

  const collectionId = generateId().replace(/[^a-zA-Z0-9-]/g, '');
  const collectionName = 'ApiFix Bin Export';

  const items = [];
  let totalCount = 0;
  for (const groupName of selectedGroups) {
    const apiIds = getGroupApiIds(groupName);
    if (apiIds.length === 0) continue;

    if (groupName === '默认分组') {
      for (const id of apiIds) {
        const api = STATE.apis[id];
        if (api) { items.push(apiToPostmanItem(api)); totalCount++; }
      }
    } else {
      const folderItems = [];
      for (const id of apiIds) {
        const api = STATE.apis[id];
        if (api) { folderItems.push(apiToPostmanItem(api)); totalCount++; }
      }
      if (folderItems.length > 0) {
        items.push({ name: groupName, item: folderItems });
      }
    }
  }

  if (totalCount === 0) {
    toast('选中的分组中没有接口', 'info');
    return;
  }

  const exportData = {
    info: {
      _postman_id: collectionId,
      name: collectionName,
      schema: 'https://schema.getpostman.com/json/collection/v2.1.0/collection.json'
    },
    item: items
  };

  const json = JSON.stringify(exportData, null, 2);
  const blob = new Blob([json], { type: 'application/json' });
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url;
  a.download = `apifix-export-${new Date().toISOString().slice(0,10)}.postman_collection.json`;
  a.click();
  URL.revokeObjectURL(url);

  closeExportModal();
  toast(`已导出 ${totalCount} 个接口（${selectedGroups.length} 个分组，Postman v2.1 格式）`, 'success');
}

function exportAllApis() {
  showExportModal();
}

function apiToPostmanItem(api) {
  const item = {
    name: api.name || api.url || 'Untitled',
    request: {
      method: api.method || 'GET',
      header: [],
      url: buildPostmanUrl(api),
      body: buildPostmanBody(api)
    },
    response: []
  };

  const headers = (api.headers || []).filter(h => h.enabled !== false);
  const bodyManagedTypes = ['application/json', 'text/plain', 'application/x-www-form-urlencoded'];
  for (const h of headers) {
    const isAutoContentType = h.key.toLowerCase() === 'content-type' &&
      bodyManagedTypes.some(t => h.value.toLowerCase().includes(t.split('/')[1]));
    if (!isAutoContentType) {
      item.request.header.push({ key: h.key, value: h.value, type: 'text' });
    }
  }

  if (api.authType === 'bearer' && api.bearerToken) {
    item.request.auth = {
      type: 'bearer',
      bearer: [{ key: 'token', value: api.bearerToken, type: 'string' }]
    };
  } else if (api.authType === 'basic' && (api.basicUser || api.basicPass)) {
    item.request.auth = {
      type: 'basic',
      basic: [{ key: 'username', value: api.basicUser || '', type: 'string' }, { key: 'password', value: api.basicPass || '', type: 'string' }]
    };
  }

  if (api.preRequestScript && api.preRequestScript.trim()) {
    item.event = [{
      listen: 'prerequest',
      script: {
        type: 'text/javascript',
        exec: api.preRequestScript.split('\n')
      }
    }];
  }

  return item;
}

function buildPostmanUrl(api) {
  let rawUrl = api.url || '';
  const params = (api.params || []).filter(p => p.enabled !== false);

  if (params.length > 0) {
    const sep = rawUrl.includes('?') ? '&' : '?';
    rawUrl += sep + params.map(p => `${encodeURIComponent(p.key)}=${encodeURIComponent(p.value)}`).join('&');
  }

  let protocol = '';
  let hostStr = '';
  let pathStr = '';
  let port = '';

  try {
    const urlObj = new URL(rawUrl.startsWith('http') ? rawUrl : 'https://' + rawUrl);
    protocol = urlObj.protocol.replace(':', '');
    hostStr = urlObj.hostname;
    pathStr = urlObj.pathname.substring(1);
    port = urlObj.port;
  } catch (e) {
    hostStr = rawUrl;
  }

  const urlObj = {
    raw: rawUrl,
    protocol: protocol,
    host: hostStr.split('.'),
    path: pathStr ? pathStr.split('/') : [],
    query: params.map(p => ({ key: p.key, value: p.value }))
  };

  if (port) urlObj.port = port;

  return urlObj;
}

function buildPostmanBody(api) {
  const bodyType = api.bodyType || 'none';
  if (bodyType === 'none') return undefined;

  if (bodyType === 'json') {
    return {
      mode: 'raw',
      raw: api.body || '',
      options: { raw: { language: 'json' } }
    };
  }

  if (bodyType === 'text') {
    return {
      mode: 'raw',
      raw: api.body || '',
      options: { raw: { language: 'text' } }
    };
  }

  if (bodyType === 'urlencoded') {
    const fields = (api.urlencoded || []).filter(f => f.enabled !== false);
    return {
      mode: 'urlencoded',
      urlencoded: fields.map(f => ({ key: f.key, value: f.value, type: 'text' }))
    };
  }

  if (bodyType === 'formdata') {
    const fields = (api.formdata || []).filter(f => f.enabled !== false);
    return {
      mode: 'formdata',
      formdata: fields.map(f => ({ key: f.key, value: f.value, type: 'text' }))
    };
  }

  return undefined;
}

// ============================================
// GROUP MANAGEMENT
// ============================================
function updateGroupSelects() {
  const options = STATE.groupOrder.filter(g => g !== '默认分组').map(g => `<option value="${escapeHtml(g)}">${escapeHtml(g)}</option>`).join('');

  const saveSelect = document.getElementById('saveGroup');
  if (saveSelect) saveSelect.innerHTML = '<option value="">默认分组</option>' + options;

  const importSelect = document.getElementById('importGroup');
  if (importSelect) importSelect.innerHTML = '<option value="">默认分组</option>' + options;
}

function showGroupContextMenu(e, groupName) {
  e.preventDefault();
  contextMenuGroup = groupName;
  const menu = document.getElementById('contextMenu');
  menu.style.left = e.clientX + 'px';
  menu.style.top = e.clientY + 'px';
  menu.classList.add('show');
}

async function renameGroup() {
  document.getElementById('contextMenu').classList.remove('show');
  if (!contextMenuGroup) return;
  const newName = await customPrompt('重命名分组', '输入新的分组名称:', contextMenuGroup);
  if (!newName || newName === contextMenuGroup) return;

  // Rename in all data structures
  STATE.groups[newName] = STATE.groups[contextMenuGroup] || { apiIds: [], preRequestScript: '' };
  delete STATE.groups[contextMenuGroup];

  const idx = STATE.groupOrder.indexOf(contextMenuGroup);
  if (idx !== -1) STATE.groupOrder[idx] = newName;

  // Update apis
  getGroupApiIds(newName).forEach(id => {
    if (STATE.apis[id]) STATE.apis[id].group = newName;
  });

  if (STATE.collapsedGroups[contextMenuGroup]) {
    STATE.collapsedGroups[newName] = STATE.collapsedGroups[contextMenuGroup];
    delete STATE.collapsedGroups[contextMenuGroup];
  }

  contextMenuGroup = newName;
  saveToStorage();
  renderSidebar();
  updateGroupSelects();
  toast('分组已重命名', 'success');
}

async function deleteGroup() {
  document.getElementById('contextMenu').classList.remove('show');
  if (!contextMenuGroup) return;
  if (contextMenuGroup === '默认分组') {
    toast('不能删除默认分组', 'error');
    return;
  }

  if (!await customConfirm('删除分组', `确定删除分组"${contextMenuGroup}"及其所有接口？此操作不可撤销。`, { icon: '🗑️', okText: '删除', danger: true })) return;

  const ids = getGroupApiIds(contextMenuGroup);
  ids.forEach(id => delete STATE.apis[id]);
  delete STATE.groups[contextMenuGroup];
  STATE.groupOrder = STATE.groupOrder.filter(g => g !== contextMenuGroup);
  delete STATE.collapsedGroups[contextMenuGroup];

  if (STATE.currentApiId && !STATE.apis[STATE.currentApiId]) {
    STATE.currentApiId = null;
    showWelcome();
  }

  contextMenuGroup = null;
  saveToStorage();
  renderSidebar();
  updateGroupSelects();
  toast('分组已删除', 'success');
}

// ============================================
// CUSTOM PROMPT & CONFIRM (替代原生弹窗)
// ============================================
let _promptResolve = null;
let _confirmResolve = null;

function customPrompt(title, message, defaultValue) {
  return new Promise((resolve) => {
    _promptResolve = resolve;
    document.getElementById('promptTitle').textContent = title || '提示';
    document.getElementById('promptMessage').textContent = message || '';
    const input = document.getElementById('promptInput');
    input.value = defaultValue || '';
    document.getElementById('promptModal').classList.add('show');
    setTimeout(() => { input.focus(); input.select(); }, 50);
  });
}

function closeCustomPrompt(ok) {
  document.getElementById('promptModal').classList.remove('show');
  if (_promptResolve) {
    _promptResolve(ok ? document.getElementById('promptInput').value : null);
    _promptResolve = null;
  }
}

function customConfirm(title, message, options) {
  return new Promise((resolve) => {
    _confirmResolve = resolve;
    const opts = options || {};
    document.getElementById('confirmTitle').textContent = title || '确认操作';
    document.getElementById('confirmMessage').textContent = message || '';
    document.getElementById('confirmIcon').textContent = opts.icon || '⚠️';
    const okBtn = document.getElementById('confirmOkBtn');
    okBtn.textContent = opts.okText || '确定';
    if (opts.danger) {
      okBtn.className = 'btn btn-danger';
    } else {
      okBtn.className = 'btn btn-primary';
    }
    document.getElementById('confirmModal').classList.add('show');
  });
}

function closeCustomConfirm(ok) {
  document.getElementById('confirmModal').classList.remove('show');
  if (_confirmResolve) {
    _confirmResolve(ok);
    _confirmResolve = null;
  }
}

// Prompt/Confirm 键盘事件
document.addEventListener('keydown', function(e) {
  if (e.key === 'Enter' && document.getElementById('promptModal').classList.contains('show')) {
    e.preventDefault();
    closeCustomPrompt(true);
  }
  if (e.key === 'Escape') {
    if (document.getElementById('promptModal').classList.contains('show')) {
      e.preventDefault();
      closeCustomPrompt(false);
    }
    if (document.getElementById('confirmModal').classList.contains('show')) {
      e.preventDefault();
      closeCustomConfirm(false);
    }
  }
});

async function createNewGroup() {
  const name = await customPrompt('新建分组', '输入新分组名称:');
  if (!name || !name.trim()) return;
  const trimmed = name.trim();
  if (STATE.groups[trimmed]) {
    toast('分组已存在', 'error');
    return;
  }
  ensureGroupFormat(trimmed);
  STATE.groupOrder.push(trimmed);
  saveToStorage();
  renderSidebar();
  updateGroupSelects();
  toast('分组已创建', 'success');
}

// ============================================
// SIDEBAR TABS
// ============================================
function switchSidebarTab(tab) {
  STATE.sidebarTab = tab;
  applySidebarTab();
  if (tab === 'history') renderHistory();
}

function applySidebarTab() {
  document.querySelectorAll('.sidebar-tab').forEach(t => {
    t.classList.toggle('active', t.dataset.sidebarTab === STATE.sidebarTab);
  });
  const body = document.getElementById('sidebarBody');
  const hist = document.getElementById('sidebarHistory');
  const actionsApis = document.getElementById('sidebarActionsApis');
  const actionsHist = document.getElementById('sidebarActionsHistory');
  if (body) body.style.display = STATE.sidebarTab === 'apis' ? '' : 'none';
  if (hist) hist.style.display = STATE.sidebarTab === 'history' ? '' : 'none';
  if (actionsApis) actionsApis.style.display = STATE.sidebarTab === 'apis' ? '' : 'none';
  if (actionsHist) actionsHist.style.display = STATE.sidebarTab === 'history' ? '' : 'none';
}

// ============================================
// REQUEST HISTORY
// ============================================
const MAX_HISTORY = 200;

function saveHistory() {
  try {
    localStorage.setItem('apifix_history', JSON.stringify(_history));
  } catch (e) {
    console.warn('History save failed:', e);
  }
}

function loadHistory() {
  try {
    const raw = localStorage.getItem('apifix_history');
    if (raw) _history = JSON.parse(raw);
    if (!Array.isArray(_history)) _history = [];
  } catch (e) {
    _history = [];
  }
}

function addHistoryEntry(entry) {
  _history.unshift(entry);
  if (_history.length > MAX_HISTORY) _history = _history.slice(0, MAX_HISTORY);
  saveHistory();
  if (STATE.sidebarTab === 'history') renderHistory();
}

function deleteHistoryEntry(id) {
  _history = _history.filter(h => h.id !== id);
  saveHistory();
  renderHistory();
}

async function clearHistory() {
  if (_history.length === 0) return;
  if (!await customConfirm('清空历史', '确定清空所有历史记录？此操作不可撤销。', { icon: '🧹', okText: '清空', danger: true })) return;
  _history = [];
  saveHistory();
  renderHistory();
  toast('历史已清空', 'success');
}

function loadHistoryEntry(id) {
  const entry = _history.find(h => h.id === id);
  if (!entry) return;

  if (entry.apiId && STATE.apis[entry.apiId]) {
    loadApi(entry.apiId);
  } else {
    const apiId = generateId();
    const group = '默认分组';
    STATE.apis[apiId] = {
      id: apiId,
      name: entry.url ? entry.url.split('/').pop() || entry.url : '历史请求',
      method: entry.method,
      url: entry.url,
      headers: entry.headers || [],
      params: entry.params || [],
      bodyType: entry.bodyType || 'json',
      body: entry.body || '',
      formdata: entry.formdata || [],
      urlencoded: entry.urlencoded || [],
      authType: entry.authType || 'none',
      bearerToken: entry.bearerToken || '',
      basicUser: entry.basicUser || '',
      basicPass: entry.basicPass || '',
      preRequestScript: '',
      group,
      createdAt: Date.now(),
      updatedAt: Date.now(),
    };
    if (!STATE.groups[group]) {
      ensureGroupFormat(group);
      if (!STATE.groupOrder.includes(group)) STATE.groupOrder.push(group);
    }
    addToGroup(group, apiId);
    saveToStorage();
    renderSidebar();
    updateGroupSelects();
    loadApi(apiId);
  }
}

function renderHistory() {
  const container = document.getElementById('sidebarHistory');
  if (!container) return;

  const searchVal = (document.getElementById('searchInput')?.value || '').toLowerCase();
  const filteredHistory = searchVal
    ? _history.filter(entry => {
        return (entry.url || '').toLowerCase().includes(searchVal) ||
               (entry.method || '').toLowerCase().includes(searchVal) ||
               (entry.name || '').toLowerCase().includes(searchVal);
      })
    : _history;

  if (filteredHistory.length === 0) {
    container.innerHTML = searchVal
      ? '<div class="empty-state" style="padding:40px 20px"><div class="empty-icon">🔍</div><div class="empty-title">无匹配历史</div><div class="empty-desc">尝试其他关键词</div></div>'
      : '<div class="empty-state" style="padding:40px 20px"><div class="empty-icon">📜</div><div class="empty-title">暂无历史</div><div class="empty-desc">发送请求后会自动记录</div></div>';
    return;
  }

  let html = '';
  for (const entry of filteredHistory) {
    const methodClass = entry.method?.toLowerCase() || 'get';
    const statusClass = !entry.status ? '' :
      entry.status < 300 ? 'success' :
      entry.status < 400 ? 'redirect' :
      entry.status < 500 ? 'client-err' : 'server-err';
    const timeStr = entry.timestamp ? new Date(entry.timestamp).toLocaleString('zh-CN', { month: '2-digit', day: '2-digit', hour: '2-digit', minute: '2-digit' }) : '';

    html += `
      <div class="history-item" data-history-id="${entry.id}">
        <span class="method-badge ${methodClass}">${entry.method || 'GET'}</span>
        <div class="history-info">
          <span class="history-url" title="${escapeHtml(entry.url || '')}">${escapeHtml(entry.url || '无URL')}</span>
          <div class="history-meta">
            ${entry.status ? `<span class="history-status ${statusClass}">${entry.status}</span>` : ''}
            ${entry.duration ? `<span>${entry.duration}ms</span>` : ''}
            ${entry.size ? `<span>${entry.size}</span>` : ''}
            <span>${timeStr}</span>
          </div>
        </div>
        <button class="history-delete" title="删除">✕</button>
      </div>
    `;
  }
  container.innerHTML = html;
}

// ============================================
// RESIZE HANDLE
// ============================================
function initResize() {
  const handle = document.getElementById('resizeHandle');
  const requestPanel = document.getElementById('requestPanel');
  const responsePanel = document.getElementById('responsePanel');
  let isResizing = false;
  let startY, startReqHeight, startRespHeight;

  handle.addEventListener('mousedown', (e) => {
    isResizing = true;
    startY = e.clientY;
    startReqHeight = requestPanel.offsetHeight;
    startRespHeight = responsePanel.offsetHeight;
    handle.classList.add('active');
    document.body.style.cursor = 'row-resize';
    document.body.style.userSelect = 'none';
  });

  document.addEventListener('mousemove', (e) => {
    if (!isResizing) return;
    const delta = e.clientY - startY;
    const newReqH = Math.max(150, startReqHeight + delta);
    const newRespH = Math.max(150, startRespHeight - delta);
    requestPanel.style.flex = 'none';
    responsePanel.style.flex = 'none';
    requestPanel.style.height = newReqH + 'px';
    responsePanel.style.height = newRespH + 'px';
  });

  document.addEventListener('mouseup', () => {
    if (!isResizing) return;
    isResizing = false;
    handle.classList.remove('active');
    document.body.style.cursor = '';
    document.body.style.userSelect = '';
  });
}

// ============================================
// TOAST NOTIFICATIONS
// ============================================
function toast(message, type = 'info') {
  const container = document.getElementById('toastContainer');
  const t = document.createElement('div');
  t.className = `toast ${type}`;
  const icons = { success: '✓', error: '✕', info: 'ℹ' };
  t.innerHTML = `<span>${icons[type] || 'ℹ'}</span> ${escapeHtml(message)}`;
  container.appendChild(t);

  setTimeout(() => {
    t.style.animation = 'toastOut 0.3s ease forwards';
    setTimeout(() => t.remove(), 300);
  }, 3000);
}

// ============================================
// PRE-REQUEST SCRIPT
// ============================================
function updateScriptBadge(script) {
  const badge = document.getElementById('scriptBadge');
  if (badge) {
    if (script && script.trim()) {
      badge.style.display = 'inline';
      badge.className = 'badge count script-badge has-script';
    } else {
      badge.style.display = 'none';
    }
  }
}

function clearScriptConsole() {
  const consoleBody = document.getElementById('scriptConsoleBody');
  if (consoleBody) consoleBody.innerHTML = '';
  const consoleEl = document.getElementById('scriptConsole');
  if (consoleEl) consoleEl.classList.remove('show');
}

function appendScriptLog(type, ...args) {
  const consoleEl = document.getElementById('scriptConsole');
  const consoleBody = document.getElementById('scriptConsoleBody');
  if (!consoleEl || !consoleBody) return;

  consoleEl.classList.add('show');

  const msg = args.map(a => {
    if (typeof a === 'object') {
      try { return JSON.stringify(a, null, 2); } catch (e) { return String(a); }
    }
    return String(a);
  }).join(' ');

  const line = document.createElement('div');
  line.className = 'console-line';
  line.innerHTML = `<span class="log-type ${type}">${type.toUpperCase()}</span><span class="log-msg">${escapeHtml(msg)}</span>`;
  consoleBody.appendChild(line);
  consoleBody.scrollTop = consoleBody.scrollHeight;
}

function executePreRequestScript(script, currentHeaders, currentUrl, currentBody, currentUrlencoded, currentFormdata) {
  clearScriptConsole();

  if (!script || !script.trim()) {
    return { headers: currentHeaders, url: currentUrl, body: currentBody, urlencoded: currentUrlencoded, formdata: currentFormdata };
  }

  // Try direct execution (will work if CSP allows new Function)
  try {
    return executeScriptDirectly(script, currentHeaders, currentUrl, currentBody, currentUrlencoded, currentFormdata);
  } catch (err) {
    if (err.message && (err.message.includes('Content Security Policy') || err.message.includes('unsafe-eval') || err.message.includes('Function'))) {
      appendScriptLog('warn', '直接执行被CSP阻止，请使用 executePreRequestScriptAsync');
      appendScriptLog('error', '✕ 脚本执行被CSP阻止 - new Function() 不可用');
    } else {
      appendScriptLog('error', '✕ 脚本执行错误: ' + err.message);
    }
    return { headers: currentHeaders, url: currentUrl, body: currentBody, urlencoded: currentUrlencoded, formdata: currentFormdata };
  }
}

async function executePreRequestScriptAsync(script, currentHeaders, currentUrl, currentBody, currentUrlencoded, currentFormdata) {
  clearScriptConsole();

  if (!script || !script.trim()) {
    return { headers: currentHeaders, url: currentUrl, body: currentBody, urlencoded: currentUrlencoded, formdata: currentFormdata };
  }

  // In extension context, CSP blocks new Function() — always use sandbox
  // Check if sandbox is available (extension environment)
  const sandboxFrame = document.getElementById('sandboxFrame');
  if (sandboxFrame && sandboxFrame.contentWindow) {
    appendScriptLog('log', '正在通过沙盒执行 Pre-request Script...');
    return executeScriptViaSandbox(script, currentHeaders, currentUrl, currentBody, currentUrlencoded, currentFormdata);
  }

  // Fallback: try direct execution (web version or if CSP allows)
  try {
    return executeScriptDirectly(script, currentHeaders, currentUrl, currentBody, currentUrlencoded, currentFormdata);
  } catch (err) {
    if (err.message && (err.message.includes('Content Security Policy') || err.message.includes('unsafe-eval') || err.message.includes('Function'))) {
      appendScriptLog('log', '直接执行被CSP阻止，正在通过沙盒执行...');
      return executeScriptViaSandbox(script, currentHeaders, currentUrl, currentBody, currentUrlencoded, currentFormdata);
    }
    appendScriptLog('error', '✕ 脚本执行错误: ' + err.message);
    return { headers: currentHeaders, url: currentUrl, body: currentBody, urlencoded: currentUrlencoded, formdata: currentFormdata };
  }
}

// ============================================
// INLINE CryptoJS SHA-256 (for Pre-request Script)
// ============================================
const _CryptoJS = (function() {
  const K = [
    0x428a2f98, 0x71374491, 0xb5c0fbcf, 0xe9b5dba5, 0x3956c25b, 0x59f111f1, 0x923f82a4, 0xab1c5ed5,
    0xd807aa98, 0x12835b01, 0x243185be, 0x550c7dc3, 0x72be5d74, 0x80deb1fe, 0x9bdc06a7, 0xc19bf174,
    0xe49b69c1, 0xefbe4786, 0x0fc19dc6, 0x240ca1cc, 0x2de92c6f, 0x4a7484aa, 0x5cb0a9dc, 0x76f988da,
    0x983e5152, 0xa831c66d, 0xb00327c8, 0xbf597fc7, 0xc6e00bf3, 0xd5a79147, 0x06ca6351, 0x14292967,
    0x27b70a85, 0x2e1b2138, 0x4d2c6dfc, 0x53380d13, 0x650a7354, 0x766a0abb, 0x81c2c92e, 0x92722c85,
    0xa2bfe8a1, 0xa81a664b, 0xc24b8b70, 0xc76c51a3, 0xd192e819, 0xd6990624, 0xf40e3585, 0x106aa070,
    0x19a4c116, 0x1e376c08, 0x2748774c, 0x34b0bcb5, 0x391c0cb3, 0x4ed8aa4a, 0x5b9cca4f, 0x682e6ff3,
    0x748f82ee, 0x78a5636f, 0x84c87814, 0x8cc70208, 0x90befffa, 0xa4506ceb, 0xbef9a3f7, 0xc67178f2
  ];

  function stringToBytes(str) {
    const bytes = [];
    for (let i = 0; i < str.length; i++) {
      const code = str.charCodeAt(i);
      if (code < 0x80) { bytes.push(code); }
      else if (code < 0x800) { bytes.push(0xc0 | (code >> 6), 0x80 | (code & 0x3f)); }
      else if (code < 0xd800 || code >= 0xe000) { bytes.push(0xe0 | (code >> 12), 0x80 | ((code >> 6) & 0x3f), 0x80 | (code & 0x3f)); }
      else { i++; const cp = 0x10000 + (((code & 0x3ff) << 10) | (str.charCodeAt(i) & 0x3ff)); bytes.push(0xf0 | (cp >> 18), 0x80 | ((cp >> 12) & 0x3f), 0x80 | ((cp >> 6) & 0x3f), 0x80 | (cp & 0x3f)); }
    }
    return bytes;
  }

  function sha256(bytes) {
    const msgLen = bytes.length;
    const padded = bytes.slice();
    padded.push(0x80);
    while (padded.length % 64 !== 56) padded.push(0);
    const bitLen = msgLen * 8;
    for (let i = 56; i >= 0; i -= 8) padded.push(Math.floor(bitLen / Math.pow(2, i)) & 0xff);

    let h0 = 0x6a09e667, h1 = 0xbb67ae85, h2 = 0x3c6ef372, h3 = 0xa54ff53a;
    let h4 = 0x510e527f, h5 = 0x9b05688c, h6 = 0x1f83d9ab, h7 = 0x5be0cd19;

    for (let offset = 0; offset < padded.length; offset += 64) {
      const w = new Array(64);
      for (let j = 0; j < 16; j++) {
        w[j] = (padded[offset + j * 4] << 24) | (padded[offset + j * 4 + 1] << 16) | (padded[offset + j * 4 + 2] << 8) | padded[offset + j * 4 + 3];
      }
      for (let j = 16; j < 64; j++) {
        const s0 = ((w[j-15] >>> 7) | (w[j-15] << 25)) ^ ((w[j-15] >>> 18) | (w[j-15] << 14)) ^ (w[j-15] >>> 3);
        const s1 = ((w[j-2] >>> 17) | (w[j-2] << 15)) ^ ((w[j-2] >>> 19) | (w[j-2] << 13)) ^ (w[j-2] >>> 10);
        w[j] = (w[j-16] + s0 + w[j-7] + s1) | 0;
      }
      let a = h0, b = h1, c = h2, d = h3, e = h4, f = h5, g = h6, h = h7;
      for (let j = 0; j < 64; j++) {
        const S1 = ((e >>> 6) | (e << 26)) ^ ((e >>> 11) | (e << 21)) ^ ((e >>> 25) | (e << 7));
        const ch = (e & f) ^ (~e & g);
        const temp1 = (h + S1 + ch + K[j] + w[j]) | 0;
        const S0 = ((a >>> 2) | (a << 30)) ^ ((a >>> 13) | (a << 19)) ^ ((a >>> 22) | (a << 10));
        const maj = (a & b) ^ (a & c) ^ (b & c);
        const temp2 = (S0 + maj) | 0;
        h = g; g = f; f = e; e = (d + temp1) | 0;
        d = c; c = b; b = a; a = (temp1 + temp2) | 0;
      }
      h0 = (h0 + a) | 0; h1 = (h1 + b) | 0; h2 = (h2 + c) | 0; h3 = (h3 + d) | 0;
      h4 = (h4 + e) | 0; h5 = (h5 + f) | 0; h6 = (h6 + g) | 0; h7 = (h7 + h) | 0;
    }

    const hash = [h0, h1, h2, h3, h4, h5, h6, h7];
    let hex = '';
    for (const val of hash) hex += ('00000000' + (val >>> 0).toString(16)).slice(-8);
    return hex;
  }

  function SHA256(message) {
    const bytes = typeof message === 'string' ? stringToBytes(message) : message;
    const hashHex = sha256(bytes);
    return { toString() { return hashHex; } };
  }

  return { SHA256 };
})();

function executeScriptDirectly(script, currentHeaders, currentUrl, currentBody, currentUrlencoded, currentFormdata) {
  const envStore = { ..._environmentVars };

  const pm = {
    request: {
      headers: {
        _store: { ...currentHeaders },
        set(key, value) { this._store[key] = value; },
        get(key) { return this._store[key]; },
        remove(key) { delete this._store[key]; },
        has(key) { return key in this._store; },
      },
      body: {
        _raw: currentBody,
        _fields: currentUrlencoded.map(f => ({ ...f })),
        _formdata: currentFormdata.map(f => ({ ...f })),
        set raw(val) { this._raw = val; },
        get raw() { return this._raw; },
        set(key, value) {
          const existing = this._fields.find(item => item.key === key);
          if (existing) { existing.value = value; existing.enabled = true; }
          else { this._fields.push({ key, value, enabled: true }); }
        },
        get(key) {
          const f = this._fields.find(item => item.key === key);
          return f ? f.value : undefined;
        },
      },
      url: {
        _url: currentUrl,
        set(val) { this._url = val; },
        get() { return this._url; },
        addQueryParams(key, value) {
          const sep = this._url.includes('?') ? '&' : '?';
          this._url += sep + encodeURIComponent(key) + '=' + encodeURIComponent(value);
        },
      },
    },
    environment: {
      set(key, value) {
        envStore[key] = value;
        _environmentVars[key] = value;
        // Also update the environment data model
        if (_activeEnvironment && _environments[_activeEnvironment]) {
          const existing = _environments[_activeEnvironment][key];
          _environments[_activeEnvironment][key] = {
            type: (existing && typeof existing === 'object') ? existing.type : 'default',
            initial: (existing && typeof existing === 'object') ? existing.initial : String(value),
            current: String(value),
            enabled: (existing && typeof existing === 'object') ? existing.enabled : true,
          };
        }
        saveEnvironments();
      },
      get(key) { return envStore[key]; },
      unset(key) {
        delete envStore[key];
        delete _environmentVars[key];
        if (_activeEnvironment && _environments[_activeEnvironment]) {
          delete _environments[_activeEnvironment][key];
        }
        saveEnvironments();
      },
      has(key) { return key in envStore; },
    },
  };

  // Postman-compatible alias object
  const postman = {
    setEnvironmentVariable(key, value) { pm.environment.set(key, value); },
    getEnvironmentVariable(key) { return pm.environment.get(key); },
    clearEnvironmentVariable(key) { pm.environment.unset(key); },
    setGlobalVariable(key, value) { pm.environment.set(key, value); },
    getGlobalVariable(key) { return pm.environment.get(key); },
    clearGlobalVariable(key) { pm.environment.unset(key); },
    environment: pm.environment,
    globals: pm.environment,
    request: pm.request,
  };

  const scriptConsole = {
    log: (...args) => { appendScriptLog('log', ...args); },
    warn: (...args) => { appendScriptLog('warn', ...args); },
    error: (...args) => { appendScriptLog('error', ...args); },
  };

  try {
    const fn = new Function('pm', 'postman', 'console', 'CryptoJS', 'Math', 'Date', 'parseInt', 'parseFloat', 'JSON', 'encodeURIComponent', 'decodeURIComponent', 'btoa', 'atob', 'setTimeout', script);
    fn(pm, postman, scriptConsole, _CryptoJS, Math, Date, parseInt, parseFloat, JSON, encodeURIComponent, decodeURIComponent, btoa, atob, setTimeout);

    appendScriptLog('log', '✓ Pre-request Script 执行成功');
  } catch (err) {
    appendScriptLog('error', '✕ 脚本执行错误: ' + err.message);
    // Re-throw so caller can fall back to sandbox
    throw err;
  }

  return {
    headers: pm.request.headers._store,
    url: pm.request.url._url,
    body: pm.request.body._raw,
    urlencoded: pm.request.body._fields,
    formdata: pm.request.body._formdata,
  };
}

async function executeScriptViaSandbox(script, currentHeaders, currentUrl, currentBody, currentUrlencoded, currentFormdata) {
  const sandboxFrame = document.getElementById('sandboxFrame');
  if (!sandboxFrame || !sandboxFrame.contentWindow) {
    appendScriptLog('error', '沙盒不可用');
    return { headers: currentHeaders, url: currentUrl, body: currentBody, urlencoded: currentUrlencoded, formdata: currentFormdata };
  }

  try {
    const requestId = 'req_' + Date.now();

    const result = await new Promise((resolve, reject) => {
      const timeout = setTimeout(() => {
        window.removeEventListener('message', handler);
        reject(new Error('沙盒执行超时'));
      }, 5000);

      const handler = (event) => {
        if (event.data && event.data.type === 'SCRIPT_RESULT' && event.data.requestId === requestId) {
          clearTimeout(timeout);
          window.removeEventListener('message', handler);
          resolve(event.data);
        }
      };

      window.addEventListener('message', handler);

      sandboxFrame.contentWindow.postMessage({
        type: 'EXECUTE_SCRIPT',
        script,
        headers: currentHeaders,
        url: currentUrl,
        body: currentBody,
        urlencoded: currentUrlencoded,
        formdata: currentFormdata,
        envVars: _environmentVars,
        requestId,
      }, '*');
    });

    if (!result.success) {
      appendScriptLog('error', '✕ 脚本执行错误: ' + result.error);
      return { headers: currentHeaders, url: currentUrl, body: currentBody, urlencoded: currentUrlencoded, formdata: currentFormdata };
    }

    // Process logs from sandbox
    if (result.result.logs) {
      result.result.logs.forEach(log => {
        appendScriptLog(log.type, ...log.args);
      });
    }

    // Update environment vars
    if (result.result.envVars) {
      Object.keys(result.result.envVars).forEach(key => {
        _environmentVars[key] = result.result.envVars[key];
      });
      saveEnvironmentVars();
    }

    appendScriptLog('log', '✓ Pre-request Script 执行成功 (沙盒)');

    return {
      headers: result.result.headers,
      url: result.result.url,
      body: result.result.body,
      urlencoded: result.result.urlencoded,
      formdata: result.result.formdata,
    };
  } catch (err) {
    appendScriptLog('error', '✕ 沙盒通信失败: ' + err.message);
    return { headers: currentHeaders, url: currentUrl, body: currentBody, urlencoded: currentUrlencoded, formdata: currentFormdata };
  }
}

// Environment variables storage (now multi-environment)
// _environmentVars, _environments, _environmentOrder, _activeEnvironment declared at top of file
// New data model: each variable is { type: 'default'|'secret', initial: 'val', current: 'val', enabled: true }
// _environmentVars (runtime) = { varKey: 'currentValue' } for template resolution

function loadEnvironments() {
  try {
    const raw = localStorage.getItem('apifix_environments');
    if (raw) {
      const data = JSON.parse(raw);
      _environments = (data.environments && typeof data.environments === 'object') ? data.environments : {};
      _environmentOrder = Array.isArray(data.environmentOrder) ? data.environmentOrder : Object.keys(_environments);
      _activeEnvironment = data.activeEnvironment || '';
    }
  } catch (e) {
    _environments = {};
    _environmentOrder = [];
    _activeEnvironment = '';
  }

  // Migrate old format: { key: "stringValue" } → { key: { type:'default', initial:'val', current:'val', enabled:true } }
  for (const envName of Object.keys(_environments)) {
    const env = _environments[envName];
    if (!env || typeof env !== 'object') continue;
    for (const varKey of Object.keys(env)) {
      const v = env[varKey];
      if (typeof v === 'string') {
        // Old format: key -> string value
        env[varKey] = { type: 'default', initial: v, current: v, enabled: true };
      }
      // New format is already an object, ensure all fields exist
      else if (typeof v === 'object' && v !== null) {
        if (v.type === undefined) v.type = 'default';
        if (v.initial === undefined) v.initial = v.current || v.value || '';
        if (v.current === undefined) v.current = v.initial;
        if (v.enabled === undefined) v.enabled = true;
      }
    }
  }

  // Build runtime vars from current environment
  rebuildRuntimeVars();
}

function rebuildRuntimeVars() {
  _environmentVars = {};
  if (_activeEnvironment && _environments[_activeEnvironment]) {
    const env = _environments[_activeEnvironment];
    for (const [key, v] of Object.entries(env)) {
      if (typeof v === 'object' && v !== null && v.enabled !== false) {
        _environmentVars[key] = v.current || v.initial || '';
      }
    }
  }
}

function saveEnvironments() {
  try {
    localStorage.setItem('apifix_environments', JSON.stringify({
      environments: _environments,
      environmentOrder: _environmentOrder,
      activeEnvironment: _activeEnvironment,
    }));
  } catch (e) {}
}

// Legacy compat
function saveEnvironmentVars() { saveEnvironments(); }
function loadEnvironmentVars() { loadEnvironments(); }

function updateEnvironmentSelector() {
  const selector = document.getElementById('envSelector');
  if (!selector) return;
  let html = '<option value="">无环境</option>';
  for (const envName of _environmentOrder) {
    html += `<option value="${escapeHtml(envName)}" ${envName === _activeEnvironment ? 'selected' : ''}>${escapeHtml(envName)}</option>`;
  }
  selector.innerHTML = html;
}

function switchEnvironment(envName) {
  _activeEnvironment = envName || '';
  rebuildRuntimeVars();
  saveEnvironments();
  updateEnvironmentSelector();
  toast(envName ? `已切换到环境「${envName}」` : '已取消环境选择', 'success');
}

function renderEnvListHTML() {
  if (_environmentOrder.length === 0) {
    return '<div style="text-align:center;padding:20px;color:var(--text-muted);">暂无环境，在上方输入名称创建</div>';
  }
  let html = '';
  for (const envName of _environmentOrder) {
    const vars = _environments[envName] || {};
    const varCount = Object.keys(vars).length;
    const isActive = _activeEnvironment === envName;
    html += `
      <div class="env-item${isActive ? ' env-item-active' : ''}">
        <div class="env-item-info">
          <span class="env-item-name">${escapeHtml(envName)}${isActive ? ' <span style="font-size:10px;color:var(--accent);">● 当前</span>' : ''}</span>
          <span class="env-item-count">${varCount} 个变量</span>
        </div>
        <div class="env-item-actions">
          <button data-action="edit-environment" data-env-name="${escapeHtml(envName)}" title="编辑">✏️</button>
          <button data-action="delete-environment" data-env-name="${escapeHtml(envName)}" title="删除">🗑️</button>
        </div>
      </div>
    `;
  }
  return html;
}

function showEnvironmentModal() {
  const listView = document.getElementById('envListView');
  const editorView = document.getElementById('envEditorView');
  if (listView) listView.style.display = '';
  if (editorView) editorView.style.display = 'none';

  const newInput = document.getElementById('newEnvNameInput');
  if (newInput) newInput.value = '';

  const list = document.getElementById('envList');
  if (list) list.innerHTML = renderEnvListHTML();
  document.getElementById('environmentModal').classList.add('show');
}

function closeEnvironmentModal() {
  document.getElementById('environmentModal').classList.remove('show');
}

function envBackToList() {
  const listView = document.getElementById('envListView');
  const editorView = document.getElementById('envEditorView');
  if (listView) listView.style.display = '';
  if (editorView) editorView.style.display = 'none';
  const list = document.getElementById('envList');
  if (list) list.innerHTML = renderEnvListHTML();
}

function addEnvironment() {
  const input = document.getElementById('newEnvNameInput');
  if (!input) return;
  const name = input.value.trim();
  if (!name) {
    toast('请输入环境名称', 'error');
    input.focus();
    return;
  }
  if (_environments[name]) {
    toast('环境已存在', 'error');
    return;
  }
  _environments[name] = {};
  _environmentOrder.push(name);
  saveEnvironments();
  input.value = '';
  updateEnvironmentSelector();
  envBackToList();
  toast('环境已创建，点击✏️编辑变量', 'success');
}

async function deleteEnvironment(envName) {
  if (!envName) return;
  if (!await customConfirm('删除环境', `确定删除环境「${envName}」？变量将全部丢失。`, { icon: '🗑️', okText: '删除', danger: true })) return;
  delete _environments[envName];
  _environmentOrder = _environmentOrder.filter(n => n !== envName);
  if (_activeEnvironment === envName) {
    _activeEnvironment = '';
    _environmentVars = {};
  }
  saveEnvironments();
  updateEnvironmentSelector();
  envBackToList();
  toast('环境已删除', 'success');
}

// ============================================
// POSTMAN-STYLE VARIABLE TABLE EDITOR
// ============================================

function editEnvironment(envName) {
  if (!envName || !_environments[envName]) return;

  // Switch to editor view
  const listView = document.getElementById('envListView');
  const editorView = document.getElementById('envEditorView');
  if (listView) listView.style.display = 'none';
  if (editorView) editorView.style.display = '';

  document.getElementById('envEditorTitle').textContent = `编辑环境: ${envName}`;
  document.getElementById('envEditorEnvName').value = envName;

  renderEnvVarTable(envName);
}

function renderEnvVarTable(envName) {
  const tbody = document.getElementById('envVarTableBody');
  if (!tbody) return;

  const vars = _environments[envName] || {};
  const entries = Object.entries(vars);

  let html = '';
  for (const [key, v] of entries) {
    const obj = (typeof v === 'object' && v !== null) ? v : { type: 'default', initial: String(v), current: String(v), enabled: true };
    const enabled = obj.enabled !== false;
    const vtype = obj.type || 'default';
    const isSecret = vtype === 'secret';
    html += `
      <div class="env-var-row${enabled ? '' : ' disabled-row'}" data-var-key="${escapeHtml(key)}">
        <div class="env-var-col env-var-col-enable">
          <input type="checkbox" ${enabled ? 'checked' : ''} data-field="enabled" title="启用/禁用">
        </div>
        <div class="env-var-col env-var-col-key">
          <input type="text" value="${escapeHtml(key)}" data-field="key" placeholder="Variable name" spellcheck="false">
        </div>
        <div class="env-var-col env-var-col-type">
          <select class="env-var-type-select" data-field="type" title="变量类型">
            <option value="default"${!isSecret ? ' selected' : ''}>default</option>
            <option value="secret"${isSecret ? ' selected' : ''}>secret</option>
          </select>
        </div>
        <div class="env-var-col env-var-col-initial">
          <input type="text" value="${escapeHtml(obj.initial || '')}" data-field="initial" placeholder="Initial value" spellcheck="false">
        </div>
        <div class="env-var-col env-var-col-current">
          <input type="${isSecret ? 'password' : 'text'}" value="${escapeHtml(obj.current || '')}" data-field="current" placeholder="Current value" spellcheck="false">
        </div>
        <div class="env-var-col env-var-col-action">
          <button class="var-remove-btn" data-action="remove-env-var" title="删除变量">✕</button>
        </div>
      </div>
    `;
  }

  // Empty row for adding new variable
  html += `
    <div class="env-var-row" data-var-key="">
      <div class="env-var-col env-var-col-enable">
        <input type="checkbox" checked data-field="enabled" title="启用/禁用">
      </div>
      <div class="env-var-col env-var-col-key">
        <input type="text" value="" data-field="key" placeholder="新变量名..." spellcheck="false">
      </div>
      <div class="env-var-col env-var-col-type">
        <select class="env-var-type-select" data-field="type" title="变量类型">
          <option value="default" selected>default</option>
          <option value="secret">secret</option>
        </select>
      </div>
      <div class="env-var-col env-var-col-initial">
        <input type="text" value="" data-field="initial" placeholder="Initial value" spellcheck="false">
      </div>
      <div class="env-var-col env-var-col-current">
        <input type="text" value="" data-field="current" placeholder="Current value" spellcheck="false">
      </div>
      <div class="env-var-col env-var-col-action">
        <button class="var-remove-btn" data-action="remove-env-var" title="删除变量">✕</button>
      </div>
    </div>
  `;

  tbody.innerHTML = html;
}

function addEnvVarRow() {
  const tbody = document.getElementById('envVarTableBody');
  if (!tbody) return;

  const row = document.createElement('div');
  row.className = 'env-var-row';
  row.setAttribute('data-var-key', '');
  row.innerHTML = `
    <div class="env-var-col env-var-col-enable">
      <input type="checkbox" checked data-field="enabled" title="启用/禁用">
    </div>
    <div class="env-var-col env-var-col-key">
      <input type="text" value="" data-field="key" placeholder="新变量名..." spellcheck="false">
    </div>
    <div class="env-var-col env-var-col-type">
      <select class="env-var-type-select" data-field="type" title="变量类型">
        <option value="default" selected>default</option>
        <option value="secret">secret</option>
      </select>
    </div>
    <div class="env-var-col env-var-col-initial">
      <input type="text" value="" data-field="initial" placeholder="Initial value" spellcheck="false">
    </div>
    <div class="env-var-col env-var-col-current">
      <input type="text" value="" data-field="current" placeholder="Current value" spellcheck="false">
    </div>
    <div class="env-var-col env-var-col-action">
      <button class="var-remove-btn" data-action="remove-env-var" title="删除变量">✕</button>
    </div>
  `;
  tbody.appendChild(row);
  row.querySelector('[data-field="key"]').focus();
}

function saveEnvironmentVarsEdit() {
  const envName = document.getElementById('envEditorEnvName').value;
  if (!envName) return;

  const tbody = document.getElementById('envVarTableBody');
  if (!tbody) return;

  const rows = tbody.querySelectorAll('.env-var-row');
  const newVars = {};

  for (const row of rows) {
    const keyInput = row.querySelector('[data-field="key"]');
    const typeSelect = row.querySelector('[data-field="type"]');
    const initialInput = row.querySelector('[data-field="initial"]');
    const currentInput = row.querySelector('[data-field="current"]');
    const enabledCheckbox = row.querySelector('[data-field="enabled"]');

    if (!keyInput) continue;
    const key = keyInput.value.trim();
    if (!key) continue; // Skip empty keys

    const vtype = typeSelect ? typeSelect.value : 'default';
    const initial = initialInput ? initialInput.value : '';
    const current = currentInput ? currentInput.value : '';
    const enabled = enabledCheckbox ? enabledCheckbox.checked : true;

    newVars[key] = {
      type: vtype,
      initial: initial,
      current: current,
      enabled: enabled,
    };
  }

  _environments[envName] = newVars;

  // If editing current active environment, update runtime vars
  if (_activeEnvironment === envName) {
    rebuildRuntimeVars();
  }

  saveEnvironments();
  updateEnvironmentSelector();
  toast('环境变量已保存', 'success');
  envBackToList();
}

// ============================================
// STREAMING REQUEST
// ============================================
let _streamChunkListener = null;

async function sendStreamingRequest(method, url, headers, body, formdataFields) {
  const btn = document.getElementById('sendBtn');
  const streamId = 'stream_' + Date.now();
  STATE.activeStreamId = streamId;

  // Show cancel button
  const cancelBtn = document.getElementById('cancelStreamBtn');
  if (cancelBtn) cancelBtn.style.display = 'inline-flex';

  // Clear response area and show streaming indicator
  const bodyEl = document.getElementById('responseBody');
  bodyEl.innerHTML = '<div class="streaming-indicator"><span class="stream-dot"></span> 正在接收数据流...</div>';

  // Listen for stream chunks
  if (_streamChunkListener) {
    chrome.runtime.onMessage.removeListener(_streamChunkListener);
  }

  let accumulatedBody = '';
  let streamStartTime = performance.now();
  let headersReceived = false;

  _streamChunkListener = (message, sender, sendResponse) => {
    if (message.type !== 'STREAM_CHUNK' || message.streamId !== streamId) return;

    const { phase, data } = message;

    if (phase === 'headers') {
      headersReceived = true;
      const statusClass = data.status < 300 ? 'success' :
                          data.status < 400 ? 'redirect' :
                          data.status < 500 ? 'client-err' : 'server-err';
      const statusEl = document.getElementById('responseStatus');
      statusEl.style.display = 'flex';
      const codeEl = document.getElementById('statusCode');
      codeEl.textContent = data.status + ' ' + data.statusText;
      codeEl.className = 'status-code ' + statusClass;
      document.getElementById('responseTime').textContent = data.duration;
      document.getElementById('responseSize').textContent = '...';

      // Render response headers
      const headersEl = document.getElementById('responseHeaders');
      if (data.headers && data.headers.length > 0) {
        let hhtml = '<table class="headers-table"><thead><tr><th>Key</th><th>Value</th></tr></thead><tbody>';
        data.headers.forEach(h => {
          hhtml += `<tr><td>${escapeHtml(h.key)}</td><td>${escapeHtml(h.value)}</td></tr>`;
        });
        hhtml += '</tbody></table>';
        headersEl.innerHTML = hhtml;
      }
    }

    if (phase === 'body') {
      accumulatedBody += data.chunk;
      const elapsed = Math.round(performance.now() - streamStartTime);
      document.getElementById('responseTime').textContent = elapsed;
      const sizeStr = data.totalSize > 1024 ? (data.totalSize / 1024).toFixed(1) + ' KB' : data.totalSize + ' B';
      document.getElementById('responseSize').textContent = sizeStr;

      // Try to format as JSON in real-time (best effort)
      let displayBody = accumulatedBody;
      try {
        const json = JSON.parse(accumulatedBody);
        displayBody = JSON.stringify(json, null, 2);
      } catch (e) {
        // Not complete JSON yet, show raw
      }
      bodyEl.innerHTML = `<button class="copy-btn">📋 复制</button><pre class="streaming-pre">${highlightJSON(displayBody)}</pre>`;
    }

    if (phase === 'done') {
      // Stream complete
      const elapsed = Math.round(performance.now() - streamStartTime);
      document.getElementById('responseTime').textContent = elapsed;
      const finalBody = data.isFormatted ? data.body : accumulatedBody;
      const sizeStr = data.size > 1024 ? (data.size / 1024).toFixed(1) + ' KB' : data.size + ' B';
      document.getElementById('responseSize').textContent = sizeStr;
      bodyEl.innerHTML = `<button class="copy-btn">📋 复制</button><pre>${highlightJSON(finalBody)}</pre>`;
      btn.classList.remove('loading');
      if (cancelBtn) cancelBtn.style.display = 'none';
      STATE.activeStreamId = null;

      // Record history
      addHistoryEntry({
        id: 'hist_' + Date.now() + '_' + Math.random().toString(36).substring(2, 8),
        apiId: STATE.currentApiId,
        method,
        url,
        status: parseInt(document.getElementById('statusCode').textContent) || 0,
        statusText: '',
        duration: elapsed,
        size: sizeStr,
        timestamp: Date.now(),
        bodyType: STATE.bodyType,
        headers: getEffectiveKvData('headersEditor', 'headers'),
        params: getEffectiveKvData('paramsEditor', 'params'),
        body: '',
        formdata: [],
        urlencoded: [],
        authType: STATE.authType,
      });

      // Cleanup listener
      if (_streamChunkListener) {
        chrome.runtime.onMessage.removeListener(_streamChunkListener);
        _streamChunkListener = null;
      }
    }

    if (phase === 'aborted') {
      bodyEl.innerHTML = `<div class="empty-state"><div class="empty-icon">⏹</div><div class="empty-title">请求已取消</div></div>`;
      btn.classList.remove('loading');
      if (cancelBtn) cancelBtn.style.display = 'none';
      STATE.activeStreamId = null;
      if (_streamChunkListener) {
        chrome.runtime.onMessage.removeListener(_streamChunkListener);
        _streamChunkListener = null;
      }
    }

    if (phase === 'error') {
      bodyEl.innerHTML = `<div class="empty-state"><div class="empty-icon">❌</div><div class="empty-title">请求失败</div><div class="empty-desc">${escapeHtml(data.error)}</div></div>`;
      const statusEl = document.getElementById('responseStatus');
      statusEl.style.display = 'flex';
      const codeEl = document.getElementById('statusCode');
      codeEl.textContent = 'Error';
      codeEl.className = 'status-code client-err';
      btn.classList.remove('loading');
      if (cancelBtn) cancelBtn.style.display = 'none';
      STATE.activeStreamId = null;
      if (_streamChunkListener) {
        chrome.runtime.onMessage.removeListener(_streamChunkListener);
        _streamChunkListener = null;
      }
    }
  };

  chrome.runtime.onMessage.addListener(_streamChunkListener);

  try {
    await chrome.runtime.sendMessage({
      type: 'STREAMING_REQUEST',
      data: {
        method,
        url,
        headers,
        body,
        bodyType: STATE.bodyType,
        formdataFields,
        streamId,
      }
    });
  } catch (err) {
    btn.classList.remove('loading');
    if (cancelBtn) cancelBtn.style.display = 'none';
    STATE.activeStreamId = null;
    bodyEl.innerHTML = `<div class="empty-state"><div class="empty-icon">❌</div><div class="empty-title">流式请求失败</div><div class="empty-desc">${escapeHtml(err.message)}</div></div>`;
    if (_streamChunkListener) {
      chrome.runtime.onMessage.removeListener(_streamChunkListener);
      _streamChunkListener = null;
    }
  }
}

function cancelStreaming() {
  if (STATE.activeStreamId) {
    chrome.runtime.sendMessage({
      type: 'CANCEL_STREAMING',
      streamId: STATE.activeStreamId,
    });
  }
}

function toggleStreaming() {
  STATE.streamingEnabled = !STATE.streamingEnabled;
  saveToStorage();
  const indicator = document.getElementById('streamToggleIndicator');
  if (indicator) {
    indicator.classList.toggle('active', STATE.streamingEnabled);
  }
  toast(STATE.streamingEnabled ? '已开启流式请求模式' : '已关闭流式请求模式', 'info');
}

// ============================================
// GROUP-LEVEL PRE-REQUEST SCRIPT
// ============================================
function editGroupScript(groupName) {
  if (!groupName) return;
  const modal = document.getElementById('groupScriptModal');
  if (!modal) return;
  document.getElementById('groupScriptModalTitle').textContent = `分组脚本: ${groupName}`;
  document.getElementById('groupScriptModalGroup').value = groupName;
  document.getElementById('groupScriptTextarea').value = getGroupScript(groupName);
  modal.classList.add('show');
}

function closeGroupScriptModal() {
  document.getElementById('groupScriptModal').classList.remove('show');
}

function saveGroupScript() {
  const groupName = document.getElementById('groupScriptModalGroup').value;
  if (!groupName || !STATE.groups[groupName]) return;
  const script = document.getElementById('groupScriptTextarea').value;

  if (Array.isArray(STATE.groups[groupName])) {
    STATE.groups[groupName] = { apiIds: STATE.groups[groupName], preRequestScript: script };
  } else {
    STATE.groups[groupName].preRequestScript = script;
  }

  saveToStorage();
  renderSidebar();
  closeGroupScriptModal();
  toast('分组脚本已保存', 'success');
}

/**
 * Replace {{variableName}} patterns in a string with environment variable values.
 * Also supports {{variableName:defaultValue}} syntax.
 */
function resolveTemplateVars(str) {
  if (typeof str !== 'string') return str;
  return str.replace(/\{\{([^}]+)\}\}/g, (match, expr) => {
    const parts = expr.split(':');
    const key = parts[0].trim();
    const defaultVal = parts.length > 1 ? parts.slice(1).join(':').trim() : match;
    if (_environmentVars.hasOwnProperty(key)) {
      return String(_environmentVars[key]);
    }
    return defaultVal;
  });
}

// ============================================
// HELPERS
// ============================================
function escapeHtml(str) {
  if (!str) return '';
  return String(str).replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;').replace(/'/g, '&#039;');
}

// ============================================
// INIT
// ============================================
init();
