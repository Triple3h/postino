<script setup lang="ts">
import { ref, computed, onMounted, onUnmounted } from 'vue'
import { useAppStore } from '@/stores/app'
import { useWorkspaceStore } from '@/stores/workspace'
import { sendRequest as httpSendRequest } from '@/utils/http'
import { generateCurl } from '@/utils/export'
import { buildViewContextUrl, saveViewOpenContext, type ViewOpenContext } from '@/utils/view-context'
import { createDefaultAuthConfig } from '@/utils/auth'
import type { HistoryEntry, HttpMethod, Module, ResponseData } from '@/types'

const store = useAppStore()
const workspace = useWorkspaceStore()
const method = ref<HttpMethod>('GET')
const url = ref('')
const bodyText = ref('')
const loading = ref(false)
const response = ref<ResponseData | null>(null)
const showResponsePreview = ref(false)
const toast = ref('')
const selectedApiId = ref<string | null>(null)
const selectedModuleId = ref<string | null>(null)
const selectedCategoryId = ref<string | null>(null)
const searchQuery = ref('')

interface PopupSearchResult {
  apiId: string
  moduleId: string
  categoryId: string | null
  name: string
  method: HttpMethod
  url: string
  moduleName: string
  hasScripts: boolean
}

const recentHistory = computed(() => store.history.slice(0, 5))
const recentModules = computed(() => {
  const usedModuleIds = new Set<string>()
  for (const history of store.history) {
    const interfaceNode = workspace.interfaces.find(item => item.apiId === history.apiId)
    if (interfaceNode) usedModuleIds.add(interfaceNode.moduleId)
  }
  const recentlyUsed = [...usedModuleIds]
    .map(moduleId => workspace.modules.find(item => item.id === moduleId))
    .filter((module): module is NonNullable<typeof module> => Boolean(module))
  const fallback = workspace.modules.filter(module => !usedModuleIds.has(module.id))
  return [...recentlyUsed, ...fallback].slice(0, 3)
})

const methods: HttpMethod[] = ['GET', 'POST', 'PUT', 'DELETE', 'PATCH']
const RESPONSE_PREVIEW_LIMIT = 1000

const responsePreview = computed(() => {
  const body = response.value?.body || ''
  return body.length > RESPONSE_PREVIEW_LIMIT ? `${body.slice(0, RESPONSE_PREVIEW_LIMIT)}\n…` : body
})

const responsePreviewTruncated = computed(() => (response.value?.body.length || 0) > RESPONSE_PREVIEW_LIMIT)

const popupResponseStatusClass = computed(() => {
  const status = response.value?.status || 0
  if (status >= 200 && status < 300) return 'success'
  if (status >= 300 && status < 400) return 'redirect'
  if (status >= 400 && status < 500) return 'client-error'
  if (status >= 500) return 'server-error'
  return 'error'
})

const popupResponseDurationClass = computed(() => {
  const duration = response.value?.duration || 0
  if (duration > 3000) return 'slow'
  if (duration > 1000) return 'medium'
  return ''
})

const popupResponseSize = computed(() => formatBytes(response.value?.size || 0))

const searchResults = computed<PopupSearchResult[]>(() => {
  const query = searchQuery.value.trim().toLowerCase()
  if (!query) return []
  const results: PopupSearchResult[] = []
  for (const item of workspace.interfaces) {
    if ((item.nodeType ?? 'request') === 'folder' || !item.apiId) continue
    const api = store.apis[item.apiId]
    const module = workspace.modules.find(module => module.id === item.moduleId)
    if (!api || !module) continue
    const result: PopupSearchResult = {
        apiId: api.id,
        moduleId: item.moduleId,
        categoryId: module.categoryId,
        name: api.name,
        method: api.method,
        url: api.url,
        moduleName: module.name,
        hasScripts: Boolean(api.preRequestScript || api.postRequestScript || item.preScript || item.postScript),
    }
    if ([result.name, result.url, result.method, result.moduleName].some(value => String(value).toLowerCase().includes(query))) {
      results.push(result)
    }
    if (results.length >= 6) break
  }
  return results
})

function methodColor(m: HttpMethod): string {
  const colors: Record<string, string> = {
    GET: 'var(--method-get)', POST: 'var(--method-post)', PUT: 'var(--method-put)',
    DELETE: 'var(--method-delete)', PATCH: 'var(--method-patch)',
  }
  return colors[m] || 'var(--text-secondary)'
}

function formatBytes(size: number): string {
  if (size >= 1024 * 1024) return `${(size / 1024 / 1024).toFixed(1)}MB`
  if (size >= 1024) return `${(size / 1024).toFixed(1)}KB`
  return `${size}B`
}

function looksLikeJson(value: string): boolean {
  const trimmed = value.trim()
  if (!trimmed || (!trimmed.startsWith('{') && !trimmed.startsWith('['))) return false
  try {
    JSON.parse(trimmed)
    return true
  } catch {
    return false
  }
}

async function send() {
  if (!url.value.trim()) return
  loading.value = true
  response.value = null
  showResponsePreview.value = false
  try {
    const trimmedBody = bodyText.value.trim()
    const bodyType = trimmedBody ? (looksLikeJson(trimmedBody) ? 'json' : 'raw') : 'none'
    response.value = await httpSendRequest({
      method: method.value,
      url: url.value,
      headers: [],
      params: [],
      cookies: [],
      autoCarryCookies: store.autoCarryCookies,
      body: {
        type: bodyType,
        raw: bodyText.value,
        formData: [],
        urlEncoded: [],
        binaryFile: null,
        contentType: bodyType === 'json' ? 'application/json' : bodyType === 'raw' ? 'text/plain' : '',
      },
      auth: createDefaultAuthConfig(),
      corsMode: store.settings.corsMode,
      proxyUrl: store.settings.proxyUrl,
      envVars: store.getEnvVariables(),
    })
  } finally {
    loading.value = false
  }
}

function rememberApiContext(apiId: string | null) {
  const knownApiId = apiId && store.apis[apiId] ? apiId : null
  selectedApiId.value = knownApiId
  const node = knownApiId ? workspace.interfaces.find(item => item.apiId === knownApiId) : null
  selectedModuleId.value = node?.moduleId ?? selectedModuleId.value
  selectedCategoryId.value = selectedModuleId.value ? workspace.modules.find(item => item.id === selectedModuleId.value)?.categoryId ?? selectedCategoryId.value : selectedCategoryId.value
}

function loadFromHistory(entry: HistoryEntry) {
  url.value = entry.url
  method.value = entry.method
  bodyText.value = entry.requestBody || ''
  rememberApiContext(entry.apiId)
}

function loadSearchResult(result: PopupSearchResult) {
  const api = store.apis[result.apiId]
  if (!api) return
  selectedApiId.value = result.apiId
  selectedModuleId.value = result.moduleId
  selectedCategoryId.value = result.categoryId
  method.value = api.method
  url.value = api.url
  bodyText.value = api.body.raw || ''
  searchQuery.value = ''
}

function moduleVariableValue(module: Module, key: string): string {
  const value = module.variables?.[key]
  if (!value) return ''
  const envValue = store.currentEnvId ? value.environmentValues?.[store.currentEnvId] : ''
  return envValue || value.local || value.remote || ''
}

function moduleBaseUrlTemplate(module: Module): string {
  const entries = Object.entries(module.variables ?? {})
  if (!entries.length) return ''
  const keywordPattern = /(base|url|host|origin|endpoint|api)/i
  const withRuntimeValue = entries.map(([key]) => ({ key, value: moduleVariableValue(module, key) }))
  const preferred = withRuntimeValue.find(item => keywordPattern.test(item.key) && item.value)
    ?? withRuntimeValue.find(item => /^https?:\/\//i.test(item.value))
  return preferred ? `{{${module.name}.${preferred.key}}}` : ''
}

async function sendFirstSearchResult() {
  const first = searchResults.value[0]
  if (!first) return
  loadSearchResult(first)
  await send()
}

function loadModule(moduleId: string) {
  const module = workspace.modules.find(item => item.id === moduleId)
  selectedModuleId.value = moduleId
  selectedCategoryId.value = module?.categoryId ?? null
  const firstInterface = workspace.interfaces.find(item => item.moduleId === moduleId && (item.nodeType ?? 'request') !== 'folder' && item.apiId)
  const api = firstInterface ? store.apis[firstInterface.apiId] : null
  if (!api) {
    selectedApiId.value = null
    method.value = 'GET'
    url.value = module ? moduleBaseUrlTemplate(module) : ''
    bodyText.value = ''
    return
  }
  selectedApiId.value = api.id
  url.value = api.url
  method.value = api.method
  bodyText.value = api.body.raw || ''
}

function moduleInterfaceCount(moduleId: string): number {
  return workspace.interfaces.filter(item => item.moduleId === moduleId && (item.nodeType ?? 'request') !== 'folder').length
}

async function sendLastRequest() {
  const last = recentHistory.value[0]
  if (!last) return
  loadFromHistory(last)
  await send()
}

async function copyLastCurl() {
  const last = recentHistory.value[0]
  if (!last) return
  const api = store.apis[last.apiId]
  const cmd = api ? generateCurl(api, store.getEnvVariables()) : `curl -X ${last.method} '${last.url}'`
  try {
    await navigator.clipboard.writeText(cmd)
    showToast('已复制上次 cURL')
  } catch {
    showToast('复制失败')
  }
}

function pendingRequestFromHistory(entry: HistoryEntry) {
  const body = entry.requestBody || ''
  const isJson = looksLikeJson(body)
  return {
    method: entry.method,
    url: entry.url,
    headers: Object.entries(entry.requestHeaders || {}).map(([key, value]) => ({ key, value })),
    postData: body
      ? {
          mimeType: isJson ? 'application/json' : 'text/plain',
          text: body,
          params: [],
        }
      : null,
  }
}

async function storePendingHistoryImport(entry: HistoryEntry): Promise<string | null> {
  const runtime = typeof chrome !== 'undefined' ? (chrome.runtime as any) : null
  if (!runtime?.sendMessage) return null
  return await new Promise(resolve => {
    runtime.sendMessage({
      type: 'STORE_PENDING_IMPORT',
      data: {
        source: 'popup-history',
        request: pendingRequestFromHistory(entry),
      },
    }, (response: any) => resolve(response?.data?.id || null))
  })
}

async function openHistoryInSidePanel(entry: HistoryEntry, event?: MouseEvent) {
  event?.stopPropagation()
  loadFromHistory(entry)
  const runtime = typeof chrome !== 'undefined' ? (chrome.runtime as any) : null
  const hasKnownApi = Boolean(entry.apiId && store.apis[entry.apiId])
  if (!hasKnownApi) await storePendingHistoryImport(entry)
  currentOpenContext('sidepanel')
  if (runtime?.sendMessage) {
    runtime.sendMessage({ type: 'OPEN_SIDE_PANEL' }, (response: any) => {
      if (runtime.lastError || !response?.success) showToast('侧边栏打开失败，已保留历史请求')
      else showToast('已在侧边栏复用历史请求')
    })
    return
  }
  window.open(buildViewContextUrl('/sidepanel.html', currentOpenContext('sidepanel')), '_blank')
}

async function openHistoryInFullPage(entry: HistoryEntry, event?: MouseEvent) {
  event?.stopPropagation()
  loadFromHistory(entry)
  const hasKnownApi = Boolean(entry.apiId && store.apis[entry.apiId])
  const pendingImportId = hasKnownApi ? null : await storePendingHistoryImport(entry)
  const context = currentOpenContext('main')
  const baseUrl = typeof chrome !== 'undefined' && chrome.runtime?.getURL
    ? chrome.runtime.getURL('main.html')
    : '/'
  const url = pendingImportId
    ? buildViewContextUrl(`${baseUrl}?pendingImport=${encodeURIComponent(pendingImportId)}`, context)
    : buildViewContextUrl(baseUrl, context)
  window.open(url, '_blank')
}

function currentOpenContext(target: ViewOpenContext['target'], extra: Partial<ViewOpenContext> = {}): ViewOpenContext {
  const fallbackNode = store.currentApiId ? workspace.interfaces.find(item => item.apiId === store.currentApiId) : null
  const moduleId = selectedModuleId.value || fallbackNode?.moduleId || null
  const categoryId = selectedCategoryId.value || (moduleId ? workspace.modules.find(item => item.id === moduleId)?.categoryId ?? null : null)
  return saveViewOpenContext({
    target,
    apiId: selectedApiId.value || store.currentApiId || null,
    moduleId,
    categoryId,
    ...extra,
  })
}

function openFullPage(extra: Partial<ViewOpenContext> | Event = {}) {
  const contextExtra = 'openHistory' in extra ? extra : {}
  const context = currentOpenContext('main', contextExtra)
  if (typeof chrome !== 'undefined' && chrome.runtime?.getURL) {
    window.open(buildViewContextUrl(chrome.runtime.getURL('main.html'), context), '_blank')
  } else {
    window.open(buildViewContextUrl('/', context), '_blank')
  }
}

async function openSidePanel() {
  currentOpenContext('sidepanel')
  const runtime = typeof chrome !== 'undefined' ? (chrome.runtime as any) : null
  if (runtime?.sendMessage) {
    runtime.sendMessage({ type: 'OPEN_SIDE_PANEL' }, (response: any) => {
      if (runtime.lastError || !response?.success) showToast('侧边栏打开失败，已保留当前上下文')
      else showToast('已打开侧边栏并携带当前上下文')
    })
    return
  }
  window.open(buildViewContextUrl('/sidepanel.html', currentOpenContext('sidepanel')), '_blank')
}

function showToast(message: string) {
  toast.value = message
  setTimeout(() => { toast.value = '' }, 1600)
}

function handlePopupKeydown(event: KeyboardEvent) {
  if (event.key !== 'Escape') return
  event.preventDefault()
  window.close()
}

onMounted(() => window.addEventListener('keydown', handlePopupKeydown))
onUnmounted(() => window.removeEventListener('keydown', handlePopupKeydown))
</script>

<template>
  <div class="popup-view">
    <div class="popup-header">
      <div class="popup-search-wrap">
        <label class="popup-search">
          <span>🔍</span>
          <input
            v-model="searchQuery"
            type="search"
            placeholder="搜索接口名、URL、模块，回车发送第一条"
            @keydown.enter.prevent="sendFirstSearchResult"
          />
        </label>
        <div v-if="searchQuery && searchResults.length > 0" class="search-popover">
          <button
            v-for="result in searchResults"
            :key="result.apiId"
            class="search-result"
            @click="loadSearchResult(result)"
          >
            <span class="method-badge" :class="result.method.toLowerCase()">{{ result.method }}</span>
            <span class="search-main">
              <strong>{{ result.name }}</strong>
              <small>{{ result.moduleName }} · {{ result.url }}</small>
            </span>
            <span v-if="result.hasScripts" class="script-badge">脚本</span>
          </button>
        </div>
        <div v-else-if="searchQuery" class="search-popover empty">未找到匹配接口</div>
      </div>
      <button class="btn-fullscreen" title="打开全屏页" @click="openFullPage">
        <svg width="16" height="16" viewBox="0 0 16 16" fill="none" stroke="currentColor" stroke-width="1.5" stroke-linecap="round" stroke-linejoin="round">
          <path d="M2 6V3a1 1 0 0 1 1-1h3M10 2h3a1 1 0 0 1 1 1v3M14 10v3a1 1 0 0 1-1 1h-3M6 14H3a1 1 0 0 1-1-1v-3"/>
        </svg>
      </button>
    </div>

    <section v-if="recentModules.length > 0" class="recent-modules">
      <div class="section-title">📂 最近访问模块</div>
      <div class="module-cards">
        <button v-for="module in recentModules" :key="module.id" class="module-card" @click="loadModule(module.id)">
          <strong>{{ module.name }}</strong>
          <small>{{ moduleInterfaceCount(module.id) }} 接口</small>
        </button>
      </div>
    </section>

    <section class="quick-actions">
      <button class="btn" @click="sendLastRequest" :disabled="!recentHistory[0] || loading">发送上次请求</button>
      <button class="btn" @click="copyLastCurl" :disabled="!recentHistory[0]">复制上次 cURL</button>
      <button class="btn" @click="openSidePanel">打开侧边栏</button>
      <button class="btn" @click="openFullPage({ openHistory: true })">查看历史</button>
    </section>

    <div class="popup-input">
      <select v-model="method" class="method-select" :style="{ color: methodColor(method) }">
        <option v-for="m in methods" :key="m" :value="m">{{ m }}</option>
      </select>
      <input v-model="url" type="url" placeholder="输入 URL" class="url-input" @keydown.enter="send" />
      <button class="btn btn-primary" @click="send" :disabled="loading || !url.trim()">
        {{ loading ? '...' : '发送' }}
      </button>
    </div>

    <label class="body-box">
      <span>Body（JSON/Text）</span>
      <textarea v-model="bodyText" placeholder='{ "key": "value" }' spellcheck="false"></textarea>
    </label>

    <div v-if="response" class="popup-response">
      <div class="response-status">
        <span :class="['status', popupResponseStatusClass]">
          {{ response.status }} {{ response.statusText }}
        </span>
        <span :class="['duration', popupResponseDurationClass]">{{ response.duration }}ms</span>
        <span class="duration">{{ popupResponseSize }}</span>
        <button class="preview-toggle" @click="showResponsePreview = !showResponsePreview">
          {{ showResponsePreview ? '收起预览' : '展开预览' }}
        </button>
      </div>
      <pre v-if="showResponsePreview" class="response-body">{{ responsePreview }}</pre>
      <div v-if="showResponsePreview && responsePreviewTruncated" class="response-preview-note">
        仅显示前 {{ RESPONSE_PREVIEW_LIMIT }} 字符，完整响应请在 Side Panel / 全屏页查看。
      </div>
    </div>
    <div v-else-if="loading" class="popup-response popup-loading">请求发送中...</div>

    <div v-if="recentHistory.length > 0" class="popup-history">
      <h3>🧪 最近历史</h3>
      <div v-for="entry in recentHistory" :key="entry.id" class="history-item" @click="loadFromHistory(entry)">
        <span :class="['method-badge', entry.method.toLowerCase()]">{{ entry.method }}</span>
        <span class="history-url">{{ entry.url }}</span>
        <span class="history-status">{{ entry.status }} · {{ entry.duration }}ms</span>
        <span class="history-actions">
          <button @click="openHistoryInSidePanel(entry, $event)">侧栏</button>
          <button @click="openHistoryInFullPage(entry, $event)">全屏</button>
        </span>
      </div>
    </div>

    <div class="popup-footer">
      <span>⚙️ 设置</span>
      <span>🌐 环境: {{ store.environments.find(env => env.id === store.currentEnvId)?.name || '默认' }}</span>
      <span>📊 统计: {{ workspace.modules.length }} 模块 / {{ workspace.interfaces.filter(item => (item.nodeType ?? 'request') !== 'folder').length }} 接口</span>
      <button @click="openFullPage">打开完整版 →</button>
    </div>
    <div v-if="toast" class="popup-toast">{{ toast }}</div>
  </div>
</template>

<style scoped>
.popup-view {
  padding: 12px;
  width: 100%;
  height: 100%;
  min-width: 0;
  overflow: auto;
  overflow-x: hidden;
  background:
    radial-gradient(circle at 0% 0%, var(--primary-soft), transparent 34%),
    var(--bg-base);
}

:global(body.popup-mode) {
  width: 800px;
  height: 600px;
  overflow: hidden;
}

:global(body.popup-mode #app) {
  width: 800px;
  height: 600px;
  overflow: hidden;
}

.popup-header,
.recent-modules,
.quick-actions,
.popup-input,
.body-box,
.popup-footer {
  margin-bottom: 14px;
  padding: 10px;
  border: 1px solid var(--border);
  border-radius: var(--radius-xl);
  background: var(--bg-panel);
  box-shadow: var(--shadow-sm);
}

.popup-header {
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: 8px;
}

.popup-search-wrap {
  position: relative;
  flex: 1;
  min-width: 0;
}

.section-title,
.popup-footer {
  color: var(--text-secondary);
  font-size: var(--font-size-small);
}

.popup-search {
  display: flex;
  align-items: center;
  gap: 8px;
  min-height: 34px;
  padding: 0 10px;
  border: 1px solid var(--border);
  border-radius: var(--radius-lg);
  background: var(--bg-code);
}

.popup-search input {
  flex: 1;
  min-width: 0;
  border: 0;
  outline: 0;
  background: transparent;
  color: var(--text-primary);
  font-size: var(--font-size-body);
}

.search-popover {
  position: absolute;
  top: calc(100% + 6px);
  left: 0;
  right: 8px;
  z-index: 20;
  max-height: 238px;
  overflow: auto;
  border: 1px solid var(--border);
  border-radius: var(--radius-xl);
  background: var(--bg-panel);
  box-shadow: var(--shadow-lg);
  padding: 6px;
}

.search-popover.empty {
  padding: 10px;
  color: var(--text-secondary);
  font-size: var(--font-size-small);
}

.search-result {
  display: flex;
  align-items: center;
  gap: 8px;
  width: 100%;
  padding: 8px;
  border: 0;
  border-radius: var(--radius-lg);
  background: transparent;
  text-align: left;
  color: var(--text-primary);
  cursor: pointer;
}

.search-result:hover {
  background: var(--bg-hover);
}

.search-main {
  flex: 1;
  min-width: 0;
}

.search-main strong,
.search-main small {
  display: block;
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
}

.search-main small {
  color: var(--text-tertiary);
  margin-top: 2px;
}

.script-badge {
  padding: 2px 5px;
  border-radius: 999px;
  background: var(--primary-soft);
  color: var(--primary);
  font-size: 11px;
}

.section-title {
  font-weight: 750;
  margin-bottom: 8px;
}

.module-cards {
  display: flex;
  gap: 8px;
  overflow: hidden;
}

.module-card {
  flex: 1 1 0;
  min-width: 0;
  min-height: 68px;
  text-align: left;
  border: 1px solid var(--border);
  border-radius: var(--radius-lg);
  background: linear-gradient(180deg, var(--bg-code), var(--bg-panel));
  padding: 10px;
  cursor: pointer;
}

.module-card strong,
.module-card small {
  display: block;
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
}

.module-card small {
  margin-top: 8px;
  color: var(--text-tertiary);
}

.quick-actions,
.popup-input,
.popup-footer {
  display: flex;
  align-items: center;
  gap: 8px;
  flex-wrap: wrap;
}

.btn-fullscreen {
  display: flex;
  align-items: center;
  justify-content: center;
  width: 28px;
  height: 28px;
  border: 1px solid var(--border);
  border-radius: var(--radius-lg);
  background: var(--bg-panel);
  color: var(--text-secondary);
  cursor: pointer;
  transition: all 0.15s;
}

.btn-fullscreen:hover {
  background: var(--bg-hover);
  color: var(--text-primary);
  border-color: var(--text-secondary);
}

.method-select {
  padding: 4px 28px 4px 8px;
  border: 1px solid var(--border);
  border-radius: var(--radius-lg);
  background-color: var(--bg-panel);
  font-weight: 850;
  font-size: var(--font-size-body);
  min-width: 70px;
  outline: none;
}

.url-input {
  flex: 1 1 180px;
  min-width: 0;
  height: 32px;
  font-size: var(--font-size-body);
  font-family: var(--font-code);
}

.body-box {
  display: flex;
  flex-direction: column;
  gap: 6px;
}

.body-box textarea {
  min-height: 88px;
  resize: vertical;
  font-family: var(--font-code);
  font-size: var(--font-size-code);
  background: var(--bg-code);
}

.popup-response {
  margin-bottom: 12px;
  border: 1px solid var(--border);
  border-radius: var(--radius-xl);
  overflow: hidden;
  background: var(--bg-panel);
  box-shadow: var(--shadow-sm);
}

.popup-loading {
  padding: 18px;
  color: var(--text-secondary);
}

.response-status {
  display: flex;
  align-items: center;
  flex-wrap: wrap;
  gap: 8px;
  padding: 6px 8px;
  background: var(--bg-sidebar);
  border-bottom: 1px solid var(--divider);
  font-size: var(--font-size-small);
}

.status { font-weight: 600; }
.status.success { color: var(--success); }
.status.redirect { color: var(--info); }
.status.client-error { color: var(--warning); }
.status.server-error,
.status.error { color: var(--error); }
.duration { color: var(--text-secondary); }
.duration.medium { color: var(--warning); }
.duration.slow { color: var(--error); }

.preview-toggle {
  margin-left: auto;
  border: 0;
  background: transparent;
  color: var(--primary);
  cursor: pointer;
  font-size: var(--font-size-small);
}

.response-body {
  padding: 8px;
  font-family: var(--font-code);
  font-size: var(--font-size-code);
  max-height: 120px;
  overflow: auto;
  white-space: pre-wrap;
  word-break: break-all;
}

.response-preview-note {
  padding: 6px 8px 8px;
  border-top: 1px solid var(--divider);
  color: var(--text-tertiary);
  font-size: var(--font-size-small);
}

.popup-history h3 {
  font-size: var(--font-size-title);
  font-weight: 600;
  margin-bottom: 6px;
  color: var(--text-secondary);
}

.history-item {
  display: flex;
  align-items: center;
  gap: 6px;
  padding: 7px 8px;
  border-radius: var(--radius-lg);
  cursor: pointer;
  font-size: var(--font-size-small);
  border: 1px solid transparent;
}

.history-item:hover {
  background: var(--bg-hover);
  border-color: var(--border);
}

.history-url {
  flex: 1;
  min-width: 0;
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
  font-family: var(--font-code);
}

.history-status {
  color: var(--text-secondary);
}

.history-actions {
  display: flex;
  gap: 4px;
  flex-shrink: 0;
}

.history-actions button {
  border: 1px solid var(--border);
  border-radius: var(--radius-sm);
  background: var(--bg-panel);
  color: var(--text-secondary);
  padding: 2px 6px;
  cursor: pointer;
  font-size: 11px;
}

.history-actions button:hover {
  color: var(--primary);
  border-color: var(--primary);
}

.popup-footer button {
  margin-left: auto;
  color: var(--primary);
  background: transparent;
  cursor: pointer;
}

.popup-toast {
  position: fixed;
  right: 16px;
  bottom: 16px;
  padding: 8px 10px;
  border: 1px solid var(--border);
  border-radius: var(--radius-lg);
  background: var(--bg-panel);
  box-shadow: var(--shadow-lg);
}

@media (max-width: 520px) {
  .popup-view {
    padding: 10px;
  }

  .quick-actions .btn {
    flex: 1 1 calc(50% - 4px);
    min-width: 0;
    padding-inline: 8px;
  }

  .url-input {
    flex-basis: 100%;
    order: 2;
  }

  .popup-footer button {
    margin-left: 0;
  }

  .popup-history .history-status {
    display: none;
  }
}
</style>
