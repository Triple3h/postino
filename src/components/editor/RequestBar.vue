<script setup lang="ts">
import { ref, computed, watch, onMounted, onUnmounted } from 'vue'
import { useAppStore } from '@/stores/app'
import { useWorkspaceStore } from '@/stores/workspace'
import { sendRequest as httpSendRequest } from '@/utils/http'
import { responseBodyToBlob, responseContentType, responseFileExtension } from '@/utils/binary-response'
import {
  createDefaultAuthConfig,
  createDefaultBodyConfig,
  executePostResponseScriptAsync,
  executePreRequestScriptAsync,
} from '@/utils/pre-request'
import type { PostResponseData, ScriptResult, ScriptSendRequestInput } from '@/utils/pre-request'
import ExportPanel from '@/components/common/ExportPanel.vue'
import CodeGenPanel from '@/components/common/CodeGenPanel.vue'
import VariableAutocomplete from '@/components/common/VariableAutocomplete.vue'
import { useVariableAutocomplete } from '@/composables/useVariableAutocomplete'
import type { ApiConfig, AuthConfig, BodyConfig, CookieItem, Environment, HttpMethod, KvPair, ResponseData } from '@/types'

const store = useAppStore()
const workspace = useWorkspaceStore()
const methods: HttpMethod[] = ['GET', 'POST', 'PUT', 'DELETE', 'PATCH', 'HEAD', 'OPTIONS']

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
const showMethodMenu = ref(false)
const postSendAction = ref<null | 'download' | 'codegen'>(null)
const showCancelButton = ref(false)
let cancelRevealTimer: ReturnType<typeof setTimeout> | null = null

const envVars = computed(() => store.getEnvVariables())
const canRetry = computed(() => !store.loading && Boolean(store.response && (store.response.status === 0 || store.response.status >= 400)))
const sendButtonLabel = computed(() => {
  if (store.loading) return '发送中'
  return canRetry.value ? '重试' : '发送'
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

function toggleWorkspaceControls() {
  window.dispatchEvent(new CustomEvent('apifix:toggle-workspace-controls'))
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

function applyBaseUrlTemplate(event: Event) {
  const target = event.target as HTMLSelectElement
  const key = target.value
  target.value = ''
  if (!key || isReadonlyModule.value) return
  const option = baseUrlOptions.value.find(item => item.key === key)
  if (!option) return
  currentUrl.value = `${option.template}${extractUrlSuffix(currentUrl.value)}`
  window.setTimeout(() => urlInputRef.value?.focus(), 0)
}

function methodColor(method: HttpMethod): string {
  const colors: Record<string, string> = {
    GET: 'var(--method-get)',
    POST: 'var(--method-post)',
    PUT: 'var(--method-put)',
    DELETE: 'var(--method-delete)',
    PATCH: 'var(--method-patch)',
    HEAD: 'var(--method-head)',
    OPTIONS: 'var(--method-options)',
  }
  return colors[method] || 'var(--text-secondary)'
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

async function persistScriptEnvChanges(result: ScriptResult) {
  const changedKeys = result.envChangedKeys ?? []
  if (changedKeys.length === 0) return

  const currentEnv = store.environments.find(item => item.id === store.currentEnvId)
  const env: Environment = currentEnv
    ? { ...currentEnv, variables: currentEnv.variables.map(item => ({ ...item })) }
    : { id: `env:${Date.now().toString(36)}`, name: '默认环境', variables: [] }

  for (const key of changedKeys) {
    const index = env.variables.findIndex(item => item.key === key)
    const nextValue = result.envVars[key]
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

  await store.upsertEnvironment(env)
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

  // Create AbortController for cancellation support
  const abortController = new AbortController()
  store.setRequestAbortController(abortController)
  showCancelButton.value = false
  if (cancelRevealTimer) clearTimeout(cancelRevealTimer)
  cancelRevealTimer = setTimeout(() => { showCancelButton.value = true }, 1000)

  store.loading = true
  store.response = null
  store.scriptLogs = []
  store.scriptVisualizations = []
  store.scriptTests = []

  const allLogs: import('@/utils/pre-request').ScriptLog[] = []

  try {
    const api = currentApi.value
    const envVars = store.getEnvVariables()

    // Execute pre-request script
    let headers: Record<string, string> = {}
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
        { requestMethod: method, requestCookies: cookies, sendRequest: input => sendScriptHttpRequest(input), sendInterface: sendScriptInterface, info: buildScriptInfo(api, 'prerequest', folder.name) },
      )
      method = normalizeMethod(scriptResult.method, method)
      headers = scriptResult.headers
      cookies = scriptResult.cookies
      url = scriptResult.url
      body = scriptResult.body
      urlencoded = scriptResult.urlencoded
      formdata = scriptResult.formdata
      effectiveEnvVars = scriptResult.envVars
      allLogs.push({ level: 'info', timestamp: Date.now(), args: [`执行文件夹前置脚本：${folder.name}`] })
      allLogs.push(...scriptResult.logs)
      collectScriptArtifacts(scriptResult)
      await persistScriptEnvChanges(scriptResult)
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

    if (api.preRequestScript) {
      const scriptResult = await executePreRequestScriptAsync(
        api.preRequestScript,
        headers,
        url,
        body,
        urlencoded,
        formdata,
        effectiveEnvVars,
        { requestMethod: method, requestCookies: cookies, sendRequest: input => sendScriptHttpRequest(input), sendInterface: sendScriptInterface, info: buildScriptInfo(api, 'prerequest') },
      )
      method = normalizeMethod(scriptResult.method, method)
      headers = scriptResult.headers
      cookies = scriptResult.cookies
      url = scriptResult.url
      body = scriptResult.body
      urlencoded = scriptResult.urlencoded
      formdata = scriptResult.formdata
      effectiveEnvVars = scriptResult.envVars
      allLogs.push(...scriptResult.logs)
      collectScriptArtifacts(scriptResult)
      await persistScriptEnvChanges(scriptResult)
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
      auth: api.auth,
      corsMode: store.settings.corsMode,
      proxyUrl: store.settings.proxyUrl,
      envVars: effectiveEnvVars,
      signal: abortController.signal,
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

    // Execute post-response script
    if (api.postRequestScript) {
      const postData: PostResponseData = {
        status: response.status,
        statusText: response.statusText,
        headers: response.headers,
        body: response.body,
        duration: response.duration,
        responseSize: response.size,
      }
      const postResult = await executePostResponseScriptAsync(
        api.postRequestScript,
        postData,
        effectiveEnvVars,
        { sendRequest: input => sendScriptHttpRequest(input), sendInterface: sendScriptInterface, info: buildScriptInfo(api, 'test') },
      )
      allLogs.push(...postResult.logs)
      collectScriptArtifacts(postResult)
      await persistScriptEnvChanges(postResult)
    }

    store.scriptLogs = allLogs

    // Add to history
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
    showCancelButton.value = false
    if (cancelRevealTimer) {
      clearTimeout(cancelRevealTimer)
      cancelRevealTimer = null
    }
    store.clearRequestAbortController()
  }
}

function toggleActionMenu() {
  showMethodMenu.value = false
  showActionMenu.value = !showActionMenu.value
}

function toggleMethodMenu() {
  if (isReadonlyModule.value) return
  showActionMenu.value = false
  showMethodMenu.value = !showMethodMenu.value
}

function selectMethod(method: HttpMethod) {
  if (isReadonlyModule.value) return
  currentMethod.value = method
  showMethodMenu.value = false
}

function openExport() {
  showActionMenu.value = false
  showExportPanel.value = true
}

function openCodeGen() {
  showActionMenu.value = false
  showCodeGenPanel.value = true
}

function saveCurrentApi() {
  if (!currentApi.value || isReadonlyModule.value) return
  store.updateApi(currentApi.value.id, { updatedAt: Date.now() })
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
  showActionMenu.value = false
  postSendAction.value = action
  await send()
}

function closeMenus() {
  showActionMenu.value = false
  showMethodMenu.value = false
}

function handleGlobalSend() {
  if (!store.loading && currentUrl.value.trim()) {
    send()
  }
}

function handleGlobalOpenCodeGen() {
  if (currentApi.value) openCodeGen()
}

onMounted(() => {
  window.addEventListener('apifix:send-current-request', handleGlobalSend)
  window.addEventListener('apifix:open-codegen', handleGlobalOpenCodeGen)
})
onUnmounted(() => {
  window.removeEventListener('apifix:send-current-request', handleGlobalSend)
  window.removeEventListener('apifix:open-codegen', handleGlobalOpenCodeGen)
  if (cancelRevealTimer) clearTimeout(cancelRevealTimer)
})
</script>

<template>
  <div class="request-shell" @click="closeMenus">
    <div class="request-context">
      <span class="request-dot" :style="{ backgroundColor: methodColor(currentMethod) }"></span>
      <span>{{ currentApi?.name || '未命名请求' }}</span>
      <small>Enter 发送 · 支持 &#123;&#123;变量&#125;&#125;</small>
      <div class="request-context-actions" @click.stop>
        <label class="top-env-picker" title="当前环境">
          <span>环境</span>
          <select v-model="store.currentEnvId">
            <option v-if="store.environments.length === 0" :value="null">无环境</option>
            <option v-for="env in store.environments" :key="env.id" :value="env.id">{{ env.name }}</option>
          </select>
        </label>
        <button class="btn btn-sm workspace-toggle-btn" title="打开工具抽屉 / 工作台设置" @click="toggleWorkspaceControls">工具</button>
      </div>
    </div>
    <div class="request-bar">
      <div class="method-picker" @click.stop>
        <button
          type="button"
          class="method-select"
          :class="{ open: showMethodMenu }"
          :style="{ color: methodColor(currentMethod) }"
          :disabled="isReadonlyModule"
          aria-haspopup="listbox"
          :aria-expanded="showMethodMenu"
          @click="toggleMethodMenu"
        >
          <span class="method-option-dot" :style="{ backgroundColor: methodColor(currentMethod) }"></span>
          <span>{{ currentMethod }}</span>
          <span class="method-caret">⌄</span>
        </button>
        <div v-if="showMethodMenu" class="method-dropdown" role="listbox">
          <button
            v-for="m in methods"
            :key="m"
            type="button"
            class="method-option"
            :class="{ active: m === currentMethod }"
            role="option"
            :aria-selected="m === currentMethod"
            @click="selectMethod(m)"
          >
            <span class="method-option-dot" :style="{ backgroundColor: methodColor(m) }"></span>
            <strong :style="{ color: methodColor(m) }">{{ m }}</strong>
          </button>
        </div>
      </div>
      <div class="url-field">
        <span class="url-prefix">URL</span>
        <select
          v-if="baseUrlOptions.length"
          class="base-url-select"
          title="选择基础地址变量并保留当前路径"
          :disabled="isReadonlyModule"
          @change="applyBaseUrlTemplate"
        >
          <option value="">基础地址</option>
          <option v-for="item in baseUrlOptions" :key="item.key" :value="item.key">
            {{ item.key }} · {{ item.preview }}
          </option>
        </select>
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
              :title="segment.variable ? (segment.resolved ? segment.preview : '未定义变量，点击右侧工具抽屉管理') : undefined"
            >{{ segment.text }}</span>
          </div>
          <input
            ref="urlInputRef"
            v-model="currentUrl"
            type="url"
            class="url-input"
            placeholder="https://api.example.com/users/{{id}}"
            @keydown.enter="send"
            @input="handleUrlInput"
            @scroll="syncUrlScroll"
            @keydown="urlAutocomplete.handleKeydown($event) ? null : null"
            :disabled="isReadonlyModule"
          />
        </div>
      </div>
      <button class="btn btn-primary send-btn" :class="{ retry: canRetry }" @click="send" :disabled="store.loading || !currentUrl.trim()">
        <span v-if="store.loading" class="send-spinner"></span>
        {{ sendButtonLabel }}
      </button>
      <button class="btn btn-sm save-request-btn" @click="saveCurrentApi" :disabled="isReadonlyModule || !currentApi" title="Ctrl+S 保存">保存</button>
      <button v-if="store.loading && showCancelButton" class="btn btn-sm cancel-send-btn" @click="store.cancelCurrentRequest()" title="取消请求">取消</button>
      <div class="action-menu-wrapper">
        <button class="btn btn-sm action-btn" @click.stop="toggleActionMenu" title="更多操作">⋯</button>
        <div v-if="showActionMenu" class="action-dropdown" @click.stop>
          <button class="action-item" @click="sendAndThen('download')">发送并下载响应</button>
          <button class="action-item" @click="sendAndThen('codegen')">发送后生成代码</button>
          <button class="action-item" @click="openExport">导出请求</button>
          <button class="action-item" @click="openCodeGen">代码生成</button>
        </div>
      </div>
    </div>
    <div v-if="isReadonlyModule" class="readonly-hint">🔒 当前模块为只读模式：可发送请求，但接口定义只能通过导入/同步更新。</div>
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
.request-shell {
  padding: 12px;
  border-bottom: 1px solid var(--border);
  background:
    linear-gradient(135deg, var(--bg-panel), color-mix(in srgb, var(--primary-light) 30%, var(--bg-panel)));
}

.request-context {
  display: flex;
  align-items: center;
  gap: 7px;
  margin-bottom: 8px;
  color: var(--text-primary);
  font-weight: 700;
}

.request-context-actions {
  display: flex;
  align-items: center;
  gap: 8px;
  margin-left: auto;
}

.top-env-picker {
  display: flex;
  align-items: center;
  gap: 6px;
  color: var(--text-secondary);
  font-size: var(--font-size-small);
  font-weight: 600;
}

.top-env-picker select {
  width: 168px;
  height: 28px;
  padding: 3px 28px 3px 8px;
  border-radius: var(--radius-lg);
  background-color: var(--bg-panel);
  color: var(--text-primary);
  font-size: var(--font-size-small);
}

.workspace-toggle-btn {
  min-height: 28px;
}

.request-context small {
  color: var(--text-tertiary);
  font-weight: 500;
  margin-left: 2px;
}

.request-dot {
  width: 9px;
  height: 9px;
  border-radius: 50%;
  box-shadow: 0 0 0 4px color-mix(in srgb, currentColor 14%, transparent);
}

.request-bar {
  display: flex;
  align-items: center;
  gap: 8px;
}

.method-picker {
  position: relative;
}

.method-select {
  display: inline-flex;
  align-items: center;
  justify-content: space-between;
  gap: 8px;
  height: 38px;
  padding: 0 10px;
  border: 1px solid var(--border);
  border-radius: var(--radius-xl);
  background-color: var(--bg-panel);
  font-weight: 850;
  font-size: var(--font-size-body);
  cursor: pointer;
  min-width: 92px;
  outline: none;
  box-shadow: var(--shadow-sm);
  transition: border-color 0.15s ease, box-shadow 0.15s ease, transform 0.15s ease;
}

.method-select:hover:not(:disabled),
.method-select.open {
  border-color: var(--primary);
  box-shadow: var(--focus-ring);
}

.method-select:disabled {
  cursor: not-allowed;
  opacity: 0.68;
}

.method-caret {
  color: var(--text-tertiary);
  font-size: 12px;
}

.method-dropdown {
  position: absolute;
  top: calc(100% + 4px);
  left: 0;
  z-index: 110;
  min-width: 132px;
  padding: 6px;
  border: 1px solid var(--border);
  border-radius: var(--radius-lg);
  background: var(--bg-panel);
  box-shadow: var(--shadow-lg);
}

.method-option {
  display: flex;
  align-items: center;
  gap: 8px;
  width: 100%;
  padding: 7px 8px;
  border: none;
  border-radius: var(--radius-md);
  background: transparent;
  color: var(--text-primary);
  cursor: pointer;
  text-align: left;
}

.method-option:hover,
.method-option.active {
  background: var(--bg-hover);
}

.method-option-dot {
  width: 8px;
  height: 8px;
  flex: 0 0 8px;
  border-radius: 50%;
  box-shadow: 0 0 0 3px color-mix(in srgb, currentColor 10%, transparent);
}

.url-field {
  flex: 1;
  min-width: 0;
  display: flex;
  align-items: center;
  height: 38px;
  border: 1px solid var(--border);
  border-radius: var(--radius-xl);
  background: var(--bg-panel);
  box-shadow: var(--shadow-sm);
  transition: border-color 0.15s ease, box-shadow 0.15s ease;
}

.url-field:focus-within {
  border-color: var(--primary);
  box-shadow: var(--focus-ring);
}

.url-prefix {
  padding: 0 10px;
  color: var(--text-tertiary);
  font-size: var(--font-size-small);
  font-weight: 800;
  letter-spacing: 0.08em;
  border-right: 1px solid var(--divider);
}

.base-url-select {
  max-width: 168px;
  height: 28px;
  margin-left: 8px;
  padding: 0 24px 0 8px;
  border: 1px solid var(--border);
  border-radius: var(--radius-md);
  background: var(--bg-panel);
  color: var(--text-secondary);
  font-size: var(--font-size-small);
  outline: none;
}

.base-url-select:hover:not(:disabled),
.base-url-select:focus:not(:disabled) {
  border-color: var(--primary);
  color: var(--text-primary);
}

.url-input-wrap {
  position: relative;
  flex: 1;
  min-width: 0;
  height: 36px;
  overflow: hidden;
}

.url-highlight-layer,
.url-input {
  position: absolute;
  inset: 0;
  width: 100%;
  height: 36px;
  padding: 0;
  font-size: var(--font-size-body);
  font-family: var(--font-code);
  line-height: 36px;
  white-space: pre;
}

.url-highlight-layer {
  pointer-events: none;
  color: var(--text-primary);
}

.url-input {
  border: none;
  background: transparent;
  color: transparent;
  caret-color: var(--text-primary);
  box-shadow: none !important;
}

.url-input::placeholder {
  color: var(--text-tertiary);
}

.url-input::selection {
  background: rgba(91, 124, 250, 0.22);
}

.url-var-token {
  color: var(--primary);
  border-bottom: 1px dashed var(--primary);
  font-weight: 700;
}

.url-var-token.unresolved {
  color: var(--error);
  border-bottom-color: var(--error);
}

.send-btn {
  min-width: 84px;
  height: 38px;
  border-radius: var(--radius-xl);
  transition: transform 0.15s ease, box-shadow 0.15s ease, opacity 0.15s ease;
}

.send-btn:hover:not(:disabled) {
  transform: scale(1.02);
}

.send-btn.retry {
  background: var(--error);
  border-color: var(--error);
  color: #fff;
}

.send-spinner {
  width: 12px;
  height: 12px;
  border: 2px solid rgba(255, 255, 255, 0.45);
  border-top-color: #fff;
  border-radius: 50%;
  animation: spin 0.8s linear infinite;
}

.save-request-btn {
  height: 38px;
  border-radius: var(--radius-xl);
}

/* Cancel button next to send button */
.cancel-send-btn {
  height: 38px;
  padding: 0 14px;
  border: 1px solid var(--error);
  border-radius: var(--radius-xl);
  background: transparent;
  color: var(--error);
  cursor: pointer;
  font-size: var(--font-size-small);
  font-weight: 700;
  transition: background 0.15s ease, color 0.15s ease;
}

.cancel-send-btn:hover {
  background: var(--error);
  color: #fff;
}

.action-menu-wrapper {
  position: relative;
}

.action-btn {
  font-size: 16px;
  width: 38px;
  height: 38px;
  padding: 0;
  line-height: 1;
  border-radius: var(--radius-xl);
}

.action-dropdown {
  position: absolute;
  top: 100%;
  right: 0;
  margin-top: 4px;
  background: var(--bg-panel);
  border: 1px solid var(--border);
  border-radius: var(--radius-lg);
  box-shadow: var(--shadow-lg);
  z-index: 100;
  min-width: 136px;
  overflow: hidden;
}

.action-item {
  display: block;
  width: 100%;
  padding: 8px 12px;
  border: none;
  background: transparent;
  color: var(--text-primary);
  text-align: left;
  cursor: pointer;
  font-size: var(--font-size-small);
}

.action-item:hover {
  background: var(--bg-hover);
}

@keyframes spin {
  to { transform: rotate(360deg); }
}
</style>
