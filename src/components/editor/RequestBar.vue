<script setup lang="ts">
import { ref, computed, watch, onMounted, onUnmounted, nextTick } from 'vue'
import { ChevronDown, Ellipsis, House, Layers, Lock, Save, X } from '@lucide/vue'
import { Tippy } from 'vue-tippy'
import { toast } from 'vue-sonner'
import { useAppStore } from '@/stores/app'
import { useWorkspaceStore } from '@/stores/workspace'
import { useWsStore } from '@/stores/ws'
import { isWebSocketUrl, sendRequest as httpSendRequest } from '@/utils/http'
import { resolveScriptChain, resolveInheritedProperties } from '@/utils/inheritance'
import { responseBodyToBlob, responseContentType, responseFileExtension } from '@/utils/binary-response'
import {
  createDefaultAuthConfig,
  createDefaultBodyConfig,
  executePostResponseScriptAsync,
  executePreRequestScriptAsync,
} from '@/utils/pre-request'
import type { PostResponseData, ScriptResult, ScriptSendRequestInput } from '@/utils/pre-request'
import { generateCurl } from '@/utils/export'
import ExportPanel from '@/components/common/ExportPanel.vue'
import CodeGenPanel from '@/components/common/CodeGenPanel.vue'
import VariableAutocomplete from '@/components/common/VariableAutocomplete.vue'
import { useVariableAutocomplete } from '@/composables/useVariableAutocomplete'
import type { ApiConfig, AuthConfig, BodyConfig, Collection, CollectionNode, CookieItem, Environment, HttpMethod, KvPair, RequestType, ResponseData } from '@/types'

const store = useAppStore()
const workspace = useWorkspaceStore()
const wsStore = useWsStore()
const methods: HttpMethod[] = ['GET', 'POST', 'PUT', 'PATCH', 'DELETE', 'HEAD', 'OPTIONS']

const currentApi = computed(() => store.getCurrentApi())
const currentModule = computed(() => {
  const interfaceNode = workspace.interfaces.find(item => item.apiId === store.currentApiId)
  return interfaceNode ? workspace.modules.find(item => item.id === interfaceNode.moduleId) ?? null : null
})
const currentCategory = computed(() => currentModule.value ? workspace.categories.find(category => category.id === currentModule.value?.categoryId) ?? null : null)
const isReadonlyModule = computed(() => currentModule.value?.type === 'readonly')
const currentMethod = ref<HttpMethod>('GET')
const currentUrl = ref('')
const urlScrollLeft = ref(0)
const showExportPanel = ref(false)
const showCodeGenPanel = ref(false)
const showActionMenu = ref(false)
const actionTippyRef = ref<{ hide: () => void } | null>(null)
function closeActionMenu() {
  showActionMenu.value = false
  actionTippyRef.value?.hide()
}
const showMethodMenu = ref(false)
const showBaseUrlMenu = ref(false)
const customMethodDraft = ref('')
const customMethodInputRef = ref<HTMLInputElement | null>(null)
const postSendAction = ref<null | 'download' | 'codegen'>(null)

const envVars = computed(() => store.getEnvVariables())
const canRetry = computed(() => !store.loading && Boolean(store.response && (store.response.status === 0 || store.response.status >= 400)))
const wsActiveForCurrent = computed(() => wsStore.activeApiId === currentApi.value?.id && wsStore.isBusy)
const sendButtonLabel = computed(() => {
  if (currentRequestType.value === 'ws') return wsActiveForCurrent.value ? '断开' : '连接'
  if (canRetry.value) return '重试'
  return '发送'
})
const baseUrlOptions = computed(() => {
  const keywordPattern = /(base|url|host|origin|endpoint|api)/i
  return Object.entries(envVars.value)
    .filter(([key, value]) => Boolean(key) && (keywordPattern.test(key) || /^https?:\/\//i.test(value)))
    .sort((a, b) => Number(/^https?:\/\//i.test(b[1])) - Number(/^https?:\/\//i.test(a[1])))
    .slice(0, 12)
    .map(([key, value]) => ({
      key,
      template: `{{${key}}}`,
      preview: value,
    }))
})
const highlightedUrlSegments = computed(() => splitUrlForHighlight(currentUrl.value, envVars.value))

// ── Phase 2:当前请求所属集合与它的环境 ──
const currentCollection = computed<Collection | null>(() => {
  const node = workspace.interfaces.find(item => item.apiId === store.currentApiId)
  const cid = node ? (node.collectionId ?? node.moduleId) : null
  return cid ? workspace.collections.find(item => item.id === cid) ?? null : null
})

// ── Phase 1.5:继承标记(集合/文件夹级 Auth/Headers/变量/脚本)──
const inheritedSummary = computed(() => {
  const api = currentApi.value
  const node = api ? workspace.interfaces.find(item => item.apiId === api.id) : null
  const cid = node ? (node.collectionId ?? node.moduleId) : null
  const collection = cid ? workspace.collections.find(item => item.id === cid) : null
  if (!collection || !node) return null
  const inherited = resolveInheritedProperties(collection, workspace.interfaces as CollectionNode[], node.id)
  return {
    collectionName: collection.name,
    auth: inherited.auth.source !== 'none' && inherited.auth.source !== 'node'
      ? `${inherited.auth.sourceName}(${inherited.auth.auth.type})`
      : null,
    headers: inherited.headers.map(h => ({ key: h.key, source: inherited.headerSources[h.key] })),
    variables: inherited.variables.map(v => ({ key: v.key, source: inherited.variableSources[v.key] })),
    preScripts: inherited.preScripts.map(script => script.sourceName),
    postScripts: inherited.postScripts.map(script => script.sourceName),
  }
})

/** 模板渲染用的继承 chips(无任何继承项时为 null) */
interface InheritedChip { key: string; label: string; title: string }
const inheritedChips = computed<{ collectionName: string; chips: InheritedChip[] } | null>(() => {
  const summary = inheritedSummary.value
  if (!summary) return null
  const chips: InheritedChip[] = []
  if (summary.auth && inheritedSummary.value?.auth && !inheritedSummary.value.auth.endsWith('(none)')) {
    chips.push({ key: 'auth', label: `Auth · ${summary.auth}`, title: `Auth 继承自:${summary.auth}` })
  }
  if (summary.headers.length) {
    chips.push({
      key: 'headers',
      label: `Headers ×${summary.headers.length}`,
      title: `${summary.headers.length} 个 Header 继承:\n${summary.headers.map(h => `${h.key} ← ${h.source}`).join('\n')}`,
    })
  }
  if (summary.variables.length) {
    chips.push({
      key: 'variables',
      label: `变量 ×${summary.variables.length}`,
      title: `${summary.variables.length} 个变量继承:\n${summary.variables.map(v => `${v.key} ← ${v.source}`).join('\n')}`,
    })
  }
  if (summary.preScripts.length) {
    chips.push({
      key: 'pre',
      label: `Pre 脚本 ×${summary.preScripts.length}`,
      title: `Pre 脚本执行顺序(集合 → 文件夹):${summary.preScripts.join(' → ')}`,
    })
  }
  if (summary.postScripts.length) {
    chips.push({
      key: 'post',
      label: `Post 脚本 ×${summary.postScripts.length}`,
      title: `Post 脚本执行顺序(文件夹 → 集合):${summary.postScripts.join(' → ')}`,
    })
  }
  return chips.length ? { collectionName: summary.collectionName, chips } : null
})

// ── FR-4:请求类型自动识别 —— ws/wss scheme 即 WS 模式,其余统一走流式 HTTP 管道;
// ApiConfig.requestType 仅保留兼容存量数据,不再作为 UI 分支依据 ──
const currentRequestType = computed<RequestType>(() => isWebSocketUrl(currentUrl.value) ? 'ws' : 'rest')

// (FR-5:流式合并配置已迁入响应卡片 ResponsePanel/StreamMergeConfig)

/** Phase 4.1:解析脚本执行链(集合 → 文件夹根→叶),请求自身脚本始终执行 */
function resolveScriptSegments(api: ApiConfig, event: 'pre' | 'post'): Array<{ sourceName: string; script: string }> {
  const node = workspace.interfaces.find(item => item.apiId === api.id)
  const cid = node ? (node.collectionId ?? node.moduleId) : null
  const collection = cid ? workspace.collections.find(item => item.id === cid) : null
  const chain = collection && node
    ? resolveScriptChain(collection, workspace.interfaces as CollectionNode[], node.id)
    : { preScripts: [], postScripts: [] }
  if (event === 'pre') {
    return [
      ...chain.preScripts.map(seg => ({ sourceName: seg.sourceName, script: seg.script })),
      ...(api.preRequestScript?.trim() ? [{ sourceName: '请求', script: api.preRequestScript }] : []),
    ]
  }
  return [
    ...(api.postRequestScript?.trim() ? [{ sourceName: '请求', script: api.postRequestScript }] : []),
    ...[...chain.postScripts].reverse().map(seg => ({ sourceName: seg.sourceName, script: seg.script })),
  ]
}

const urlInputRef = ref<HTMLInputElement | null>(null)
const urlAutocomplete = useVariableAutocomplete(urlInputRef)

watch(currentApi, (api) => {
  if (api) {
    currentMethod.value = api.method
    currentUrl.value = api.url
  }
}, { immediate: true })

watch([currentMethod, currentUrl], () => {
  if (currentApi.value && !isReadonlyModule.value) {
    store.updateApi(currentApi.value.id, {
      method: currentMethod.value,
      url: currentUrl.value,
    })
  }
})

type UrlHighlightSegment = {
  text: string
  variable?: boolean
  resolved?: boolean
  preview?: string
}

function splitUrlForHighlight(url: string, vars: Record<string, string>): UrlHighlightSegment[] {
  const segments: UrlHighlightSegment[] = []
  const pattern = /\{\{\s*([^}]+?)\s*\}\}/g
  let lastIndex = 0
  let match: RegExpExecArray | null

  while ((match = pattern.exec(url))) {
    if (match.index > lastIndex) segments.push({ text: url.slice(lastIndex, match.index) })
    const expression = match[1]?.trim() || ''
    segments.push({
      text: match[0],
      variable: true,
      resolved: expression.startsWith('$') || Object.prototype.hasOwnProperty.call(vars, expression),
      preview: expression.startsWith('$') ? '动态变量' : vars[expression],
    })
    lastIndex = match.index + match[0].length
  }

  if (lastIndex < url.length) segments.push({ text: url.slice(lastIndex) })
  return segments.length ? segments : [{ text: url }]
}

function syncUrlScroll() {
  urlScrollLeft.value = urlInputRef.value?.scrollLeft ?? 0
}

function handleUrlInput() {
  syncUrlScroll()
  urlAutocomplete.handleInput()
}

function extractUrlSuffix(url: string): string {
  const trimmed = url.trim()
  if (!trimmed) return ''

  const templateMatch = trimmed.match(/^\{\{[^}]+\}\}(.*)$/)
  if (templateMatch) return normalizeUrlSuffix(templateMatch[1] || '')

  if (/^[a-z][a-z\d+.-]*:\/\//i.test(trimmed)) {
    try {
      const parsed = new URL(trimmed)
      const suffix = `${parsed.pathname === '/' ? '' : parsed.pathname}${parsed.search}${parsed.hash}`
      return suffix || ''
    } catch {
      return ''
    }
  }

  if (trimmed.startsWith('/')) return trimmed
  return ''
}

function normalizeUrlSuffix(suffix: string): string {
  const trimmed = suffix.trim()
  if (!trimmed) return ''
  if (trimmed.startsWith('/')) return trimmed
  if (trimmed.startsWith('?') || trimmed.startsWith('#')) return `/${trimmed}`
  return `/${trimmed}`
}

function applyBaseUrlTemplate(key: string) {
  showBaseUrlMenu.value = false
  if (!key || isReadonlyModule.value) return
  const option = baseUrlOptions.value.find(item => item.key === key)
  if (!option) return
  currentUrl.value = `${option.template}${extractUrlSuffix(currentUrl.value)}`
  window.setTimeout(() => urlInputRef.value?.focus(), 0)
}

function methodColor(method: HttpMethod): string {
  const colors: Record<string, string> = {
    GET: 'var(--method-get-color)',
    POST: 'var(--method-post-color)',
    PUT: 'var(--method-put-color)',
    DELETE: 'var(--method-delete-color)',
    PATCH: 'var(--method-patch-color)',
    HEAD: 'var(--method-head-color)',
    OPTIONS: 'var(--method-options-color)',
  }
  return colors[method] || 'var(--method-default-color)'
}

const isCustomMethod = computed(() => !methods.includes(currentMethod.value))

// ── Alt+↑/↓ 循环切换 method(FR-1.1 / FR-8.1;由全局快捷键派发)──
function cycleMethod(direction: 1 | -1) {
  if (isReadonlyModule.value || currentRequestType.value === 'ws') return
  const base = isCustomMethod.value ? -1 : methods.indexOf(currentMethod.value)
  const next = (base + direction + methods.length) % methods.length
  currentMethod.value = methods[next]
}

function onCycleMethodEvent(event: Event) {
  const direction = (event as CustomEvent<{ direction?: 1 | -1 }>).detail?.direction ?? 1
  cycleMethod(direction)
}

/** FR-8.1:Ctrl+I 重置请求(清空响应 + 重置参数) */
function resetRequest() {
  const api = currentApi.value
  if (!api || isReadonlyModule.value) return
  store.response = null
  currentUrl.value = ''
  currentMethod.value = 'GET'
  store.updateApi(api.id, {
    method: 'GET',
    url: '',
    headers: [],
    params: [],
    body: { type: 'none', raw: '', formData: [], urlEncoded: [], binaryFile: null, contentType: '' },
  })
  toast.success('请求已重置')
}

// ── CUSTOM method ──
function pickCustomMethod() {
  customMethodDraft.value = isCustomMethod.value ? currentMethod.value : ''
  showMethodMenu.value = false
  nextTick(() => customMethodInputRef.value?.focus())
}

function commitCustomMethod() {
  const verb = customMethodDraft.value.trim().toUpperCase()
  if (verb) currentMethod.value = verb as HttpMethod
  else if (isCustomMethod.value) currentMethod.value = 'GET'
}

function headerRecordToPairs(headers: Record<string, string>): KvPair[] {
  return Object.entries(headers).map(([key, value]) => ({
    key,
    value,
    enabled: true,
  }))
}

function cloneKvPairs(items: KvPair[] = []): KvPair[] {
  return items.map(item => ({ ...item }))
}

function cloneCookies(items: CookieItem[] = []): CookieItem[] {
  return items.map(item => ({ ...item }))
}

function cloneBody(body?: BodyConfig): BodyConfig {
  if (!body) return createDefaultBodyConfig()
  return {
    ...body,
    formData: cloneKvPairs(body.formData),
    urlEncoded: cloneKvPairs(body.urlEncoded),
  }
}

function inferScriptBodyConfig(baseBody: BodyConfig, rawBody: string, urlencoded: KvPair[], formdata: KvPair[]): BodyConfig {
  if (formdata.some(item => item.enabled !== false && item.key)) {
    return { ...baseBody, type: 'form', raw: '', urlEncoded: [], formData: formdata }
  }
  if (urlencoded.some(item => item.enabled !== false && item.key)) {
    return { ...baseBody, type: 'urlencoded', raw: '', urlEncoded: urlencoded, formData: [] }
  }
  if (rawBody && baseBody.type === 'none') {
    try {
      JSON.parse(rawBody)
      return { ...baseBody, type: 'json', raw: rawBody, urlEncoded: [], formData: [] }
    } catch {
      return { ...baseBody, type: 'raw', raw: rawBody, urlEncoded: [], formData: [], contentType: baseBody.contentType || 'text/plain' }
    }
  }
  return {
    ...baseBody,
    raw: rawBody,
    urlEncoded: urlencoded,
    formData: formdata,
  }
}

function cloneAuth(auth?: AuthConfig): AuthConfig {
  return auth ? { ...auth } : createDefaultAuthConfig()
}

function kvPairsFromEntries(entries: Iterable<[unknown, unknown]>): KvPair[] {
  return Array.from(entries).map(([key, entryValue]) => ({
    key: String(key),
    value: String(entryValue ?? ''),
    enabled: true,
  })).filter(item => item.key)
}

function stringifyBodyInput(value: unknown): string {
  if (value == null) return ''
  if (typeof value === 'string') return value
  if (typeof value === 'number' || typeof value === 'boolean') return String(value)
  try {
    return JSON.stringify(value)
  } catch {
    return String(value)
  }
}

function normalizeKvInput(input: unknown, value?: unknown): KvPair[] {
  if (Array.isArray(input)) return input.flatMap(item => normalizeKvInput(item))
  if (input && typeof input === 'object') {
    const item = input as { key?: unknown; name?: unknown; value?: unknown; disabled?: unknown; description?: unknown }
    if (!('key' in item) && !('name' in item)) {
      const entries = (input as { entries?: unknown }).entries
      if (typeof entries === 'function') return kvPairsFromEntries((entries as () => Iterable<[unknown, unknown]>).call(input))
      return Object.entries(input as Record<string, unknown>).map(([key, entryValue]) => ({
        key,
        value: String(entryValue ?? ''),
        enabled: true,
      })).filter(field => field.key)
    }
    const key = String(item.key ?? item.name ?? '')
    if (!key) return []
    return [{
      key,
      value: String(item.value ?? ''),
      enabled: item.disabled === undefined ? true : !item.disabled,
      description: item.description == null ? undefined : String(item.description),
    }]
  }
  if (typeof input === 'string') return [{ key: input, value: String(value ?? ''), enabled: true }]
  return []
}

function normalizeHeaderInput(input: unknown): KvPair[] {
  if (!input) return []
  if (Array.isArray(input)) return input.flatMap(item => normalizeHeaderInput(item))
  if (typeof input === 'object') {
    const maybeRecord = input as Record<string, unknown>
    if ('key' in maybeRecord || 'name' in maybeRecord) return normalizeKvInput(input)
    return Object.entries(maybeRecord).map(([key, value]) => ({ key, value: String(value ?? ''), enabled: true }))
  }
  return []
}

function upsertPairs(target: KvPair[], source: KvPair[]) {
  for (const item of source) {
    const existing = target.find(pair => pair.key.toLowerCase() === item.key.toLowerCase())
    if (existing) Object.assign(existing, item)
    else target.push({ ...item })
  }
}

function readScriptInput(input?: ScriptSendRequestInput): Record<string, any> {
  if (!input) return {}
  if (typeof input === 'string') return { url: input }
  return input as Record<string, any>
}

function readScriptUrl(inputUrl: unknown, fallback: string): string {
  if (typeof inputUrl === 'string') return inputUrl
  if (inputUrl && typeof inputUrl === 'object') {
    const url = inputUrl as { raw?: unknown; toString?: () => string }
    if (typeof url.raw === 'string') return url.raw
    if (url.toString && url.toString !== Object.prototype.toString) return url.toString()
  }
  return fallback
}

function applyScriptBodyOverride(target: BodyConfig, bodyInput: unknown): BodyConfig {
  if (bodyInput == null) return target
  if (typeof bodyInput === 'string') {
    return { ...target, type: 'raw', raw: bodyInput, contentType: target.contentType || 'text/plain' }
  }
  if (typeof bodyInput !== 'object') {
    return { ...target, type: 'raw', raw: String(bodyInput), contentType: target.contentType || 'text/plain' }
  }

  const body = bodyInput as Record<string, any>
  const mode = String(body.mode ?? body.type ?? '').toLowerCase()
  const entries = (bodyInput as { entries?: unknown }).entries
  if (typeof entries === 'function') {
    const pairs = kvPairsFromEntries((entries as () => Iterable<[unknown, unknown]>).call(bodyInput))
    const ctorName = (bodyInput as { constructor?: { name?: string } }).constructor?.name?.toLowerCase() ?? ''
    return ctorName.includes('urlsearchparams')
      ? { ...target, type: 'urlencoded', raw: '', urlEncoded: pairs, formData: [] }
      : { ...target, type: 'form', raw: '', urlEncoded: [], formData: pairs }
  }
  if (mode === 'raw' || 'raw' in body) {
    return { ...target, type: body.contentType === 'application/json' ? 'json' : 'raw', raw: stringifyBodyInput(body.raw ?? body.content ?? ''), urlEncoded: [], formData: [], contentType: String(body.contentType ?? target.contentType ?? 'text/plain') }
  }
  if (mode === 'json') {
    return { ...target, type: 'json', raw: stringifyBodyInput('content' in body ? body.content : bodyInput), urlEncoded: [], formData: [], contentType: 'application/json' }
  }
  if (mode === 'urlencoded' || mode === 'x-www-form-urlencoded') {
    return { ...target, type: 'urlencoded', raw: '', urlEncoded: normalizeKvInput(body.urlencoded ?? body.urlencodedData ?? body.data ?? body.content ?? []), formData: [] }
  }
  if (mode === 'formdata' || mode === 'form') {
    return { ...target, type: 'form', raw: '', urlEncoded: [], formData: normalizeKvInput(body.formdata ?? body.formData ?? body.data ?? body.content ?? []) }
  }
  if (mode === 'none') return { ...target, type: 'none', raw: '', urlEncoded: [], formData: [] }
  return { ...target, type: 'json', raw: JSON.stringify(bodyInput), contentType: 'application/json' }
}

function normalizeMethod(method: unknown, fallback: HttpMethod): HttpMethod {
  const upper = String(method ?? fallback).toUpperCase()
  return methods.includes(upper as HttpMethod) ? upper as HttpMethod : fallback
}

function mergeEnvKeys(env: Environment, keys: string[], source: Record<string, string>) {
  for (const key of keys) {
    const index = env.variables.findIndex(item => item.key === key)
    const nextValue = source[key]
    if (nextValue === undefined) {
      if (index >= 0) env.variables.splice(index, 1)
      continue
    }
    if (index >= 0) {
      env.variables[index] = { ...env.variables[index], value: nextValue, enabled: true }
    } else {
      env.variables.push({ key, value: nextValue, enabled: true })
    }
  }
}

/**
 * Phase 2.3 + 4.2:脚本变量按 scope 写回。
 * pm.environment → 当前集合所选环境(无则全局);pm.collectionVariables → 集合变量;pm.globals → 全局环境。
 */
async function persistScriptEnvChanges(result: ScriptResult, collection: Collection | null) {
  const envChanged = result.envChangedKeys ?? []
  const globalChanged = result.changedGlobalKeys ?? []
  if (envChanged.length > 0 || globalChanged.length > 0) {
    const targetEnv = (collection?.selectedEnvId
      ? store.environments.find(item => item.id === collection.selectedEnvId)
      : null)
      ?? store.environments.find(item => store.isGlobalEnv(item) && item.id === store.currentEnvId)
      ?? store.environments.find(item => store.isGlobalEnv(item))
    if (targetEnv) {
      const env: Environment = { ...targetEnv, variables: targetEnv.variables.map(item => ({ ...item })) }
      mergeEnvKeys(env, [...envChanged, ...globalChanged], { ...result.envVars, ...(result.globalVars ?? {}) })
      await store.upsertEnvironment(env)
    }
  }

  const collectionChanged = result.changedCollectionKeys ?? []
  if (collection && collectionChanged.length > 0) {
    const merged = collection.variables.map(item => ({ ...item }))
    for (const key of collectionChanged) {
      const nextValue = result.collectionVars?.[key]
      const index = merged.findIndex(item => item.key === key)
      if (nextValue === undefined) {
        if (index >= 0) merged.splice(index, 1)
        continue
      }
      if (index >= 0) merged[index] = { ...merged[index], currentValue: nextValue, enabled: true }
      else merged.push({ key, initialValue: nextValue, currentValue: nextValue, secret: false, enabled: true })
    }
    await workspace.updateCollectionSettings(collection.id, { variables: merged })
  }
}

function collectScriptArtifacts(result: ScriptResult) {
  if (result.visualizations?.length) {
    store.scriptVisualizations.push(...result.visualizations)
  }
  if (result.tests?.length) {
    store.scriptTests.push(...result.tests)
  }
}

function buildScriptInfo(api: ApiConfig, eventName: 'prerequest' | 'test', interfaceName = api.name) {
  return {
    moduleName: currentModule.value?.name || '',
    categoryName: currentCategory.value?.name || '',
    interfaceName,
    eventName,
  }
}

async function sendScriptHttpRequest(input?: ScriptSendRequestInput, baseApi?: ApiConfig): Promise<ResponseData> {
  const request = readScriptInput(input)
  const headers = baseApi ? cloneKvPairs(baseApi.headers) : []
  upsertPairs(headers, normalizeHeaderInput(request.header))
  upsertPairs(headers, normalizeHeaderInput(request.headers))

  const params = baseApi ? cloneKvPairs(baseApi.params) : []
  upsertPairs(params, normalizeKvInput(request.params))
  if (request.url && typeof request.url === 'object') {
    upsertPairs(params, normalizeKvInput((request.url as Record<string, unknown>).query))
  }

  const cookies = baseApi ? cloneCookies(baseApi.cookies) : []
  upsertPairs(cookies, normalizeKvInput(request.cookie) as CookieItem[])
  upsertPairs(cookies, normalizeKvInput(request.cookies) as CookieItem[])

  const body = applyScriptBodyOverride(cloneBody(baseApi?.body), request.body)
  const auth = { ...cloneAuth(baseApi?.auth), ...(request.auth && typeof request.auth === 'object' ? request.auth : {}) }

  return httpSendRequest({
    method: normalizeMethod(request.method, baseApi?.method ?? 'GET'),
    url: readScriptUrl(request.url, baseApi?.url ?? ''),
    headers,
    params,
    cookies,
    autoCarryCookies: store.autoCarryCookies,
    body,
    auth,
    corsMode: store.settings.corsMode,
    proxyUrl: store.settings.proxyUrl,
    envVars: store.getEnvVariables(),
    timeoutMs: typeof request.timeout === 'number' && request.timeout > 0 ? request.timeout : undefined,
    followRedirects: typeof request.followRedirects === 'boolean' ? request.followRedirects : undefined,
  })
}

async function sendScriptInterface(interfaceOrApiId: string, overrides?: ScriptSendRequestInput): Promise<ResponseData> {
  const node = workspace.interfaces.find(item => item.id === interfaceOrApiId || item.apiId === interfaceOrApiId || item.name === interfaceOrApiId)
  const api = node?.apiId ? store.apis[node.apiId] : store.apis[interfaceOrApiId]
  if (!api) throw new Error(`未找到接口：${interfaceOrApiId}`)
  return sendScriptHttpRequest(overrides ?? { url: api.url, method: api.method }, api)
}

async function send() {
  if (!currentUrl.value.trim()) return
  if (!currentApi.value) return
  // FR-4:WS 模式(ws/wss scheme)不走 HTTP 发送链,由 ws store 管理连接(发送框在 WsPanel)
  if (currentRequestType.value === 'ws') {
    wsStore.toggleConnect(currentApi.value)
    return
  }

  // Create AbortController for cancellation support
  const abortController = new AbortController()
  store.setRequestAbortController(abortController)

  store.loading = true
  store.response = null
  store.scriptLogs = []
  store.scriptVisualizations = []
  store.scriptTests = []

  const allLogs: import('@/utils/pre-request').ScriptLog[] = []

  try {
    const api = currentApi.value
    const envVars = store.getEnvVariables()
    const collection = currentCollection.value

    // Phase 1.2 + 4.4:继承 Auth/Headers 在发送时落地;请求自身显式配置优先级最高
    const apiNode = workspace.interfaces.find(item => item.apiId === api.id)
    const inheritedProps = collection && apiNode
      ? resolveInheritedProperties(collection, workspace.interfaces as CollectionNode[], apiNode.id)
      : null
    const effectiveAuth = api.auth?.type === 'inherit'
      ? (inheritedProps && inheritedProps.auth.source !== 'none'
          ? cloneAuth(inheritedProps.auth.auth)
          : cloneAuth())
      : cloneAuth(api.auth)

    // Execute pre-request script
    let headers: Record<string, string> = {}
    if (inheritedProps) {
      for (const h of inheritedProps.headers) {
        if (h.enabled && h.key) headers[h.key] = h.value
      }
    }
    for (const h of api.headers) {
      if (h.enabled && h.key) headers[h.key] = h.value
    }

    let method = api.method
    let url = api.url
    let body = api.body.raw || ''
    let urlencoded = [...api.body.urlEncoded]
    let formdata = [...api.body.formData]
    let cookies = (api.cookies || []).map(cookie => ({ ...cookie }))
    let effectiveEnvVars = envVars

    // Phase 4.1:Postman 兼容执行链 = 集合 → 文件夹(根→叶) → 请求自身
    const collectionVarStore: Record<string, string> = Object.fromEntries(
      (collection?.variables ?? []).filter(v => v.enabled && v.key).map(v => [v.key, v.currentValue || v.initialValue]),
    )
    const globalEnvForScripts = store.environments.find(item => store.isGlobalEnv(item) && item.id === store.currentEnvId)
      ?? store.environments.find(item => store.isGlobalEnv(item))
    const globalVarStore: Record<string, string> = Object.fromEntries(
      (globalEnvForScripts?.variables ?? []).filter(v => v.enabled && v.key).map(v => [v.key, v.value]),
    )
    let collectionStoreLatest = { ...collectionVarStore }
    let globalStoreLatest = { ...globalVarStore }

    const preSegments = resolveScriptSegments(api, 'pre')
    for (const segment of preSegments) {
      if (!segment.script?.trim()) continue
      const scriptResult = await executePreRequestScriptAsync(
        segment.script,
        headers,
        url,
        body,
        urlencoded,
        formdata,
        effectiveEnvVars,
        {
          requestMethod: method,
          requestCookies: cookies,
          sendRequest: input => sendScriptHttpRequest(input),
          sendInterface: sendScriptInterface,
          info: buildScriptInfo(api, 'prerequest', segment.sourceName === '请求' ? api.name : `${segment.sourceName}`),
          collectionVarStore: collectionStoreLatest,
          globalVarStore: globalStoreLatest,
        },
      )
      method = normalizeMethod(scriptResult.method, method)
      headers = scriptResult.headers
      cookies = scriptResult.cookies
      url = scriptResult.url
      body = scriptResult.body
      urlencoded = scriptResult.urlencoded
      formdata = scriptResult.formdata
      effectiveEnvVars = scriptResult.envVars
      collectionStoreLatest = { ...collectionStoreLatest, ...(scriptResult.collectionVars ?? {}) }
      globalStoreLatest = { ...globalStoreLatest, ...(scriptResult.globalVars ?? {}) }
      if (segment.sourceName !== '请求') {
        allLogs.push({ level: 'info', timestamp: Date.now(), args: [`执行继承前置脚本：${segment.sourceName}`] })
      }
      allLogs.push(...scriptResult.logs)
      collectScriptArtifacts(scriptResult)
      await persistScriptEnvChanges(scriptResult, collection)
      if (scriptResult.skipRequest) {
        store.response = {
          status: 0,
          statusText: 'Pre-request skipped',
          headers: {},
          body: '',
          duration: 0,
          size: 0,
          url,
          method,
          requestHeaders: headers,
          requestBody: body || null,
          timestamp: Date.now(),
        }
        store.scriptLogs = allLogs
        postSendAction.value = null
        return
      }
    }

    const effectiveBody = inferScriptBodyConfig(api.body, body, urlencoded, formdata)

    // Send request with cancellation signal and streaming callback
    const response = await httpSendRequest({
      method,
      url,
      headers: headerRecordToPairs(headers),
      params: api.params,
      cookies,
      autoCarryCookies: store.autoCarryCookies,
      body: effectiveBody,
      auth: effectiveAuth,
      corsMode: store.settings.corsMode,
      proxyUrl: store.settings.proxyUrl,
      envVars: effectiveEnvVars,
      signal: abortController.signal,
      streamMerge: api.streamMerge,
      onStreamingUpdate: (streamingResponse: ResponseData) => {
        store.response = streamingResponse
      },
    })

    store.response = response

    if (postSendAction.value === 'download') {
      downloadResponse(response)
    } else if (postSendAction.value === 'codegen') {
      showCodeGenPanel.value = true
    }
    postSendAction.value = null

    // Phase 4.1:Postman 兼容 Post 脚本链 = 请求自身 → 文件夹(叶→根) → 集合
    const postSegments = resolveScriptSegments(api, 'post')
    for (const segment of postSegments) {
      if (!segment.script?.trim()) continue
      const postData: PostResponseData = {
        status: response.status,
        statusText: response.statusText,
        headers: response.headers,
        body: response.body,
        duration: response.duration,
        responseSize: response.size,
      }
      const postResult = await executePostResponseScriptAsync(
        segment.script,
        postData,
        effectiveEnvVars,
        {
          sendRequest: input => sendScriptHttpRequest(input),
          sendInterface: sendScriptInterface,
          info: buildScriptInfo(api, 'test', segment.sourceName === '请求' ? api.name : segment.sourceName),
          collectionVarStore: collectionStoreLatest,
          globalVarStore: globalStoreLatest,
        },
      )
      collectionStoreLatest = { ...collectionStoreLatest, ...(postResult.collectionVars ?? {}) }
      globalStoreLatest = { ...globalStoreLatest, ...(postResult.globalVars ?? {}) }
      if (segment.sourceName !== '请求') {
        allLogs.push({ level: 'info', timestamp: Date.now(), args: [`执行继承后置脚本：${segment.sourceName}`] })
      }
      allLogs.push(...postResult.logs)
      collectScriptArtifacts(postResult)
      await persistScriptEnvChanges(postResult, collection)
    }

    store.scriptLogs = allLogs

    // Add to history(FR-4:流式标记记录「实际发生了流式」,与声明的请求类型解耦;chunks 不入库)
    const streamExtras = response.chunks?.length
      ? {
          requestType: 'sse' as const,
          streamMerge: api.streamMerge,
          mergedText: response.mergedText || undefined,
          mergedReasoning: response.mergedReasoning || undefined,
          rawPreview: response.body.slice(0, 64 * 1024),
        }
      : {}
    store.addHistory({
      id: Date.now().toString(36) + Math.random().toString(36).slice(2, 8),
      apiId: api.id,
      method,
      url,
      status: response.status,
      statusText: response.statusText,
      duration: response.duration,
      timestamp: Date.now(),
      requestHeaders: response.requestHeaders,
      requestBody: response.requestBody,
      responseSize: response.size,
      starred: false,
      ...streamExtras,
    })
  } catch (err: any) {
    store.response = {
      status: 0,
      statusText: err.message || 'Unknown Error',
      headers: {},
      body: '',
      duration: 0,
      size: 0,
      url: currentUrl.value,
      method: currentMethod.value,
      requestHeaders: {},
      requestBody: null,
      timestamp: Date.now(),
    }
    store.scriptLogs = allLogs
    postSendAction.value = null
  } finally {
    store.loading = false
    store.clearRequestAbortController()
  }
}

function openExport() {
  closeActionMenu()
  showExportPanel.value = true
}

function openCodeGen() {
  closeActionMenu()
  showCodeGenPanel.value = true
}

/** FR-2.5:保存按钮 → Save 弹窗(已保存请求静默落库并熄灭未保存圆点) */
function saveCurrentApi() {
  if (!currentApi.value || isReadonlyModule.value) return
  window.dispatchEvent(new CustomEvent('apifix:save-request'))
}

function copyAsCurl() {
  const api = currentApi.value
  if (!api) return
  void navigator.clipboard.writeText(generateCurl(api, store.getEnvVariables()))
  closeActionMenu()
  toast.success('已复制 cURL')
}

function downloadResponse(response: ResponseData) {
  const contentType = responseContentType(response)
  const extension = responseFileExtension(contentType)
  const blob = responseBodyToBlob(response)
  const url = URL.createObjectURL(blob)
  const a = document.createElement('a')
  a.href = url
  a.download = `response-${new Date(response.timestamp).toISOString().replace(/[:.]/g, '-')}.${extension}`
  a.click()
  URL.revokeObjectURL(url)
}

async function sendAndThen(action: 'download' | 'codegen') {
  closeActionMenu()
  postSendAction.value = action
  await send()
}

function closeMenus() {
  showActionMenu.value = false
  showMethodMenu.value = false
  showBaseUrlMenu.value = false
}

function handleGlobalSend() {
  // FR-8.1:Ctrl+Enter 发送/取消 —— 发送中再按一次取消
  if (store.loading) {
    store.cancelCurrentRequest()
    return
  }
  if (currentUrl.value.trim()) {
    send()
  }
}

function handleGlobalOpenCodeGen() {
  if (currentApi.value) openCodeGen()
}

onMounted(() => {
  window.addEventListener('apifix:send-current-request', handleGlobalSend)
  window.addEventListener('apifix:open-codegen', handleGlobalOpenCodeGen)
  window.addEventListener('apifix:cycle-method', onCycleMethodEvent)
  window.addEventListener('apifix:reset-request', resetRequest)
})
onUnmounted(() => {
  window.removeEventListener('apifix:send-current-request', handleGlobalSend)
  window.removeEventListener('apifix:open-codegen', handleGlobalOpenCodeGen)
  window.removeEventListener('apifix:cycle-method', onCycleMethodEvent)
  window.removeEventListener('apifix:reset-request', resetRequest)
})
</script>

<template>
  <div class="request-bar-area">
    <!-- 请求名 + 继承标记 -->
    <div class="request-meta-row">
      <span class="request-name-dot" :style="{ backgroundColor: methodColor(currentMethod) }"></span>
      <span class="request-name" :title="currentApi?.name">{{ currentApi?.name || '未命名请求' }}</span>
      <template v-if="inheritedChips">
        <span class="inherit-chip base"><Layers :size="11" />{{ inheritedChips.collectionName }}</span>
        <span
          v-for="chip in inheritedChips.chips"
          :key="chip.key"
          class="inherit-chip"
          :title="chip.title"
        >{{ chip.label }}</span>
      </template>
    </div>

    <!-- 请求行(FR-1.1;FR-4:无类型切换,ws/wss scheme 自动进入 WS 模式) -->
    <div class="request-line" @click="closeMenus">
      <!-- method 彩色下拉(含 CUSTOM;WS 模式无 method) -->
      <div v-if="currentRequestType !== 'ws'" class="method-picker relative">
        <button
          type="button"
          class="method-btn"
          :style="{ color: methodColor(currentMethod) }"
          :disabled="isReadonlyModule"
          aria-haspopup="listbox"
          :aria-expanded="showMethodMenu"
          @click.stop="showMethodMenu = !showMethodMenu"
        >
          <span>{{ isCustomMethod ? currentMethod : currentMethod }}</span>
          <ChevronDown :size="13" class="opacity-60" />
        </button>
        <div v-if="showMethodMenu" class="method-menu" role="listbox">
          <button
            v-for="m in methods"
            :key="m"
            type="button"
            class="method-option"
            :class="{ active: m === currentMethod }"
            role="option"
            :aria-selected="m === currentMethod"
            @click.stop="currentMethod = m; showMethodMenu = false"
          >
            <strong :style="{ color: methodColor(m) }">{{ m }}</strong>
          </button>
          <div class="method-menu-divider"></div>
          <button
            type="button"
            class="method-option"
            :class="{ active: isCustomMethod }"
            role="option"
            :aria-selected="isCustomMethod"
            @click.stop="pickCustomMethod"
          >
            <strong class="text-[color:var(--method-default-color)]">CUSTOM</strong>
          </button>
          <div v-if="isCustomMethod" class="p-2">
            <input
              ref="customMethodInputRef"
              v-model="customMethodDraft"
              type="text"
              class="custom-method-input"
              placeholder="自定义动词,如 PURGE"
              maxlength="12"
              @keydown.enter.stop="commitCustomMethod(); showMethodMenu = false"
              @blur="commitCustomMethod"
              @click.stop
            />
          </div>
        </div>
      </div>

      <!-- URL 输入(环境变量高亮 + 自动补全) -->
      <div class="url-field">
        <div class="url-input-wrap">
          <div
            class="url-highlight-layer"
            aria-hidden="true"
            :style="{ transform: `translateX(-${urlScrollLeft}px)` }"
          >
            <span
              v-for="(segment, index) in highlightedUrlSegments"
              :key="`${index}-${segment.text}`"
              :class="{ 'url-var-token': segment.variable, unresolved: segment.variable && !segment.resolved }"
              :title="segment.variable ? (segment.resolved ? segment.preview : '未定义变量') : undefined"
            >{{ segment.text }}</span>
          </div>
          <input
            ref="urlInputRef"
            v-model="currentUrl"
            type="url"
            class="url-input"
            placeholder="https://api.example.com/users/{{id}}"
            spellcheck="false"
            @keydown.enter="send"
            @input="handleUrlInput"
            @scroll="syncUrlScroll"
            :disabled="isReadonlyModule"
          />
        </div>
        <div v-if="baseUrlOptions.length" class="base-url-picker">
          <button
            type="button"
            class="base-url-btn"
            title="选择基础地址变量并保留当前路径"
            :disabled="isReadonlyModule"
            aria-haspopup="listbox"
            :aria-expanded="showBaseUrlMenu"
            @click.stop="showBaseUrlMenu = !showBaseUrlMenu"
          >
            <House :size="13" />
            <ChevronDown :size="11" class="opacity-60" />
          </button>
          <div v-if="showBaseUrlMenu" class="base-url-menu" role="listbox">
            <button
              v-for="item in baseUrlOptions"
              :key="item.key"
              type="button"
              class="base-url-option"
              role="option"
              :title="item.preview"
              @click.stop="applyBaseUrlTemplate(item.key)"
            >
              <span class="base-url-key">{{ item.key }}</span>
              <span class="base-url-preview">{{ item.preview }}</span>
            </button>
          </div>
        </div>
      </div>

      <!-- 发送 / 取消 -->
      <button
        v-if="!store.loading"
        class="send-btn"
        :class="{ retry: canRetry && currentRequestType !== 'ws' }"
        :disabled="!currentUrl.trim()"
        :title="currentRequestType === 'ws' ? '连接 / 断开 WebSocket' : '发送(Ctrl+Enter)'"
        @click="send"
      >
        {{ sendButtonLabel }}
      </button>
      <button v-else class="send-btn cancel" @click="store.cancelCurrentRequest()">
        <X :size="14" /> 取消
      </button>

      <!-- 保存 -->
      <button
        class="save-btn"
        :disabled="isReadonlyModule || !currentApi"
        title="保存(Ctrl+S)"
        @click="saveCurrentApi"
      >
        <Save :size="14" />
      </button>

      <!-- 更多操作 -->
      <Tippy ref="actionTippyRef" interactive trigger="click" theme="popover" placement="bottom-end" :offset="[0, 4]">
        <button class="action-btn" title="更多操作"><Ellipsis :size="16" /></button>
        <template #content>
          <div class="flex w-44 flex-col">
            <button class="menu-item" @click="closeActionMenu(); sendAndThen('download')">发送并下载响应</button>
            <button class="menu-item" @click="closeActionMenu(); sendAndThen('codegen')">发送后生成代码</button>
            <button class="menu-item" @click="copyAsCurl">复制为 cURL</button>
            <button class="menu-item" @click="openCodeGen">生成代码</button>
            <button class="menu-item" @click="openExport">导出请求</button>
          </div>
        </template>
      </Tippy>
    </div>

    <div v-if="isReadonlyModule" class="readonly-hint"><Lock :size="13" /> 当前集合为只读模式:可发送请求,但接口定义只能通过导入/同步更新。</div>
  </div>

  <ExportPanel
    :visible="showExportPanel"
    :api="currentApi"
    :env-vars="envVars"
    @close="showExportPanel = false"
  />

  <CodeGenPanel
    :visible="showCodeGenPanel"
    :api="currentApi"
    :env-vars="envVars"
    @close="showCodeGenPanel = false"
  />

  <VariableAutocomplete
    :visible="urlAutocomplete.showAutocomplete.value"
    :position="urlAutocomplete.autocompletePosition.value"
    :filter="urlAutocomplete.autocompleteFilter.value"
    :items="urlAutocomplete.allItems.value"
    @select="urlAutocomplete.insertVariable"
    @close="urlAutocomplete.close"
  />
</template>

<style scoped>
.request-bar-area {
  padding: 8px 12px 10px;
  border-bottom: 1px solid var(--divider-color);
  background: var(--primary-light-color);
}

.request-meta-row {
  display: flex;
  align-items: center;
  gap: 6px;
  margin-bottom: 8px;
  font-size: var(--font-size-body);
  font-weight: 600;
  color: var(--secondary-dark-color);
  min-height: 18px;
}

.request-name {
  max-width: 320px;
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
}

.request-name-dot {
  width: 8px;
  height: 8px;
  border-radius: 50%;
  flex-shrink: 0;
}

.inherit-chip {
  display: inline-flex;
  align-items: center;
  gap: 3px;
  max-width: 200px;
  padding: 1px 7px;
  border: 1px solid var(--divider-dark-color);
  border-radius: 999px;
  color: var(--secondary-color);
  font-size: var(--font-size-tiny);
  font-weight: 500;
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
}

.inherit-chip.base {
  border-color: color-mix(in srgb, var(--accent-color) 40%, var(--divider-dark-color));
  color: var(--accent-color);
}

.request-line {
  display: flex;
  align-items: center;
  gap: 0;
}

/* method 下拉:与 URL 输入方角拼接 */
.method-picker {
  flex-shrink: 0;
}

.method-btn {
  display: inline-flex;
  align-items: center;
  gap: 5px;
  height: 34px;
  padding: 0 8px 0 10px;
  border: 1px solid var(--divider-dark-color);
  border-right: none;
  border-radius: 0;
  background: var(--primary-light-color);
  font-weight: 700;
  font-size: var(--font-size-body);
  font-family: var(--font-code);
  white-space: nowrap;
  transition: background 0.12s ease;
}

.method-btn:hover:not(:disabled) {
  background: var(--primary-dark-color);
}

.method-btn:disabled {
  cursor: not-allowed;
  opacity: 0.6;
}

.method-menu {
  position: absolute;
  top: calc(100% + 4px);
  left: 0;
  z-index: 110;
  min-width: 132px;
  padding: 4px;
  border: 1px solid var(--divider-dark-color);
  border-radius: var(--radius-md);
  background: var(--popover-color);
  box-shadow: var(--shadow-lg);
}

.method-option {
  display: flex;
  align-items: center;
  width: 100%;
  padding: 6px 9px;
  border-radius: var(--radius-sm);
  background: transparent;
  color: var(--secondary-dark-color);
  cursor: pointer;
  text-align: left;
  font-size: var(--font-size-body);
}

.method-option:hover,
.method-option.active {
  background: var(--primary-dark-color);
}

.method-menu-divider {
  height: 1px;
  margin: 4px 6px;
  background: var(--divider-color);
}

.custom-method-input {
  width: 100%;
  height: 26px;
  padding: 0 7px;
  font-family: var(--font-code);
  font-size: var(--font-size-tiny);
  text-transform: uppercase;
}

/* URL 输入框 */
.url-field {
  flex: 1;
  min-width: 0;
  display: flex;
  align-items: center;
  height: 34px;
  border: 1px solid var(--divider-dark-color);
  background: var(--primary-color);
  transition: border-color 0.12s ease;
}

.url-field:focus-within {
  border-color: var(--accent-color);
}

.url-input-wrap {
  position: relative;
  flex: 1;
  min-width: 0;
  height: 32px;
  overflow: hidden;
}

.url-highlight-layer,
.url-input {
  position: absolute;
  inset: 0;
  width: 100%;
  height: 32px;
  padding: 0 10px;
  font-size: var(--font-size-body);
  font-family: var(--font-code);
  line-height: 32px;
  white-space: pre;
}

.url-highlight-layer {
  pointer-events: none;
  color: var(--secondary-dark-color);
}

.url-input {
  border: none;
  background: transparent;
  color: transparent;
  caret-color: var(--secondary-dark-color);
}

.url-input:disabled {
  cursor: not-allowed;
}

.url-input::placeholder {
  color: var(--secondary-light-color);
}

.url-var-token {
  color: var(--accent-color);
  border-bottom: 1px dashed var(--accent-color);
  font-weight: 700;
}

.url-var-token.unresolved {
  color: var(--status-critical-error-color);
  border-bottom-color: var(--status-critical-error-color);
}

.base-url-picker {
  position: relative;
  flex-shrink: 0;
}

.base-url-btn {
  display: flex;
  align-items: center;
  gap: 3px;
  height: 26px;
  margin-right: 4px;
  padding: 0 6px;
  border: 1px solid var(--divider-dark-color);
  border-radius: var(--radius-sm);
  background-color: var(--primary-light-color);
  color: var(--secondary-color);
  font-size: var(--font-size-tiny);
  outline: none;
  cursor: pointer;
}

.base-url-btn:hover:not(:disabled) {
  color: var(--secondary-dark-color);
  border-color: var(--accent-color);
}

.base-url-btn:disabled {
  cursor: not-allowed;
  opacity: 0.6;
}

.base-url-menu {
  position: absolute;
  top: calc(100% + 4px);
  right: 0;
  z-index: 110;
  min-width: 340px;
  max-width: 440px;
  max-height: 260px;
  overflow-y: auto;
  padding: 4px;
  border: 1px solid var(--divider-dark-color);
  border-radius: var(--radius-md);
  background: var(--popover-color);
  box-shadow: var(--shadow-lg);
}

.base-url-option {
  display: flex;
  align-items: center;
  gap: 8px;
  width: 100%;
  padding: 6px 9px;
  border-radius: var(--radius-sm);
  cursor: pointer;
  text-align: left;
  font-size: var(--font-size-body);
}

.base-url-option:hover {
  background: var(--primary-dark-color);
}

.base-url-key {
  font-family: 'SF Mono', 'Fira Code', monospace;
  font-weight: 600;
  color: var(--secondary-dark-color);
  white-space: nowrap;
}

.base-url-preview {
  flex: 1;
  min-width: 0;
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
  color: var(--accent-color);
}

/* 发送 / 保存 */
.send-btn {
  display: inline-flex;
  align-items: center;
  justify-content: center;
  gap: 4px;
  height: 34px;
  min-width: 74px;
  padding: 0 14px;
  border-radius: 0;
  background: var(--accent-color);
  color: var(--accent-contrast-color);
  font-size: var(--font-size-body);
  font-weight: 600;
  transition: background 0.12s ease;
}

.send-btn:hover:not(:disabled) {
  background: var(--accent-dark-color);
}

.send-btn:disabled {
  opacity: 0.45;
  cursor: not-allowed;
}

.send-btn.retry {
  background: var(--status-redirect-color);
}

.send-btn.cancel {
  background: var(--status-critical-error-color);
}

.save-btn {
  display: inline-flex;
  align-items: center;
  justify-content: center;
  width: 38px;
  height: 34px;
  border: 1px solid var(--divider-dark-color);
  border-left: none;
  border-radius: 0 var(--radius-md) var(--radius-md) 0;
  background: var(--primary-light-color);
  color: var(--secondary-color);
  transition: background 0.12s ease, color 0.12s ease;
}

.save-btn:hover:not(:disabled) {
  background: var(--primary-dark-color);
  color: var(--secondary-dark-color);
}

.save-btn:disabled {
  opacity: 0.45;
  cursor: not-allowed;
}

.action-btn {
  display: inline-flex;
  align-items: center;
  justify-content: center;
  width: 30px;
  height: 34px;
  margin-left: 2px;
  border-radius: var(--radius-md);
  color: var(--secondary-color);
}

.action-btn:hover {
  background: var(--primary-dark-color);
  color: var(--secondary-dark-color);
}

.readonly-hint {
  display: flex;
  align-items: center;
  gap: 6px;
  margin-top: 8px;
  color: var(--secondary-color);
  font-size: var(--font-size-tiny);
}

.menu-item {
  display: flex;
  align-items: center;
  gap: 8px;
  width: 100%;
  padding: 7px 12px;
  border-radius: var(--radius-sm);
  font-size: var(--font-size-body);
  color: var(--secondary-dark-color);
  text-align: left;
}

.menu-item:hover {
  background: var(--primary-dark-color);
}
</style>
