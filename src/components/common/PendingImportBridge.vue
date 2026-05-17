<script setup lang="ts">
import { onMounted, onUnmounted, ref } from 'vue'
import { useAppStore } from '@/stores/app'
import { useWorkspaceStore } from '@/stores/workspace'
import { importOpenApiSpec } from '@/utils/openapi-import'
import type { ApiConfig, BodyConfig, HttpMethod, KvPair, ModuleExportConfig } from '@/types'

const store = useAppStore()
const workspace = useWorkspaceStore()
const toast = ref('')
const processedIds = new Set<string>()
const SHARE_HASH_PREFIX = 'apifix-share='

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
    auth: partial.auth || {
      type: 'none',
      bearerToken: '',
      basicUsername: '',
      basicPassword: '',
      apiKeyName: '',
      apiKeyValue: '',
      apiKeyIn: 'header',
    },
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
  if (exportConfig) {
    await workspace.updateModule(module.id, {
      exportConfig: { ...(module.exportConfig ?? {}), ...exportConfig },
      type: exportConfig.teamRole === 'viewer' ? 'readonly' : module.type,
      description: module.description || `由 ApiFix 分享链接导入，权限角色：${exportConfig.teamRole}`,
    })
  }
  for (const api of apis) {
    await store.addApi({ ...api, folder: api.folder || moduleName }, module.id)
  }
  const firstApi = apis[0]
  const interfaceNode = workspace.interfaces.find(item => item.apiId === firstApi.id)
  workspace.selectInterface(interfaceNode?.id ?? firstApi.id)
  store.currentApiId = firstApi.id
  toast.value = `已导入分享模块：${moduleName}（${apis.length} 个接口）`
  setTimeout(() => { toast.value = '' }, 2600)
  clearShareHash()
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

  const module = await workspace.ensureModuleForLegacyGroup(api.folder || '浏览器捕获')
  await store.addApi(api, module.id)
  const interfaceNode = workspace.interfaces.find(item => item.apiId === api.id)
  workspace.selectInterface(interfaceNode?.id ?? api.id)
  store.currentApiId = api.id
  toast.value = `已导入：${api.name}`
  setTimeout(() => { toast.value = '' }, 2200)
  await clearPendingImport()
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
  runtime?.onMessage?.addListener?.(handleRuntimeMessage)
})

onUnmounted(() => {
  window.removeEventListener('hashchange', handleHashChange)
  const runtime = typeof chrome !== 'undefined' ? (chrome.runtime as any) : null
  runtime?.onMessage?.removeListener?.(handleRuntimeMessage)
})
</script>

<template>
  <div v-if="toast" class="pending-import-toast">{{ toast }}</div>
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
</style>
