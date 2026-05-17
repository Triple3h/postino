<script setup lang="ts">
import { computed, onMounted, onUnmounted, ref } from 'vue'
import { Maximize2, Menu, RefreshCw, Search, X } from '@lucide/vue'
import { useAppStore } from '@/stores/app'
import { useWorkspaceStore } from '@/stores/workspace'
import Sidebar from '@/components/sidebar/Sidebar.vue'
import EditorView from '@/components/editor/EditorView.vue'
import GlobalSearch from '@/components/common/GlobalSearch.vue'
import { useKeyboardShortcuts } from '@/composables/useKeyboardShortcuts'
import { generateCurl } from '@/utils/export'
import { applyViewOpenContext, buildViewContextUrl, clearViewOpenContext, readViewOpenContext, saveViewOpenContext } from '@/utils/view-context'
import { createDefaultAuthConfig } from '@/utils/auth'
import type { ApiConfig, HttpMethod } from '@/types'

interface BrowserTab {
  id: number
  title?: string
  url?: string
  active?: boolean
}

interface CapturedRequest {
  requestId: string
  method?: string
  url?: string
  statusCode?: number
  updatedAt?: number
  startedAt?: number
  requestHeaders?: Array<{ key: string; value: string }>
}

const store = useAppStore()
const workspace = useWorkspaceStore()
useKeyboardShortcuts()

const navCollapsed = ref(false)
const showCapture = ref(false)
const captureLoading = ref(false)
const capturedRequests = ref<CapturedRequest[]>([])
const captureMessage = ref('')
const targetTabs = ref<BrowserTab[]>([])
const selectedDropTabId = ref('')
const layoutEl = ref<HTMLElement | null>(null)
const panelWidth = ref(480)
let panelResizeObserver: ResizeObserver | null = null

const panelSizeClass = computed(() => {
  if (panelWidth.value <= 400) return 'sidepanel-xs'
  if (panelWidth.value <= 600) return 'sidepanel-sm'
  if (panelWidth.value <= 800) return 'sidepanel-md'
  return 'sidepanel-lg'
})

const compactInterfaceOptions = computed(() => {
  const activeModuleId = workspace.activeSelectionType === 'module'
    ? workspace.activeSelectionId
    : workspace.activeInterface
      ? workspace.interfaces.find(item => item.id === workspace.activeInterface?.id || item.apiId === workspace.activeInterface?.apiId)?.moduleId
      : workspace.modules[0]?.id
  return workspace.interfaces
    .filter(item => item.moduleId === activeModuleId && (item.nodeType ?? 'request') !== 'folder' && item.apiId)
    .map(item => ({ id: item.apiId, label: store.apis[item.apiId]?.name || item.name || item.url || item.apiId }))
})

function getChromeTabs() {
  const chromeApi = typeof chrome !== 'undefined' ? (chrome as any) : null
  return chromeApi?.tabs
}

function saveSelectedDropTab() {
  if (selectedDropTabId.value) localStorage.setItem('apifix_target_tab_id', selectedDropTabId.value)
  else localStorage.removeItem('apifix_target_tab_id')
}

async function refreshTargetTabs() {
  const tabsApi = getChromeTabs()
  if (!tabsApi?.query) return
  await new Promise<void>(resolve => {
    tabsApi.query({ currentWindow: true }, (tabs: BrowserTab[]) => {
      targetTabs.value = (tabs || []).filter(tab => typeof tab.id === 'number')
      const stored = localStorage.getItem('apifix_target_tab_id') || ''
      const active = targetTabs.value.find(tab => tab.active)?.id?.toString() || ''
      selectedDropTabId.value = targetTabs.value.some(tab => tab.id.toString() === stored) ? stored : active
      saveSelectedDropTab()
      resolve()
    })
  })
}

function runtimeSend<T = any>(message: unknown): Promise<T | null> {
  const runtime = typeof chrome !== 'undefined' ? (chrome.runtime as any) : null
  if (!runtime?.sendMessage) return Promise.resolve(null)
  return new Promise(resolve => {
    runtime.sendMessage(message, (response: any) => {
      if (runtime.lastError || !response?.success) {
        resolve(null)
        return
      }
      resolve(response.data ?? response)
    })
  })
}

async function refreshCapturedRequests() {
  captureLoading.value = true
  captureMessage.value = ''
  try {
    const data = await runtimeSend<CapturedRequest[]>({ type: 'GET_RECENT_WEB_REQUESTS' })
    capturedRequests.value = (data || []).slice(0, 10)
    if (capturedRequests.value.length === 0) {
      captureMessage.value = '暂无捕获请求。请在当前页面触发网络请求后刷新。'
    }
  } finally {
    captureLoading.value = false
  }
}

async function openCapturePanel() {
  showCapture.value = !showCapture.value
  if (showCapture.value) await refreshCapturedRequests()
}

function capturedToApiConfig(item: CapturedRequest): ApiConfig {
  return {
    id: item.requestId || Date.now().toString(36),
    name: item.url ? (() => { try { return new URL(item.url || '').pathname || item.url || 'Captured Request' } catch { return item.url || 'Captured Request' } })() : 'Captured Request',
    method: (item.method || 'GET') as HttpMethod,
    url: item.url || '',
    headers: (item.requestHeaders || []).map(header => ({ key: header.key, value: header.value, enabled: true })),
    params: [],
    cookies: [],
    body: { type: 'none', raw: '', formData: [], urlEncoded: [], binaryFile: null, contentType: '' },
    auth: createDefaultAuthConfig(),
    preRequestScript: '',
    postRequestScript: '',
    folder: 'Network 捕获',
    createdAt: item.startedAt || Date.now(),
    updatedAt: item.updatedAt || Date.now(),
  }
}

function buildCapturedCurl(item: CapturedRequest): string {
  return generateCurl(capturedToApiConfig(item))
}

async function copyCapturedCurl(event: MouseEvent, item: CapturedRequest) {
  event.stopPropagation()
  await navigator.clipboard.writeText(buildCapturedCurl(item))
  captureMessage.value = '已复制 cURL'
}

async function dragCapturedCurl(event: DragEvent, item: CapturedRequest) {
  const curl = buildCapturedCurl(item)
  event.dataTransfer?.setData('text/plain', curl)
  event.dataTransfer?.setData('application/x-apifix-curl', curl)
  if (event.dataTransfer) event.dataTransfer.effectAllowed = 'copy'
  await navigator.clipboard.writeText(curl).catch(() => {})
  captureMessage.value = '拖拽内容已设置为 cURL，并已尝试复制到剪贴板'
}

async function importCapturedRequest(item: CapturedRequest) {
  const request = {
    method: item.method || 'GET',
    url: item.url || '',
    headers: item.requestHeaders || [],
    queryString: [],
    postData: null,
  }
  const response = await runtimeSend({
    type: 'STORE_PENDING_IMPORT',
    data: { source: 'sidepanel-webrequest', request },
  })
  captureMessage.value = response ? '已加入待导入队列' : '导入失败：扩展运行时不可用'
}

function openFullPage() {
  const node = store.currentApiId ? workspace.interfaces.find(item => item.apiId === store.currentApiId) : null
  const moduleId = node?.moduleId ?? (workspace.activeSelectionType === 'module' ? workspace.activeSelectionId : null)
  const categoryId = moduleId ? workspace.modules.find(item => item.id === moduleId)?.categoryId ?? null : workspace.activeSelectionType === 'category' ? workspace.activeSelectionId : null
  const context = saveViewOpenContext({ target: 'main', apiId: store.currentApiId, moduleId, categoryId })
  const base = typeof chrome !== 'undefined' && chrome.runtime?.getURL ? chrome.runtime.getURL('main.html') : '/'
  window.open(buildViewContextUrl(base, context), '_blank')
}

async function restoreOpenContext() {
  const context = await readViewOpenContext('sidepanel')
  if (applyViewOpenContext(context, store, workspace)) clearViewOpenContext()
}

function selectCompactInterface(event: Event) {
  const apiId = (event.target as HTMLSelectElement).value
  if (apiId) {
    store.currentApiId = apiId
    workspace.selectInterface(apiId)
  }
}

function handleSidePanelKeydown(event: KeyboardEvent) {
  if (event.key !== 'Escape') return
  if (event.defaultPrevented || document.querySelector('.search-overlay')) return
  if (showCapture.value) {
    event.preventDefault()
    showCapture.value = false
    return
  }
  if (!navCollapsed.value) {
    event.preventDefault()
    navCollapsed.value = true
  }
}

onMounted(() => {
  void restoreOpenContext()
  window.addEventListener('keydown', handleSidePanelKeydown)
  void refreshTargetTabs()
  if (layoutEl.value && typeof ResizeObserver !== 'undefined') {
    panelResizeObserver = new ResizeObserver(entries => {
      const width = entries[0]?.contentRect.width
      if (width) panelWidth.value = Math.round(width)
    })
    panelResizeObserver.observe(layoutEl.value)
  }
})
onUnmounted(() => {
  window.removeEventListener('keydown', handleSidePanelKeydown)
  panelResizeObserver?.disconnect()
  panelResizeObserver = null
})
</script>

<template>
  <div ref="layoutEl" class="sidepanel-layout" :class="[{ collapsed: navCollapsed }, panelSizeClass]">
    <div class="sidepanel-topbar">
      <button class="icon-btn" title="折叠导航" @click="navCollapsed = !navCollapsed"><Menu :size="16" /></button>
      <strong>ApiFix Side Panel</strong>
      <label v-if="panelSizeClass === 'sidepanel-sm' && compactInterfaceOptions.length > 0" class="compact-interface-picker" title="窄侧栏接口选择">
        <span>接口</span>
        <select :value="store.currentApiId || ''" @change="selectCompactInterface">
          <option value="">选择接口</option>
          <option v-for="item in compactInterfaceOptions" :key="item.id" :value="item.id">{{ item.label }}</option>
        </select>
      </label>
      <label v-if="targetTabs.length > 0" class="target-tab-picker" title="接口树拖拽目标标签页">
        <span>目标页</span>
        <select v-model="selectedDropTabId" @change="saveSelectedDropTab">
          <option v-for="tab in targetTabs" :key="tab.id" :value="String(tab.id)">{{ tab.title || tab.url || tab.id }}</option>
        </select>
      </label>
      <div class="topbar-actions">
        <button class="icon-btn" title="捕获当前页请求" @click="openCapturePanel"><Search :size="16" /></button>
        <button class="icon-btn" title="刷新捕获/标签" @click="refreshCapturedRequests(); refreshTargetTabs()" :disabled="!showCapture || captureLoading"><RefreshCw :size="16" :class="{ spinning: captureLoading }" /></button>
        <button class="icon-btn" title="展开全屏" @click="openFullPage"><Maximize2 :size="16" /></button>
      </div>
    </div>

    <div class="sidepanel-main">
      <Sidebar />
      <EditorView />
    </div>

    <aside v-if="showCapture" class="capture-panel">
      <div class="capture-header">
        <strong>Network 捕获</strong>
        <button class="icon-btn" aria-label="关闭捕获面板" @click="showCapture = false"><X :size="16" /></button>
      </div>
      <div v-if="captureLoading" class="capture-empty">加载中...</div>
      <div v-else-if="captureMessage && capturedRequests.length === 0" class="capture-empty">{{ captureMessage }}</div>
      <div v-else class="capture-list">
        <div
          v-for="item in capturedRequests"
          :key="item.requestId"
          class="capture-item"
          draggable="true"
          @dragstart="dragCapturedCurl($event, item)"
          @click="importCapturedRequest(item)"
        >
          <span class="method-badge" :class="(item.method || 'GET').toLowerCase()">{{ item.method || 'GET' }}</span>
          <span class="capture-url">{{ item.url }}</span>
          <span class="capture-status">{{ item.statusCode || '-' }}</span>
          <button class="curl-mini" title="复制 cURL" @click="copyCapturedCurl($event, item)">cURL</button>
        </div>
      </div>
      <div v-if="captureMessage && capturedRequests.length > 0" class="capture-message">{{ captureMessage }}</div>
    </aside>
    <GlobalSearch />
  </div>
</template>

<style scoped>
.sidepanel-layout {
  display: flex;
  flex-direction: column;
  height: 100%;
  width: 100%;
  gap: 8px;
  padding: 8px;
  background: var(--bg-app);
}

.sidepanel-layout.sidepanel-md .sidepanel-main,
.sidepanel-layout.sidepanel-xs .sidepanel-main,
.sidepanel-layout.sidepanel-sm .sidepanel-main {
  gap: 6px;
}

.sidepanel-topbar {
  display: flex;
  align-items: center;
  gap: 8px;
  min-height: 38px;
  padding: 6px 8px;
  border: 1px solid var(--border);
  border-radius: var(--radius-xl);
  background: var(--bg-panel);
  box-shadow: var(--shadow-sm);
}

.compact-interface-picker,
.target-tab-picker {
  display: flex;
  align-items: center;
  gap: 5px;
  min-width: 0;
  max-width: 240px;
  margin-left: auto;
  color: var(--text-secondary);
  font-size: var(--font-size-small);
}

.compact-interface-picker {
  max-width: 210px;
  margin-left: auto;
}

.compact-interface-picker select,
.target-tab-picker select {
  min-width: 0;
  max-width: 170px;
  height: 28px;
  border: 1px solid var(--border);
  border-radius: var(--radius-lg);
  background: var(--bg-primary);
  color: var(--text-primary);
  font-size: var(--font-size-small);
}

.compact-interface-picker select {
  max-width: 140px;
}

.topbar-actions {
  margin-left: auto;
  display: flex;
  gap: 4px;
}

.icon-btn {
  width: 28px;
  height: 28px;
  display: inline-flex;
  align-items: center;
  justify-content: center;
  border: 1px solid var(--border);
  border-radius: var(--radius-lg);
  background: var(--bg-panel);
  color: var(--text-secondary);
  cursor: pointer;
}

.icon-btn:hover:not(:disabled) {
  color: var(--text-primary);
  border-color: var(--primary);
}

.icon-btn:disabled {
  opacity: 0.5;
  cursor: not-allowed;
}

.spinning {
  animation: spin 0.9s linear infinite;
}

@keyframes spin {
  to { transform: rotate(360deg); }
}

.sidepanel-main {
  flex: 1;
  min-height: 0;
  display: flex;
  gap: 8px;
}

.sidepanel-layout.collapsed :deep(.sidebar) {
  width: var(--sidebar-collapsed);
}

.sidepanel-layout.sidepanel-xs :deep(.sidebar) {
  width: var(--sidebar-collapsed) !important;
  min-width: var(--sidebar-collapsed);
}

.sidepanel-layout.sidepanel-xs :deep(.sidebar:hover) {
  width: 220px !important;
  min-width: 220px;
  z-index: 20;
  box-shadow: var(--shadow-lg);
}

.sidepanel-layout.sidepanel-xs :deep(.sidebar-title > div),
.sidepanel-layout.sidepanel-xs :deep(.search-shell),
.sidepanel-layout.sidepanel-xs :deep(.sidebar-actions),
.sidepanel-layout.sidepanel-xs :deep(.category-name),
.sidepanel-layout.sidepanel-xs :deep(.group-name),
.sidepanel-layout.sidepanel-xs :deep(.group-count),
.sidepanel-layout.sidepanel-xs :deep(.folder-name),
.sidepanel-layout.sidepanel-xs :deep(.api-copy),
.sidepanel-layout.sidepanel-xs :deep(.api-actions),
.sidepanel-layout.sidepanel-xs :deep(.module-actions),
.sidepanel-layout.sidepanel-xs :deep(.resizer) {
  display: none !important;
}

.sidepanel-layout.sidepanel-xs :deep(.sidebar:hover .sidebar-title > div),
.sidepanel-layout.sidepanel-xs :deep(.sidebar:hover .search-shell),
.sidepanel-layout.sidepanel-xs :deep(.sidebar:hover .sidebar-actions),
.sidepanel-layout.sidepanel-xs :deep(.sidebar:hover .category-name),
.sidepanel-layout.sidepanel-xs :deep(.sidebar:hover .group-name),
.sidepanel-layout.sidepanel-xs :deep(.sidebar:hover .group-count),
.sidepanel-layout.sidepanel-xs :deep(.sidebar:hover .folder-name),
.sidepanel-layout.sidepanel-xs :deep(.sidebar:hover .api-copy),
.sidepanel-layout.sidepanel-xs :deep(.sidebar:hover .api-actions),
.sidepanel-layout.sidepanel-xs :deep(.sidebar:hover .module-actions) {
  display: flex !important;
}

.sidepanel-layout.sidepanel-sm :deep(.sidebar) {
  width: 180px !important;
  min-width: 180px;
}

.sidepanel-layout.sidepanel-sm :deep(.sidebar-content .api-item),
.sidepanel-layout.sidepanel-sm :deep(.sidebar-content .folder-item) {
  display: none;
}

.sidepanel-layout.sidepanel-sm :deep(.sidebar-actions) {
  flex-wrap: wrap;
}

.sidepanel-layout.sidepanel-sm .target-tab-picker {
  display: none;
}

.sidepanel-layout.sidepanel-xs .target-tab-picker,
.sidepanel-layout.sidepanel-xs .compact-interface-picker,
.sidepanel-layout.sidepanel-xs .sidepanel-topbar strong {
  display: none;
}

.sidepanel-layout.sidepanel-md :deep(.editor-view) {
  min-width: 0;
}

.sidepanel-layout.sidepanel-lg :deep(.editor-view) {
  min-width: 600px;
}

.capture-panel {
  position: fixed;
  top: 56px;
  right: 12px;
  width: min(360px, calc(100vw - 24px));
  max-height: 60vh;
  display: flex;
  flex-direction: column;
  border: 1px solid var(--border);
  border-radius: var(--radius-xl);
  background: var(--bg-panel);
  box-shadow: var(--shadow-lg);
  z-index: 30;
  overflow: hidden;
}

.capture-header {
  display: flex;
  align-items: center;
  justify-content: space-between;
  padding: 8px 10px;
  border-bottom: 1px solid var(--divider);
}

.capture-list {
  overflow: auto;
  padding: 6px;
}

.capture-item {
  width: 100%;
  display: flex;
  align-items: center;
  gap: 6px;
  padding: 7px;
  border: 1px solid transparent;
  border-radius: var(--radius-lg);
  background: transparent;
  cursor: pointer;
  text-align: left;
}

.capture-item:hover {
  background: var(--bg-hover);
  border-color: var(--border);
}

.capture-url {
  flex: 1;
  min-width: 0;
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
  font-family: var(--font-code);
  font-size: var(--font-size-small);
}

.curl-mini {
  border: 1px solid var(--border);
  border-radius: 999px;
  background: var(--bg-panel);
  color: var(--text-secondary);
  cursor: pointer;
  padding: 2px 6px;
  font-size: 10px;
}

.curl-mini:hover {
  color: var(--primary);
  border-color: var(--primary);
}

.capture-status,
.capture-empty,
.capture-message {
  color: var(--text-secondary);
  font-size: var(--font-size-small);
}

.capture-empty,
.capture-message {
  padding: 12px;
}

@media (max-width: 400px) {
  .sidepanel-layout :deep(.sidebar) {
    width: var(--sidebar-collapsed);
  }
}

@media (max-width: 600px) {
  .sidepanel-layout :deep(.sidebar) {
    width: 180px;
  }
}
</style>
