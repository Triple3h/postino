<script setup lang="ts">
import { ref, computed, onMounted, onUnmounted } from 'vue'
import {
  Box,
  ArrowLeftRight,
  Check,
  ChevronDown,
  ChevronRight,
  Diff,
  Download,
  FileCode2,
  FilePlus2,
  FileText,
  Folder,
  Globe2,
  MoreVertical,
  PanelLeftClose,
  PanelLeftOpen,
  Plus,
  Search,
  Settings,
  Trash2,
  Upload,
  Zap,
} from '@lucide/vue'
import { useAppStore } from '@/stores/app'
import { useWorkspaceStore } from '@/stores/workspace'
import { importCurl, importHar, importPostman, importPostmanTree, importPostmanEnvironment } from '@/utils/import'
import { generateCurl, generateCollectionBackup, generatePostmanCollectionTree, generatePostmanEnvironmentFiles, parseCollectionBackup } from '@/utils/export'
import { sendRequest } from '@/utils/http'
import { executePreRequestScriptAsync } from '@/utils/pre-request'
import { createDefaultAuthConfig } from '@/utils/auth'
import AuthConfig from '@/components/editor/AuthConfig.vue'
import { importOpenApi } from '@/utils/openapi-import'
import { db } from '@/db'
import { useDialog } from '@/composables/useDialog'
import CollectionSettingsModal from '@/components/sidebar/CollectionSettingsModal.vue'
import type { ApiConfig, Collection, CollectionNode, HttpMethod, InterfaceNode, KvPair, ResponseData } from '@/types'

const store = useAppStore()
const workspace = useWorkspaceStore()
const dialog = useDialog()
const searchQuery = ref('')
const collapsedMoreOpen = ref(false)
const collapsedCreateOpen = ref(false)
const collapsedModulePreview = ref<{ moduleId: string; x: number; y: number } | null>(null)
let collapsedPreviewTimer: ReturnType<typeof setTimeout> | null = null
const showImportModal = ref(false)
const importType = ref<'curl' | 'postman' | 'openapi' | 'har'>('curl')
const importText = ref('')
const sidebarCollapsed = ref(false)
const sidebarWidth = ref(260)
const resizingSidebar = ref(false)
const draggingNodeId = ref<string | null>(null)
const draggingModuleId = ref<string | null>(null)
const batchSendingFolderId = ref<string | null>(null)
const batchSendingModuleId = ref<string | null>(null)
const compareBaseApiId = ref<string | null>(null)
const comparePair = ref<ApiCompareState | null>(null)
const folderSettings = ref<{
  id: string
  name: string
  scriptsInherit: boolean
  preRequestScript: string
  postRequestScript: string
  auth: import('@/types').AuthConfig
  authOverride: boolean
  headers: KvPair[]
  variables: import('@/types').CollectionVariable[]
  folderTab: 'auth' | 'headers' | 'variables' | 'scripts'
} | null>(null)
const dropTarget = ref<{ kind: 'module-root' | 'folder' | 'before'; id: string } | null>(null)
const collectionSettingsId = ref<string | null>(null)

function openCollectionSettings(collectionId: string) {
  closeContextMenu()
  collectionSettingsId.value = collectionId
}
const selectedModuleId = computed(() => {
  if (workspace.activeSelectionType === 'module') return workspace.activeSelectionId
  if (workspace.activeSelectionType === 'interface') {
    return workspace.interfaces.find(item => item.id === workspace.activeSelectionId || item.apiId === workspace.activeSelectionId)?.moduleId ?? null
  }
  return null
})
const contextMenu = ref<{ x: number; y: number; apiId?: string; moduleId?: string; folderId?: string } | null>(null)

// --- Inline rename state ---
const renamingModuleId = ref<string | null>(null)
const renamingModuleInput = ref('')

// --- Color picker state ---
const colorPickerCollectionId = ref<string | null>(null)

// --- Move-to submenu state ---
const moveToInterfaceId = ref<string | null>(null)

// --- Toast state ---
const toast = ref('')
let toastTimer: ReturnType<typeof setTimeout> | null = null

function showToast(msg: string) {
  toast.value = msg
  if (toastTimer) clearTimeout(toastTimer)
  toastTimer = setTimeout(() => { toast.value = ''; toastTimer = null }, 1800)
}

// --- Preset colors for category color picker ---
const PRESET_COLORS = [
  '#6366f1', '#3b82f6', '#0ea5e9', '#14b8a6',
  '#10b981', '#f59e0b', '#ef4444', '#ec4899',
  '#8b5cf6', '#64748b',
]


function clampSidebarWidth(width: number): number {
  return Math.max(200, Math.min(400, Math.round(width)))
}

function startSidebarResize(event: MouseEvent) {
  if (sidebarCollapsed.value) return
  event.preventDefault()
  resizingSidebar.value = true
}

function handleSidebarResize(event: MouseEvent) {
  if (!resizingSidebar.value) return
  sidebarWidth.value = clampSidebarWidth(event.clientX - 10)
}

function stopSidebarResize() {
  resizingSidebar.value = false
}

function toggleSidebarCollapsed() {
  sidebarCollapsed.value = !sidebarCollapsed.value
  closeCollapsedMenus()
  hideCollapsedModulePreview()
  if (!sidebarCollapsed.value) sidebarWidth.value = clampSidebarWidth(sidebarWidth.value || 260)
}

onMounted(() => {
  window.addEventListener('mousemove', handleSidebarResize)
  window.addEventListener('mouseup', stopSidebarResize)
})

onUnmounted(() => {
  window.removeEventListener('mousemove', handleSidebarResize)
  window.removeEventListener('mouseup', stopSidebarResize)
  if (collapsedPreviewTimer) clearTimeout(collapsedPreviewTimer)
})

interface SidebarCollection extends Collection {
  interfaces: InterfaceNode[]
  requestCount: number
}


interface ApiCompareSection {
  name: string
  left: string
  right: string
  same: boolean
}

interface ApiCompareState {
  left: ApiConfig
  right: ApiConfig
  sections: ApiCompareSection[]
}

const sidebarTree = computed<SidebarCollection[]>(() => {
  const q = searchQuery.value.toLowerCase()
  const searching = q.trim().length > 0

  return [...workspace.collections]
    .sort((a, b) => a.order - b.order)
    .map(collection => {
      const interfaces = workspace.interfaces
        .filter(item => (item.collectionId ?? item.moduleId) === collection.id)
        .sort((a, b) => a.order - b.order)
      const requestCount = interfaces.filter(item => !isFolderNode(item)).length
      return { ...collection, interfaces, requestCount }
    })
    .filter(collection => !searching || collection.name.toLowerCase().includes(q) || collection.interfaces.some(item => nodeMatchesSearch(item, q)))
})

const hasVisibleItems = computed(() => sidebarTree.value.length > 0)

function getInterfaceApi(interfaceNode: InterfaceNode): ApiConfig | null {
  return store.apis[interfaceNode.apiId] ?? null
}

function isFolderNode(node: InterfaceNode): boolean {
  return (node.nodeType ?? 'request') === 'folder'
}

function getFolderStats(folderId: string) {
  const descendants = workspace.getDescendantNodes(folderId)
  return {
    childFolders: descendants.filter(item => isFolderNode(item)).length,
    requests: descendants.filter(item => !isFolderNode(item)).length,
  }
}

function nodeMatchesSearch(node: InterfaceNode, query: string): boolean {
  if (!query.trim()) return true
  if (isFolderNode(node)) return node.name.toLowerCase().includes(query)
  const api = getInterfaceApi(node)
  const name = api?.name ?? node.name
  const url = api?.url ?? node.url
  const method = api?.method ?? node.method
  return name.toLowerCase().includes(query) ||
    url.toLowerCase().includes(query) ||
    method.toLowerCase().includes(query)
}

function nodeOrDescendantMatches(node: InterfaceNode, allNodes: InterfaceNode[], query: string): boolean {
  if (!query.trim()) return true
  if (nodeMatchesSearch(node, query)) return true
  return allNodes
    .filter(item => (item.parentId ?? null) === node.id)
    .some(child => nodeOrDescendantMatches(child, allNodes, query))
}

function getVisibleNodes(collection: SidebarCollection): Array<{ node: InterfaceNode; depth: number }> {
  const q = searchQuery.value.toLowerCase().trim()
  const rows: Array<{ node: InterfaceNode; depth: number }> = []
  const visit = (parentId: string | null, depth: number) => {
    const children = collection.interfaces
      .filter(item => (item.parentId ?? null) === parentId)
      .sort((a, b) => a.order - b.order)
    for (const node of children) {
      if (!nodeOrDescendantMatches(node, collection.interfaces, q)) continue
      rows.push({ node, depth })
      if (isFolderNode(node) && isExpanded(getNodeStorageKey(node.id))) {
        visit(node.id, depth + 1)
      }
    }
  }
  visit(null, 0)
  return rows
}

function getModuleStorageKey(moduleId: string): string {
  return `module:${moduleId}`
}

function getNodeStorageKey(nodeId: string): string {
  return `node:${nodeId}`
}

function isExpanded(key: string): boolean {
  if (key.startsWith('category:') || key.startsWith('module:') || key.startsWith('node:')) {
    return !store.expandedFolders.includes(`collapsed:${key}`)
  }
  return store.expandedFolders.includes(key)
}

function toggleExpanded(key: string) {
  const storageKey = key.startsWith('category:') || key.startsWith('module:') || key.startsWith('node:')
    ? `collapsed:${key}`
    : key
  const idx = store.expandedFolders.indexOf(storageKey)
  if (idx >= 0) {
    store.expandedFolders.splice(idx, 1)
  } else {
    store.expandedFolders.push(storageKey)
  }
}

function generateId(): string {
  return Date.now().toString(36) + Math.random().toString(36).slice(2, 8)
}

async function addApiToModule(api: ApiConfig, moduleName: string | null, parentId: string | null = null): Promise<void> {
  if (!moduleName) {
    const parent = parentId ? workspace.interfaces.find(item => item.id === parentId) : null
    store.addApi(api, parent?.moduleId ?? selectedModuleId.value, parentId)
    return
  }

  // Phase 5.4:集合树是唯一真源,legacy groups 双写已移除
  const module = await workspace.ensureModuleForLegacyGroup(moduleName)
  store.addApi(api, module.id, parentId)
}

async function createNewApi(parentFolderId: string | null = null) {
  const api: ApiConfig = {
    id: generateId(),
    name: 'New Request',
    method: 'GET' as HttpMethod,
    url: '',
    headers: [],
    params: [],
    cookies: [],
    body: { type: 'none', raw: '', formData: [], urlEncoded: [], binaryFile: null, contentType: '' },
    auth: { type: 'none', bearerToken: '', basicUsername: '', basicPassword: '', apiKeyName: '', apiKeyValue: '', apiKeyIn: 'header' as const, digestUsername: '', digestPassword: '', oauth2GrantType: 'authorization_code' as const, oauth2AccessTokenUrl: '', oauth2ClientId: '', oauth2ClientSecret: '', oauth2Scope: '', oauth2Token: '', oauth2Username: '', oauth2Password: '' },
    preRequestScript: '',
    postRequestScript: '',
    folder: null,
    createdAt: Date.now(),
    updatedAt: Date.now(),
  }
  await addApiToModule(api, null, parentFolderId)
  selectApi(api.id)
}

function openModule(moduleId: string) {
  workspace.selectModule(moduleId)
  store.currentApiId = null
  store.response = null
}

function selectApi(id: string) {
  const interfaceNode = workspace.interfaces.find(item => item.apiId === id)
  workspace.selectInterface(interfaceNode?.id ?? id)
  store.currentApiId = id
}


async function copyApiCurl(event: MouseEvent, apiId: string) {
  event.stopPropagation()
  const api = store.apis[apiId]
  if (!api) return
  await navigator.clipboard.writeText(generateCurl(api, store.getEnvVariables()))
}

async function copyModuleCurl(event: MouseEvent, moduleId: string) {
  event.stopPropagation()
  await copyModuleCurlById(moduleId)
}

async function copyModuleCurlById(moduleId: string) {
  const apis = getModuleRequestApis(moduleId)
  if (apis.length === 0) {
    window.alert('该模块下没有可复制的请求。')
    return
  }
  await navigator.clipboard.writeText(apis.map(api => generateCurl(api, buildEnvVariablesForApi(api.id))).join('\n\n'))
  window.alert(`已复制模块内 ${apis.length} 个请求的 cURL。`)
}

function copyModuleCurlFromContext(moduleId: string) {
  closeContextMenu()
  void copyModuleCurlById(moduleId)
}

function quickSendApi(event: MouseEvent, apiId: string) {
  event.stopPropagation()
  selectApi(apiId)
  window.dispatchEvent(new CustomEvent('apifix:send-current-request'))
}

function quickSendModule(event: MouseEvent, moduleId: string) {
  event.stopPropagation()
  void runModuleBatch(moduleId, 'serial')
}


function normalizeJson(value: unknown): string {
  return JSON.stringify(value, null, 2)
}

function formatKvPairs(items: KvPair[] = []): string {
  const enabled = items.filter(item => item.enabled && item.key)
  return enabled.length > 0
    ? enabled.map(item => `${item.key}: ${item.value}`).join('\n')
    : '（空）'
}

function formatCookies(items: ApiConfig['cookies'] = []): string {
  const enabled = items.filter(item => item.enabled && item.key)
  return enabled.length > 0
    ? enabled.map(item => `${item.key}: ${item.value}`).join('\n')
    : '（空）'
}

function formatAuth(auth: ApiConfig['auth']): string {
  if (auth.type === 'none') return 'none'
  return normalizeJson(auth)
}

function formatBody(body: ApiConfig['body']): string {
  if (body.type === 'none') return 'none'
  if (body.type === 'json' || body.type === 'raw') return `${body.type} / ${body.contentType || '默认'}\n${body.raw || '（空）'}`
  if (body.type === 'form') return `form-data\n${formatKvPairs(body.formData)}`
  if (body.type === 'urlencoded') return `x-www-form-urlencoded\n${formatKvPairs(body.urlEncoded)}`
  if (body.type === 'binary') return `binary\n${body.binaryFile || '（未选择文件）'}`
  return normalizeJson(body)
}

function compareSection(name: string, left: string, right: string): ApiCompareSection {
  return { name, left, right, same: left === right }
}

function buildApiCompareState(left: ApiConfig, right: ApiConfig): ApiCompareState {
  const sections = [
    compareSection('请求名称', left.name || '（未命名）', right.name || '（未命名）'),
    compareSection('Method', left.method, right.method),
    compareSection('URL', left.url || '（空）', right.url || '（空）'),
    compareSection('Params', formatKvPairs(left.params), formatKvPairs(right.params)),
    compareSection('Headers', formatKvPairs(left.headers), formatKvPairs(right.headers)),
    compareSection('Cookies', formatCookies(left.cookies), formatCookies(right.cookies)),
    compareSection('Auth', formatAuth(left.auth), formatAuth(right.auth)),
    compareSection('Body', formatBody(left.body), formatBody(right.body)),
    compareSection('请求变量', formatKvPairs(left.requestVariables ?? []), formatKvPairs(right.requestVariables ?? [])),
    compareSection('前置脚本', left.preRequestScript || '（空）', right.preRequestScript || '（空）'),
    compareSection('后置脚本', left.postRequestScript || '（空）', right.postRequestScript || '（空）'),
  ]
  return { left, right, sections }
}

function selectCompareBaseFromContext(apiId: string) {
  compareBaseApiId.value = apiId
  closeContextMenu()
  const api = store.apis[apiId]
  window.alert(`已选择「${api?.name ?? apiId}」作为对比基准，请右键另一个接口选择“与基准对比差异”。`)
}

function clearCompareBaseFromContext() {
  compareBaseApiId.value = null
  closeContextMenu()
}

function openApiCompareFromContext(apiId: string) {
  const baseId = compareBaseApiId.value
  if (!baseId || baseId === apiId) {
    selectCompareBaseFromContext(apiId)
    return
  }
  const left = store.apis[baseId]
  const right = store.apis[apiId]
  closeContextMenu()
  if (!left || !right) {
    window.alert('对比接口不存在或已被删除。')
    return
  }
  comparePair.value = buildApiCompareState(left, right)
}

function closeApiCompare() {
  comparePair.value = null
}


type BatchSendMode = 'serial' | 'parallel'

interface FolderBatchResult {
  index: number
  api: ApiConfig
  ok: boolean
  status: number
  statusText: string
  duration: number
  size: number
  url: string
  error?: string
}

function buildEnvVariablesForApi(apiId: string): Record<string, string> {
  // Phase 2:统一走集合环境解析(请求变量 > 集合环境 > 集合变量 > 全局)
  return store.getEnvVariablesForApi(apiId)
}

function headerRecordToPairs(headers: Record<string, string>): KvPair[] {
  return Object.entries(headers).map(([key, value]) => ({
    key,
    value,
    enabled: true,
  }))
}

function addBatchHistory(api: ApiConfig, response: ResponseData) {
  store.addHistory({
    id: generateId(),
    apiId: api.id,
    method: api.method,
    url: api.url,
    status: response.status,
    statusText: response.statusText,
    duration: response.duration,
    timestamp: Date.now(),
    requestHeaders: response.requestHeaders,
    requestBody: response.requestBody,
    responseSize: response.size,
    starred: false,
  })
}

async function runBatchRequest(api: ApiConfig, index: number): Promise<FolderBatchResult> {
  try {
    let headers: Record<string, string> = {}
    for (const header of api.headers) {
      if (header.enabled && header.key) headers[header.key] = header.value
    }
    let url = api.url
    let body = api.body.raw || ''
    let urlencoded = api.body.urlEncoded.map(item => ({ ...item }))
    let formdata = api.body.formData.map(item => ({ ...item }))
    let cookies = (api.cookies || []).map(item => ({ ...item }))
    let effectiveEnvVars = buildEnvVariablesForApi(api.id)

    for (const folder of workspace.getAncestorFolders(api.id)) {
      if (!folder.preRequestScript?.trim()) continue
      const scriptResult = await executePreRequestScriptAsync(
        folder.preRequestScript,
        headers,
        url,
        body,
        urlencoded,
        formdata,
        effectiveEnvVars,
        { requestCookies: cookies },
      )
      headers = scriptResult.headers
      cookies = scriptResult.cookies
      url = scriptResult.url
      body = scriptResult.body
      urlencoded = scriptResult.urlencoded
      formdata = scriptResult.formdata
      effectiveEnvVars = scriptResult.envVars
    }

    if (api.preRequestScript?.trim()) {
      const scriptResult = await executePreRequestScriptAsync(
        api.preRequestScript,
        headers,
        url,
        body,
        urlencoded,
        formdata,
        effectiveEnvVars,
        { requestCookies: cookies },
      )
      headers = scriptResult.headers
      cookies = scriptResult.cookies
      url = scriptResult.url
      body = scriptResult.body
      urlencoded = scriptResult.urlencoded
      formdata = scriptResult.formdata
      effectiveEnvVars = scriptResult.envVars
    }

    const response = await sendRequest({
      method: api.method,
      url,
      headers: headerRecordToPairs(headers),
      params: api.params,
      cookies,
      autoCarryCookies: store.autoCarryCookies,
      body: { ...api.body, raw: body, urlEncoded: urlencoded, formData: formdata },
      auth: api.auth,
      corsMode: store.settings.corsMode,
      proxyUrl: store.settings.proxyUrl,
      envVars: effectiveEnvVars,
    })
    addBatchHistory(api, response)
    return {
      index,
      api,
      ok: response.status >= 200 && response.status < 400,
      status: response.status,
      statusText: response.statusText,
      duration: response.duration,
      size: response.size,
      url: response.url,
    }
  } catch (error: any) {
    return {
      index,
      api,
      ok: false,
      status: 0,
      statusText: error?.message || 'Batch request failed',
      duration: 0,
      size: 0,
      url: api.url,
      error: error?.message || String(error),
    }
  }
}

function formatBatchTimestamp(timestamp = Date.now()): string {
  const date = new Date(timestamp)
  const pad = (value: number) => String(value).padStart(2, '0')
  return `${date.getFullYear()}-${pad(date.getMonth() + 1)}-${pad(date.getDate())} ${pad(date.getHours())}:${pad(date.getMinutes())}:${pad(date.getSeconds())}`
}

function safeFileName(name: string): string {
  return name.replace(/[\\/:*?"<>|]+/g, '-').replace(/\s+/g, '-').slice(0, 80) || 'folder'
}

function buildBatchReport(scopeLabel: string, scopeName: string, mode: BatchSendMode, results: FolderBatchResult[]): string {
  const total = results.length
  const passed = results.filter(item => item.ok).length
  const failed = total - passed
  const avgDuration = total ? Math.round(results.reduce((sum, item) => sum + item.duration, 0) / total) : 0
  const modeLabel = mode === 'serial' ? '串行' : '并行'
  const lines = [
    `# ${scopeLabel}批量发送测试报告 - ${scopeName}`,
    '',
    `- 生成时间：${formatBatchTimestamp()}`,
    `- 范围：${scopeLabel}${scopeName}`,
    `- 执行模式：${modeLabel}`,
    `- 请求总数：${total}`,
    `- 通过：${passed}`,
    `- 失败：${failed}`,
    `- 平均耗时：${avgDuration}ms`,
    '',
    '| # | 接口 | 方法 | 状态 | 耗时 | 大小 | URL | 错误 |',
    '|---:|------|------|------|------|------|-----|------|',
  ]

  for (const item of [...results].sort((a, b) => a.index - b.index)) {
    const escaped = (value: string) => value.replace(/\|/g, '\\|').replace(/\n/g, ' ')
    const status = item.ok ? `PASS ${item.status} ${item.statusText}` : `FAIL ${item.status} ${item.statusText}`
    lines.push(`| ${item.index + 1} | ${escaped(item.api.name)} | ${item.api.method} | ${escaped(status)} | ${item.duration}ms | ${item.size}B | ${escaped(item.url)} | ${escaped(item.error ?? '')} |`)
  }

  return `${lines.join('\n')}\n`
}

function downloadTextFile(fileName: string, content: string, mime = 'text/markdown;charset=utf-8') {
  const blob = new Blob([content], { type: mime })
  const url = URL.createObjectURL(blob)
  const link = document.createElement('a')
  link.href = url
  link.download = fileName
  document.body.appendChild(link)
  link.click()
  link.remove()
  URL.revokeObjectURL(url)
}

function getModuleRequestApis(moduleId: string): ApiConfig[] {
  return workspace.interfaces
    .filter(item => item.moduleId === moduleId && !isFolderNode(item) && item.apiId)
    .sort((a, b) => a.order - b.order)
    .map(item => store.apis[item.apiId])
    .filter((api): api is ApiConfig => Boolean(api))
}

async function runFolderBatch(folderId: string, mode: BatchSendMode) {
  if (batchSendingFolderId.value) return
  const folder = workspace.interfaces.find(item => item.id === folderId)
  const requestApis = workspace.getDescendantNodes(folderId)
    .filter(item => !isFolderNode(item) && item.apiId)
    .map(item => store.apis[item.apiId])
    .filter((api): api is ApiConfig => Boolean(api))

  if (!folder || requestApis.length === 0) {
    window.alert('该文件夹下没有可发送的请求。')
    return
  }

  batchSendingFolderId.value = folderId
  try {
    const results: FolderBatchResult[] = []
    if (mode === 'parallel') {
      results.push(...await Promise.all(requestApis.map((api, index) => runBatchRequest(api, index))))
    } else {
      for (let index = 0; index < requestApis.length; index += 1) {
        results.push(await runBatchRequest(requestApis[index], index))
      }
    }

    const report = buildBatchReport('文件夹', folder.name, mode, results)
    const fileStamp = formatBatchTimestamp().replace(/[-: ]/g, '')
    downloadTextFile(`apifix-batch-${safeFileName(folder.name)}-${fileStamp}.md`, report)
    const passed = results.filter(item => item.ok).length
    window.alert(`批量发送完成：${passed}/${results.length} 通过，已导出 Markdown 测试报告。`)
  } finally {
    batchSendingFolderId.value = null
  }
}

async function runModuleBatch(moduleId: string, mode: BatchSendMode) {
  if (batchSendingModuleId.value || batchSendingFolderId.value) return
  const module = workspace.modules.find(item => item.id === moduleId)
  const requestApis = getModuleRequestApis(moduleId)
  if (!module || requestApis.length === 0) {
    window.alert('该模块下没有可发送的请求。')
    return
  }

  batchSendingModuleId.value = moduleId
  try {
    const results: FolderBatchResult[] = []
    if (mode === 'parallel') {
      results.push(...await Promise.all(requestApis.map((api, index) => runBatchRequest(api, index))))
    } else {
      for (let index = 0; index < requestApis.length; index += 1) {
        results.push(await runBatchRequest(requestApis[index], index))
      }
    }
    const report = buildBatchReport('模块', module.name, mode, results)
    const fileStamp = formatBatchTimestamp().replace(/[-: ]/g, '')
    downloadTextFile(`apifix-module-batch-${safeFileName(module.name)}-${fileStamp}.md`, report)
    const passed = results.filter(item => item.ok).length
    window.alert(`模块批量发送完成：${passed}/${results.length} 通过，已导出 Markdown 测试报告。`)
  } finally {
    batchSendingModuleId.value = null
  }
}

function runFolderBatchFromContext(folderId: string, mode: BatchSendMode) {
  closeContextMenu()
  void runFolderBatch(folderId, mode)
}

function runModuleBatchFromContext(moduleId: string, mode: BatchSendMode) {
  closeContextMenu()
  void runModuleBatch(moduleId, mode)
}

function deleteApi(id: string) {
  const api = store.apis[id]
  if (!window.confirm(`确认删除请求「${api?.name ?? id}」？此操作不可撤销。`)) return
  store.deleteApi(id)
}

async function addCollection() {
  const name = await dialog.prompt({
    title: '新建集合',
    message: '集合用于组织接口、环境与脚本,是顶层组织单元。',
    placeholder: '例如：用户中心',
    confirmText: '创建',
  })
  if (!name?.trim()) return
  let categoryId = workspace.categories[0]?.id
  if (!categoryId) categoryId = (await workspace.ensureDefaultCategory()).id
  const module = await workspace.addModule(categoryId, name.trim())
  openModule(module.id)
  const key = getModuleStorageKey(module.id)
  if (!isExpanded(key)) toggleExpanded(key)
}

async function deleteModule(moduleId: string) {
  const module = workspace.modules.find(item => item.id === moduleId)
  if (!window.confirm(`确认删除集合「${module?.name ?? moduleId}」及其所有接口？此操作不可撤销。`)) return
  const apiIds = workspace.interfaces
    .filter(item => item.moduleId === moduleId && !isFolderNode(item) && item.apiId)
    .map(item => item.apiId)

  for (const id of apiIds) {
    deleteApi(id)
  }

  await workspace.deleteModule(moduleId)
}

function handleModuleContextMenu(e: MouseEvent, moduleId: string) {
  e.preventDefault()
  contextMenu.value = { x: e.clientX, y: e.clientY, moduleId }
}

function handleApiContextMenu(e: MouseEvent, apiId: string) {
  e.preventDefault()
  contextMenu.value = { x: e.clientX, y: e.clientY, apiId }
}

function handleFolderContextMenu(e: MouseEvent, folderId: string) {
  e.preventDefault()
  contextMenu.value = { x: e.clientX, y: e.clientY, folderId }
}

function closeContextMenu() {
  contextMenu.value = null
}


function closeCollapsedMenus() {
  collapsedMoreOpen.value = false
  collapsedCreateOpen.value = false
}

function handleSidebarRootClick() {
  closeContextMenu()
  closeCollapsedMenus()
}

function toggleCollapsedMore() {
  collapsedMoreOpen.value = !collapsedMoreOpen.value
  collapsedCreateOpen.value = false
  hideCollapsedModulePreview()
}

function toggleCollapsedCreate() {
  collapsedCreateOpen.value = !collapsedCreateOpen.value
  collapsedMoreOpen.value = false
  hideCollapsedModulePreview()
}

function openGlobalSearch() {
  closeCollapsedMenus()
  window.dispatchEvent(new CustomEvent('apifix:open-global-search'))
}

function openWorkspaceSettings() {
  closeCollapsedMenus()
  window.dispatchEvent(new CustomEvent('apifix:open-workspace-settings'))
}

function openImportModalFromCollapsed() {
  closeCollapsedMenus()
  showImportModal.value = true
}

function exportWorkspaceData() {
  closeCollapsedMenus()
  // Phase 4.5:自有带版本备份格式(主备份格式,secret 值剥离)
  const payload = generateCollectionBackup({
    collections: workspace.collections,
    nodes: workspace.interfaces,
    environments: store.environments,
    apis: store.apis,
  })
  const stamp = formatBatchTimestamp().replace(/[-: ]/g, '')
  downloadTextFile(`apifix-backup-v1-${stamp}.json`, payload, 'application/json;charset=utf-8')
  showToast('已导出备份 JSON（secret 值已剥离）')
}

/** Phase 4.5:单集合导出 Postman v2.1 树(含集合级脚本/变量/auth),集合环境另存文件 */
async function exportCollectionPostmanTree(moduleId: string) {
  const collection = workspace.collections.find(item => item.id === moduleId)
  if (!collection) return
  closeContextMenu()
  const nodes = workspace.interfaces.filter(item => (item.collectionId ?? item.moduleId) === moduleId)
  const json = generatePostmanCollectionTree({ collection, nodes, apis: store.apis })
  const stamp = formatBatchTimestamp().replace(/[-: ]/g, '')
  const safeName = collection.name.replace(/[\\/:*?"<>|]/g, '_') || 'collection'
  downloadTextFile(`${safeName}-postman-v21-${stamp}.json`, json, 'application/json;charset=utf-8')
  const envs = store.environments.filter(item => item.collectionId === moduleId && !store.isGlobalEnv(item))
  for (const [index, content] of generatePostmanEnvironmentFiles(envs).entries()) {
    const envName = envs[index]?.name.replace(/[\\/:*?"<>|]/g, '_') || `env-${index + 1}`
    window.setTimeout(() => {
      downloadTextFile(`${safeName}-${envName}-env.json`, content, 'application/json;charset=utf-8')
    }, 150 * (index + 1))
  }
  showToast(envs.length ? `已导出 Postman 集合与 ${envs.length} 个环境` : '已导出 Postman 集合')
}

function sanitizeNavIcon(value?: string): string {
  return Array.from((value ?? '').trim()).slice(0, 2).join('')
}

function getNameInitial(name: string): string {
  const chars = Array.from(name.trim())
  if (chars.length === 0) return '?'
  const first = chars[0]
  return /[a-z0-9]/i.test(first) ? first.toUpperCase() : chars.slice(0, Math.min(2, chars.length)).join('')
}

function getCollectionNavIcon(collection?: SidebarCollection | Collection | null): string {
  return sanitizeNavIcon(collection?.icon) || getNameInitial(collection?.name ?? '') || '·'
}

function navIconStyle(icon: string | undefined, fallbackColor: string): Record<string, string> {
  return sanitizeNavIcon(icon)
    ? { backgroundColor: 'transparent', color: 'var(--text-primary)', boxShadow: 'none', fontSize: '17px' }
    : { backgroundColor: fallbackColor }
}

async function setModuleIconFromContext(moduleId: string) {
  const module = workspace.modules.find(item => item.id === moduleId)
  closeContextMenu()
  if (!module) return
  const icon = await dialog.prompt({
    title: '设置集合图标',
    message: '输入 1 个 Emoji 或 1-2 个字符；留空则恢复自动首字图标。',
    placeholder: '例如：API',
    defaultValue: module.icon ?? '',
    confirmText: '保存',
  })
  if (icon == null) return
  await workspace.updateModule(moduleId, { icon: sanitizeNavIcon(icon) || undefined })
}

function showCollapsedModulePreview(event: MouseEvent, moduleId: string) {
  if (!sidebarCollapsed.value) return
  if (collapsedPreviewTimer) clearTimeout(collapsedPreviewTimer)
  const target = event.currentTarget as HTMLElement | null
  const rect = target?.getBoundingClientRect()
  if (!rect) return
  collapsedModulePreview.value = {
    moduleId,
    x: rect.right + 10,
    y: Math.max(10, Math.min(rect.top - 6, window.innerHeight - 240)),
  }
}

function hideCollapsedModulePreview() {
  if (collapsedPreviewTimer) clearTimeout(collapsedPreviewTimer)
  collapsedModulePreview.value = null
}

function scheduleHideCollapsedModulePreview() {
  if (collapsedPreviewTimer) clearTimeout(collapsedPreviewTimer)
  collapsedPreviewTimer = setTimeout(() => {
    collapsedModulePreview.value = null
    collapsedPreviewTimer = null
  }, 120)
}

function keepCollapsedModulePreview() {
  if (collapsedPreviewTimer) {
    clearTimeout(collapsedPreviewTimer)
    collapsedPreviewTimer = null
  }
}

function getPreviewModule(moduleId: string): SidebarCollection | null {
  return sidebarTree.value.find(item => item.id === moduleId) ?? null
}

function getModulePreviewItems(moduleId: string): InterfaceNode[] {
  return workspace.interfaces
    .filter(item => item.moduleId === moduleId && !isFolderNode(item) && item.apiId)
    .sort((a, b) => a.order - b.order)
    .slice(0, 5)
}

// --- Collection rename ---
function startRenameModule(moduleId: string) {
  const module = workspace.modules.find(item => item.id === moduleId)
  if (!module) return
  renamingModuleId.value = moduleId
  renamingModuleInput.value = module.name
  closeContextMenu()
}

function confirmRenameModule() {
  const id = renamingModuleId.value
  if (!id) return
  const newName = renamingModuleInput.value.trim()
  if (!newName) { renamingModuleId.value = null; return }
  workspace.updateModule(id, { name: newName })
  renamingModuleId.value = null
}

function cancelRenameModule() {
  renamingModuleId.value = null
}

// --- Collection color picker ---
function selectCollectionColor(color: string) {
  const id = colorPickerCollectionId.value
  if (!id) return
  workspace.updateModule(id, { color })
  colorPickerCollectionId.value = null
  closeContextMenu()
}

function cancelColorPicker() {
  colorPickerCollectionId.value = null
  closeContextMenu()
}

// --- Duplicate module ---
async function duplicateModuleFromContext(moduleId: string) {
  closeContextMenu()
  const result = await workspace.duplicateModule(moduleId)
  if (result) {
    showToast(`已复制模块：${result.name}`)
    openModule(result.id)
  }
}

// --- Interface: send request ---
function sendInterfaceRequest(apiId: string) {
  selectApi(apiId)
  closeContextMenu()
  window.dispatchEvent(new CustomEvent('apifix:send-current-request'))
}

// --- Interface: copy cURL ---
async function copyInterfaceCurl(apiId: string) {
  const api = store.apis[apiId]
  if (!api) { closeContextMenu(); return }
  const curl = generateCurl(api, store.getEnvVariables())
  await navigator.clipboard.writeText(curl)
  closeContextMenu()
  showToast('已复制 cURL')
}

// --- Interface: move to module ---
function showMoveToSubmenu(apiId: string) {
  moveToInterfaceId.value = apiId
}

async function moveInterfaceToModule(targetModuleId: string) {
  const apiId = moveToInterfaceId.value
  if (!apiId) return
  const interfaceNode = workspace.interfaces.find(item => item.apiId === apiId || item.id === apiId)
  if (!interfaceNode) return
  await workspace.moveInterfaceNode(interfaceNode.id, targetModuleId, null)
  moveToInterfaceId.value = null
  closeContextMenu()
  showToast('已移动接口')
}

function cancelMoveTo() {
  moveToInterfaceId.value = null
  closeContextMenu()
}

function handleModuleDblClick(moduleId: string) {
  workspace.selectModule(moduleId)
  store.currentApiId = null
  store.response = null
}

// --- Method color map for collapsed mode dots ---
const METHOD_COLORS: Record<string, string> = {
  get: '#10b981',
  post: '#f59e0b',
  put: '#3b82f6',
  delete: '#ef4444',
  patch: '#8b5cf6',
  head: '#64748b',
  options: '#64748b',
}

function getMethodColor(method: string): string {
  return METHOD_COLORS[method.toLowerCase()] ?? '#64748b'
}

function getApiDisplayPath(node: InterfaceNode): string {
  const url = getInterfaceApi(node)?.url ?? node.url ?? ''
  const trimmed = url.trim()
  if (!trimmed) return '/'
  const templatePath = trimmed.match(/^\{\{[^}]+\}\}(.*)$/)?.[1]
  if (templatePath !== undefined) return templatePath || '/'
  if (trimmed.startsWith('/')) return trimmed
  try {
    const parsed = new URL(trimmed)
    return `${parsed.pathname || '/'}${parsed.search}`
  } catch {
    return trimmed
  }
}

function getCollectionColor(collectionId: string): string {
  return workspace.collections.find(item => item.id === collectionId)?.color || '#6366f1'
}

// --- Collapsed mode: expand sidebar and focus search ---
function expandAndFocusSearch() {
  sidebarCollapsed.value = false
  requestAnimationFrame(() => {
    const input = document.querySelector<HTMLInputElement>('.sidebar-search')
    input?.focus()
  })
}

// --- Bottom bar actions ---
function handleOpenEnvVars() {
  window.dispatchEvent(new CustomEvent('apifix:open-env-panel'))
}

function handleRecycleBin() {
  showToast('回收站功能开发中')
}

function handleModuleDragStart(event: DragEvent, moduleId: string) {
  draggingModuleId.value = moduleId
  event.dataTransfer?.setData('text/plain', moduleId)
  if (event.dataTransfer) event.dataTransfer.effectAllowed = 'move'
}

function notifyActiveTabInterfaceDrop(payload: Record<string, unknown>) {
  const chromeApi = typeof chrome !== 'undefined' ? (chrome as any) : null
  if (!chromeApi?.tabs?.query || !chromeApi.tabs.sendMessage) return
  const preferredTabId = Number(localStorage.getItem('apifix_target_tab_id') || '')
  const sendToTab = (tabId?: number) => {
    if (!tabId) return
    chromeApi.tabs.sendMessage(tabId, { type: 'APIFIX_PREPARE_INTERFACE_DROP', payload }, () => {
      void chromeApi.runtime?.lastError
    })
  }
  if (Number.isFinite(preferredTabId) && preferredTabId > 0) {
    sendToTab(preferredTabId)
    return
  }
  chromeApi.tabs.query({ active: true, currentWindow: true }, (tabs: Array<{ id?: number }>) => {
    sendToTab(tabs?.[0]?.id)
  })
}

function buildNodeDragPayload(nodeId: string): { content: string; payload: Record<string, unknown> } | null {
  const node = workspace.interfaces.find(item => item.id === nodeId)
  if (!node) return null

  if (isFolderNode(node)) {
    const descendants = workspace.getDescendantNodes(node.id)
      .filter(item => !isFolderNode(item) && item.apiId)
      .map(item => store.apis[item.apiId])
      .filter((api): api is ApiConfig => Boolean(api))
    const content = descendants.map(api => generateCurl(api, store.getEnvVariables())).join('\n\n')
    return {
      content: content || node.name,
      payload: {
        kind: 'folder',
        nodeId: node.id,
        name: node.name,
        count: descendants.length,
        curl: content,
      },
    }
  }

  const api = store.apis[node.apiId]
  if (!api) return null
  const curl = generateCurl(api, store.getEnvVariables())
  return {
    content: curl,
    payload: {
      kind: 'request',
      nodeId: node.id,
      apiId: api.id,
      name: api.name,
      method: api.method,
      url: api.url,
      curl,
    },
  }
}

function markDropTarget(kind: 'module-root' | 'folder' | 'before', id: string) {
  if (!draggingNodeId.value && !draggingModuleId.value) return
  dropTarget.value = { kind, id }
}

function clearDropTarget() {
  dropTarget.value = null
}

function isDropTarget(kind: 'module-root' | 'folder' | 'before', id: string): boolean {
  return dropTarget.value?.kind === kind && dropTarget.value.id === id
}

function clearDragState() {
  draggingNodeId.value = null
  draggingModuleId.value = null
  dropTarget.value = null
}

async function handleCollectionDrop(event: DragEvent, targetId: string) {
  event.preventDefault()
  const draggedId = draggingModuleId.value
  clearDragState()
  if (!draggedId || draggedId === targetId) return
  const ordered = sidebarTree.value
  const targetModule = workspace.modules.find(item => item.id === targetId)
  if (!targetModule) return
  const insertAt = ordered.filter(item => item.id !== draggedId).findIndex(item => item.id === targetId)
  await workspace.moveModule(draggedId, targetModule.categoryId, Math.max(0, insertAt))
}

function handleCollectionHeaderDrop(event: DragEvent, targetId: string) {
  if (draggingModuleId.value) return handleCollectionDrop(event, targetId)
  return dropNodeToModuleRoot(event, targetId)
}

function handleNodeDragStart(event: DragEvent, nodeId: string) {
  draggingNodeId.value = nodeId
  const dragPayload = buildNodeDragPayload(nodeId)
  if (event.dataTransfer) {
    event.dataTransfer.setData('text/plain', dragPayload?.content || nodeId)
    event.dataTransfer.setData('application/x-apifix-node-id', nodeId)
    if (dragPayload) {
      event.dataTransfer.setData('application/x-apifix-interface', JSON.stringify(dragPayload.payload))
      notifyActiveTabInterfaceDrop(dragPayload.payload)
    }
    event.dataTransfer.effectAllowed = 'copyMove'
  }
}

async function dropNodeToModuleRoot(event: DragEvent, moduleId: string) {
  event.preventDefault()
  if (!draggingNodeId.value) return
  await workspace.moveInterfaceNode(draggingNodeId.value, moduleId, null)
  clearDragState()
}

async function dropNodeOnRow(event: DragEvent, target: InterfaceNode) {
  event.preventDefault()
  event.stopPropagation()
  if (!draggingNodeId.value || draggingNodeId.value === target.id) return
  if (isFolderNode(target)) {
    await workspace.moveInterfaceNode(draggingNodeId.value, target.moduleId, target.id)
  } else {
    const siblings = workspace.interfaces
      .filter(item => item.moduleId === target.moduleId && (item.parentId ?? null) === (target.parentId ?? null))
      .sort((a, b) => a.order - b.order)
    const targetIndex = siblings.findIndex(item => item.id === target.id)
    await workspace.moveInterfaceNode(draggingNodeId.value, target.moduleId, target.parentId ?? null, targetIndex < 0 ? undefined : targetIndex)
  }
  clearDragState()
}

async function addFolder(moduleId?: string, parentId: string | null = null) {
  const targetModuleId = moduleId
    ?? (parentId ? workspace.interfaces.find(item => item.id === parentId)?.moduleId : null)
    ?? selectedModuleId.value
  if (!targetModuleId) return

  const name = await dialog.prompt({
    title: '新建文件夹',
    message: '文件夹支持无限层级，可在其中继续创建请求或子文件夹。',
    placeholder: '例如：登录流程',
    confirmText: '创建',
  })
  if (!name?.trim()) return
  const folder = await workspace.addFolder(targetModuleId, name.trim(), parentId)
  const moduleKey = getModuleStorageKey(targetModuleId)
  if (!isExpanded(moduleKey)) toggleExpanded(moduleKey)
  if (parentId) {
    const nodeKey = getNodeStorageKey(parentId)
    if (!isExpanded(nodeKey)) toggleExpanded(nodeKey)
  }
  const folderKey = getNodeStorageKey(folder.id)
  if (!isExpanded(folderKey)) toggleExpanded(folderKey)
}

async function editFolderPreScript(folderId: string) {
  const folder = workspace.interfaces.find(item => item.id === folderId)
  if (!folder) return
  const script = await dialog.prompt({
    title: '文件夹前置脚本',
    message: '发送该文件夹下请求前会先执行此脚本；当前对话框适合短脚本，复杂脚本可后续在脚本引擎面板中扩展。',
    placeholder: 'pm.request.headers.set("X-Folder", "true")',
    defaultValue: folder.preRequestScript ?? '',
    confirmText: '保存',
  })
  if (script == null) return
  await workspace.updateInterfaceNode(folder.id, { preRequestScript: script })
}

function openFolderSettings(folderId: string) {
  const folder = workspace.interfaces.find(item => item.id === folderId)
  if (!folder) return
  folderSettings.value = {
    id: folder.id,
    name: folder.name,
    scriptsInherit: folder.scriptsInherit !== false,
    preRequestScript: folder.preRequestScript ?? '',
    postRequestScript: folder.postRequestScript ?? '',
    auth: folder.auth ? { ...folder.auth } : createDefaultAuthConfig(),
    authOverride: Boolean(folder.auth),
    headers: (folder.headers ?? []).map(item => ({ ...item })),
    variables: (folder.variables ?? []).map(item => ({ ...item })),
    folderTab: 'scripts',
  }
  closeContextMenu()
}

async function saveFolderSettings() {
  const draft = folderSettings.value
  if (!draft) return
  const name = draft.name.trim()
  if (!name) return
  const updates: Partial<CollectionNode> = {
    name,
    scriptsInherit: draft.scriptsInherit,
    preRequestScript: draft.preRequestScript,
    postRequestScript: draft.postRequestScript,
    headers: draft.headers.filter(item => item.key.trim()),
    variables: draft.variables.filter(item => item.key.trim()),
  }
  if (draft.authOverride) updates.auth = draft.auth
  else if (draft.auth) updates.auth = undefined
  await workspace.updateInterfaceNode(draft.id, updates)
  folderSettings.value = null
}

function addFolderHeader() {
  if (!folderSettings.value) return
  folderSettings.value.headers.push({ key: '', value: '', enabled: true })
}
function removeFolderHeader(index: number) {
  folderSettings.value?.headers.splice(index, 1)
}
function addFolderVariable() {
  if (!folderSettings.value) return
  folderSettings.value.variables.push({ key: '', initialValue: '', currentValue: '', secret: false, enabled: true })
}
function removeFolderVariable(index: number) {
  folderSettings.value?.variables.splice(index, 1)
}

async function deleteFolder(folderId: string) {
  const folder = workspace.interfaces.find(item => item.id === folderId)
  if (!window.confirm(`确认删除文件夹「${folder?.name ?? folderId}」及其子接口？此操作不可撤销。`)) return
  const descendants = workspace.getDescendantNodes(folderId)
  const apiIds = descendants
    .filter(item => !isFolderNode(item) && item.apiId)
    .map(item => item.apiId)
  for (const id of apiIds) {
    deleteApi(id)
  }
  await workspace.deleteInterfaceSubtree(folderId)
}

async function doImport() {
  if (!importText.value.trim()) return

  // Phase 4.5:自有备份格式优先识别(与所选导入类型无关)
  const backup = parseCollectionBackup(importText.value)
  if (backup) {
    const stats = await store.restoreCollectionBackup(backup)
    showToast(`已恢复备份：集合 ${stats.collections} · 节点 ${stats.nodes} · 接口 ${stats.apis} · 环境 ${stats.environments}`)
    showImportModal.value = false
    importText.value = ''
    return
  }

  if (importType.value === 'curl') {
    const api = importCurl(importText.value)
    if (api) {
      await addApiToModule(api, null)
      selectApi(api.id)
    }
  } else if (importType.value === 'postman') {
    // Phase 4.4:优先树形导入(保留文件夹层级 + 集合/文件夹级 auth/变量/脚本),其次环境 JSON,最后兼容拍平
    const tree = importPostmanTree(importText.value)
    if (tree) {
      const collectionId = await store.importPostmanCollectionTree(tree)
      const first = tree.requests[0]?.api
      if (first) {
        selectApi(first.id)
      } else if (collectionId) {
        workspace.selectModule(collectionId)
      }
    } else {
      const envDraft = importPostmanEnvironment(importText.value)
      if (envDraft && selectedModuleId.value) {
        await store.importCollectionEnvironment(selectedModuleId.value, envDraft.name, envDraft.variables)
        showToast(`已导入环境：${envDraft.name}`)
      } else {
        const apis = importPostman(importText.value)
        for (const api of apis) {
          await addApiToModule(api, api.folder)
        }
        if (apis.length > 0) {
          selectApi(apis[0].id)
        }
      }
    }
  } else if (importType.value === 'openapi') {
    const apis = importOpenApi(importText.value)
    for (const api of apis) {
      await addApiToModule(api, api.folder)
    }
    if (apis.length > 0) {
      selectApi(apis[0].id)
    }
  } else if (importType.value === 'har') {
    const apis = importHar(importText.value)
    for (const api of apis) {
      await addApiToModule(api, api.folder)
    }
    if (apis.length > 0) {
      selectApi(apis[0].id)
    }
  }

  showImportModal.value = false
  importText.value = ''
}
</script>

<template>
  <div class="sidebar" :class="{ collapsed: sidebarCollapsed, resizing: resizingSidebar }" :style="{ width: sidebarCollapsed ? undefined : sidebarWidth + 'px' }" @click="handleSidebarRootClick">
    <div class="sidebar-header">
      <div class="sidebar-title">
        <span class="sidebar-logo"><Zap :size="18" /></span>
        <div>
          <strong>接口目录</strong>
          <small>{{ workspace.collections.length }} 集合 · 环境按集合隔离</small>
        </div>
        <button class="collapse-btn" :title="sidebarCollapsed ? '展开侧栏' : '折叠侧栏'" @click.stop="toggleSidebarCollapsed">
          <component :is="sidebarCollapsed ? PanelLeftOpen : PanelLeftClose" :size="16" />
        </button>
      </div>
      <label class="search-shell">
        <Search :size="15" />
        <input
          v-model="searchQuery"
          type="text"
          placeholder="搜索接口、模块、变量..."
          class="sidebar-search"
        />
      </label>
    </div>
    <div class="sidebar-actions">
      <button class="btn btn-sm btn-primary" @click="createNewApi()"><FilePlus2 :size="14" /> 请求</button>
      <button class="btn btn-sm" title="新建顶层集合" @click="addCollection">新建集合</button>
    </div>
    <div class="sidebar-content">
      <div v-for="collection in sidebarTree" :key="collection.id" class="group-section collection-section">
        <div
          :class="['group-header collection-header', { selected: selectedModuleId === collection.id, 'drop-target': isDropTarget('module-root', collection.id) }]"
          :title="sidebarCollapsed ? collection.name : undefined"
          draggable="true"
          @click="openModule(collection.id)"
          @dblclick="handleModuleDblClick(collection.id)"
          @contextmenu="handleModuleContextMenu($event, collection.id)"
          @dragstart="handleModuleDragStart($event, collection.id)"
          @dragend="clearDragState"
          @dragover.prevent="markDropTarget('module-root', collection.id)"
          @dragleave="clearDropTarget"
          @drop="handleCollectionHeaderDrop($event, collection.id)"
          @mouseenter="showCollapsedModulePreview($event, collection.id)"
          @mouseleave="scheduleHideCollapsedModulePreview"
        >
          <button class="expand-icon" type="button" @click.stop="toggleExpanded(getModuleStorageKey(collection.id))">
            <ChevronDown v-if="isExpanded(getModuleStorageKey(collection.id))" :size="14" />
            <ChevronRight v-else :size="14" />
          </button>
          <span class="category-color" :style="{ backgroundColor: collection.color || '#6366f1' }"></span>
          <span class="node-kind module-kind">集合</span>
          <span class="collapsed-badge module-collapsed-badge" :style="navIconStyle(collection.icon, collection.color || '#6366f1')">{{ getCollectionNavIcon(collection) }}</span>
          <template v-if="renamingModuleId === collection.id">
            <input
              class="rename-input"
              v-model="renamingModuleInput"
              @keydown.enter="confirmRenameModule"
              @keydown.escape="cancelRenameModule"
              @blur="confirmRenameModule"
              @click.stop
              autofocus
            />
          </template>
          <template v-else>
            <span class="group-name">{{ collection.name }}</span>
          </template>
          <span class="count-badge module-count-badge" title="请求数">{{ collection.requestCount }}</span>
        </div>
        <template v-if="isExpanded(getModuleStorageKey(collection.id))">
          <div
            v-for="row in getVisibleNodes(collection)"
            :key="row.node.id"
            :class="[
              isFolderNode(row.node) ? 'folder-item' : 'api-item',
              {
                active: !isFolderNode(row.node) && store.currentApiId === row.node.apiId,
                dragging: draggingNodeId === row.node.id,
                'drop-into': isFolderNode(row.node) && isDropTarget('folder', row.node.id),
                'drop-before': !isFolderNode(row.node) && isDropTarget('before', row.node.id)
              }
            ]"
            :style="{ paddingLeft: (isFolderNode(row.node) ? 30 : 44) + row.depth * 14 + 'px' }"
            :title="sidebarCollapsed ? (getInterfaceApi(row.node)?.name ?? row.node.name) : undefined"
            draggable="true"
            @click="isFolderNode(row.node) ? toggleExpanded(getNodeStorageKey(row.node.id)) : selectApi(row.node.apiId)"
            @contextmenu="isFolderNode(row.node) ? handleFolderContextMenu($event, row.node.id) : handleApiContextMenu($event, row.node.apiId)"
            @dragstart="handleNodeDragStart($event, row.node.id)"
            @dragend="clearDragState"
            @dragover.prevent="markDropTarget(isFolderNode(row.node) ? 'folder' : 'before', row.node.id)"
            @dragleave="clearDropTarget"
            @drop="dropNodeOnRow($event, row.node)"
          >
            <template v-if="isFolderNode(row.node)">
              <span class="expand-icon">
                <ChevronDown v-if="isExpanded(getNodeStorageKey(row.node.id))" :size="14" />
                <ChevronRight v-else :size="14" />
              </span>
              <span class="node-kind folder-kind">文件夹</span>
              <span class="folder-name">{{ row.node.name }}</span>
              <span v-if="row.node.preRequestScript" class="script-dot" title="有文件夹前置脚本"><FileCode2 :size="12" /></span>
            </template>
            <template v-else>
              <span :class="['method-badge', (getInterfaceApi(row.node)?.method ?? row.node.method).toLowerCase()]">
                {{ getInterfaceApi(row.node)?.method ?? row.node.method }}
              </span>
              <span class="method-dot" :style="{ backgroundColor: getMethodColor(getInterfaceApi(row.node)?.method ?? row.node.method) }"></span>
              <span class="api-copy">
                <span class="api-url api-path">{{ getApiDisplayPath(row.node) }}</span>
                <span class="api-name">{{ getInterfaceApi(row.node)?.name ?? row.node.name }}</span>
              </span>

            </template>
          </div>
        </template>
      </div>
      <div v-if="!hasVisibleItems" class="sidebar-empty">
        {{ searchQuery.trim() ? '无匹配接口' : '暂无接口，点击"新建请求"开始' }}
      </div>
    </div>

    <!-- Context Menu -->
    <Teleport to="body">
      <div
        v-if="contextMenu"
        class="context-menu"
        :style="{ left: contextMenu.x + 'px', top: contextMenu.y + 'px' }"
        @click.stop
      >
      <!-- API / Interface context items -->
      <template v-if="contextMenu.apiId">
        <button class="context-item" @click="sendInterfaceRequest(contextMenu.apiId)">发送请求</button>
        <button class="context-item" @click="copyInterfaceCurl(contextMenu.apiId)">复制 cURL</button>
        <button class="context-item" @click="showMoveToSubmenu(contextMenu.apiId)">移动到...</button>
        <div v-if="moveToInterfaceId === contextMenu.apiId" class="context-submenu">
          <button
            v-for="col in sidebarTree"
            :key="col.id"
            class="context-submenu-item"
            @click="moveInterfaceToModule(col.id)"
          >{{ col.name }}</button>
          <button class="context-item context-submenu-cancel" @click="cancelMoveTo">取消</button>
        </div>
        <div class="context-divider"></div>
        <button v-if="compareBaseApiId !== contextMenu.apiId" class="context-item" @click="selectCompareBaseFromContext(contextMenu.apiId)">选为对比基准</button>
        <button v-if="compareBaseApiId && compareBaseApiId !== contextMenu.apiId" class="context-item" @click="openApiCompareFromContext(contextMenu.apiId)">与基准对比差异</button>
        <button v-if="compareBaseApiId === contextMenu.apiId" class="context-item" @click="clearCompareBaseFromContext()">取消对比基准</button>
        <div class="context-divider"></div>
        <button class="context-item" @click="deleteApi(contextMenu.apiId); closeContextMenu()">删除请求</button>
      </template>

      <!-- Collection context items -->
      <template v-if="contextMenu.moduleId">
        <button class="context-item" @click="startRenameModule(contextMenu.moduleId)">重命名</button>
        <button class="context-item" @click="colorPickerCollectionId = contextMenu.moduleId">修改颜色</button>
        <div v-if="colorPickerCollectionId === contextMenu.moduleId" class="color-picker-row">
          <button
            v-for="color in PRESET_COLORS"
            :key="color"
            class="color-dot"
            :style="{ backgroundColor: color }"
            @click="selectCollectionColor(color)"
          ></button>
          <button class="context-item context-submenu-cancel" @click="cancelColorPicker">取消</button>
        </div>
        <button class="context-item" @click="setModuleIconFromContext(contextMenu.moduleId)">设置导航图标</button>
        <button class="context-item" @click="duplicateModuleFromContext(contextMenu.moduleId)">复制集合</button>
        <button class="context-item" @click="openCollectionSettings(contextMenu.moduleId)">集合设置</button>
        <button class="context-item" @click="exportCollectionPostmanTree(contextMenu.moduleId)">导出 Postman v2.1</button>
        <div class="context-divider"></div>
        <button class="context-item" @click="addFolder(contextMenu.moduleId); closeContextMenu()">新建文件夹</button>
        <button class="context-item" :disabled="batchSendingModuleId === contextMenu.moduleId" @click="runModuleBatchFromContext(contextMenu.moduleId, 'serial')">批量发送（串行）</button>
        <button class="context-item" :disabled="batchSendingModuleId === contextMenu.moduleId" @click="runModuleBatchFromContext(contextMenu.moduleId, 'parallel')">批量发送（并行）</button>
        <div class="context-divider"></div>
        <button class="context-item" @click="deleteModule(contextMenu.moduleId); closeContextMenu()">删除集合</button>
      </template>

      <!-- Folder context items -->
      <template v-if="contextMenu.folderId">
        <button class="context-item" @click="createNewApi(contextMenu.folderId); closeContextMenu()">新建请求</button>
        <button class="context-item" @click="addFolder(undefined, contextMenu.folderId); closeContextMenu()">新建子文件夹</button>
        <div class="context-divider"></div>
        <button class="context-item" :disabled="batchSendingFolderId === contextMenu.folderId" @click="runFolderBatchFromContext(contextMenu.folderId, 'serial')">批量发送（串行）</button>
        <button class="context-item" :disabled="batchSendingFolderId === contextMenu.folderId" @click="runFolderBatchFromContext(contextMenu.folderId, 'parallel')">批量发送（并行）</button>
        <button class="context-item" @click="openFolderSettings(contextMenu.folderId)">文件夹设置</button>
        <button class="context-item" @click="editFolderPreScript(contextMenu.folderId); closeContextMenu()">编辑前置脚本</button>
        <div class="context-divider"></div>
        <button class="context-item" @click="deleteFolder(contextMenu.folderId); closeContextMenu()">删除文件夹</button>
      </template>
      </div>
    </Teleport>

    <!-- Collection Settings Modal -->
    <CollectionSettingsModal
      v-if="collectionSettingsId"
      :collection-id="collectionSettingsId"
      @close="collectionSettingsId = null"
    />

    <!-- Folder Settings Modal -->
    <div v-if="folderSettings" class="modal-overlay" @click.self="folderSettings = null">
      <div class="modal-content folder-settings-modal">
        <div class="compare-header">
          <div>
            <h3>文件夹设置</h3>
            <p>脚本默认继承父级(集合 → 父文件夹 → 本文件夹);Auth/Headers/变量缺省时同样继承。</p>
          </div>
          <button class="btn btn-sm" @click="folderSettings = null">关闭</button>
        </div>
        <label class="folder-settings-field">
          <span>文件夹名称</span>
          <input v-model="folderSettings.name" class="folder-settings-input" type="text" placeholder="文件夹名称" />
        </label>
        <div class="folder-settings-stats">
          <span>子文件夹：{{ getFolderStats(folderSettings.id).childFolders }}</span>
          <span>子请求：{{ getFolderStats(folderSettings.id).requests }}</span>
          <span>脚本：{{ folderSettings.preRequestScript.trim() || folderSettings.postRequestScript.trim() ? '已配置' : '未配置' }}</span>
        </div>
        <label class="folder-settings-field inherit-toggle">
          <input v-model="folderSettings.scriptsInherit" type="checkbox" />
          <span>脚本继承父级(关闭后仅执行本文件夹自身脚本,不执行集合/祖先脚本)</span>
        </label>
        <div class="folder-tabs">
          <button :class="['settings-tab', { active: folderSettings.folderTab === 'scripts' }]" @click="folderSettings.folderTab = 'scripts'">脚本</button>
          <button :class="['settings-tab', { active: folderSettings.folderTab === 'auth' }]" @click="folderSettings.folderTab = 'auth'">Auth</button>
          <button :class="['settings-tab', { active: folderSettings.folderTab === 'headers' }]" @click="folderSettings.folderTab = 'headers'">Headers</button>
          <button :class="['settings-tab', { active: folderSettings.folderTab === 'variables' }]" @click="folderSettings.folderTab = 'variables'">变量</button>
        </div>
        <div class="folder-tab-body">
          <template v-if="folderSettings.folderTab === 'scripts'">
            <label class="folder-settings-field">
              <span>前置脚本(Pre Request)</span>
              <textarea
                v-model="folderSettings.preRequestScript"
                class="import-textarea folder-script-editor"
                spellcheck="false"
                placeholder="例如：pm.request.headers.set('X-Folder', 'true')"
              ></textarea>
            </label>
            <label class="folder-settings-field">
              <span>后置脚本(Post Response / Tests)</span>
              <textarea
                v-model="folderSettings.postRequestScript"
                class="import-textarea folder-script-editor"
                spellcheck="false"
                placeholder="例如：pm.test('状态码 200', () => pm.expect(pm.response.code).to.equal(200))"
              ></textarea>
            </label>
            <div class="folder-settings-hint">
              执行顺序(Postman 兼容):Pre = 集合 → 文件夹(根→叶) → 请求自身;Post = 请求自身 → 文件夹(叶→根) → 集合。
            </div>
          </template>
          <template v-else-if="folderSettings.folderTab === 'auth'">
            <label class="folder-settings-field inherit-toggle">
              <input v-model="folderSettings.authOverride" type="checkbox" />
              <span>在此文件夹覆盖 Auth(关闭 = 继承最近的集合/祖先定义)</span>
            </label>
            <AuthConfig v-if="folderSettings.authOverride" v-model="folderSettings.auth" />
            <p v-else class="folder-settings-hint">当前继承祖先级 Auth。</p>
          </template>
          <template v-else-if="folderSettings.folderTab === 'headers'">
            <p class="folder-settings-hint">文件夹级 Headers 与集合/请求自身合并,同名 key 以更近层级为准。</p>
            <div v-for="(header, index) in folderSettings.headers" :key="index" class="kv-row">
              <input v-model="header.enabled" type="checkbox" class="kv-check" title="启用" />
              <input v-model="header.key" type="text" placeholder="Header 名称" class="kv-key" />
              <input v-model="header.value" type="text" placeholder="值" class="kv-value" />
              <button class="kv-remove" @click="removeFolderHeader(index)"><X :size="14" /></button>
            </div>
            <button class="btn btn-sm" @click="addFolderHeader">+ 添加 Header</button>
          </template>
          <template v-else>
            <p class="folder-settings-hint">文件夹级变量,解析时近层覆盖远层(集合 → 父文件夹 → 本文件夹)。</p>
            <div v-for="(variable, index) in folderSettings.variables" :key="index" class="kv-row">
              <input v-model="variable.enabled" type="checkbox" class="kv-check" title="启用" />
              <input v-model="variable.key" type="text" placeholder="变量名" class="kv-key" />
              <input v-model="variable.initialValue" type="text" placeholder="初始值" class="kv-value" />
              <input v-model="variable.currentValue" :type="variable.secret ? 'password' : 'text'" placeholder="当前值" class="kv-value" />
              <button class="kv-remove" @click="removeFolderVariable(index)"><X :size="14" /></button>
            </div>
            <button class="btn btn-sm" @click="addFolderVariable">+ 添加变量</button>
          </template>
        </div>
        <div class="modal-actions">
          <button class="btn btn-sm" @click="folderSettings = null">取消</button>
          <button class="btn btn-sm btn-primary" :disabled="!folderSettings.name.trim()" @click="saveFolderSettings">保存设置</button>
        </div>
      </div>
    </div>

    <!-- API Compare Modal -->
    <div v-if="comparePair" class="modal-overlay" @click.self="closeApiCompare">
      <div class="modal-content compare-modal">
        <div class="compare-header">
          <div>
            <h3>接口对比差异</h3>
            <p><span>{{ comparePair.left.name }}</span><ArrowLeftRight :size="15" /><span>{{ comparePair.right.name }}</span></p>
          </div>
          <button class="btn btn-sm" @click="closeApiCompare">关闭</button>
        </div>
        <div class="compare-grid compare-grid-head">
          <strong>配置项</strong>
          <strong>{{ comparePair.left.name }}</strong>
          <strong>{{ comparePair.right.name }}</strong>
        </div>
        <div class="compare-body">
          <div
            v-for="section in comparePair.sections"
            :key="section.name"
            :class="['compare-grid', 'compare-row', { same: section.same }]"
          >
            <div class="compare-name">
              <span>
                <Check v-if="section.same" :size="14" />
                <Diff v-else :size="14" />
              </span>
              {{ section.name }}
            </div>
            <pre>{{ section.left }}</pre>
            <pre>{{ section.right }}</pre>
          </div>
        </div>
      </div>
    </div>

    <!-- Import Modal -->
    <div v-if="showImportModal" class="modal-overlay" @click.self="showImportModal = false">
      <div class="modal-content">
        <h3>导入请求</h3>
        <div class="import-type-select">
          <button :class="['btn btn-sm', { active: importType === 'curl' }]" @click="importType = 'curl'">cURL</button>
          <button :class="['btn btn-sm', { active: importType === 'postman' }]" @click="importType = 'postman'">Postman</button>
          <button :class="['btn btn-sm', { active: importType === 'openapi' }]" @click="importType = 'openapi'">OpenAPI</button>
          <button :class="['btn btn-sm', { active: importType === 'har' }]" @click="importType = 'har'">HAR</button>
        </div>
        <textarea
          v-model="importText"
          class="import-textarea"
          :placeholder="importType === 'curl' ? '粘贴 cURL 命令...' : importType === 'postman' ? '粘贴 Postman Collection JSON...' : importType === 'openapi' ? '粘贴 OpenAPI / Swagger JSON...' : '粘贴浏览器导出的 HAR JSON...'"
          spellcheck="false"
        ></textarea>
        <div class="modal-actions">
          <button class="btn" @click="showImportModal = false">取消</button>
          <button class="btn btn-primary" @click="doImport">导入</button>
        </div>
      </div>
    </div>
    <div v-if="!sidebarCollapsed" class="sidebar-resizer" title="拖拽调整侧栏宽度" @mousedown.stop="startSidebarResize">
      <div class="resizer-grip">
        <span></span><span></span><span></span>
      </div>
    </div>
    <div
      v-if="sidebarCollapsed && collapsedModulePreview"
      class="module-hover-preview"
      :style="{ left: collapsedModulePreview.x + 'px', top: collapsedModulePreview.y + 'px' }"
      @mouseenter="keepCollapsedModulePreview"
      @mouseleave="scheduleHideCollapsedModulePreview"
      @click.stop
    >
      <div class="preview-title">
        <span>{{ getCollectionNavIcon(getPreviewModule(collapsedModulePreview.moduleId)) }}</span>
        <strong>{{ getPreviewModule(collapsedModulePreview.moduleId)?.name }}</strong>
      </div>
      <button
        v-for="node in getModulePreviewItems(collapsedModulePreview.moduleId)"
        :key="node.id"
        class="preview-api-row"
        @click="quickSendApi($event, node.apiId); hideCollapsedModulePreview()"
      >
        <span :class="['preview-method', (getInterfaceApi(node)?.method ?? node.method).toLowerCase()]">{{ getInterfaceApi(node)?.method ?? node.method }}</span>
        <span>{{ getInterfaceApi(node)?.name ?? node.name }}</span>
      </button>
      <div v-if="getModulePreviewItems(collapsedModulePreview.moduleId).length === 0" class="preview-empty">暂无接口</div>
    </div>

    <!-- Sidebar Bottom Bar -->
    <div class="sidebar-bottom-bar" :class="{ collapsed: sidebarCollapsed }">
      <template v-if="!sidebarCollapsed">
        <button class="bottom-bar-btn" @click="handleOpenEnvVars" title="环境变量">
          <Globe2 :size="16" />
          <span>环境变量</span>
        </button>
        <button class="bottom-bar-btn" @click="handleRecycleBin" title="回收站">
          <Trash2 :size="16" />
          <span>回收站</span>
        </button>
      </template>
      <template v-else>
        <div class="collapsed-menu-wrap">
          <button class="collapsed-more-btn" title="更多操作" @click.stop="toggleCollapsedMore"><MoreVertical :size="17" /></button>
          <div v-if="collapsedMoreOpen" class="collapsed-popover more-popover" @click.stop>
            <button @click="openGlobalSearch"><span><Search :size="15" /> 全局搜索</span><kbd>Ctrl K</kbd></button>
            <div class="collapsed-menu-divider"></div>
            <button @click="handleOpenEnvVars(); closeCollapsedMenus()"><span><Globe2 :size="15" /> 环境变量</span></button>
            <button @click="openWorkspaceSettings"><span><Settings :size="15" /> 工作台设置</span></button>
            <button @click="handleRecycleBin(); closeCollapsedMenus()"><span><Trash2 :size="15" /> 回收站</span></button>
            <div class="collapsed-menu-divider"></div>
            <button @click="openImportModalFromCollapsed"><span><Download :size="15" /> 导入数据</span></button>
            <button @click="exportWorkspaceData"><span><Upload :size="15" /> 导出数据</span></button>
          </div>
        </div>
        <div class="collapsed-menu-wrap">
          <button class="collapsed-fab" title="新建" @click.stop="toggleCollapsedCreate"><Plus :size="18" /></button>
          <div v-if="collapsedCreateOpen" class="collapsed-popover create-popover" @click.stop>
            <button @click="createNewApi(); closeCollapsedMenus()"><span><FileText :size="15" /> 新建请求</span></button>
            <button @click="addCollection(); closeCollapsedMenus()"><span><Box :size="15" /> 新建集合</span></button>
            <button @click="addFolder(); closeCollapsedMenus()"><span><Folder :size="15" /> 新建文件夹</span></button>
            <button @click="openImportModalFromCollapsed"><span><Download :size="15" /> 导入</span></button>
          </div>
        </div>
      </template>
    </div>

    <!-- Toast notification -->
    <Transition name="toast">
      <div v-if="toast" class="sidebar-toast">{{ toast }}</div>
    </Transition>
  </div>
</template>

<style scoped>
.sidebar {
  width: var(--sidebar-width);
  min-width: var(--sidebar-collapsed);
  height: 100%;
  background: var(--bg-sidebar);
  border: 1px solid var(--border);
  border-radius: var(--radius-2xl);
  display: flex;
  flex-direction: column;
  overflow: hidden;
  position: relative;
  box-shadow: var(--shadow-md);
  backdrop-filter: blur(16px);
  transition: width 0.2s ease-out;
}

.sidebar.resizing {
  transition: none;
}

.sidebar-resizer {
  position: absolute;
  top: 0;
  right: 0;
  width: 6px;
  height: 100%;
  cursor: col-resize;
  background: transparent;
  display: flex;
  align-items: center;
  justify-content: center;
}

.resizer-grip {
  display: flex;
  flex-direction: column;
  gap: 2px;
  opacity: 0;
  transition: opacity 0.15s ease;
}

.resizer-grip span {
  display: block;
  width: 3px;
  height: 3px;
  border-radius: 50%;
  background: var(--text-tertiary);
}

.sidebar-resizer:hover {
  background: color-mix(in srgb, var(--primary) 18%, transparent);
}

.sidebar-resizer:hover .resizer-grip {
  opacity: 1;
}

.sidebar.collapsed {
  width: var(--sidebar-collapsed);
  overflow: visible;
  z-index: 30;
  transition-duration: 0.15s;
  transition-timing-function: ease-in;
}

.sidebar-header {
  padding: 12px;
  border-bottom: 1px solid var(--divider);
  background:
    linear-gradient(180deg, color-mix(in srgb, var(--primary-light) 52%, transparent), transparent);
}

.sidebar-title {
  display: flex;
  align-items: center;
  gap: 9px;
  margin-bottom: 10px;
}

.collapse-btn {
  margin-left: auto;
  display: inline-flex;
  align-items: center;
  justify-content: center;
  width: 24px;
  height: 24px;
  border: 1px solid var(--border);
  border-radius: var(--radius-md);
  background: var(--bg-panel);
  color: var(--text-secondary);
  cursor: pointer;
}

.collapse-btn:hover {
  color: var(--primary);
  border-color: var(--primary);
}

.sidebar-logo {
  display: inline-flex;
  align-items: center;
  justify-content: center;
  width: 30px;
  height: 30px;
  border-radius: 11px;
  background: linear-gradient(135deg, var(--primary), var(--accent));
  color: #fff;
  box-shadow: 0 8px 16px rgba(79, 70, 229, 0.22);
}

.sidebar-title strong,
.sidebar-title small {
  display: block;
}

.sidebar-title strong {
  line-height: 1.2;
}

.sidebar-title small {
  color: var(--text-secondary);
  font-size: var(--font-size-small);
  margin-top: 2px;
}

.sidebar.collapsed .sidebar-header {
  padding: 8px 6px;
}

.sidebar.collapsed .sidebar-title {
  justify-content: center;
  margin-bottom: 0;
}

.sidebar.collapsed .sidebar-title > div,
.sidebar.collapsed .search-shell,
.sidebar.collapsed .sidebar-actions,
.sidebar.collapsed .category-name,
.sidebar.collapsed .node-kind,
.sidebar.collapsed .module-symbol,
.sidebar.collapsed .group-name,
.sidebar.collapsed .group-count,
.sidebar.collapsed .folder-name,
.sidebar.collapsed .api-copy,
.sidebar.collapsed .script-dot,
.sidebar.collapsed .bottom-bar-btn span,
.sidebar.collapsed .category-color,
.sidebar.collapsed .method-badge,
.sidebar.collapsed .count-badge {
  display: none;
}

.sidebar.collapsed .collapsed-badge {
  display: flex;
}

.sidebar.collapsed .method-dot {
  display: block;
}

.sidebar.collapsed .collapse-btn {
  position: absolute;
  right: 3px;
  top: 3px;
  width: 18px;
  height: 18px;
  padding: 0;
  font-size: 12px;
}

.sidebar.collapsed .sidebar-content {
  padding: 6px 4px;
}

.sidebar.collapsed .category-header,
.sidebar.collapsed .group-header,
.sidebar.collapsed .api-item,
.sidebar.collapsed .folder-item {
  justify-content: center;
  min-height: 32px;
  padding-left: 0 !important;
  padding-right: 0;
}

.sidebar.collapsed .expand-icon {
  margin: 0;
}

.sidebar.collapsed .category-header,
.sidebar.collapsed .group-header,
.sidebar.collapsed .api-item,
.sidebar.collapsed .folder-item {
  position: relative;
}

.sidebar.collapsed .category-header.selected,
.sidebar.collapsed .group-header.selected,
.sidebar.collapsed .api-item.active {
  border-color: transparent;
  box-shadow: none;
  background: var(--primary-soft);
  color: var(--primary);
}

.sidebar.collapsed .category-header.selected::before,
.sidebar.collapsed .group-header.selected::before,
.sidebar.collapsed .api-item.active::before {
  content: '';
  position: absolute;
  left: 0;
  top: 7px;
  bottom: 7px;
  width: 3px;
  border-radius: 0 999px 999px 0;
  background: var(--primary);
}

.search-shell {
  display: flex;
  align-items: center;
  gap: 6px;
  height: 32px;
  padding: 0 9px;
  border: 1px solid var(--border);
  border-radius: 999px;
  background: var(--bg-panel);
  color: var(--text-tertiary);
  box-shadow: var(--shadow-sm);
}

.sidebar-search {
  width: 100%;
  height: 30px;
  padding: 0;
  border: none;
  background: transparent;
  font-size: var(--font-size-small);
  box-shadow: none !important;
}

.sidebar-actions {
  display: flex;
  gap: 4px;
  padding: 8px;
  border-bottom: 1px solid var(--divider);
  background: var(--bg-panel-elevated);
}

.sidebar-actions .btn {
  flex: 1;
  display: inline-flex;
  align-items: center;
  justify-content: center;
  gap: 4px;
  font-size: var(--font-size-small);
}

.sidebar-content {
  flex: 1;
  overflow-y: auto;
  padding: 8px;
}

.group-section {
  margin-bottom: 2px;
}

.category-section {
  margin-bottom: 4px;
}

.category-header {
  display: flex;
  align-items: center;
  padding: 8px;
  font-size: var(--font-size-title);
  font-weight: 700;
  color: var(--text-primary);
  cursor: pointer;
  gap: 4px;
  border-radius: var(--radius-lg);
  border: 1px dashed color-mix(in srgb, var(--primary) 26%, var(--border));
  background: color-mix(in srgb, var(--primary) 5%, transparent);
  transition: background 0.15s ease, transform 0.15s ease, border-color 0.15s ease;
}

.category-header:hover {
  background: color-mix(in srgb, var(--primary) 8%, var(--bg-hover));
  border-color: color-mix(in srgb, var(--primary) 36%, var(--border));
  transform: translateX(1px);
}

.category-header.selected {
  background: var(--primary-soft);
  color: var(--primary);
  border-style: solid;
  border-color: color-mix(in srgb, var(--primary) 28%, transparent);
  box-shadow: inset 3px 0 0 var(--primary);
}

.group-header {
  display: flex;
  align-items: center;
  padding: 7px 8px 7px 18px;
  font-size: var(--font-size-title);
  font-weight: 600;
  color: var(--text-secondary);
  cursor: pointer;
  gap: 5px;
  border-radius: var(--radius-lg);
  border: 1px dashed color-mix(in srgb, #0ea5e9 28%, var(--border));
  background: color-mix(in srgb, #0ea5e9 5%, transparent);
  transition: background 0.15s ease, transform 0.15s ease, border-color 0.15s ease;
}

.group-header:hover {
  background: color-mix(in srgb, #0ea5e9 8%, var(--bg-hover));
  border-color: color-mix(in srgb, #0ea5e9 38%, var(--border));
  transform: translateX(1px);
}

.group-header[draggable="true"],
.api-item[draggable="true"],
.folder-item[draggable="true"] {
  user-select: none;
}

.group-header.selected {
  background: color-mix(in srgb, var(--primary-soft) 72%, var(--bg-panel));
  color: var(--text-primary);
  border-style: solid;
  border-color: color-mix(in srgb, var(--primary) 24%, transparent);
  box-shadow: inset 3px 0 0 var(--primary);
}

.expand-icon {
  width: 16px;
  height: 18px;
  display: inline-flex;
  align-items: center;
  justify-content: center;
  flex: 0 0 auto;
  border: 0;
  padding: 0;
  background: transparent;
  color: currentColor;
  cursor: pointer;
}

.category-color {
  width: 8px;
  height: 8px;
  border-radius: 50%;
  flex-shrink: 0;
  box-shadow: 0 0 0 2px var(--bg-sidebar);
}

.node-kind {
  flex-shrink: 0;
  height: 18px;
  padding: 0 6px;
  border-radius: var(--radius-full);
  display: inline-flex;
  align-items: center;
  justify-content: center;
  font-size: 10px;
  font-weight: 750;
  letter-spacing: 0.02em;
  line-height: 1;
}

.category-kind {
  background: color-mix(in srgb, var(--primary) 12%, var(--bg-panel));
  color: var(--primary);
  border: 1px solid color-mix(in srgb, var(--primary) 24%, transparent);
}

.module-kind {
  background: color-mix(in srgb, #0ea5e9 12%, var(--bg-panel));
  color: #0284c7;
  border: 1px solid color-mix(in srgb, #0ea5e9 28%, transparent);
}

.folder-kind {
  background: color-mix(in srgb, #f59e0b 14%, var(--bg-panel));
  color: #b45309;
  border: 1px solid color-mix(in srgb, #f59e0b 32%, transparent);
}

/* Collapsed mode first-letter badge */
.collapsed-badge {
  display: none;
  align-items: center;
  justify-content: center;
  width: 22px;
  height: 22px;
  border-radius: 6px;
  color: #fff;
  font-size: 11px;
  font-weight: 700;
  flex-shrink: 0;
  line-height: 1;
  text-transform: uppercase;
  text-align: center;
}

.category-collapsed-badge {
  box-shadow: 0 2px 6px rgba(0, 0, 0, 0.15);
}

.module-collapsed-badge {
  width: 20px;
  height: 20px;
  border-radius: 5px;
  font-size: 10px;
  opacity: 0.85;
}

.method-dot {
  display: block;
  width: 8px;
  height: 8px;
  border-radius: 50%;
  flex-shrink: 0;
}

/* Count badges for category/module */
.count-badge {
  font-size: 10px;
  color: var(--text-tertiary);
  font-weight: 600;
  background: var(--bg-secondary);
  border-radius: 999px;
  min-width: 18px;
  padding: 0 5px;
  height: 16px;
  line-height: 16px;
  text-align: center;
  flex-shrink: 0;
}

.category-count-badge {
  margin-left: auto;
}

.module-count-badge {
  margin-left: 2px;
}

.category-name,
.group-name {
  flex: 1;
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
}

.group-count {
  font-size: var(--font-size-small);
  color: var(--primary);
  font-weight: 700;
  min-width: 26px;
  padding: 1px 0;
  text-align: center;
}

.api-item {
  padding: 7px 8px 7px 36px;
  display: flex;
  align-items: center;
  gap: 6px;
  cursor: pointer;
  font-size: var(--font-size-body);
  border-radius: var(--radius-lg);
  border: 1px solid transparent;
  transition: background 0.15s ease, border-color 0.15s ease, transform 0.15s ease;
}

.api-item:hover {
  background: var(--bg-hover);
  transform: translateX(1px);
}

.api-item.active {
  background: var(--bg-panel);
  border-color: var(--primary);
  box-shadow: inset 3px 0 0 var(--primary), var(--shadow-sm);
}

.api-item.dragging,
.folder-item.dragging {
  opacity: 0.48;
  outline: 1px dashed var(--primary);
}

.category-header.drop-target,
.group-header.drop-target,
.folder-item.drop-into {
  background: var(--primary-soft);
  color: var(--primary);
  box-shadow: inset 0 0 0 1px var(--primary);
}

.api-item.drop-before,
.folder-item.drop-before {
  border-top-color: var(--primary);
  box-shadow: 0 -2px 0 var(--primary);
}

.folder-item {
  padding: 7px 8px 7px 30px;
  display: flex;
  align-items: center;
  gap: 5px;
  cursor: pointer;
  font-size: var(--font-size-body);
  border-radius: var(--radius-lg);
  color: var(--text-secondary);
  border: 1px dashed color-mix(in srgb, var(--border) 72%, transparent);
  background: color-mix(in srgb, #f59e0b 5%, transparent);
  transition: background 0.15s ease, transform 0.15s ease, border-color 0.15s ease;
}

.folder-item:hover {
  background: color-mix(in srgb, #f59e0b 9%, var(--bg-hover));
  border-color: color-mix(in srgb, #f59e0b 35%, var(--border));
  transform: translateX(1px);
}

.folder-icon {
  font-size: 13px;
}

.folder-name {
  flex: 1;
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
  font-weight: 650;
}

.script-dot {
  color: var(--primary);
  font-size: 10px;
}


.api-copy {
  min-width: 0;
  flex: 1;
}

.api-name,
.api-url {
  display: block;
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
}

.api-name {
  color: var(--text-secondary);
  font-size: 10px;
}

.api-url {
  color: var(--text-primary);
  font-family: var(--font-code);
  font-size: 11px;
  font-weight: 750;
}

.api-path {
  margin-bottom: 2px;
}

.sidebar-empty {
  padding: 20px;
  text-align: center;
  color: var(--text-tertiary);
  font-size: var(--font-size-body);
}

.context-menu {
  position: fixed;
  background: var(--bg-panel);
  border: 1px solid var(--border);
  border-radius: var(--radius-lg);
  box-shadow: var(--shadow-lg);
  padding: 4px 0;
  z-index: 1000;
  min-width: 132px;
  overflow: hidden;
}

.context-item {
  display: block;
  width: 100%;
  padding: 7px 12px;
  background: transparent;
  color: var(--text-primary);
  text-align: left;
  cursor: pointer;
  font-size: var(--font-size-body);
}

.context-item:hover:not(:disabled) {
  background: var(--bg-hover);
}

.context-item:disabled {
  cursor: not-allowed;
  opacity: 0.56;
}


.compare-modal {
  width: min(980px, 92vw);
  max-height: 84vh;
}

.folder-settings-modal {
  width: min(720px, 92vw);
}

.compare-header {
  display: flex;
  align-items: flex-start;
  justify-content: space-between;
  gap: 12px;
  margin-bottom: 12px;
}

.compare-header h3 {
  margin: 0 0 4px;
}

.compare-header p {
  margin: 0;
  color: var(--text-secondary);
  font-size: var(--font-size-body);
}

.compare-body {
  max-height: 62vh;
  overflow: auto;
  border: 1px solid var(--border);
  border-radius: var(--radius-lg);
}

.compare-grid {
  display: grid;
  grid-template-columns: 140px minmax(0, 1fr) minmax(0, 1fr);
  gap: 0;
}

.compare-grid-head {
  padding: 8px 0;
  color: var(--text-secondary);
  font-size: var(--font-size-small);
}

.compare-row {
  border-bottom: 1px solid var(--divider);
}

.compare-row:last-child {
  border-bottom: 0;
}

.compare-row.same {
  opacity: 0.72;
}

.compare-name,
.compare-row pre {
  margin: 0;
  padding: 10px;
  white-space: pre-wrap;
  word-break: break-word;
}

.compare-name {
  display: flex;
  gap: 6px;
  align-items: flex-start;
  color: var(--text-secondary);
  background: var(--bg-secondary);
  font-weight: 600;
}

.compare-row pre {
  border-left: 1px solid var(--divider);
  font-family: var(--font-code);
  font-size: 12px;
  color: var(--text-primary);
  background: color-mix(in srgb, var(--bg-panel) 92%, var(--bg-secondary));
}

.modal-overlay {
  position: fixed;
  inset: 0;
  background: rgba(2, 6, 23, 0.52);
  backdrop-filter: blur(8px);
  display: flex;
  align-items: center;
  justify-content: center;
  z-index: 1001;
}

.modal-content {
  background: var(--bg-panel);
  border: 1px solid var(--border);
  border-radius: var(--radius-2xl);
  padding: 20px;
  width: 500px;
  max-width: calc(100vw - 28px);
  max-height: 80vh;
  display: flex;
  flex-direction: column;
  gap: 12px;
  box-shadow: var(--shadow-lg);
}

.modal-content h3 {
  font-size: 16px;
  font-weight: 600;
}

.import-type-select {
  display: flex;
  gap: 4px;
}

.import-type-select .btn.active {
  background: var(--primary-light);
  color: var(--primary);
  border-color: var(--primary);
}

.import-textarea {
  width: 100%;
  min-height: 200px;
  background: var(--bg-code);
  color: var(--text-primary);
  font-family: var(--font-code);
  font-size: var(--font-size-code);
  resize: vertical;
}

.import-textarea:focus {
  border-color: var(--primary);
}

.folder-settings-field {
  display: flex;
  flex-direction: column;
  gap: 6px;
  font-size: var(--font-size-small);
  color: var(--text-secondary);
}

.folder-settings-field span {
  font-weight: 600;
}

.folder-settings-input {
  width: 100%;
  height: 38px;
  padding: 0 10px;
  border: 1px solid var(--border);
  border-radius: var(--radius-lg);
  background: var(--bg-secondary);
  color: var(--text-primary);
}

.folder-settings-input:focus {
  outline: none;
  border-color: var(--primary);
}

.folder-settings-stats {
  display: flex;
  flex-wrap: wrap;
  gap: 8px;
}

.folder-settings-stats span {
  padding: 4px 8px;
  border: 1px solid var(--border);
  border-radius: var(--radius-full);
  background: var(--bg-secondary);
  color: var(--text-secondary);
  font-size: var(--font-size-small);
}

.folder-script-editor {
  min-height: 220px;
}

.folder-settings-hint {
  padding: 10px 12px;
  border: 1px solid var(--border);
  border-radius: var(--radius-lg);
  background: var(--bg-secondary);
  color: var(--text-secondary);
  font-size: var(--font-size-small);
  line-height: 1.5;
}

.folder-tabs {
  display: flex;
  gap: 4px;
  border-bottom: 1px solid var(--divider);
  padding-bottom: 8px;
}

.folder-tab-body {
  display: flex;
  flex-direction: column;
  gap: 10px;
  overflow-y: auto;
  max-height: 44vh;
  padding-right: 4px;
}

.inherit-toggle {
  flex-direction: row !important;
  align-items: center;
  gap: 8px !important;
  font-weight: 500 !important;
}

.kv-row {
  display: flex;
  align-items: center;
  gap: 6px;
}

.kv-row input[type='text'] {
  height: 32px;
  padding: 0 8px;
  border: 1px solid var(--border);
  border-radius: var(--radius-md);
  background: var(--bg-secondary);
  color: var(--text-primary);
  font-size: var(--font-size-small);
}

.kv-key { width: 150px; flex-shrink: 0; }
.kv-value { flex: 1; min-width: 0; }
.kv-check { flex-shrink: 0; }

.kv-remove {
  border: none;
  background: transparent;
  color: var(--text-tertiary);
  cursor: pointer;
  padding: 4px;
  flex-shrink: 0;
}

.kv-remove:hover { color: var(--danger, #ef4444); }

.modal-actions {
  display: flex;
  justify-content: flex-end;
  gap: 8px;
}

.rename-input {
  flex: 1;
  min-width: 0;
  height: 24px;
  padding: 0 6px;
  border: 1px solid var(--primary);
  border-radius: var(--radius-md);
  background: var(--bg-panel);
  color: var(--text-primary);
  font-size: var(--font-size-body);
  font-weight: inherit;
  outline: none;
  box-shadow: 0 0 0 2px color-mix(in srgb, var(--primary) 18%, transparent);
}

.context-divider {
  height: 1px;
  margin: 4px 8px;
  background: var(--divider);
}

.context-submenu {
  padding: 4px 0 0 0;
  max-height: 220px;
  overflow-y: auto;
}

.context-submenu-group {
  margin-bottom: 2px;
}

.context-submenu-label {
  padding: 4px 12px;
  font-size: var(--font-size-small);
  color: var(--text-tertiary);
  font-weight: 600;
}

.context-submenu-item {
  display: block;
  width: 100%;
  padding: 6px 12px 6px 20px;
  background: transparent;
  color: var(--text-primary);
  text-align: left;
  cursor: pointer;
  font-size: var(--font-size-body);
  border: none;
}

.context-submenu-item:hover {
  background: var(--bg-hover);
}

.context-submenu-cancel {
  color: var(--text-tertiary);
  font-size: var(--font-size-small);
}

.color-picker-row {
  display: flex;
  flex-wrap: wrap;
  gap: 6px;
  padding: 8px 12px;
  align-items: center;
}

.color-dot {
  width: 20px;
  height: 20px;
  border-radius: 50%;
  border: 2px solid transparent;
  cursor: pointer;
  transition: border-color 0.15s ease, transform 0.15s ease;
  padding: 0;
  background: none;
}

.color-dot:hover {
  border-color: var(--text-primary);
  transform: scale(1.18);
}

.sidebar-bottom-bar {
  display: flex;
  gap: 2px;
  padding: 8px 8px;
  border-top: 1px solid var(--divider);
  background: var(--bg-panel-elevated);
  flex-shrink: 0;
}

.sidebar-bottom-bar.collapsed {
  flex-direction: column;
  align-items: center;
  gap: 8px;
  padding: 8px 4px 10px;
}

.bottom-bar-btn {
  display: flex;
  align-items: center;
  gap: 5px;
  flex: 1;
  padding: 6px 8px;
  border: 1px solid var(--border);
  border-radius: var(--radius-lg);
  background: var(--bg-panel);
  color: var(--text-secondary);
  cursor: pointer;
  font-size: var(--font-size-small);
  transition: color 0.15s ease, border-color 0.15s ease, background 0.15s ease;
  white-space: nowrap;
}

.bottom-bar-btn:hover {
  color: var(--primary);
  border-color: var(--primary);
  background: var(--primary-soft);
}

.collapsed-menu-wrap {
  position: relative;
  width: 100%;
  display: flex;
  justify-content: center;
}

.collapsed-more-btn,
.collapsed-fab {
  display: flex;
  align-items: center;
  justify-content: center;
  width: 34px;
  height: 34px;
  border: 1px solid var(--border);
  border-radius: 999px;
  cursor: pointer;
  transition: color 0.15s ease, border-color 0.15s ease, background 0.15s ease, transform 0.15s ease;
}

.collapsed-more-btn {
  background: var(--bg-panel);
  color: var(--text-secondary);
  font-size: 20px;
  line-height: 1;
}

.collapsed-fab {
  background: linear-gradient(135deg, var(--primary), var(--accent));
  color: #fff;
  border-color: transparent;
  box-shadow: 0 10px 22px rgba(79, 70, 229, 0.3);
  font-size: 20px;
  font-weight: 800;
}

.collapsed-more-btn:hover,
.collapsed-fab:hover {
  transform: translateY(-1px);
}

.collapsed-more-btn:hover {
  color: var(--primary);
  border-color: var(--primary);
  background: var(--primary-soft);
}

.collapsed-popover,
.module-hover-preview {
  position: fixed;
  min-width: 174px;
  border: 1px solid var(--border);
  border-radius: var(--radius-xl);
  background: var(--bg-panel);
  box-shadow: var(--shadow-lg);
  z-index: 1200;
  padding: 6px;
}

.collapsed-popover {
  position: absolute;
  left: calc(100% + 12px);
  bottom: 0;
}

.create-popover {
  bottom: 0;
}

.collapsed-popover button,
.preview-api-row {
  width: 100%;
  border: none;
  border-radius: var(--radius-md);
  background: transparent;
  color: var(--text-primary);
  cursor: pointer;
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: 8px;
  padding: 8px 10px;
  font-size: var(--font-size-body);
  text-align: left;
}


.collapsed-popover button > span {
  display: inline-flex;
  align-items: center;
  gap: 7px;
  min-width: 0;
}

.collapsed-popover button:hover,
.preview-api-row:hover {
  background: var(--bg-hover);
  color: var(--primary);
}

.collapsed-popover kbd {
  padding: 1px 5px;
  border: 1px solid var(--border);
  border-radius: var(--radius-sm);
  color: var(--text-tertiary);
  font-family: var(--font-code);
  font-size: 10px;
}

.collapsed-menu-divider {
  height: 1px;
  margin: 5px 6px;
  background: var(--divider);
}

.module-hover-preview {
  max-width: 260px;
}

.preview-title {
  display: flex;
  align-items: center;
  gap: 8px;
  padding: 8px 10px 7px;
  border-bottom: 1px solid var(--divider);
  margin-bottom: 4px;
}

.preview-title span {
  width: 22px;
  text-align: center;
  font-size: 17px;
}

.preview-title strong {
  min-width: 0;
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
  color: var(--text-primary);
}

.preview-api-row {
  justify-content: flex-start;
}

.preview-api-row > span:last-child {
  min-width: 0;
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
}

.preview-method {
  min-width: 44px;
  padding: 2px 5px;
  border-radius: var(--radius-sm);
  background: var(--bg-secondary);
  color: var(--text-secondary);
  font-family: var(--font-code);
  font-size: 10px;
  font-weight: 800;
  text-align: center;
}

.preview-empty {
  padding: 12px 10px;
  color: var(--text-tertiary);
  font-size: var(--font-size-body);
  text-align: center;
}

.sidebar-toast {
  position: absolute;
  bottom: 52px;
  left: 50%;
  transform: translateX(-50%);
  padding: 8px 14px;
  border: 1px solid var(--border);
  border-radius: var(--radius-lg);
  background: var(--bg-panel-elevated);
  color: var(--text-primary);
  font-size: var(--font-size-small);
  box-shadow: var(--shadow-lg);
  z-index: 10;
  pointer-events: none;
  white-space: nowrap;
}

.toast-enter-active,
.toast-leave-active {
  transition: opacity 0.2s ease, transform 0.2s ease;
}

.toast-enter-from,
.toast-leave-to {
  opacity: 0;
  transform: translateX(-50%) translateY(8px);
}
</style>
