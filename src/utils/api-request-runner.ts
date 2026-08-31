import { useAppStore } from '@/stores/app'
import { useWorkspaceStore } from '@/stores/workspace'
import { sendRequest as httpSendRequest } from '@/utils/http'
import { resolveInheritedProperties, resolveScriptChain } from '@/utils/inheritance'
import {
  createDefaultBodyConfig,
  executePostResponseScriptAsync,
  executePreRequestScriptAsync,
} from '@/utils/pre-request'
import type { PostResponseData, ScriptResult, ScriptSendRequestInput } from '@/utils/pre-request'
import { createDefaultAuthConfig } from '@/utils/auth'
import { collectionVariableValue } from '@/utils/variables'
import type {
  ApiConfig,
  AuthConfig,
  BodyConfig,
  Collection,
  CollectionNode,
  CookieItem,
  Environment,
  HttpMethod,
  KvPair,
  ResponseData,
} from '@/types'

const HTTP_METHODS: HttpMethod[] = ['GET', 'POST', 'PUT', 'DELETE', 'PATCH', 'HEAD', 'OPTIONS']

export interface ApiRequestOverrides {
  method?: HttpMethod
  url?: string
  rawBody?: string
  signal?: AbortSignal
  onStreamingUpdate?: (response: ResponseData) => void
  recordHistory?: boolean
}

export interface ApiRequestCapabilities {
  params: number
  headers: number
  cookies: number
  auth: boolean
  preScripts: number
  postScripts: number
}

function executionContext(api: ApiConfig) {
  const workspace = useWorkspaceStore()
  const node = workspace.interfaces.find(item => item.apiId === api.id) ?? null
  const collectionId = node ? (node.collectionId ?? node.moduleId) : null
  const collection = collectionId
    ? workspace.collections.find(item => item.id === collectionId) ?? null
    : null
  const inherited = collection && node
    ? resolveInheritedProperties(collection, workspace.interfaces as CollectionNode[], node.id)
    : null
  const scriptChain = collection && node
    ? resolveScriptChain(collection, workspace.interfaces as CollectionNode[], node.id)
    : { preScripts: [], postScripts: [] }
  return { workspace, node, collection, inherited, scriptChain }
}

export function getApiRequestCapabilities(api: ApiConfig): ApiRequestCapabilities {
  const { inherited, scriptChain } = executionContext(api)
  return {
    params: api.params.filter(item => item.enabled && item.key).length,
    headers: new Set([
      ...(inherited?.headers ?? []).filter(item => item.enabled && item.key).map(item => item.key.toLowerCase()),
      ...api.headers.filter(item => item.enabled && item.key).map(item => item.key.toLowerCase()),
    ]).size,
    cookies: api.cookies.filter(item => item.enabled && item.key).length,
    auth: api.auth.type !== 'none' || Boolean(inherited && inherited.auth.source !== 'none'),
    preScripts: scriptChain.preScripts.length + Number(Boolean(api.preRequestScript?.trim())),
    postScripts: scriptChain.postScripts.length + Number(Boolean(api.postRequestScript?.trim())),
  }
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

function cloneAuth(auth?: AuthConfig): AuthConfig {
  return { ...createDefaultAuthConfig(), ...(auth ?? {}) }
}

function bodyWithRawOverride(body: BodyConfig, rawBody?: string): BodyConfig {
  if (rawBody === undefined || (body.type !== 'none' && body.type !== 'json' && body.type !== 'raw')) return body
  if (body.type === 'json' || body.type === 'raw') return { ...body, raw: rawBody }
  if (!rawBody.trim()) return body
  try {
    JSON.parse(rawBody)
    return { ...body, type: 'json', raw: rawBody, contentType: 'application/json' }
  } catch {
    return { ...body, type: 'raw', raw: rawBody, contentType: 'text/plain' }
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
  return { ...baseBody, raw: rawBody, urlEncoded: urlencoded, formData: formdata }
}

function headerRecordToPairs(headers: Record<string, string>): KvPair[] {
  return Object.entries(headers).map(([key, value]) => ({ key, value, enabled: true }))
}

function normalizeMethod(input: unknown, fallback: HttpMethod): HttpMethod {
  const method = String(input ?? fallback).toUpperCase() as HttpMethod
  return HTTP_METHODS.includes(method) ? method : fallback
}

function kvPairsFromEntries(entries: Iterable<[unknown, unknown]>): KvPair[] {
  return Array.from(entries).map(([key, value]) => ({ key: String(key), value: String(value ?? ''), enabled: true }))
    .filter(item => item.key)
}

function normalizeKvInput(input: unknown, value?: unknown): KvPair[] {
  if (Array.isArray(input)) return input.flatMap(item => normalizeKvInput(item))
  if (input && typeof input === 'object') {
    const item = input as { key?: unknown; name?: unknown; value?: unknown; disabled?: unknown; description?: unknown }
    if (!('key' in item) && !('name' in item)) {
      const entries = (input as { entries?: unknown }).entries
      if (typeof entries === 'function') return kvPairsFromEntries((entries as () => Iterable<[unknown, unknown]>).call(input))
      return Object.entries(input as Record<string, unknown>)
        .map(([key, entryValue]) => ({ key, value: String(entryValue ?? ''), enabled: true }))
        .filter(field => field.key)
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
    const record = input as Record<string, unknown>
    if ('key' in record || 'name' in record) return normalizeKvInput(input)
    return Object.entries(record).map(([key, value]) => ({ key, value: String(value ?? ''), enabled: true }))
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

function applyScriptBodyOverride(target: BodyConfig, bodyInput: unknown): BodyConfig {
  if (bodyInput == null) return target
  if (typeof bodyInput === 'string') return { ...target, type: 'raw', raw: bodyInput, contentType: target.contentType || 'text/plain' }
  if (typeof bodyInput !== 'object') return { ...target, type: 'raw', raw: String(bodyInput), contentType: target.contentType || 'text/plain' }

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
  if (mode === 'json') return { ...target, type: 'json', raw: stringifyBodyInput('content' in body ? body.content : bodyInput), urlEncoded: [], formData: [], contentType: 'application/json' }
  if (mode === 'urlencoded' || mode === 'x-www-form-urlencoded') {
    return { ...target, type: 'urlencoded', raw: '', urlEncoded: normalizeKvInput(body.urlencoded ?? body.urlencodedData ?? body.data ?? body.content ?? []), formData: [] }
  }
  if (mode === 'formdata' || mode === 'form') {
    return { ...target, type: 'form', raw: '', urlEncoded: [], formData: normalizeKvInput(body.formdata ?? body.formData ?? body.data ?? body.content ?? []) }
  }
  if (mode === 'none') return { ...target, type: 'none', raw: '', urlEncoded: [], formData: [] }
  return { ...target, type: 'json', raw: JSON.stringify(bodyInput), contentType: 'application/json' }
}

function mergeEnvKeys(env: Environment, keys: string[], source: Record<string, string>) {
  for (const key of keys) {
    const index = env.variables.findIndex(item => item.key === key)
    const nextValue = source[key]
    if (nextValue === undefined) {
      if (index >= 0) env.variables.splice(index, 1)
    } else if (index >= 0) {
      env.variables[index] = { ...env.variables[index], value: nextValue, enabled: true }
    } else {
      env.variables.push({ key, value: nextValue, enabled: true })
    }
  }
}

async function persistScriptEnvChanges(result: ScriptResult, collection: Collection | null) {
  const store = useAppStore()
  const workspace = useWorkspaceStore()
  const envChanged = result.envChangedKeys ?? []
  const globalChanged = result.changedGlobalKeys ?? []
  if (envChanged.length || globalChanged.length) {
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
  if (!collection || !collectionChanged.length) return
  const variables = collection.variables.map(item => ({ ...item }))
  for (const key of collectionChanged) {
    const nextValue = result.collectionVars?.[key]
    const index = variables.findIndex(item => item.key === key)
    if (nextValue === undefined) {
      if (index >= 0) variables.splice(index, 1)
    } else if (index >= 0) {
      const item = variables[index]
      variables[index] = collection.selectedEnvId
        ? { ...item, environmentValues: { ...(item.environmentValues ?? {}), [collection.selectedEnvId]: nextValue }, enabled: true }
        : { ...item, currentValue: nextValue, enabled: true }
    } else {
      variables.push({
        key,
        initialValue: collection.selectedEnvId ? '' : nextValue,
        currentValue: collection.selectedEnvId ? '' : nextValue,
        environmentValues: collection.selectedEnvId ? { [collection.selectedEnvId]: nextValue } : {},
        secret: false,
        enabled: true,
      })
    }
  }
  await workspace.updateCollectionSettings(collection.id, { variables })
}

function collectScriptArtifacts(result: ScriptResult) {
  const store = useAppStore()
  if (result.visualizations?.length) store.scriptVisualizations.push(...result.visualizations)
  if (result.tests?.length) store.scriptTests.push(...result.tests)
}

function scriptInfo(api: ApiConfig, eventName: 'prerequest' | 'test', interfaceName: string) {
  const { workspace, node } = executionContext(api)
  const module = node ? workspace.modules.find(item => item.id === node.moduleId) : null
  const category = module ? workspace.categories.find(item => item.id === module.categoryId) : null
  return {
    moduleName: module?.name || '',
    categoryName: category?.name || '',
    interfaceName,
    eventName,
  }
}

async function sendScriptHttpRequest(input: ScriptSendRequestInput | undefined, baseApi: ApiConfig | undefined, contextApi: ApiConfig): Promise<ResponseData> {
  const store = useAppStore()
  const request = typeof input === 'string' ? { url: input } : (input ?? {}) as Record<string, any>
  const headers = baseApi ? cloneKvPairs(baseApi.headers) : []
  upsertPairs(headers, normalizeHeaderInput(request.header))
  upsertPairs(headers, normalizeHeaderInput(request.headers))
  const params = baseApi ? cloneKvPairs(baseApi.params) : []
  upsertPairs(params, normalizeKvInput(request.params))
  if (request.url && typeof request.url === 'object') upsertPairs(params, normalizeKvInput(request.url.query))
  const cookies = baseApi ? cloneCookies(baseApi.cookies) : []
  upsertPairs(cookies, normalizeKvInput(request.cookie) as CookieItem[])
  upsertPairs(cookies, normalizeKvInput(request.cookies) as CookieItem[])

  const inputUrl = request.url
  const scriptUrl = typeof inputUrl === 'string'
    ? inputUrl
    : typeof inputUrl?.raw === 'string'
      ? inputUrl.raw
      : inputUrl?.toString && inputUrl.toString !== Object.prototype.toString
        ? inputUrl.toString()
        : baseApi?.url ?? ''
  return httpSendRequest({
    method: normalizeMethod(request.method, baseApi?.method ?? 'GET'),
    url: scriptUrl,
    headers,
    params,
    cookies,
    autoCarryCookies: store.autoCarryCookies,
    body: applyScriptBodyOverride(cloneBody(baseApi?.body), request.body),
    auth: { ...cloneAuth(baseApi?.auth), ...(request.auth && typeof request.auth === 'object' ? request.auth : {}) },
    corsMode: store.settings.corsMode,
    proxyUrl: store.settings.proxyUrl,
    envVars: store.getEnvVariablesForApi(baseApi?.id ?? contextApi.id),
    timeoutMs: typeof request.timeout === 'number' && request.timeout > 0 ? request.timeout : undefined,
    followRedirects: typeof request.followRedirects === 'boolean' ? request.followRedirects : undefined,
  })
}

async function sendScriptInterface(interfaceOrApiId: string, overrides: ScriptSendRequestInput | undefined, contextApi: ApiConfig): Promise<ResponseData> {
  const store = useAppStore()
  const workspace = useWorkspaceStore()
  const node = workspace.interfaces.find(item => item.id === interfaceOrApiId || item.apiId === interfaceOrApiId || item.name === interfaceOrApiId)
  const api = node?.apiId ? store.apis[node.apiId] : store.apis[interfaceOrApiId]
  if (!api) throw new Error(`未找到接口：${interfaceOrApiId}`)
  return sendScriptHttpRequest(overrides ?? { url: api.url, method: api.method }, api, contextApi)
}

export async function runApiRequest(api: ApiConfig, overrides: ApiRequestOverrides = {}): Promise<ResponseData> {
  const store = useAppStore()
  const { collection, inherited, scriptChain } = executionContext(api)
  const baseBody = bodyWithRawOverride(cloneBody(api.body), overrides.rawBody)
  const effectiveAuth = api.auth.type === 'inherit'
    ? inherited && inherited.auth.source !== 'none' ? cloneAuth(inherited.auth.auth) : cloneAuth()
    : cloneAuth(api.auth)

  let headers: Record<string, string> = {}
  for (const header of inherited?.headers ?? []) {
    if (header.enabled && header.key) headers[header.key] = header.value
  }
  for (const header of api.headers) {
    if (header.enabled && header.key) headers[header.key] = header.value
  }

  let method = overrides.method ?? api.method
  let url = overrides.url ?? api.url
  let body = baseBody.raw || ''
  let urlencoded = cloneKvPairs(baseBody.urlEncoded)
  let formdata = cloneKvPairs(baseBody.formData)
  let cookies = cloneCookies(api.cookies)
  let envVars = store.getEnvVariablesForApi(api.id)
  const allLogs: typeof store.scriptLogs = []
  store.scriptLogs = []
  store.scriptVisualizations = []
  store.scriptTests = []

  const collectionStore: Record<string, string> = Object.fromEntries(
    (collection?.variables ?? []).filter(item => item.enabled && item.key)
      .map(item => [item.key, collectionVariableValue(item, collection?.selectedEnvId)]),
  )
  const globalEnv = store.environments.find(item => store.isGlobalEnv(item) && item.id === store.currentEnvId)
    ?? store.environments.find(item => store.isGlobalEnv(item))
  const globalStore: Record<string, string> = Object.fromEntries(
    (globalEnv?.variables ?? []).filter(item => item.enabled && item.key).map(item => [item.key, item.value]),
  )
  let latestCollectionStore = { ...collectionStore }
  let latestGlobalStore = { ...globalStore }

  const preSegments = [
    ...scriptChain.preScripts,
    ...(api.preRequestScript?.trim() ? [{ sourceId: api.id, sourceName: '请求', script: api.preRequestScript }] : []),
  ]
  for (const segment of preSegments) {
    const result = await executePreRequestScriptAsync(segment.script, headers, url, body, urlencoded, formdata, envVars, {
      requestMethod: method,
      requestCookies: cookies,
      sendRequest: input => sendScriptHttpRequest(input, undefined, api),
      sendInterface: (id, input) => sendScriptInterface(id, input, api),
      info: scriptInfo(api, 'prerequest', segment.sourceName === '请求' ? api.name : segment.sourceName),
      collectionVarStore: latestCollectionStore,
      globalVarStore: latestGlobalStore,
    })
    method = normalizeMethod(result.method, method)
    headers = result.headers
    cookies = result.cookies
    url = result.url
    body = result.body
    urlencoded = result.urlencoded
    formdata = result.formdata
    envVars = result.envVars
    latestCollectionStore = { ...latestCollectionStore, ...(result.collectionVars ?? {}) }
    latestGlobalStore = { ...latestGlobalStore, ...(result.globalVars ?? {}) }
    if (segment.sourceName !== '请求') allLogs.push({ level: 'info', timestamp: Date.now(), args: [`执行继承前置脚本：${segment.sourceName}`] })
    allLogs.push(...result.logs)
    collectScriptArtifacts(result)
    await persistScriptEnvChanges(result, collection)
    if (result.skipRequest) {
      const skipped: ResponseData = {
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
      return skipped
    }
  }

  const response = await httpSendRequest({
    method,
    url,
    headers: headerRecordToPairs(headers),
    params: cloneKvPairs(api.params),
    cookies,
    autoCarryCookies: store.autoCarryCookies,
    body: inferScriptBodyConfig(baseBody, body, urlencoded, formdata),
    auth: effectiveAuth,
    corsMode: store.settings.corsMode,
    proxyUrl: store.settings.proxyUrl,
    envVars,
    signal: overrides.signal,
    streamMerge: api.streamMerge,
    onStreamingUpdate: overrides.onStreamingUpdate,
  })

  const postSegments = [
    ...(api.postRequestScript?.trim() ? [{ sourceId: api.id, sourceName: '请求', script: api.postRequestScript }] : []),
    ...[...scriptChain.postScripts].reverse(),
  ]
  const postData: PostResponseData = {
    status: response.status,
    statusText: response.statusText,
    headers: response.headers,
    body: response.body,
    duration: response.duration,
    responseSize: response.size,
  }
  for (const segment of postSegments) {
    const result = await executePostResponseScriptAsync(segment.script, postData, envVars, {
      sendRequest: input => sendScriptHttpRequest(input, undefined, api),
      sendInterface: (id, input) => sendScriptInterface(id, input, api),
      info: scriptInfo(api, 'test', segment.sourceName === '请求' ? api.name : segment.sourceName),
      collectionVarStore: latestCollectionStore,
      globalVarStore: latestGlobalStore,
    })
    latestCollectionStore = { ...latestCollectionStore, ...(result.collectionVars ?? {}) }
    latestGlobalStore = { ...latestGlobalStore, ...(result.globalVars ?? {}) }
    if (segment.sourceName !== '请求') allLogs.push({ level: 'info', timestamp: Date.now(), args: [`执行继承后置脚本：${segment.sourceName}`] })
    allLogs.push(...result.logs)
    collectScriptArtifacts(result)
    await persistScriptEnvChanges(result, collection)
  }
  store.scriptLogs = allLogs

  if (overrides.recordHistory !== false) {
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
  }
  return response
}
