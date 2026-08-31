<script setup lang="ts">
import { ref, computed, nextTick, onMounted, onUnmounted } from 'vue'
import {
  ArrowRight,
  BarChart3,
  Check,
  ChevronDown,
  ClipboardCopy,
  FlaskConical,
  FolderClock,
  History,
  Maximize2,
  PanelRightOpen,
  RotateCw,
  Search,
  Settings,
} from '@lucide/vue'
import { useAppStore } from '@/stores/app'
import { useWorkspaceStore } from '@/stores/workspace'
import { generateCurl } from '@/utils/export'
import { buildViewContextUrl, saveViewOpenContext, type ViewOpenContext } from '@/utils/view-context'
import { createDefaultAuthConfig } from '@/utils/auth'
import { getApiRequestCapabilities, runApiRequest } from '@/utils/api-request-runner'
import type { ApiConfig, HistoryEntry, HttpMethod, Module, ResponseData } from '@/types'

const store = useAppStore()
const workspace = useWorkspaceStore()
const method = ref<HttpMethod>('GET')
const url = ref('')
const bodyText = ref('')
const loading = ref(false)
const response = ref<ResponseData | null>(null)
let requestAbortController: AbortController | null = null
const showResponsePreview = ref(false)
const toast = ref('')
const selectedApiId = ref<string | null>(null)
const selectedModuleId = ref<string | null>(null)
const selectedCategoryId = ref<string | null>(null)
const searchQuery = ref('')
const showMethodMenu = ref(false)
const methodMenuIndex = ref(0)
const methodPickerRef = ref<HTMLDivElement | null>(null)
const methodButtonRef = ref<HTMLButtonElement | null>(null)
const methodMenuRef = ref<HTMLDivElement | null>(null)
const urlInputRef = ref<HTMLInputElement | null>(null)

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
const selectedApi = computed<ApiConfig | null>(() => selectedApiId.value ? store.apis[selectedApiId.value] ?? null : null)
const requestCapabilities = computed(() => selectedApi.value ? getApiRequestCapabilities(selectedApi.value) : null)
const requestCapabilityLabels = computed(() => {
  const capabilities = requestCapabilities.value
  if (!capabilities) return []
  const labels: string[] = []
  if (capabilities.params) labels.push(`参数 ${capabilities.params}`)
  if (capabilities.headers) labels.push(`Header ${capabilities.headers}`)
  if (capabilities.cookies) labels.push(`Cookie ${capabilities.cookies}`)
  if (capabilities.auth) labels.push('认证')
  if (capabilities.preScripts) labels.push(`前置脚本 ${capabilities.preScripts}`)
  if (capabilities.postScripts) labels.push(`后置脚本 ${capabilities.postScripts}`)
  return labels
})

function openMethodMenu(direction: 1 | -1 = 1) {
  const currentIndex = methods.indexOf(method.value)
  methodMenuIndex.value = currentIndex >= 0
    ? currentIndex
    : direction > 0 ? 0 : methods.length - 1
  showMethodMenu.value = true
  nextTick(() => methodMenuRef.value?.focus())
}

function closeMethodMenu(restoreFocus = false) {
  showMethodMenu.value = false
  if (restoreFocus) nextTick(() => methodButtonRef.value?.focus())
}

function toggleMethodMenu() {
  if (showMethodMenu.value) closeMethodMenu()
  else openMethodMenu()
}

function selectMethod(nextMethod: HttpMethod) {
  method.value = nextMethod
  closeMethodMenu(true)
}

function handleMethodButtonKeydown(event: KeyboardEvent) {
  if (event.key !== 'ArrowDown' && event.key !== 'ArrowUp') return
  event.preventDefault()
  openMethodMenu(event.key === 'ArrowDown' ? 1 : -1)
}

function handleMethodMenuKeydown(event: KeyboardEvent) {
  if (event.key === 'ArrowDown' || event.key === 'ArrowUp') {
    event.preventDefault()
    event.stopPropagation()
    const direction = event.key === 'ArrowDown' ? 1 : -1
    methodMenuIndex.value = (methodMenuIndex.value + direction + methods.length) % methods.length
    return
  }
  if (event.key === 'Home' || event.key === 'End') {
    event.preventDefault()
    event.stopPropagation()
    methodMenuIndex.value = event.key === 'Home' ? 0 : methods.length - 1
    return
  }
  if (event.key === 'Enter' || event.key === ' ') {
    event.preventDefault()
    event.stopPropagation()
    selectMethod(methods[methodMenuIndex.value])
    return
  }
  if (event.key === 'Escape') {
    event.preventDefault()
    event.stopPropagation()
    closeMethodMenu(true)
    return
  }
  if (event.key === 'Tab') {
    event.preventDefault()
    event.stopPropagation()
    closeMethodMenu()
    nextTick(() => event.shiftKey ? methodButtonRef.value?.focus() : urlInputRef.value?.focus())
  }
}

function handlePopupPointerDown(event: PointerEvent) {
  if (!showMethodMenu.value || methodPickerRef.value?.contains(event.target as Node)) return
  closeMethodMenu()
}

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
        hasScripts: Boolean(api.preRequestScript || api.postRequestScript),
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
  if (loading.value) {
    requestAbortController?.abort(new DOMException('Request cancelled', 'AbortError'))
    return
  }
  if (!url.value.trim()) return
  const abortController = new AbortController()
  requestAbortController = abortController
  loading.value = true
  response.value = null
  showResponsePreview.value = false
  try {
    const trimmedBody = bodyText.value.trim()
    const bodyType = trimmedBody ? (looksLikeJson(trimmedBody) ? 'json' : 'raw') : 'none'
    const api: ApiConfig = selectedApi.value ?? {
      id: 'popup-quick-request',
      name: '快速请求',
      method: method.value,
      url: url.value,
      headers: [],
      params: [],
      cookies: [],
      body: {
        type: bodyType,
        raw: bodyText.value,
        formData: [],
        urlEncoded: [],
        binaryFile: null,
        contentType: bodyType === 'json' ? 'application/json' : bodyType === 'raw' ? 'text/plain' : '',
      },
      auth: createDefaultAuthConfig(),
      preRequestScript: '',
      postRequestScript: '',
      folder: null,
      createdAt: Date.now(),
      updatedAt: Date.now(),
    }
    response.value = await runApiRequest(api, {
      method: method.value,
      url: url.value,
      rawBody: bodyText.value,
      signal: abortController.signal,
      recordHistory: Boolean(selectedApi.value),
      onStreamingUpdate: streamingResponse => { response.value = streamingResponse },
    })
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error)
    response.value = {
      status: 0,
      statusText: message || 'Unknown Error',
      headers: {},
      body: '',
      duration: 0,
      size: 0,
      url: url.value,
      method: method.value,
      requestHeaders: {},
      requestBody: bodyText.value || null,
      timestamp: Date.now(),
    }
  } finally {
    if (requestAbortController === abortController) requestAbortController = null
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
  rememberApiContext(entry.apiId)
  const api = selectedApi.value
  if (api) {
    method.value = api.method
    url.value = api.url
    bodyText.value = api.body.raw || ''
  } else {
    url.value = entry.url
    method.value = entry.method
    bodyText.value = entry.requestBody || ''
  }
  response.value = null
  showResponsePreview.value = false
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
  const environmentId = workspace.collections.find(item => item.id === module.id)?.selectedEnvId ?? store.currentEnvId
  if (environmentId && value.environmentValues !== undefined) {
    return value.environmentValues[environmentId] ?? ''
  }
  return value.local || value.remote || ''
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
  const hasKnownApi = Boolean(entry.apiId && store.apis[entry.apiId])
  if (!hasKnownApi) await storePendingHistoryImport(entry)
  currentOpenContext('sidepanel')
  await openSidePanelWithFallbacks()
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

// sidePanel.open 要求用户手势;点击处理器内直接调最可靠,经消息中转到
// service worker 的手势传播在部分浏览器(Edge)不可靠。失败逐级降级,并
// 把真实错误暴露到 console,避免只剩笼统的"打开失败"。
async function openSidePanelNative(): Promise<void> {
  const chromeApi = (typeof chrome !== 'undefined' ? chrome : null) as any
  if (!chromeApi?.sidePanel?.open) throw new Error('当前浏览器不支持侧边栏 API')
  const win = await chromeApi.windows.getCurrent()
  await chromeApi.sidePanel.open({ windowId: win.id })
}

async function openSidePanelWithFallbacks(): Promise<void> {
  try {
    await openSidePanelNative()
    showToast('已打开侧边栏并携带当前上下文')
    return
  } catch (err: any) {
    console.warn('[Postino] 直接打开侧边栏失败,转经后台重试:', err?.message || err)
  }
  const runtime = (typeof chrome !== 'undefined' ? (chrome.runtime as any) : null)
  if (runtime?.sendMessage) {
    const ok = await new Promise<boolean>(resolve => {
      runtime.sendMessage({ type: 'OPEN_SIDE_PANEL' }, (response: any) => {
        const failure = runtime.lastError?.message || (response && response.success === false ? response.error : null)
        if (failure) console.warn('[Postino] 后台打开侧边栏失败:', failure)
        resolve(!runtime.lastError && Boolean(response?.success))
      })
    })
    if (ok) {
      showToast('已打开侧边栏并携带当前上下文')
      return
    }
  }
  window.open(buildViewContextUrl('/sidepanel.html', currentOpenContext('sidepanel')), '_blank')
  showToast('侧边栏不可用，已在标签页打开')
}

async function openSidePanel() {
  currentOpenContext('sidepanel')
  await openSidePanelWithFallbacks()
}

function showToast(message: string) {
  toast.value = message
  setTimeout(() => { toast.value = '' }, 1600)
}

function handlePopupKeydown(event: KeyboardEvent) {
  if (event.key !== 'Escape') return
  if (showMethodMenu.value) {
    event.preventDefault()
    closeMethodMenu(true)
    return
  }
  event.preventDefault()
  window.close()
}

onMounted(() => {
  window.addEventListener('keydown', handlePopupKeydown)
  document.addEventListener('pointerdown', handlePopupPointerDown)
})
onUnmounted(() => {
  requestAbortController?.abort(new DOMException('Popup closed', 'AbortError'))
  window.removeEventListener('keydown', handlePopupKeydown)
  document.removeEventListener('pointerdown', handlePopupPointerDown)
})
</script>

<template>
  <div class="popup-view">
    <div class="popup-header">
      <div class="popup-search-wrap">
        <label class="popup-search">
          <Search :size="15" />
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
        <Maximize2 :size="16" />
      </button>
    </div>

    <section class="workspace-strip">
      <div v-if="recentModules.length > 0" class="recent-modules">
        <div class="section-title"><FolderClock :size="14" /> 最近模块</div>
        <div class="module-cards">
          <button v-for="module in recentModules" :key="module.id" class="module-card" @click="loadModule(module.id)">
            <strong>{{ module.name }}</strong>
            <small>{{ moduleInterfaceCount(module.id) }}</small>
          </button>
        </div>
      </div>

      <div class="quick-actions" aria-label="快捷操作">
        <button title="发送上次请求" aria-label="发送上次请求" @click="sendLastRequest" :disabled="!recentHistory[0] || loading">
          <RotateCw :size="15" /><span>重发</span>
        </button>
        <button title="复制上次 cURL" aria-label="复制上次 cURL" @click="copyLastCurl" :disabled="!recentHistory[0]">
          <ClipboardCopy :size="15" /><span>cURL</span>
        </button>
        <button title="打开侧边栏" aria-label="打开侧边栏" @click="openSidePanel">
          <PanelRightOpen :size="15" /><span>侧栏</span>
        </button>
        <button title="查看历史" aria-label="查看历史" @click="openFullPage({ openHistory: true })">
          <History :size="15" /><span>历史</span>
        </button>
      </div>
    </section>

    <section class="request-composer">
      <div class="popup-input">
        <div ref="methodPickerRef" class="method-picker">
          <button
            ref="methodButtonRef"
            type="button"
            class="method-trigger"
            aria-label="请求方法"
            aria-haspopup="listbox"
            :aria-expanded="showMethodMenu"
            :style="{ color: methodColor(method) }"
            @click="toggleMethodMenu"
            @keydown="handleMethodButtonKeydown"
          >
            <strong>{{ method }}</strong>
            <ChevronDown :size="14" :class="['method-chevron', { open: showMethodMenu }]" />
          </button>
          <div
            v-if="showMethodMenu"
            ref="methodMenuRef"
            class="method-menu"
            role="listbox"
            tabindex="-1"
            aria-label="选择请求方法"
            :aria-activedescendant="`popup-method-${methods[methodMenuIndex]}`"
            @keydown="handleMethodMenuKeydown"
          >
            <button
              v-for="(m, index) in methods"
              :id="`popup-method-${m}`"
              :key="m"
              type="button"
              class="method-option"
              :class="{ selected: m === method, focused: index === methodMenuIndex }"
              role="option"
              :aria-selected="m === method"
              @mouseenter="methodMenuIndex = index"
              @click="selectMethod(m)"
            >
              <Check :size="14" :class="['method-check', { visible: m === method }]" />
              <strong :style="{ color: methodColor(m) }">{{ m }}</strong>
            </button>
          </div>
        </div>
        <input ref="urlInputRef" v-model="url" type="url" placeholder="输入 URL" aria-label="请求 URL" class="url-input" @keydown.enter="send" />
        <button class="btn btn-primary send-button" @click="send" :disabled="!loading && !url.trim()">
          {{ loading ? '取消' : '发送' }}
        </button>
      </div>

      <label class="body-box">
        <span>Body <small>JSON / Text</small></span>
        <textarea v-model="bodyText" placeholder='{ "key": "value" }' spellcheck="false"></textarea>
      </label>
      <div v-if="selectedApi && requestCapabilityLabels.length" class="request-context" :title="`完整配置来自：${selectedApi.name}`">
        <span class="request-context-source">{{ selectedApi.name }}</span>
        <span v-for="label in requestCapabilityLabels" :key="label" class="request-context-chip">{{ label }}</span>
      </div>
    </section>

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
      <h3><FlaskConical :size="16" /> 最近历史</h3>
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
      <span><Settings :size="14" /> 设置</span>
      <span><FlaskConical :size="14" /> 环境: {{ store.environments.find(env => env.id === store.currentEnvId)?.name || '默认' }}</span>
      <span><BarChart3 :size="14" /> 统计: {{ workspace.modules.length }} 模块 / {{ workspace.interfaces.filter(item => (item.nodeType ?? 'request') !== 'folder').length }} 接口</span>
      <button @click="openFullPage">打开完整版 <ArrowRight :size="14" /></button>
    </div>
    <div v-if="toast" class="popup-toast">{{ toast }}</div>
  </div>
</template>

<style scoped>
.popup-view {
  display: flex;
  flex-direction: column;
  padding: 10px;
  width: 100%;
  height: 100%;
  min-width: 0;
  overflow: hidden;
  background:
    radial-gradient(circle at 0% 0%, var(--primary-soft), transparent 34%),
    var(--bg-base);
}

.popup-header,
.workspace-strip,
.request-composer,
.popup-footer {
  margin-bottom: 8px;
  padding: 8px;
  border: 1px solid var(--border);
  border-radius: var(--radius-lg);
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
  min-height: 32px;
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
  display: flex;
  align-items: center;
  gap: 6px;
  font-weight: 750;
  flex: 0 0 auto;
  margin: 0;
  white-space: nowrap;
}

.workspace-strip,
.recent-modules,
.module-cards {
  display: flex;
  align-items: center;
}

.workspace-strip {
  gap: 10px;
  min-height: 48px;
}

.recent-modules {
  flex: 1;
  gap: 8px;
  min-width: 0;
}

.module-cards {
  flex: 1;
  gap: 8px;
  overflow: hidden;
}

.module-card {
  display: flex;
  align-items: center;
  gap: 6px;
  flex: 1 1 0;
  min-width: 0;
  min-height: 30px;
  text-align: left;
  border: 1px solid var(--border);
  border-radius: var(--radius-md);
  background: var(--bg-code);
  padding: 5px 8px;
  cursor: pointer;
}

.module-card strong {
  flex: 1;
  min-width: 0;
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
}

.module-card small {
  flex: 0 0 auto;
  min-width: 19px;
  padding: 1px 5px;
  border-radius: 999px;
  background: var(--bg-panel);
  color: var(--text-tertiary);
  text-align: center;
}

.popup-input,
.popup-footer {
  display: flex;
  align-items: center;
  gap: 8px;
}

.quick-actions {
  display: flex;
  align-items: center;
  gap: 4px;
  flex: 0 0 auto;
  padding-left: 10px;
  border-left: 1px solid var(--divider);
}

.quick-actions button {
  display: inline-flex;
  align-items: center;
  justify-content: center;
  gap: 5px;
  height: 30px;
  padding: 0 8px;
  border: 1px solid transparent;
  border-radius: var(--radius-md);
  background: transparent;
  color: var(--text-secondary);
  cursor: pointer;
  font-size: var(--font-size-small);
  white-space: nowrap;
}

.quick-actions button:hover:not(:disabled) {
  border-color: var(--border);
  background: var(--bg-hover);
  color: var(--text-primary);
}

.quick-actions button:disabled {
  cursor: not-allowed;
  opacity: 0.4;
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

.method-picker {
  position: relative;
  flex: 0 0 104px;
}

.method-trigger {
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: 8px;
  width: 100%;
  height: 34px;
  padding: 0 9px 0 11px;
  border: 1px solid var(--border);
  border-radius: var(--radius-lg);
  background: var(--bg-panel);
  cursor: pointer;
  font-size: var(--font-size-body);
  font-family: var(--font-code);
  outline: none;
  transition: border-color 0.15s, background-color 0.15s, box-shadow 0.15s;
}

.method-trigger:hover,
.method-trigger[aria-expanded='true'] {
  border-color: color-mix(in srgb, currentColor 45%, var(--border));
  background: var(--bg-hover);
}

.method-trigger:focus-visible {
  border-color: currentColor;
  box-shadow: 0 0 0 2px color-mix(in srgb, currentColor 18%, transparent);
}

.method-chevron {
  flex: 0 0 auto;
  color: var(--text-tertiary);
  transition: transform 0.15s ease;
}

.method-chevron.open {
  transform: rotate(180deg);
}

.method-menu {
  position: absolute;
  top: calc(100% + 5px);
  left: 0;
  z-index: 40;
  width: 132px;
  padding: 5px;
  border: 1px solid var(--border);
  border-radius: var(--radius-lg);
  background: var(--bg-panel);
  box-shadow: var(--shadow-lg);
  outline: none;
}

.method-option {
  display: flex;
  align-items: center;
  gap: 7px;
  width: 100%;
  min-height: 31px;
  padding: 5px 8px;
  border: 0;
  border-radius: var(--radius-md);
  background: transparent;
  cursor: pointer;
  text-align: left;
  font-family: var(--font-code);
  font-size: var(--font-size-body);
}

.method-option.focused,
.method-option:hover {
  background: var(--bg-hover);
}

.method-option.selected {
  background: var(--primary-soft);
}

.method-option.selected.focused,
.method-option.selected:hover {
  background: color-mix(in srgb, var(--primary-soft) 72%, var(--bg-hover));
}

.method-check {
  flex: 0 0 auto;
  visibility: hidden;
  color: var(--primary);
}

.method-check.visible {
  visibility: visible;
}

.url-input {
  flex: 1 1 180px;
  min-width: 0;
  height: 34px;
  font-size: var(--font-size-body);
  font-family: var(--font-code);
}

.request-composer {
  position: relative;
  z-index: 5;
  flex: 0 0 auto;
  padding: 0;
  overflow: visible;
}

.popup-input {
  flex-wrap: nowrap;
  padding: 8px;
  border-bottom: 1px solid var(--divider);
}

.send-button {
  min-width: 64px;
  height: 34px;
}

.body-box {
  display: flex;
  align-items: stretch;
  gap: 8px;
  padding: 8px;
  color: var(--text-secondary);
  font-size: var(--font-size-small);
}

.body-box > span {
  flex: 0 0 88px;
  padding: 7px 2px;
  color: var(--text-primary);
  font-weight: 650;
}

.body-box > span small {
  display: block;
  margin-top: 2px;
  color: var(--text-tertiary);
  font-weight: 400;
}

.body-box textarea {
  flex: 1;
  min-width: 0;
  height: 56px;
  min-height: 56px;
  padding: 7px 9px;
  resize: none;
  font-family: var(--font-code);
  font-size: var(--font-size-code);
  background: var(--bg-code);
}

.request-context {
  display: flex;
  align-items: center;
  gap: 5px;
  min-height: 28px;
  padding: 4px 8px;
  overflow-x: auto;
  border-top: 1px solid var(--divider);
  color: var(--text-tertiary);
  font-size: 11px;
  scrollbar-width: none;
}

.request-context::-webkit-scrollbar {
  display: none;
}

.request-context-source {
  max-width: 160px;
  overflow: hidden;
  color: var(--text-secondary);
  font-weight: 650;
  text-overflow: ellipsis;
  white-space: nowrap;
}

.request-context-chip {
  flex: 0 0 auto;
  padding: 2px 6px;
  border: 1px solid var(--border);
  border-radius: var(--radius-sm);
  background: var(--bg-code);
  white-space: nowrap;
}

.popup-response {
  flex: 0 1 auto;
  min-height: 0;
  margin-bottom: 8px;
  border: 1px solid var(--border);
  border-radius: var(--radius-xl);
  overflow-y: auto;
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

.popup-history {
  flex: 1 1 auto;
  min-height: 0;
  max-height: none;
  overflow-y: auto;
}

.popup-history h3 {
  display: flex;
  align-items: center;
  gap: 6px;
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

.popup-footer {
  flex-shrink: 0;
  min-height: 34px;
  margin-top: auto;
  margin-bottom: 0;
  padding: 6px 8px;
  flex-wrap: nowrap;
}

.popup-footer span {
  display: inline-flex;
  align-items: center;
  gap: 5px;
}

.popup-footer button {
  display: inline-flex;
  align-items: center;
  gap: 5px;
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

@media (max-width: 620px) {
  .quick-actions button span {
    display: none;
  }

  .quick-actions button {
    width: 30px;
    padding: 0;
  }
}

@media (max-width: 520px) {
  .popup-view {
    padding: 8px;
  }

  .workspace-strip {
    align-items: stretch;
    flex-direction: column;
    gap: 6px;
  }

  .quick-actions {
    justify-content: flex-end;
    padding-top: 6px;
    padding-left: 0;
    border-top: 1px solid var(--divider);
    border-left: 0;
  }

  .url-input {
    flex-basis: auto;
  }

  .popup-footer button {
    margin-left: 0;
  }

  .popup-history .history-status {
    display: none;
  }
}
</style>
