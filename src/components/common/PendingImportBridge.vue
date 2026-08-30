<script setup lang="ts">
import { onMounted, onUnmounted, ref, computed } from 'vue'
import { Check, X, XCircle } from '@lucide/vue'
import { useAppStore } from '@/stores/app'
import { createDefaultAuthConfig } from '@/utils/auth'
import { useWorkspaceStore } from '@/stores/workspace'
import { importOpenApiSpec } from '@/utils/openapi-import'
import type { ApiConfig, BodyConfig, HttpMethod, KvPair, ModuleExportConfig } from '@/types'

const store = useAppStore()
const workspace = useWorkspaceStore()
const toast = ref('')
const processedIds = new Set<string>()
const SHARE_HASH_PREFIX = 'apifix-share='

// --- Import preview state ---
interface ImportPreviewItem {
  api: ApiConfig
  checked: boolean
}

type ImportSource = 'share' | 'browser-capture' | 'context-capture'

interface ImportPreviewState {
  visible: boolean
  items: ImportPreviewItem[]
  moduleName: string
  moduleId: string | null
  source: ImportSource
  sourceLabel: string
  exportConfig: ModuleExportConfig | null
  payload: unknown
  pendingImport: PendingImport | null
  phase: 'preview' | 'importing' | 'success' | 'error'
  progressCurrent: number
  progressTotal: number
  errorMessage: string
}

const preview = ref<ImportPreviewState>({
  visible: false,
  items: [],
  moduleName: '',
  moduleId: null,
  source: 'share',
  sourceLabel: '',
  exportConfig: null,
  payload: null,
  pendingImport: null,
  phase: 'preview',
  progressCurrent: 0,
  progressTotal: 0,
  errorMessage: '',
})

const checkedCount = computed(() => preview.value.items.filter(item => item.checked).length)
const allChecked = computed(() => preview.value.items.length > 0 && preview.value.items.every(item => item.checked))

function toggleAll() {
  const next = !allChecked.value
  preview.value.items.forEach(item => { item.checked = next })
}

function toggleItem(index: number) {
  preview.value.items[index].checked = !preview.value.items[index].checked
}

function cancelImport() {
  preview.value.visible = false
  preview.value.items = []
  preview.value.phase = 'preview'
  preview.value.errorMessage = ''
  // If it was a share link, clear the hash so it doesn't re-trigger
  if (preview.value.source === 'share') {
    clearShareHash()
  }
}

async function confirmImport() {
  const checkedItems = preview.value.items.filter(item => item.checked)
  if (checkedItems.length === 0) return

  preview.value.phase = 'importing'
  preview.value.progressCurrent = 0
  preview.value.progressTotal = checkedItems.length

  try {
    const { source, moduleName, moduleId, exportConfig, pendingImport } = preview.value

    if (source === 'share') {
      // Share import flow
      const module = moduleId
        ? workspace.modules.find(m => m.id === moduleId) ?? await workspace.ensureModuleForLegacyGroup(moduleName)
        : await workspace.ensureModuleForLegacyGroup(moduleName)

      if (exportConfig) {
        await workspace.updateModule(module.id, {
          exportConfig: { ...(module.exportConfig ?? {}), ...exportConfig },
          type: exportConfig.teamRole === 'viewer' ? 'readonly' : module.type,
          description: module.description || `由 ApiFix 分享链接导入，权限角色：${exportConfig.teamRole}`,
        })
      }

      for (const item of checkedItems) {
        await store.addApi({ ...item.api, folder: item.api.folder || moduleName }, module.id)
        preview.value.progressCurrent++
      }

      const firstApi = checkedItems[0].api
      const interfaceNode = workspace.interfaces.find(i => i.apiId === firstApi.id)
      workspace.selectInterface(interfaceNode?.id ?? firstApi.id)
      store.openApiInTab(firstApi.id)
    } else {
      // Browser capture / context capture flow
      const api = checkedItems[0].api
      const module = await workspace.ensureModuleForLegacyGroup(api.folder || '浏览器捕获')
      await store.addApi(api, module.id)
      preview.value.progressCurrent = 1

      const interfaceNode = workspace.interfaces.find(i => i.apiId === api.id)
      workspace.selectInterface(interfaceNode?.id ?? api.id)
      store.openApiInTab(api.id)

      if (pendingImport) {
        await clearPendingImport()
      }
    }

    preview.value.phase = 'success'
    setTimeout(() => {
      preview.value.visible = false
      preview.value.phase = 'preview'
    }, 2200)
  } catch (err) {
    preview.value.phase = 'error'
    preview.value.errorMessage = err instanceof Error ? err.message : String(err)
  }
}

async function retryImport() {
  preview.value.phase = 'preview'
  preview.value.errorMessage = ''
  await confirmImport()
}

// --- Method badge colors ---
const METHOD_COLORS: Record<string, string> = {
  GET: '#10b981',
  POST: '#3b82f6',
  PUT: '#f59e0b',
  DELETE: '#ef4444',
  PATCH: '#8b5cf6',
  HEAD: '#6b7280',
  OPTIONS: '#6b7280',
}

function methodColor(method: string): string {
  return METHOD_COLORS[method.toUpperCase()] || '#6b7280'
}

// --- Existing types and helpers (unchanged) ---

interface HeaderLike {
  key?: string
  name?: string
  value?: string
}

interface PendingImport {
  id?: string
  source?: string
  request?: {
    method?: string
    url?: string
    headers?: HeaderLike[]
    queryString?: HeaderLike[]
    postData?: {
      mimeType?: string
      text?: string
      params?: Array<{ name?: string; key?: string; value?: string }>
    } | null
  } | null
  context?: {
    mode?: string
    pageUrl?: string
    pageTitle?: string
    selectionText?: string
    text?: string
    json?: unknown
    isJson?: boolean
    referrer?: string
    language?: string
    viewport?: string
    frame?: {
      isTop?: boolean
      url?: string
      name?: string
    }
    capturedAt?: number
  } | null
}

function generateId(): string {
  return Date.now().toString(36) + Math.random().toString(36).slice(2, 8)
}

function normalizeMethod(method?: string): HttpMethod {
  const value = (method || 'GET').toUpperCase()
  return ['GET', 'POST', 'PUT', 'DELETE', 'PATCH', 'HEAD', 'OPTIONS'].includes(value)
    ? value as HttpMethod
    : 'GET'
}

function normalizeHeaders(headers?: HeaderLike[]): KvPair[] {
  return (headers || [])
    .map(header => ({
      key: header.key || header.name || '',
      value: header.value || '',
      enabled: true,
    }))
    .filter(header => header.key)
}

function normalizeParams(params?: HeaderLike[]): KvPair[] {
  return (params || [])
    .map(param => ({
      key: param.key || param.name || '',
      value: param.value || '',
      enabled: true,
    }))
    .filter(param => param.key)
}

function bodyFromPostData(postData: NonNullable<PendingImport['request']>['postData']): BodyConfig {
  if (!postData) {
    return { type: 'none', raw: '', formData: [], urlEncoded: [], binaryFile: null, contentType: '' }
  }

  const mimeType = postData.mimeType || ''
  if (mimeType.includes('application/x-www-form-urlencoded')) {
    return {
      type: 'urlencoded',
      raw: '',
      formData: [],
      urlEncoded: (postData.params || []).map(param => ({
        key: param.key || param.name || '',
        value: param.value || '',
        enabled: true,
      })).filter(param => param.key),
      binaryFile: null,
      contentType: 'application/x-www-form-urlencoded',
    }
  }

  if (mimeType.includes('multipart/form-data')) {
    return {
      type: 'form',
      raw: '',
      formData: (postData.params || []).map(param => ({
        key: param.key || param.name || '',
        value: param.value || '',
        enabled: true,
      })).filter(param => param.key),
      urlEncoded: [],
      binaryFile: null,
      contentType: '',
    }
  }

  const text = postData.text || ''
  return {
    type: mimeType.includes('json') ? 'json' : text ? 'raw' : 'none',
    raw: text,
    formData: [],
    urlEncoded: [],
    binaryFile: null,
    contentType: mimeType || (text ? 'text/plain' : ''),
  }
}

function bodyFromContext(context: NonNullable<PendingImport['context']>): BodyConfig {
  const raw = context.isJson && context.json != null
    ? JSON.stringify(context.json, null, 2)
    : (context.selectionText || context.text || '')

  return {
    type: raw ? (context.isJson ? 'json' : 'raw') : 'none',
    raw,
    formData: [],
    urlEncoded: [],
    binaryFile: null,
    contentType: context.isJson ? 'application/json' : raw ? 'text/plain' : '',
  }
}

function contextVariables(context: NonNullable<PendingImport['context']>): KvPair[] {
  const entries: Array<[string, unknown, string]> = [
    ['page.url', context.pageUrl, '页面 URL'],
    ['page.title', context.pageTitle, '页面标题'],
    ['page.referrer', context.referrer, '页面 referrer'],
    ['page.language', context.language, '浏览器语言'],
    ['page.viewport', context.viewport, '视口尺寸'],
    ['page.frameUrl', context.frame?.url, 'Frame URL'],
    ['page.frameName', context.frame?.name, 'Frame 名称'],
    ['page.isTopFrame', context.frame?.isTop == null ? '' : String(context.frame.isTop), '是否顶层 Frame'],
  ]
  return entries
    .filter(([, value]) => value != null && String(value).length > 0)
    .map(([key, value, description]) => ({
      key,
      value: String(value),
      enabled: true,
      description,
    }))
}

function decodeSharePayload(value: string): unknown | null {
  try {
    const normalized = value.replace(/-/g, '+').replace(/_/g, '/')
    const padded = normalized.padEnd(Math.ceil(normalized.length / 4) * 4, '=')
    const binary = atob(padded)
    const bytes = Uint8Array.from(binary, char => char.charCodeAt(0))
    return JSON.parse(new TextDecoder().decode(bytes))
  } catch (err) {
    console.warn('Failed to decode ApiFix share payload:', err)
    return null
  }
}

function shareExportConfig(shareMeta: any): ModuleExportConfig | null {
  if (!shareMeta || typeof shareMeta !== 'object') return null
  const role = ['owner', 'editor', 'viewer'].includes(shareMeta.teamRole) ? shareMeta.teamRole : 'viewer'
  const permissions = shareMeta.permissions && typeof shareMeta.permissions === 'object'
    ? {
        editSettings: Boolean(shareMeta.permissions.editSettings),
        editVariables: Boolean(shareMeta.permissions.editVariables),
        syncDataSource: Boolean(shareMeta.permissions.syncDataSource),
        backup: Boolean(shareMeta.permissions.backup),
      }
    : {
        editSettings: role !== 'viewer',
        editVariables: role !== 'viewer',
        syncDataSource: role !== 'viewer',
        backup: role !== 'viewer',
      }
  return {
    format: 'openapi3',
    autoBackup: false,
    backupTarget: 'local',
    teamRole: role,
    conflictStrategy: shareMeta.conflictStrategy === 'overwrite' ? 'overwrite' : 'prompt',
    permissions,
  }
}

function currentSharePayload(): unknown | null {
  if (typeof window === 'undefined') return null
  const hash = window.location.hash.replace(/^#/, '')
  if (!hash.startsWith(SHARE_HASH_PREFIX)) return null
  return decodeSharePayload(hash.slice(SHARE_HASH_PREFIX.length))
}

function clearShareHash() {
  if (typeof window === 'undefined') return
  const nextUrl = `${window.location.pathname}${window.location.search}`
  window.history.replaceState(null, document.title, nextUrl)
}

function createDefaultApi(partial: Partial<ApiConfig>): ApiConfig {
  const now = Date.now()
  return {
    id: generateId(),
    name: partial.name || '浏览器捕获请求',
    method: partial.method || 'GET',
    url: partial.url || '',
    headers: partial.headers || [],
    params: partial.params || [],
    cookies: partial.cookies || [],
    body: partial.body || { type: 'none', raw: '', formData: [], urlEncoded: [], binaryFile: null, contentType: '' },
    auth: partial.auth || createDefaultAuthConfig(),
    preRequestScript: partial.preRequestScript || '',
    postRequestScript: partial.postRequestScript || '',
    folder: partial.folder || null,
    createdAt: now,
    updatedAt: now,
  }
}

function apiFromPendingImport(pending: PendingImport): ApiConfig | null {
  if (pending.request?.url) {
    const url = pending.request.url
    let path = url
    try {
      path = new URL(url).pathname || url
    } catch {}
    return createDefaultApi({
      name: `${normalizeMethod(pending.request.method)} ${path}`,
      method: normalizeMethod(pending.request.method),
      url,
      headers: normalizeHeaders(pending.request.headers),
      params: normalizeParams(pending.request.queryString),
      body: bodyFromPostData(pending.request.postData),
      folder: '浏览器捕获',
    })
  }

  if (pending.context) {
    const context = pending.context
    const body = bodyFromContext(context)
    const isSelection = Boolean(context.selectionText || context.mode?.includes('selection'))
    const name = context.isJson
      ? (context.pageTitle && isSelection ? `选中 JSON：${context.pageTitle}` : '选中 JSON')
      : context.pageTitle
        ? `页面内容：${context.pageTitle}`
        : '选中文本'
    return createDefaultApi({
      name,
      method: body.type === 'none' ? 'GET' : 'POST',
      url: context.pageUrl || '',
      headers: body.contentType ? [{ key: 'Content-Type', value: body.contentType, enabled: true }] : [],
      body,
      requestVariables: contextVariables(context),
      folder: '页面上下文',
    })
  }

  return null
}

async function clearPendingImport(): Promise<void> {
  const runtime = typeof chrome !== 'undefined' ? (chrome.runtime as any) : null
  if (!runtime?.sendMessage) return
  await new Promise<void>((resolve) => {
    runtime.sendMessage({ type: 'CLEAR_PENDING_IMPORT' }, () => resolve())
  })
}

// --- Modified consume functions to show preview instead of auto-import ---

async function consumeSharePayload(payload: unknown): Promise<void> {
  const spec = payload as any
  const shareMeta = spec?.['x-apifix-share']
  const expiresAt = shareMeta?.expiresAt ? Date.parse(String(shareMeta.expiresAt)) : Number.NaN
  if (Number.isFinite(expiresAt) && expiresAt < Date.now()) {
    toast.value = '分享链接已过期，请重新生成'
    setTimeout(() => { toast.value = '' }, 2600)
    clearShareHash()
    return
  }
  const moduleName = shareMeta?.moduleName || spec?.info?.title || '分享模块'
  const id = `share:${shareMeta?.moduleId || moduleName}:${shareMeta?.exportedAt || ''}:${JSON.stringify(spec?.paths || {}).length}`
  if (processedIds.has(id)) return
  processedIds.add(id)

  const apis = importOpenApiSpec(spec)
  if (apis.length === 0) {
    toast.value = '分享链接中未识别到接口'
    setTimeout(() => { toast.value = '' }, 2200)
    return
  }

  const module = await workspace.ensureModuleForLegacyGroup(moduleName)
  const exportConfig = shareExportConfig(shareMeta)

  // Show preview instead of auto-importing
  preview.value = {
    visible: true,
    items: apis.map(api => ({ api, checked: true })),
    moduleName,
    moduleId: module.id,
    source: 'share',
    sourceLabel: 'ApiFix 分享链接',
    exportConfig,
    payload,
    pendingImport: null,
    phase: 'preview',
    progressCurrent: 0,
    progressTotal: 0,
    errorMessage: '',
  }
}

async function checkShareHash(): Promise<void> {
  const payload = currentSharePayload()
  if (!payload) return
  await consumeSharePayload(payload)
}

async function consumePendingImport(pending: PendingImport | null): Promise<void> {
  if (!pending) return
  const id = pending.id || `${pending.source}:${pending.request?.url || pending.context?.pageUrl || Date.now()}`
  if (processedIds.has(id)) return
  processedIds.add(id)

  const api = apiFromPendingImport(pending)
  if (!api) return

  const sourceLabel = pending.request?.url ? '浏览器网络捕获' : '页面上下文捕获'

  // Show preview instead of auto-importing
  preview.value = {
    visible: true,
    items: [{ api, checked: true }],
    moduleName: api.folder || '浏览器捕获',
    moduleId: null,
    source: pending.request?.url ? 'browser-capture' : 'context-capture',
    sourceLabel,
    exportConfig: null,
    payload: null,
    pendingImport: pending,
    phase: 'preview',
    progressCurrent: 0,
    progressTotal: 0,
    errorMessage: '',
  }
}

async function checkPendingImport(): Promise<void> {
  const runtime = typeof chrome !== 'undefined' ? (chrome.runtime as any) : null
  if (!runtime?.sendMessage) return

  await new Promise<void>((resolve) => {
    runtime.sendMessage({ type: 'GET_PENDING_IMPORT' }, (response: any) => {
      consumePendingImport(response?.success ? response.data : null).finally(resolve)
    })
  })
}

function handleRuntimeMessage(message: any) {
  if (message?.type === 'PENDING_IMPORT_UPDATED') {
    consumePendingImport(message.data)
  }
}

function handleHashChange() {
  void checkShareHash()
}

onMounted(() => {
  checkPendingImport()
  checkShareHash()
  window.addEventListener('hashchange', handleHashChange)
  const runtime = typeof chrome !== 'undefined' ? (chrome.runtime as any) : null
  runtime?.onMessage?.addListener(handleRuntimeMessage)
})

onUnmounted(() => {
  window.removeEventListener('hashchange', handleHashChange)
  const runtime = typeof chrome !== 'undefined' ? (chrome.runtime as any) : null
  runtime?.onMessage?.removeListener(handleRuntimeMessage)
})
</script>

<template>
  <!-- Simple toast for non-preview messages -->
  <div v-if="toast" class="pending-import-toast">{{ toast }}</div>

  <!-- Import preview modal -->
  <Teleport to="body">
    <div v-if="preview.visible" class="import-preview-overlay" @click.self="cancelImport">
      <div class="import-preview-modal">
        <!-- Header -->
        <div class="import-preview-header">
          <h3 class="import-preview-title">导入预览</h3>
          <button class="import-preview-close" @click="cancelImport" aria-label="关闭"><X :size="16" /></button>
        </div>

        <!-- Preview phase -->
        <template v-if="preview.phase === 'preview'">
          <!-- Source info -->
          <div class="import-preview-info">
            <div class="import-info-row">
              <span class="import-info-label">来源</span>
              <span class="import-info-value">{{ preview.sourceLabel }}</span>
            </div>
            <div class="import-info-row">
              <span class="import-info-label">目标模块</span>
              <span class="import-info-value">{{ preview.moduleName }}</span>
            </div>
            <div class="import-info-row">
              <span class="import-info-label">接口数量</span>
              <span class="import-info-value">{{ preview.items.length }} 个</span>
            </div>
          </div>

          <!-- API list with checkboxes -->
          <div class="import-preview-list">
            <div class="import-list-header">
              <label class="import-check-all" @click.prevent="toggleAll">
                <span class="import-checkbox" :class="{ checked: allChecked }">
                  <Check v-if="allChecked" :size="12" />
                </span>
                <span>全选 ({{ checkedCount }}/{{ preview.items.length }})</span>
              </label>
            </div>
            <div class="import-list-body">
              <div
                v-for="(item, index) in preview.items"
                :key="item.api.id"
                class="import-list-item"
                :class="{ unchecked: !item.checked }"
                @click="toggleItem(index)"
              >
                <span class="import-checkbox" :class="{ checked: item.checked }">
                  <Check v-if="item.checked" :size="12" />
                </span>
                <span
                  class="import-method-badge"
                  :style="{ backgroundColor: methodColor(item.api.method) }"
                >{{ item.api.method }}</span>
                <span class="import-api-name">{{ item.api.name }}</span>
                <span class="import-api-url" :title="item.api.url">{{ item.api.url }}</span>
              </div>
            </div>
          </div>

          <!-- Actions -->
          <div class="import-preview-actions">
            <button class="import-btn import-btn-cancel" @click="cancelImport">取消</button>
            <button
              class="import-btn import-btn-confirm"
              :disabled="checkedCount === 0"
              @click="confirmImport"
            >确认导入 ({{ checkedCount }})</button>
          </div>
        </template>

        <!-- Importing phase -->
        <template v-else-if="preview.phase === 'importing'">
          <div class="import-progress-container">
            <div class="import-progress-spinner"></div>
            <div class="import-progress-text">
              导入中... ({{ preview.progressCurrent }}/{{ preview.progressTotal }})
            </div>
            <div class="import-progress-bar">
              <div
                class="import-progress-bar-fill"
                :style="{ width: preview.progressTotal > 0 ? `${(preview.progressCurrent / preview.progressTotal) * 100}%` : '0%' }"
              ></div>
            </div>
          </div>
        </template>

        <!-- Success phase -->
        <template v-else-if="preview.phase === 'success'">
          <div class="import-result-container">
            <div class="import-result-icon import-result-success">
              <Check :size="24" />
            </div>
            <div class="import-result-text">
              导入成功，共导入 {{ preview.progressTotal }} 个接口
            </div>
          </div>
        </template>

        <!-- Error phase -->
        <template v-else-if="preview.phase === 'error'">
          <div class="import-result-container">
            <div class="import-result-icon import-result-error">
              <XCircle :size="24" />
            </div>
            <div class="import-result-text import-result-error-text">
              导入失败：{{ preview.errorMessage }}
            </div>
            <div class="import-result-actions">
              <button class="import-btn import-btn-cancel" @click="cancelImport">关闭</button>
              <button class="import-btn import-btn-retry" @click="retryImport">重试</button>
            </div>
          </div>
        </template>
      </div>
    </div>
  </Teleport>
</template>

<style scoped>
.pending-import-toast {
  position: fixed;
  right: 18px;
  bottom: 18px;
  z-index: 1200;
  max-width: min(360px, calc(100vw - 36px));
  padding: 10px 12px;
  border: 1px solid var(--border);
  border-radius: var(--radius-xl);
  background: var(--bg-panel);
  color: var(--text-primary);
  box-shadow: var(--shadow-lg);
  font-size: var(--font-size-body);
}

/* --- Overlay --- */
.import-preview-overlay {
  position: fixed;
  inset: 0;
  z-index: 1300;
  display: flex;
  align-items: center;
  justify-content: center;
  background: color-mix(in srgb, var(--bg-panel) 20%, transparent);
  backdrop-filter: blur(4px);
}

/* --- Modal --- */
.import-preview-modal {
  width: min(560px, calc(100vw - 32px));
  max-height: min(640px, calc(100vh - 64px));
  display: flex;
  flex-direction: column;
  border: 1px solid var(--border);
  border-radius: var(--radius-xl);
  background: var(--bg-panel);
  color: var(--text-primary);
  box-shadow: var(--shadow-lg);
  overflow: hidden;
}

/* --- Header --- */
.import-preview-header {
  display: flex;
  align-items: center;
  justify-content: space-between;
  padding: 14px 16px;
  border-bottom: 1px solid var(--divider);
}

.import-preview-title {
  margin: 0;
  font-size: 15px;
  font-weight: 700;
}

.import-preview-close {
  display: flex;
  align-items: center;
  justify-content: center;
  width: 28px;
  height: 28px;
  border: none;
  border-radius: 6px;
  background: transparent;
  color: var(--text-secondary);
  font-size: 18px;
  cursor: pointer;
  transition: background 0.15s;
}

.import-preview-close:hover {
  background: var(--bg-hover);
}

/* --- Info section --- */
.import-preview-info {
  padding: 12px 16px;
  border-bottom: 1px solid var(--divider);
  display: flex;
  flex-direction: column;
  gap: 6px;
}

.import-info-row {
  display: flex;
  align-items: center;
  gap: 8px;
  font-size: 13px;
}

.import-info-label {
  color: var(--text-secondary);
  min-width: 64px;
  flex-shrink: 0;
}

.import-info-value {
  color: var(--text-primary);
  font-weight: 500;
}

/* --- API list --- */
.import-preview-list {
  flex: 1;
  display: flex;
  flex-direction: column;
  min-height: 0;
}

.import-list-header {
  padding: 8px 16px;
  border-bottom: 1px solid var(--divider);
  background: var(--bg-subtle);
}

.import-check-all {
  display: flex;
  align-items: center;
  gap: 8px;
  cursor: pointer;
  font-size: 13px;
  color: var(--text-secondary);
  user-select: none;
}

.import-list-body {
  flex: 1;
  overflow-y: auto;
  max-height: 320px;
}

.import-list-item {
  display: flex;
  align-items: center;
  gap: 8px;
  padding: 8px 16px;
  cursor: pointer;
  transition: background 0.12s;
  font-size: 13px;
}

.import-list-item:hover {
  background: var(--bg-hover);
}

.import-list-item.unchecked {
  opacity: 0.5;
}

/* --- Checkbox --- */
.import-checkbox {
  display: inline-flex;
  align-items: center;
  justify-content: center;
  width: 16px;
  height: 16px;
  border: 1.5px solid var(--border);
  border-radius: 4px;
  flex-shrink: 0;
  transition: all 0.12s;
  color: white;
}

.import-checkbox.checked {
  background: #10b981;
  border-color: #10b981;
}

/* --- Method badge --- */
.import-method-badge {
  display: inline-flex;
  align-items: center;
  justify-content: center;
  min-width: 44px;
  padding: 1px 6px;
  border-radius: 4px;
  color: #fff;
  font-size: 11px;
  font-weight: 700;
  letter-spacing: 0.3px;
  flex-shrink: 0;
}

.import-api-name {
  flex-shrink: 1;
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
  min-width: 80px;
}

.import-api-url {
  flex-shrink: 1;
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
  color: var(--text-secondary);
  font-size: 12px;
}

/* --- Actions --- */
.import-preview-actions {
  display: flex;
  align-items: center;
  justify-content: flex-end;
  gap: 8px;
  padding: 12px 16px;
  border-top: 1px solid var(--divider);
}

.import-btn {
  display: inline-flex;
  align-items: center;
  justify-content: center;
  padding: 7px 16px;
  border: 1px solid var(--border);
  border-radius: 8px;
  font-size: 13px;
  font-weight: 600;
  cursor: pointer;
  transition: all 0.15s;
}

.import-btn-cancel {
  background: transparent;
  color: var(--text-secondary);
}

.import-btn-cancel:hover {
  background: var(--bg-hover);
  color: var(--text-primary);
}

.import-btn-confirm {
  background: #10b981;
  border-color: #10b981;
  color: #fff;
}

.import-btn-confirm:hover:not(:disabled) {
  background: #059669;
}

.import-btn-confirm:disabled {
  opacity: 0.4;
  cursor: not-allowed;
}

.import-btn-retry {
  background: #f59e0b;
  border-color: #f59e0b;
  color: #fff;
}

.import-btn-retry:hover {
  background: #d97706;
}

/* --- Progress --- */
.import-progress-container {
  display: flex;
  flex-direction: column;
  align-items: center;
  gap: 14px;
  padding: 32px 16px;
}

.import-progress-spinner {
  width: 32px;
  height: 32px;
  border: 3px solid var(--border);
  border-top-color: #10b981;
  border-radius: 50%;
  animation: import-spin 0.8s linear infinite;
}

@keyframes import-spin {
  to { transform: rotate(360deg); }
}

.import-progress-text {
  font-size: 14px;
  color: var(--text-secondary);
}

.import-progress-bar {
  width: 100%;
  max-width: 320px;
  height: 6px;
  border-radius: 3px;
  background: var(--border);
  overflow: hidden;
}

.import-progress-bar-fill {
  height: 100%;
  border-radius: 3px;
  background: #10b981;
  transition: width 0.2s ease;
}

/* --- Result --- */
.import-result-container {
  display: flex;
  flex-direction: column;
  align-items: center;
  gap: 12px;
  padding: 32px 16px;
}

.import-result-icon {
  display: flex;
  align-items: center;
  justify-content: center;
  width: 48px;
  height: 48px;
  border-radius: 50%;
}

.import-result-success {
  background: color-mix(in srgb, #10b981 15%, transparent);
  color: #10b981;
}

.import-result-error {
  background: color-mix(in srgb, #ef4444 15%, transparent);
  color: #ef4444;
}

.import-result-text {
  font-size: 14px;
  color: var(--text-primary);
  text-align: center;
}

.import-result-error-text {
  color: #ef4444;
}

.import-result-actions {
  display: flex;
  gap: 8px;
  margin-top: 4px;
}
</style>
