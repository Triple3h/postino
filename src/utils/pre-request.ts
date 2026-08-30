import type { AuthConfig, BodyConfig, CookieItem, HttpMethod, KvPair, ResponseData } from '@/types'
import { createDefaultAuthConfig as createDefaultAuthConfigValue } from '@/utils/auth'
import { createCryptoJsShim } from '@/scripting/crypto-shim'

export interface ScriptLog {
  level: 'log' | 'warn' | 'error' | 'info' | 'table'
  timestamp: number
  args: string[]
}

export interface ScriptVisualization {
  id: string
  type: 'template' | 'table'
  title: string
  content: string
  data?: unknown
  createdAt: number
}

export interface ScriptTestResult {
  name: string
  passed: boolean
  skipped?: boolean
  error?: string
}

export interface ScriptResult {
  /** pm.collectionVariables 变更后的完整 store(Phase 4.2) */
  collectionVars?: Record<string, string>
  changedCollectionKeys?: string[]
  /** pm.globals 变更后的完整 store */
  globalVars?: Record<string, string>
  changedGlobalKeys?: string[]
  method?: HttpMethod
  headers: Record<string, string>
  cookies: CookieItem[]
  url: string
  body: string
  urlencoded: KvPair[]
  formdata: KvPair[]
  envVars: Record<string, string>
  envChangedKeys?: string[]
  skipRequest?: boolean
  nextRequest?: string | null
  logs: ScriptLog[]
  visualizations?: ScriptVisualization[]
  tests?: ScriptTestResult[]
  error?: string
}

export type ScriptType = 'pre-request' | 'post-response'

export interface PostResponseData {
  status: number
  statusText: string
  headers: Record<string, string>
  body: string
  duration: number
  responseSize: number
}

export type ScriptSendRequestInput = string | {
  url?: string | { raw?: string; path?: string[]; query?: unknown; toString?: () => string }
  method?: string
  header?: unknown
  headers?: unknown
  params?: unknown
  cookie?: unknown
  cookies?: unknown
  body?: unknown
  auth?: Partial<AuthConfig>
  timeout?: number
  followRedirects?: boolean
}

export type ScriptSendRequestCallback = (err: Error | null, response?: ScriptResponseFacade | null) => void
export type ScriptRequestSender = (input: ScriptSendRequestInput) => Promise<ResponseData>
export type ScriptInterfaceSender = (interfaceOrApiId: string, overrides?: ScriptSendRequestInput) => Promise<ResponseData>

export interface ScriptExecutionOptions {
  /** 集合变量初始 store(pm.collectionVariables 落点) */
  collectionVarStore?: Record<string, string>
  /** 全局变量初始 store(pm.globals 落点) */
  globalVarStore?: Record<string, string>
  timeoutMs?: number
  maxMemoryBytes?: number
  requestMethod?: HttpMethod
  requestCookies?: CookieItem[]
  onEnvSave?: (vars: Record<string, string>, changedKeys: string[]) => void | Promise<void>
  sendRequest?: ScriptRequestSender
  sendInterface?: ScriptInterfaceSender
  info?: Partial<{
    moduleName: string
    categoryName: string
    interfaceName: string
    eventName: 'prerequest' | 'test'
  }>
}

export interface ScriptResponseFacade {
  code: number
  status: string
  responseTime: number
  responseSize: number
  size: number
  headers: {
    [key: string]: string | ((key: string) => string | undefined) | ((key: string) => boolean) | (() => Record<string, string>) | undefined
    get: (key: string) => string | undefined
    has: (key: string) => boolean
    all: () => Record<string, string>
  }
  body: string
  text: () => string
  json: () => unknown
  xml: () => Document | null
  blob: () => Promise<Blob>
  jsonPath: (path: string) => unknown
  match: (pattern: string | RegExp) => string | null
  to: {
    have: {
      status: (expected: number) => void
      header: (key: string) => void
      body: (expected: string | RegExp) => void
      jsonBody: (path?: string, expected?: unknown) => void
      bodyContains: (expected: string) => void
    }
  }
  toJSON: () => ResponseData
}

let sandboxIframe: HTMLIFrameElement | null = null
let sandboxReady: Promise<void> | null = null
let sandboxMessageListenerInstalled = false
const pendingRequests: Map<string, {
  resolve: (result: ScriptResult) => void
  reject: (err: Error) => void
  options?: ScriptExecutionOptions
  timeoutId?: ReturnType<typeof setTimeout>
}> = new Map()

class ScriptTimeoutError extends Error {
  constructor(message: string) {
    super(message)
    this.name = 'ScriptTimeoutError'
  }
}

function createScriptTimeoutError(message: string): ScriptTimeoutError {
  return new ScriptTimeoutError(message)
}

function isScriptTimeoutError(err: unknown): boolean {
  return err instanceof Error && (err.name === 'ScriptTimeoutError' || err.message.includes('timed out'))
}

// MV3 扩展页 CSP 不放行 eval 且不可放宽,Worker 继承扩展页 CSP,pm-facade 在 Worker 里
// 构造 AsyncFunction 必抛此错。这是「环境级失败」而非用户脚本错误,必须 reject 让上层
// 降级到 sandbox iframe(manifest sandbox.pages 的默认沙箱 CSP 放行 unsafe-eval)。
function isEvalBlockedByCsp(message?: string | null): boolean {
  if (!message) return false
  return /Content Security Policy|unsafe-eval|Evaluating a string/i.test(message)
}

function destroySandboxIframe(reason: string) {
  if (sandboxIframe?.parentNode) {
    sandboxIframe.parentNode.removeChild(sandboxIframe)
  }
  sandboxIframe = null
  sandboxReady = null

  for (const [requestId, pending] of pendingRequests.entries()) {
    if (pending.timeoutId) clearTimeout(pending.timeoutId)
    pending.reject(new Error(reason))
    pendingRequests.delete(requestId)
  }
}

function normalizeSandboxResult(result: any, success = true, error?: string): ScriptResult {
  return {
    method: result?.method,
    headers: result?.headers || {},
    cookies: result?.cookies || [],
    url: result?.url || '',
    body: result?.body || '',
    urlencoded: result?.urlencoded || [],
    formdata: result?.formdata || [],
    envVars: result?.envVars || {},
    envChangedKeys: result?.envChangedKeys || [],
    collectionVars: result?.collectionVars,
    changedCollectionKeys: result?.changedCollectionKeys || [],
    globalVars: result?.globalVars,
    changedGlobalKeys: result?.changedGlobalKeys || [],
    skipRequest: Boolean(result?.skipRequest),
    nextRequest: result?.nextRequest ?? null,
    logs: result?.logs || [],
    visualizations: result?.visualizations || [],
    tests: result?.tests || [],
    error: success ? undefined : error,
  }
}

function shouldUseWorkerSandbox(): boolean {
  return typeof Worker !== 'undefined'
}

function getApproximateJsHeapUsed(): number | null {
  const memory = (globalThis.performance as Performance & { memory?: { usedJSHeapSize?: number } } | undefined)?.memory
  return typeof memory?.usedJSHeapSize === 'number' ? memory.usedJSHeapSize : null
}

function getWorkerSandboxUrl(): string {
  return new URL('/script-worker.js', window.location.href).toString()
}

export async function executeScriptInWorkerSandbox(
  script: string,
  headers: Record<string, string>,
  url: string,
  body: string,
  urlencoded: KvPair[],
  formdata: KvPair[],
  envVars: Record<string, string>,
  responseData?: PostResponseData,
  options: ScriptExecutionOptions = {},
): Promise<ScriptResult> {
  if (!script || !script.trim()) {
    return emptyResult(headers, url, body, urlencoded, formdata, envVars, options.requestCookies || [])
  }

  const requestId = generateRequestId()
  const worker = new Worker(getWorkerSandboxUrl(), { name: `postino-script-${requestId}` })
  const timeoutMs = options.timeoutMs ?? 30000
  const maxMemoryBytes = options.maxMemoryBytes ?? 128 * 1024 * 1024
  const baselineHeap = getApproximateJsHeapUsed()

  return new Promise((resolve, reject) => {
    let settled = false
    const timeoutId = setTimeout(() => {
      fail(createScriptTimeoutError(`ScriptTimeoutError: Script execution timed out (${Math.round(timeoutMs / 1000)}s); worker was terminated`))
    }, timeoutMs)
    const memoryInterval = setInterval(() => {
      const usedHeap = getApproximateJsHeapUsed()
      const scriptHeapDelta = usedHeap !== null && baselineHeap !== null ? usedHeap - baselineHeap : null
      if (scriptHeapDelta !== null && scriptHeapDelta > maxMemoryBytes) {
        fail(new Error(`Script execution exceeded memory guard (${Math.round(maxMemoryBytes / 1024 / 1024)}MB); worker was terminated`))
      }
    }, 250)

    const cleanup = () => {
      clearTimeout(timeoutId)
      clearInterval(memoryInterval)
      worker.terminate()
    }

    const fail = (error: Error) => {
      if (settled) return
      settled = true
      cleanup()
      reject(error)
    }

    const succeed = (result: ScriptResult) => {
      if (settled) return
      settled = true
      cleanup()
      resolve(result)
    }

    worker.onmessage = (event) => {
      if (event.data?.type === 'SCRIPT_SEND_REQUEST') {
        const { callId, input, interfaceOrApiId, overrides } = event.data
        const sender = interfaceOrApiId
          ? options.sendInterface?.(String(interfaceOrApiId), overrides)
          : options.sendRequest?.(input)
        if (!sender) {
          worker.postMessage({ type: 'SCRIPT_SEND_RESPONSE', requestId, callId, success: false, error: 'pm.sendRequest is unavailable in this context' })
          return
        }
        sender
          .then(response => worker.postMessage({ type: 'SCRIPT_SEND_RESPONSE', requestId, callId, success: true, response }))
          .catch(err => worker.postMessage({ type: 'SCRIPT_SEND_RESPONSE', requestId, callId, success: false, error: err instanceof Error ? err.message : String(err) }))
        return
      }

      if (event.data?.type !== 'SCRIPT_RESULT' || event.data.requestId !== requestId) return
      const { success, error, result } = event.data
      if (!success && isEvalBlockedByCsp(error)) {
        fail(new Error(error))
        return
      }
      succeed(normalizeSandboxResult(result, success, error))
    }

    worker.onerror = (event) => {
      fail(new Error(event.message || 'Script worker failed'))
    }

    const message: Record<string, unknown> = {
      type: 'EXECUTE_SCRIPT',
      script,
      envVars,
      method: options.requestMethod,
      headers,
      cookies: options.requestCookies || [],
      url,
      body,
      urlencoded,
      formdata,
      requestId,
      info: {
        moduleName: '',
        categoryName: '',
        interfaceName: '',
        eventName: responseData ? 'test' : 'prerequest',
        ...options.info,
      },
    }
    if (responseData) message.responseData = responseData
    worker.postMessage(message)
  })
}

function getSandboxIframe(): HTMLIFrameElement {
  if (!sandboxIframe) {
    sandboxIframe = document.createElement('iframe')
    sandboxIframe.src = '/sandbox.html'
    sandboxIframe.style.display = 'none'
    sandboxIframe.sandbox.add('allow-scripts')
    sandboxReady = new Promise((resolve, reject) => {
      const timer = setTimeout(() => reject(new Error('Sandbox iframe load timed out')), 5000)
      sandboxIframe?.addEventListener('load', () => {
        clearTimeout(timer)
        resolve()
      }, { once: true })
      sandboxIframe?.addEventListener('error', () => {
        clearTimeout(timer)
        reject(new Error('Sandbox iframe failed to load'))
      }, { once: true })
    })
    document.body.appendChild(sandboxIframe)
  }

  if (!sandboxMessageListenerInstalled) {
    sandboxMessageListenerInstalled = true
    window.addEventListener('message', (event) => {
      if (event.data?.type === 'SCRIPT_SEND_REQUEST') {
        const { requestId, callId, input, interfaceOrApiId, overrides } = event.data
        const pending = pendingRequests.get(requestId)
        const source = event.source as WindowProxy | null
        if (!pending || !source) return
        const sender = interfaceOrApiId
          ? pending.options?.sendInterface?.(String(interfaceOrApiId), overrides)
          : pending.options?.sendRequest?.(input)
        if (!sender) {
          source.postMessage({ type: 'SCRIPT_SEND_RESPONSE', requestId, callId, success: false, error: 'pm.sendRequest is unavailable in this context' }, '*')
          return
        }
        sender
          .then(response => source.postMessage({ type: 'SCRIPT_SEND_RESPONSE', requestId, callId, success: true, response }, '*'))
          .catch(err => source.postMessage({ type: 'SCRIPT_SEND_RESPONSE', requestId, callId, success: false, error: err instanceof Error ? err.message : String(err) }, '*'))
        return
      }

      if (event.data?.type !== 'SCRIPT_RESULT') return
      const { requestId, success, error, result } = event.data
      const pending = pendingRequests.get(requestId)
      if (!pending) return
      pendingRequests.delete(requestId)
      if (pending.timeoutId) clearTimeout(pending.timeoutId)

      pending.resolve(normalizeSandboxResult(result, success, error))
    })
  }
  return sandboxIframe
}

function generateRequestId(): string {
  return Date.now().toString(36) + Math.random().toString(36).slice(2, 8)
}

export async function executeScriptInSandbox(
  script: string,
  headers: Record<string, string>,
  url: string,
  body: string,
  urlencoded: KvPair[],
  formdata: KvPair[],
  envVars: Record<string, string>,
  responseData?: PostResponseData,
  options: ScriptExecutionOptions = {},
): Promise<ScriptResult> {
  if (!script || !script.trim()) {
    return emptyResult(headers, url, body, urlencoded, formdata, envVars, options.requestCookies || [])
  }

  const iframe = getSandboxIframe()
  await sandboxReady
  const requestId = generateRequestId()

  return new Promise((resolve, reject) => {
    const timeoutMs = options.timeoutMs ?? 30000
    const timeoutId = setTimeout(() => {
      const pending = pendingRequests.get(requestId)
      if (!pending) return
      pendingRequests.delete(requestId)
      reject(createScriptTimeoutError(`ScriptTimeoutError: Script execution timed out (${Math.round(timeoutMs / 1000)}s); sandbox was reset`))
      destroySandboxIframe('Script sandbox was reset after a timed-out execution')
    }, timeoutMs)
    pendingRequests.set(requestId, { resolve, reject, options, timeoutId })

    const message: Record<string, unknown> = {
      type: 'EXECUTE_SCRIPT',
      script,
      envVars,
      method: options.requestMethod,
      headers,
      cookies: options.requestCookies || [],
      url,
      body,
      urlencoded,
      formdata,
      requestId,
      info: {
        moduleName: '',
        categoryName: '',
        interfaceName: '',
        eventName: responseData ? 'test' : 'prerequest',
        ...options.info,
      },
    }

    if (responseData) message.responseData = responseData

    const contentWindow = iframe.contentWindow
    if (contentWindow) {
      contentWindow.postMessage(message, '*')
    } else {
      clearTimeout(timeoutId)
      pendingRequests.delete(requestId)
      reject(new Error('Sandbox iframe not ready'))
    }
  })
}

function emptyResult(
  headers: Record<string, string>,
  url: string,
  body: string,
  urlencoded: KvPair[],
  formdata: KvPair[],
  envVars: Record<string, string>,
  cookies: CookieItem[] = [],
): ScriptResult {
  return {
    headers,
    cookies,
    url,
    body,
    urlencoded,
    formdata,
    envVars,
    envChangedKeys: [],
    skipRequest: false,
    nextRequest: null,
    logs: [],
    visualizations: [],
    tests: [],
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

function upsertField(fields: KvPair[], field: KvPair) {
  const existing = fields.find(item => item.key === field.key)
  if (existing) {
    existing.value = field.value
    existing.enabled = field.enabled
    existing.description = field.description
  } else {
    fields.push(field)
  }
}

function kvPairsFromEntries(entries: Iterable<[unknown, unknown]>): KvPair[] {
  return Array.from(entries).map(([key, value]) => ({
    key: String(key),
    value: String(value ?? ''),
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

function applyBodyInput(bodyFacade: { _raw: string; _fields: KvPair[]; _formdata: KvPair[] }, value: unknown) {
  const setRaw = (rawValue: unknown) => {
    bodyFacade._raw = stringifyBodyInput(rawValue)
    bodyFacade._fields = []
    bodyFacade._formdata = []
  }
  if (value && typeof value === 'object') {
    const maybeBody = value as Record<string, unknown>
    const mode = String(maybeBody.mode ?? maybeBody.type ?? '').toLowerCase()
    const entries = (value as { entries?: unknown }).entries
    if ((mode === 'urlencoded' || mode === 'x-www-form-urlencoded') && ('urlencoded' in maybeBody || 'data' in maybeBody || 'content' in maybeBody)) {
      bodyFacade._fields = normalizeKvInput(maybeBody.urlencoded ?? maybeBody.data ?? maybeBody.content ?? [])
      bodyFacade._formdata = []
      bodyFacade._raw = ''
      return
    }
    if ((mode === 'formdata' || mode === 'form') && ('formdata' in maybeBody || 'formData' in maybeBody || 'data' in maybeBody || 'content' in maybeBody)) {
      bodyFacade._formdata = normalizeKvInput(maybeBody.formdata ?? maybeBody.formData ?? maybeBody.data ?? maybeBody.content ?? [])
      bodyFacade._fields = []
      bodyFacade._raw = ''
      return
    }
    if (typeof entries === 'function') {
      const pairs = kvPairsFromEntries((entries as () => Iterable<[unknown, unknown]>).call(value))
      const ctorName = (value as { constructor?: { name?: string } }).constructor?.name?.toLowerCase() ?? ''
      if (ctorName.includes('urlsearchparams')) {
        bodyFacade._fields = pairs
        bodyFacade._formdata = []
      } else {
        bodyFacade._formdata = pairs
        bodyFacade._fields = []
      }
      bodyFacade._raw = ''
      return
    }
    if (mode === 'raw') {
      setRaw(maybeBody.raw ?? maybeBody.content ?? '')
      return
    }
    if (mode === 'json' && 'content' in maybeBody) {
      setRaw(maybeBody.content)
      return
    }
  }
  setRaw(value)
}

function getCookieJarKey(url: string): string {
  try {
    const parsed = new URL(url || 'http://postino.local')
    return parsed.origin
  } catch {
    return url || '__default__'
  }
}

function createCookieFacade(cookieStore: CookieItem[], currentUrl = '') {
  const currentKey = getCookieJarKey(currentUrl)
  const jarStore = new Map<string, CookieItem[]>([[currentKey, cookieStore]])
  const getBucket = (url?: string) => {
    const key = getCookieJarKey(url || currentUrl)
    if (!jarStore.has(key)) jarStore.set(key, [])
    return jarStore.get(key)!
  }
  const toObject = (bucket = cookieStore) => Object.fromEntries(bucket.filter(item => item.enabled !== false).map(item => [item.key, item.value]))
  const setCookie = (bucket: CookieItem[], name: string, value: unknown) => upsertField(bucket, { key: String(name), value: String(value ?? ''), enabled: true })
  const unsetCookie = (bucket: CookieItem[], name: string) => {
    const index = bucket.findIndex(item => item.key === name)
    if (index >= 0) bucket.splice(index, 1)
  }
  const withCallback = <T>(valueFactory: () => T, callback?: (err: Error | null, value?: T) => void): Promise<T> => {
    const promise = Promise.resolve().then(valueFactory)
    if (callback) promise.then(value => callback(null, value)).catch(err => callback(err instanceof Error ? err : new Error(String(err))))
    return promise
  }
  const jar = {
    get(url: string, name: string, callback?: (err: Error | null, value?: string) => void) {
      return withCallback<string | undefined>(() => getBucket(url).find(item => item.key === name && item.enabled !== false)?.value, callback as ((err: Error | null, value?: string | undefined) => void) | undefined)
    },
    getAll(url: string, callback?: (err: Error | null, value?: Record<string, string>) => void) {
      return withCallback(() => toObject(getBucket(url)), callback)
    },
    set(url: string, name: string, value: unknown, callback?: (err: Error | null, value?: string) => void) {
      return withCallback(() => {
        setCookie(getBucket(url), name, value)
        return String(value ?? '')
      }, callback)
    },
    unset(url: string, name: string, callback?: (err: Error | null) => void) {
      return withCallback(() => {
        unsetCookie(getBucket(url), name)
        return undefined
      }, callback as ((err: Error | null, value?: undefined) => void) | undefined)
    },
    clear(url: string, callback?: (err: Error | null) => void) {
      return withCallback(() => {
        getBucket(url).splice(0)
        return undefined
      }, callback as ((err: Error | null, value?: undefined) => void) | undefined)
    },
    toObject(url?: string) { return toObject(getBucket(url)) },
  }
  return {
    jar: () => jar,
    get(name: string) { return cookieStore.find(item => item.key === name && item.enabled !== false)?.value },
    has(name: string) { return cookieStore.some(item => item.key === name && item.enabled !== false) },
    set(name: string, value: unknown) { setCookie(cookieStore, name, value) },
    unset(name: string) { unsetCookie(cookieStore, name) },
    clear() { cookieStore.splice(0) },
    toObject: () => toObject(cookieStore),
    all: () => cookieStore.map(item => ({ ...item })),
    each(callback: (value: string, key: string) => void) { cookieStore.filter(item => item.enabled !== false).forEach(item => callback(item.value, item.key)) },
  }
}

function formatLogArg(arg: unknown): string {
  if (arg instanceof Error) return `${arg.name}: ${arg.message}`
  if (typeof arg === 'string') return arg
  if (arg == null) return String(arg)
  if (typeof arg === 'object') {
    try { return JSON.stringify(arg) } catch { return Object.prototype.toString.call(arg) }
  }
  return String(arg)
}

function escapeRegExp(value: string): string {
  return value.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')
}

function headerLookup(headers: Record<string, string>, key: string): string | undefined {
  const lower = key.toLowerCase()
  const matched = Object.keys(headers).find(item => item.toLowerCase() === lower)
  return matched ? headers[matched] : undefined
}

function setHeaderValue(headers: Record<string, string>, key: string, value: unknown) {
  const lower = key.toLowerCase()
  const matched = Object.keys(headers).find(item => item.toLowerCase() === lower)
  headers[matched || key] = String(value ?? '')
}

function removeHeaderValue(headers: Record<string, string>, key: string) {
  const lower = key.toLowerCase()
  const matched = Object.keys(headers).find(item => item.toLowerCase() === lower)
  if (matched) delete headers[matched]
}

function createMutableHeaderFacade(headerStore: Record<string, string>) {
  const methods = {
    _store: headerStore,
    add(input: unknown, value?: unknown) {
      for (const item of normalizeKvInput(input, value)) {
        if (headerLookup(headerStore, item.key) === undefined) headerStore[item.key] = item.value
      }
    },
    set(key: string, value: string) { setHeaderValue(headerStore, key, value) },
    upsert(input: unknown, value?: unknown) {
      for (const item of normalizeKvInput(input, value)) setHeaderValue(headerStore, item.key, item.value)
    },
    get(key: string) { return headerLookup(headerStore, key) },
    remove(key: string) { removeHeaderValue(headerStore, key) },
    has(key: string) { return headerLookup(headerStore, key) !== undefined },
    all() { return { ...headerStore } },
    toObject() { return { ...headerStore } },
    each(callback: (value: string, key: string) => void) {
      Object.entries(headerStore).forEach(([key, value]) => callback(value, key))
    },
    clear() {
      Object.keys(headerStore).forEach(key => delete headerStore[key])
    },
  }
  return new Proxy(methods as Record<string | symbol, unknown>, {
    get(target, prop) {
      if (typeof prop !== 'string') return Reflect.get(target, prop)
      if (prop in target) return Reflect.get(target, prop)
      return headerLookup(headerStore, prop)
    },
    set(target, prop, value) {
      if (typeof prop !== 'string') return Reflect.set(target, prop, value)
      if (prop in target) return Reflect.set(target, prop, value)
      setHeaderValue(headerStore, prop, value)
      return true
    },
    deleteProperty(target, prop) {
      if (typeof prop !== 'string') return Reflect.deleteProperty(target, prop)
      if (prop in target) return false
      removeHeaderValue(headerStore, prop)
      return true
    },
    has(target, prop) {
      if (typeof prop !== 'string') return Reflect.has(target, prop)
      return prop in target || headerLookup(headerStore, prop) !== undefined
    },
    ownKeys() {
      return Object.keys(headerStore)
    },
    getOwnPropertyDescriptor(target, prop) {
      if (typeof prop !== 'string') return Reflect.getOwnPropertyDescriptor(target, prop)
      if (prop in target) {
        return { configurable: true, enumerable: false, writable: true, value: Reflect.get(target, prop) }
      }
      const matched = Object.keys(headerStore).find(key => key.toLowerCase() === prop.toLowerCase())
      if (!matched) return undefined
      return { configurable: true, enumerable: true, writable: true, value: headerStore[matched] }
    },
  })
}

function createHeaderFacade(headers: Record<string, string>): ScriptResponseFacade['headers'] {
  const facade: Record<string, unknown> = {}
  for (const [key, value] of Object.entries(headers)) {
    facade[key] = value
    facade[key.toLowerCase()] = value
  }
  Object.defineProperties(facade, {
    get: { value: (key: string) => headerLookup(headers, key), enumerable: false },
    has: { value: (key: string) => headerLookup(headers, key) !== undefined, enumerable: false },
    all: { value: () => ({ ...headers }), enumerable: false },
    toObject: { value: () => ({ ...headers }), enumerable: false },
  })
  return facade as ScriptResponseFacade['headers']
}

function normalizeResponseData(responseData: PostResponseData): ResponseData {
  return {
    status: responseData.status,
    statusText: responseData.statusText,
    headers: responseData.headers,
    body: responseData.body,
    duration: responseData.duration,
    size: responseData.responseSize,
    url: '',
    method: 'GET',
    requestHeaders: {},
    requestBody: null,
    timestamp: Date.now(),
  }
}

function createResponseFacade(data: ResponseData | PostResponseData): ScriptResponseFacade {
  const response = 'size' in data ? data : normalizeResponseData(data)
  return {
    code: response.status,
    status: response.statusText,
    responseTime: response.duration,
    responseSize: response.size,
    size: response.size,
    headers: createHeaderFacade(response.headers),
    body: response.body,
    text() { return response.body },
    json() {
      try { return JSON.parse(response.body) } catch { return null }
    },
    xml() {
      if (typeof DOMParser === 'undefined') return null
      try { return new DOMParser().parseFromString(response.body, 'application/xml') } catch { return null }
    },
    async blob() {
      return new Blob([response.body], { type: response.contentType || headerLookup(response.headers, 'content-type') || 'text/plain' })
    },
    jsonPath(path: string) {
      try { return jsonPathQuery(JSON.parse(response.body), path) } catch { return null }
    },
    match(pattern: string | RegExp) {
      const regex = typeof pattern === 'string' ? new RegExp(pattern) : pattern
      const matched = response.body.match(regex)
      return matched ? matched[0] : null
    },
    to: {
      have: {
        status(expected: number) {
          if (response.status !== expected) throw new Error(`expected status ${expected} but got ${response.status}`)
        },
        header(key: string) {
          if (headerLookup(response.headers, key) === undefined) throw new Error(`expected response to have header ${key}`)
        },
        body(expected: string | RegExp) {
          const matched = typeof expected === 'string' ? response.body.includes(expected) : expected.test(response.body)
          if (!matched) throw new Error('expected response body to match')
        },
        jsonBody(path?: string, expected?: unknown) {
          let parsed: unknown
          try {
            parsed = JSON.parse(response.body)
          } catch {
            throw new Error('expected response body to be valid JSON')
          }
          const actual = path ? jsonPathQuery(parsed, path) : parsed
          if (expected !== undefined && JSON.stringify(actual) !== JSON.stringify(expected)) {
            throw new Error(`expected JSON body ${path || '$'} to equal ${JSON.stringify(expected)}`)
          }
        },
        bodyContains(expected: string) {
          if (!response.body.includes(expected)) throw new Error(`expected response body to contain ${expected}`)
        },
      },
    },
    toJSON() { return response },
  }
}

function renderTemplate(template: string, data: unknown): string {
  if (!data || typeof data !== 'object') return template
  const resolvePath = (key: string) => key.split('.').reduce<unknown>((current, part) => {
      if (current && typeof current === 'object') return (current as Record<string, unknown>)[part]
      return undefined
    }, data)
  const interpolate = (_: string, key: string) => {
    const value = resolvePath(key.trim())
    return value == null ? '' : String(value)
  }
  return template
    .replace(/\{\{\s*([\w.-]+)\s*\}\}/g, interpolate)
    .replace(/<%=\s*([\w.-]+)\s*%>/g, interpolate)
}

function createPmEnvironment(envStore: Record<string, string>, changedEnvKeys: Set<string>, options?: ScriptExecutionOptions) {
  async function notify() {
    if (options?.onEnvSave) await options.onEnvSave(envStore, [...changedEnvKeys])
  }
  const scope = createPmVariableScope(envStore)
  return {
    set(key: string, value: string) {
      envStore[key] = String(value)
      changedEnvKeys.add(key)
      void notify()
    },
    get(key: string) { return envStore[key] },
    unset(key: string) {
      delete envStore[key]
      changedEnvKeys.add(key)
      void notify()
    },
    has(key: string) { return key in envStore },
    clear() {
      for (const key of Object.keys(envStore)) {
        delete envStore[key]
        changedEnvKeys.add(key)
      }
      void notify()
    },
    import(values: Record<string, unknown>) {
      for (const [key, value] of Object.entries(values ?? {})) {
        envStore[key] = String(value)
        changedEnvKeys.add(key)
      }
      void notify()
    },
    toObject() { return { ...envStore } },
    replaceIn(template: string) { return scope.replaceIn(template) },
  }
}


function createVaultFacade(initialValues: Record<string, unknown> = {}) {
  const store = new Map<string, string>()
  for (const [key, value] of Object.entries(initialValues)) store.set(key, String(value ?? ''))
  const resolveValue = <T>(valueFactory: () => T, callback?: (err: Error | null, value?: T) => void): Promise<T> => {
    const promise = Promise.resolve().then(valueFactory)
    if (callback) promise.then(value => callback(null, value)).catch(err => callback(err instanceof Error ? err : new Error(String(err))))
    return promise
  }
  return {
    get(key: string, callback?: (err: Error | null, value?: string) => void) {
      return resolveValue<string | undefined>(() => store.get(String(key)), callback as ((err: Error | null, value?: string | undefined) => void) | undefined)
    },
    set(key: string, value: unknown, callback?: (err: Error | null, value?: string) => void) {
      return resolveValue(() => {
        const normalized = String(value ?? '')
        store.set(String(key), normalized)
        return normalized
      }, callback)
    },
    unset(key: string, callback?: (err: Error | null) => void) {
      return resolveValue(() => {
        store.delete(String(key))
        return undefined
      }, callback as ((err: Error | null, value?: undefined) => void) | undefined)
    },
    clear(callback?: (err: Error | null) => void) {
      return resolveValue(() => {
        store.clear()
        return undefined
      }, callback as ((err: Error | null, value?: undefined) => void) | undefined)
    },
    has(key: string, callback?: (err: Error | null, value?: boolean) => void) {
      return resolveValue(() => store.has(String(key)), callback)
    },
    toObject() { return Object.fromEntries(store.entries()) },
  }
}

function createPmVariableScope(
  ownStore: Record<string, string> = {},
  fallbackScopes: Array<{ get: (key: string) => unknown; has?: (key: string) => boolean }> = [],
) {
  return {
    set(key: string, value: string) { ownStore[key] = String(value) },
    get(key: string) {
      if (key in ownStore) return ownStore[key]
      for (const scope of fallbackScopes) {
        if (scope.has ? scope.has(key) : scope.get(key) !== undefined) {
          const value = scope.get(key)
          return value == null ? undefined : String(value)
        }
      }
      return undefined
    },
    unset(key: string) { delete ownStore[key] },
    has(key: string) {
      return key in ownStore || fallbackScopes.some(scope => scope.has ? scope.has(key) : scope.get(key) !== undefined)
    },
    clear() {
      for (const key of Object.keys(ownStore)) delete ownStore[key]
    },
    import(values: Record<string, unknown>) {
      for (const [key, value] of Object.entries(values ?? {})) ownStore[key] = String(value)
    },
    toObject() { return { ...ownStore } },
    replaceIn(template: string) {
      return String(template).replace(/\{\{\s*([\w.-]+)\s*\}\}/g, (_, key: string) => {
        const value = this.get(key)
        return value == null ? '' : String(value)
      })
    },
  }
}

function createPmRequest(
  currentMethod: HttpMethod | undefined,
  currentHeaders: Record<string, string>,
  currentUrl: string,
  currentBody: string,
  currentUrlencoded: KvPair[],
  currentFormdata: KvPair[],
  currentCookies: CookieItem[] = [],
) {
  const headerStore: Record<string, string> = { ...currentHeaders }
  const cookieStore: CookieItem[] = currentCookies.map(cookie => ({ ...cookie }))
  let requestMethod = currentMethod || 'GET'
  const request = {
    get method() { return requestMethod },
    set method(value: string) { requestMethod = String(value || 'GET').toUpperCase() as HttpMethod },
    setMethod(value: string) { request.method = value },
      addHeader(input: unknown, value?: unknown) { (request.headers as any).add(input, value) },
    setHeader(key: string, value: string) { setHeaderValue(headerStore, key, value) },
    getHeader(key: string) { return headerLookup(headerStore, key) },
    removeHeader(key: string) {
      const lower = key.toLowerCase()
      const matched = Object.keys(headerStore).find(item => item.toLowerCase() === lower)
      if (matched) delete headerStore[matched]
    },
    addQueryParam(input: unknown, value?: unknown) { request.url.addQueryParams(input, value) },
    removeQueryParam(key: string) { request.url.removeQueryParams(key) },
    addCookie(input: unknown, value?: unknown) { request.cookies.add(input, value) },
    setCookie(key: string, value: string) { request.cookies.upsert(key, value) },
    getCookie(key: string) { return request.cookies.get(key) },
    removeCookie(key: string) { request.cookies.remove(key) },
    setPathParam(key: string, value: string | number) {
      const escapedKey = escapeRegExp(String(key))
      request.url._url = request.url._url.replace(new RegExp(`(:${escapedKey}|\\{${escapedKey}\\}|\\{\\{\\s*${escapedKey}\\s*\\}\\})`, 'g'), encodeURIComponent(String(value)))
    },
    headers: createMutableHeaderFacade(headerStore),
    cookies: {
      _store: cookieStore,
      add(input: unknown, value?: unknown) {
        for (const item of normalizeKvInput(input, value)) cookieStore.push(item)
      },
      set(key: string, value: string) { this.upsert(key, value) },
      upsert(input: unknown, value?: unknown) {
        for (const item of normalizeKvInput(input, value)) upsertField(cookieStore, item)
      },
      get(key: string) { return cookieStore.find(item => item.key === key)?.value },
      remove(key: string) {
        const index = cookieStore.findIndex(item => item.key === key)
        if (index >= 0) cookieStore.splice(index, 1)
      },
      has(key: string) { return cookieStore.some(item => item.key === key) },
      all() { return cookieStore.map(item => ({ ...item })) },
      toObject() {
        return Object.fromEntries(cookieStore.filter(item => item.enabled !== false).map(item => [item.key, item.value]))
      },
      each(callback: (value: string, key: string) => void) {
        cookieStore.forEach(item => callback(item.value, item.key))
      },
      clear() {
        cookieStore.splice(0, cookieStore.length)
      },
    },
    body: {
      _raw: currentBody,
      _fields: currentUrlencoded.map(f => ({ ...f })),
      _formdata: currentFormdata.map(f => ({ ...f })),
      get raw() { return this._raw },
      set raw(val: string) { applyBodyInput(this, val) },
      update(val: unknown) { applyBodyInput(this, val) },
      set(key: string, value: string) {
        const existing = this._fields.find(f => f.key === key)
        if (existing) { existing.value = value; existing.enabled = true }
        else this._fields.push({ key, value, enabled: true })
      },
      get(key: string) { return this._fields.find(f => f.key === key)?.value },
      remove(key: string) {
        this._fields = this._fields.filter(f => f.key !== key)
      },
      text() { return this._raw },
      json() {
        try { return JSON.parse(this._raw) } catch { return null }
      },
      toObject() {
        return {
          raw: this._raw,
          urlencoded: this._fields.map(f => ({ ...f })),
          formdata: this._formdata.map(f => ({ ...f })),
        }
      },
      all() { return this.toObject() },
      toString() { return this._raw },
      urlencoded: {
        add: (input: unknown, value?: unknown) => {
          for (const item of normalizeKvInput(input, value)) upsertField(request.body._fields, item)
        },
        upsert: (input: unknown, value?: unknown) => {
          for (const item of normalizeKvInput(input, value)) upsertField(request.body._fields, item)
        },
        remove: (key: string) => {
          request.body._fields = request.body._fields.filter(item => item.key !== key)
        },
        all: () => request.body._fields.map(item => ({ ...item })),
      },
      formdata: {
        add: (input: unknown, value?: unknown) => {
          for (const item of normalizeKvInput(input, value)) upsertField(request.body._formdata, item)
        },
        upsert: (input: unknown, value?: unknown) => {
          for (const item of normalizeKvInput(input, value)) upsertField(request.body._formdata, item)
        },
        remove: (key: string) => {
          request.body._formdata = request.body._formdata.filter(item => item.key !== key)
        },
        all: () => request.body._formdata.map(item => ({ ...item })),
      },
    },
    url: {
      _url: currentUrl,
      get raw() { return this._url },
      set raw(val: string) { this._url = String(val ?? '') },
      get href() { return this._url },
      set href(val: string) { this._url = String(val ?? '') },
      set(val: string) { this._url = val },
      get() { return this._url },
      addQueryParams(input: unknown, value?: unknown) {
        const fields = normalizeKvInput(input, value).filter(item => item.enabled)
        for (const field of fields) {
          const sep = this._url.includes('?') ? '&' : '?'
          this._url += sep + encodeURIComponent(field.key) + '=' + encodeURIComponent(field.value)
        }
      },
      upsertQueryParams(input: unknown, value?: unknown) {
        const fields = normalizeKvInput(input, value).filter(item => item.enabled)
        for (const field of fields) {
          this.removeQueryParams(field.key)
          this.addQueryParams(field.key, field.value)
        }
      },
      removeQueryParams(key: string) {
        const [base, hash = ''] = this._url.split('#')
        const [path, query = ''] = base.split('?')
        const params = new URLSearchParams(query)
        params.delete(key)
        const nextQuery = params.toString()
        this._url = `${path}${nextQuery ? `?${nextQuery}` : ''}${hash ? `#${hash}` : ''}`
      },
      allQueryParams() {
        const query = this._url.split('#')[0].split('?')[1] || ''
        return Array.from(new URLSearchParams(query).entries()).map(([key, value]) => ({ key, value, enabled: true }))
      },
      toJSON() { return this._url },
      valueOf() { return this._url },
      toString() { return this._url },
      [Symbol.toPrimitive]() { return this._url },
      includes(search: string, position?: number) { return this._url.includes(search, position) },
      startsWith(search: string, position?: number) { return this._url.startsWith(search, position) },
      endsWith(search: string, endPosition?: number) { return this._url.endsWith(search, endPosition) },
      match(pattern: string | RegExp) { return this._url.match(pattern as any) },
      replace(pattern: string | RegExp, replacement: string) { return this._url.replace(pattern as any, replacement) },
    },
  }
  return new Proxy(request, {
    set(target, prop, value) {
      if (prop === 'url') {
        target.url.set(String(value ?? ''))
        return true
      }
      if (prop === 'body') {
        target.body.update(value)
        return true
      }
      if (prop === 'method') {
        target.method = String(value ?? 'GET')
        return true
      }
      return Reflect.set(target, prop, value)
    },
  })
}
type PmRequest = ReturnType<typeof createPmRequest>

function createVisualizer(visualizations: ScriptVisualization[], appendLog: (level: ScriptLog['level'], ...args: unknown[]) => void) {
  function addVisualization(type: ScriptVisualization['type'], title: string, content: string, data?: unknown) {
    visualizations.push({
      id: generateRequestId(),
      type,
      title,
      content,
      data,
      createdAt: Date.now(),
    })
    appendLog('info', `生成 Visualizer：${title}`)
  }

  return {
    set(content: string, data?: unknown) {
      this.template(content, data)
    },
    template(template: string, data?: unknown, options?: { title?: string }) {
      addVisualization('template', options?.title || '模板预览', renderTemplate(String(template), data), data)
    },
    table(data: unknown, options?: { title?: string }) {
      const rows = Array.isArray(data) ? data : []
      const columns = rows.length > 0 && typeof rows[0] === 'object' ? Object.keys(rows[0] as Record<string, unknown>) : []
      const head = columns.map(col => `<th>${escapeHtml(col)}</th>`).join('')
      const body = rows.map(row => `<tr>${columns.map(col => `<td>${escapeHtml(String((row as Record<string, unknown>)[col] ?? ''))}</td>`).join('')}</tr>`).join('')
      addVisualization('table', options?.title || '表格预览', `<table><thead><tr>${head}</tr></thead><tbody>${body}</tbody></table>`, data)
    },
    clear() {
      visualizations.splice(0, visualizations.length)
    },
  }
}

function escapeHtml(value: string): string {
  return value
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#39;')
}

function createSendRequestFacade(
  options: ScriptExecutionOptions | undefined,
  appendLog: (level: ScriptLog['level'], ...args: unknown[]) => void,
) {
  const sendRequest = async (input: ScriptSendRequestInput, callback?: ScriptSendRequestCallback): Promise<ScriptResponseFacade> => {
    if (!options?.sendRequest) {
      const err = new Error('pm.sendRequest 尚未连接到请求代理')
      callback?.(err, null)
      throw err
    }
    try {
      appendLog('info', 'pm.sendRequest 开始')
      const response = await options.sendRequest(input)
      const facade = createResponseFacade(response)
      appendLog('info', `pm.sendRequest 完成：${response.status} ${response.statusText}`)
      callback?.(null, facade)
      return facade
    } catch (err) {
      const normalized = err instanceof Error ? err : new Error(String(err))
      appendLog('error', `pm.sendRequest 失败：${normalized.message}`)
      callback?.(normalized, null)
      throw normalized
    }
  }

  sendRequest.sendInterface = async (
    interfaceOrApiId: string,
    overrides?: ScriptSendRequestInput,
    callback?: ScriptSendRequestCallback,
  ): Promise<ScriptResponseFacade> => {
    if (!options?.sendInterface) {
      const err = new Error('pm.sendRequest.sendInterface 尚未连接到接口代理')
      callback?.(err, null)
      throw err
    }
    try {
      appendLog('info', `pm.sendRequest.sendInterface 开始：${interfaceOrApiId}`)
      const response = await options.sendInterface(interfaceOrApiId, overrides)
      const facade = createResponseFacade(response)
      appendLog('info', `pm.sendRequest.sendInterface 完成：${response.status} ${response.statusText}`)
      callback?.(null, facade)
      return facade
    } catch (err) {
      const normalized = err instanceof Error ? err : new Error(String(err))
      appendLog('error', `pm.sendRequest.sendInterface 失败：${normalized.message}`)
      callback?.(normalized, null)
      throw normalized
    }
  }

  return sendRequest
}


function createExecutionFacade(
  options: ScriptExecutionOptions | undefined,
  appendLog: (level: ScriptLog['level'], ...args: unknown[]) => void,
) {
  const state: { skipRequest: boolean; nextRequest: string | null; runRequestCount: number } = { skipRequest: false, nextRequest: null, runRequestCount: 0 }
  const runRequest = async (interfaceOrApiId: string, overrides?: ScriptSendRequestInput, callback?: ScriptSendRequestCallback): Promise<ScriptResponseFacade> => {
    if (typeof overrides === 'function') {
      callback = overrides as ScriptSendRequestCallback
      overrides = undefined
    }
    state.runRequestCount += 1
    if (state.runRequestCount > 10) {
      const err = new Error('pm.execution.runRequest 每个脚本最多调用 10 次')
      callback?.(err, null)
      throw err
    }
    if (!options?.sendInterface) {
      const err = new Error('pm.execution.runRequest 尚未连接到接口代理')
      callback?.(err, null)
      throw err
    }
    try {
      appendLog('info', `pm.execution.runRequest 开始：${interfaceOrApiId}`)
      const response = await options.sendInterface(interfaceOrApiId, overrides)
      const facade = createResponseFacade(response)
      appendLog('info', `pm.execution.runRequest 完成：${response.status} ${response.statusText}`)
      callback?.(null, facade)
      return facade
    } catch (err) {
      const normalized = err instanceof Error ? err : new Error(String(err))
      appendLog('error', `pm.execution.runRequest 失败：${normalized.message}`)
      callback?.(normalized, null)
      throw normalized
    }
  }
  const info = options?.info ?? {}
  const locationParts = [info.categoryName, info.moduleName, info.interfaceName].filter(Boolean).map(String)
  const location = Object.assign([...locationParts], { current: locationParts[locationParts.length - 1] || '' })
  return {
    _state: state,
    location,
    setNextRequest(requestNameOrId: string | null) {
      state.nextRequest = requestNameOrId == null ? null : String(requestNameOrId)
      appendLog('info', `pm.execution.setNextRequest：${state.nextRequest ?? 'null'}`)
    },
    skipRequest() {
      state.skipRequest = true
      appendLog('warn', 'pm.execution.skipRequest：已跳过当前请求发送')
    },
    runRequest,
    get nextRequest() { return state.nextRequest },
    get skipped() { return state.skipRequest },
  }
}

async function runScriptWithTimeout(scriptRunner: () => Promise<void>, timeoutMs: number) {
  let timer: ReturnType<typeof setTimeout> | undefined
  try {
    await Promise.race([
      scriptRunner(),
      new Promise<void>((_, reject) => {
        timer = setTimeout(() => reject(createScriptTimeoutError(`ScriptTimeoutError: Script execution timed out (${Math.round(timeoutMs / 1000)}s)`)), timeoutMs)
      }),
    ])
  } finally {
    if (timer) clearTimeout(timer)
  }
}

function shouldUseIframeSandbox(): boolean {
  return typeof document !== 'undefined' && typeof window !== 'undefined'
}

/** Phase 4.2:从执行完的 pm 上差分出 collection/global 作用域变更 */
function scopedResultOf(pm: any): Partial<ScriptResult> {
  const scoped = pm?.__scopedStores
  if (!scoped) return {}
  const diffKeys = (initial: Record<string, string>, final: Record<string, string>) => {
    const keys = new Set([...Object.keys(initial), ...Object.keys(final)])
    const changed: string[] = []
    for (const key of keys) {
      if (initial[key] !== final[key]) changed.push(key)
    }
    return changed
  }
  return {
    collectionVars: { ...scoped.collectionStore },
    changedCollectionKeys: diffKeys(scoped.initialCollection, scoped.collectionStore),
    globalVars: { ...scoped.globalStore },
    changedGlobalKeys: diffKeys(scoped.initialGlobal, scoped.globalStore),
  }
}

export async function executePreRequestScriptAsync(
  script: string,
  currentHeaders: Record<string, string>,
  currentUrl: string,
  currentBody: string,
  currentUrlencoded: KvPair[],
  currentFormdata: KvPair[],
  envVars: Record<string, string>,
  options: ScriptExecutionOptions = {},
): Promise<ScriptResult> {
  if (!script || !script.trim()) {
    return emptyResult(currentHeaders, currentUrl, currentBody, currentUrlencoded, currentFormdata, envVars, options.requestCookies || [])
  }

  if (shouldUseWorkerSandbox()) {
    try {
      return await executeScriptInWorkerSandbox(script, currentHeaders, currentUrl, currentBody, currentUrlencoded, currentFormdata, envVars, undefined, options)
    } catch (err) {
      if (!isScriptTimeoutError(err)) {
        return executeScriptInSandbox(script, currentHeaders, currentUrl, currentBody, currentUrlencoded, currentFormdata, envVars, undefined, options)
      }
      throw err
    }
  }

  if (shouldUseIframeSandbox()) {
    return executeScriptInSandbox(script, currentHeaders, currentUrl, currentBody, currentUrlencoded, currentFormdata, envVars, undefined, options)
  }

  const logs: ScriptLog[] = []
  const visualizations: ScriptVisualization[] = []
  const tests: ScriptTestResult[] = []
  const pendingTests: Promise<void>[] = []
  const envStore: Record<string, string> = { ...envVars }
  const changedEnvKeys = new Set<string>()

  const appendLog = (level: ScriptLog['level'], ...args: unknown[]) => {
    logs.push({ level, timestamp: Date.now(), args: args.map(formatLogArg) })
  }

  const pmRequest = createPmRequest(options.requestMethod, currentHeaders, currentUrl, currentBody, currentUrlencoded, currentFormdata, options.requestCookies || [])
  const pm = createPmRuntime({ pmRequest, envStore, changedEnvKeys, logs, visualizations, tests, pendingTests, appendLog, options })

  await executeAsyncScript(script, pm, tests, pendingTests, appendLog, options.timeoutMs ?? 30000)

  return {
    method: pm.request.method,
    headers: pm.request.headers._store,
    cookies: pm.request.cookies._store,
    url: pm.request.url._url,
    body: pm.request.body._raw,
    urlencoded: pm.request.body._fields,
    formdata: pm.request.body._formdata,
    envVars: envStore,
    envChangedKeys: [...changedEnvKeys],
    ...scopedResultOf(pm),
    skipRequest: Boolean(pm.execution?._state?.skipRequest),
    nextRequest: pm.execution?._state?.nextRequest ?? null,
    logs,
    visualizations,
    tests,
    error: logs.find(log => log.level === 'error' && log.args[0]?.startsWith('脚本执行错误'))?.args[0],
  }
}

// Backward-compatible synchronous fallback. It cannot wait for top-level await or pm.sendRequest;
// new request flow should use executePreRequestScriptAsync.
export function executePreRequestScript(
  script: string,
  currentHeaders: Record<string, string>,
  currentUrl: string,
  currentBody: string,
  currentUrlencoded: KvPair[],
  currentFormdata: KvPair[],
  envVars: Record<string, string>,
  onEnvSave?: (vars: Record<string, string>) => void,
): ScriptResult {
  let result = emptyResult(currentHeaders, currentUrl, currentBody, currentUrlencoded, currentFormdata, envVars)
  void executePreRequestScriptAsync(script, currentHeaders, currentUrl, currentBody, currentUrlencoded, currentFormdata, envVars, {
    onEnvSave: vars => onEnvSave?.(vars),
  }).then(next => { result = next })
  return result
}

export async function executePostResponseScriptAsync(
  script: string,
  responseData: PostResponseData,
  envVars: Record<string, string>,
  options: ScriptExecutionOptions = {},
): Promise<ScriptResult> {
  if (!script || !script.trim()) {
    return emptyResult({}, '', '', [], [], envVars)
  }

  if (shouldUseWorkerSandbox()) {
    try {
      return await executeScriptInWorkerSandbox(script, {}, '', '', [], [], envVars, responseData, options)
    } catch (err) {
      if (!isScriptTimeoutError(err)) {
        return executeScriptInSandbox(script, {}, '', '', [], [], envVars, responseData, options)
      }
      throw err
    }
  }

  if (shouldUseIframeSandbox()) {
    return executeScriptInSandbox(script, {}, '', '', [], [], envVars, responseData, options)
  }

  const logs: ScriptLog[] = []
  const visualizations: ScriptVisualization[] = []
  const tests: ScriptTestResult[] = []
  const pendingTests: Promise<void>[] = []
  const envStore: Record<string, string> = { ...envVars }
  const changedEnvKeys = new Set<string>()

  const appendLog = (level: ScriptLog['level'], ...args: unknown[]) => {
    logs.push({ level, timestamp: Date.now(), args: args.map(formatLogArg) })
  }

  const pmRequest = createPmRequest(options.requestMethod, {}, '', '', [], [], options.requestCookies || [])
  const pm = createPmRuntime({ pmRequest, envStore, changedEnvKeys, logs, visualizations, tests, pendingTests, appendLog, options })
  pm.response = createResponseFacade(responseData)

  await executeAsyncScript(script, pm, tests, pendingTests, appendLog, options.timeoutMs ?? 30000)

  return {
    headers: {},
    cookies: pm.request.cookies._store,
    url: '',
    body: '',
    urlencoded: [],
    formdata: [],
    envVars: envStore,
    envChangedKeys: [...changedEnvKeys],
    ...scopedResultOf(pm),
    skipRequest: Boolean(pm.execution?._state?.skipRequest),
    nextRequest: pm.execution?._state?.nextRequest ?? null,
    logs,
    visualizations,
    tests,
    error: logs.find(log => log.level === 'error' && log.args[0]?.startsWith('脚本执行错误'))?.args[0],
  }
}

export function executePostResponseScript(
  script: string,
  responseData: PostResponseData,
  envVars: Record<string, string>,
  onEnvSave?: (vars: Record<string, string>) => void,
): ScriptResult {
  let result = emptyResult({}, '', '', [], [], envVars)
  void executePostResponseScriptAsync(script, responseData, envVars, {
    onEnvSave: vars => onEnvSave?.(vars),
  }).then(next => { result = next })
  return result
}

function createPmRuntime(args: {
  pmRequest: PmRequest
  envStore: Record<string, string>
  changedEnvKeys: Set<string>
  logs: ScriptLog[]
  visualizations: ScriptVisualization[]
  tests: ScriptTestResult[]
  pendingTests: Promise<void>[]
  appendLog: (level: ScriptLog['level'], ...args: unknown[]) => void
  options?: ScriptExecutionOptions
}) {
  const environment = createPmEnvironment(args.envStore, args.changedEnvKeys, args.options)
  // Phase 4.2:pm.collectionVariables / pm.globals 落到真实 store(可持久化),
  // 快照用于差分出变更 key。
  const collectionStore: Record<string, string> = { ...(args.options?.collectionVarStore ?? {}) }
  const globalStore: Record<string, string> = { ...(args.options?.globalVarStore ?? {}) }
  const globals = createPmVariableScope(globalStore, [environment])
  const collectionVariables = createPmVariableScope(collectionStore, [environment])
  const variables = createPmVariableScope({}, [environment, collectionVariables, globals])
  const environmentSet = environment.set.bind(environment)
  const globalsSet = globals.set.bind(globals)
  const collectionSet = collectionVariables.set.bind(collectionVariables)
  const variablesSet = variables.set.bind(variables)
  const setScopedVariable = (fallback: (key: string, value: string) => void, key: string, value: unknown, scope?: string) => {
    const normalized = String(scope || '').toLowerCase()
    if (normalized === 'global' || normalized === 'globals') globalsSet(key, String(value))
    else if (normalized === 'module' || normalized === 'collection' || normalized === 'collectionvariables') collectionSet(key, String(value))
    else if (normalized === 'local' || normalized === 'variable' || normalized === 'variables') variablesSet(key, String(value))
    else if (normalized === 'environment' || normalized === 'env') environmentSet(key, String(value))
    else fallback(key, String(value))
  }
  environment.set = (key: string, value: string, scope?: string) => setScopedVariable(environmentSet, key, value, scope)
  globals.set = (key: string, value: string, scope?: string) => setScopedVariable(globalsSet, key, value, scope)
  collectionVariables.set = (key: string, value: string, scope?: string) => setScopedVariable(collectionSet, key, value, scope)
  variables.set = (key: string, value: string, scope?: string) => setScopedVariable(variablesSet, key, value, scope)
  const cookies = createCookieFacade(args.pmRequest.cookies._store, args.pmRequest.url._url)
  const vault = createVaultFacade()
  const execution = createExecutionFacade(args.options, args.appendLog)
  const pm: any = {
    request: args.pmRequest,
    cookies,
    cookieJar: cookies.jar(),
    vault,
    execution,
    info: {
      moduleName: '',
      categoryName: '',
      interfaceName: '',
      eventName: 'prerequest',
      ...args.options?.info,
    },
    environment,
    globals,
    collectionVariables,
    variables,
    /** Phase 4.2:作用域 store 快照,执行完成后差分出变更(见 scopedResultOf) */
    __scopedStores: {
      collectionStore,
      globalStore,
      initialCollection: { ...collectionStore },
      initialGlobal: { ...globalStore },
    },
    iterationData: createPmVariableScope({}, [environment]),
    response: undefined,
    visualizer: createVisualizer(args.visualizations, args.appendLog),
    sendRequest: createSendRequestFacade(args.options, args.appendLog),
    test: (name: string, fn: () => void | Promise<void>) => {
      try {
        const maybePromise = fn()
        if (maybePromise && typeof (maybePromise as Promise<void>).then === 'function') {
          args.pendingTests.push((maybePromise as Promise<void>)
            .then(() => { args.tests.push({ name, passed: true }) })
            .catch((err: unknown) => { args.tests.push({ name, passed: false, error: err instanceof Error ? err.message : String(err) }) }))
        } else {
          args.tests.push({ name, passed: true })
        }
      } catch (err) {
        args.tests.push({ name, passed: false, error: err instanceof Error ? err.message : String(err) })
      }
    },
    expect: (value: unknown) => createExpectChain(value),
  }
  pm.collection = collectionVariables
  pm.test.skip = (name: string) => {
    args.tests.push({ name, passed: true, skipped: true })
  }
  return pm
}

async function executeAsyncScript(
  script: string,
  pm: any,
  tests: ScriptTestResult[],
  pendingTests: Promise<void>[],
  appendLog: (level: ScriptLog['level'], ...args: unknown[]) => void,
  timeoutMs: number,
) {
  const postman = {
    setEnvironmentVariable: (key: string, value: string) => pm.environment.set(key, value),
    getEnvironmentVariable: (key: string) => pm.environment.get(key),
    clearEnvironmentVariable: (key: string) => pm.environment.unset(key),
    setGlobalVariable: (key: string, value: string) => pm.globals.set(key, value),
    getGlobalVariable: (key: string) => pm.globals.get(key),
    clearGlobalVariable: (key: string) => pm.globals.unset(key),
    environment: pm.environment,
    globals: pm.globals,
    collection: pm.collection,
    collectionVariables: pm.collectionVariables,
    variables: pm.variables,
    iterationData: pm.iterationData,
    cookies: pm.cookies,
    cookieJar: pm.cookieJar,
    vault: pm.vault,
    execution: pm.execution,
    request: pm.request,
    response: pm.response,
    info: pm.info,
    test: pm.test,
    expect: pm.expect,
  }

  const scriptConsole = {
    log: (...args: unknown[]) => appendLog('log', ...args),
    warn: (...args: unknown[]) => appendLog('warn', ...args),
    error: (...args: unknown[]) => appendLog('error', ...args),
    info: (...args: unknown[]) => appendLog('info', ...args),
    table: (...args: unknown[]) => appendLog('table', ...args),
  }

  try {
    const AsyncFunction = Object.getPrototypeOf(async function () {}).constructor
    const deniedGlobal = undefined
    const CryptoJS = createCryptoJsShim()
    // 不能加 'use strict':strict 下 'eval' 不能作为参数名,沙箱函数会构造失败(遮蔽失效)
    const safeScript = String(script ?? '')
    const fn = new AsyncFunction(
      'pm', 'postman', 'console', 'Math', 'Date', 'parseInt', 'parseFloat',
      'JSON', 'CryptoJS', 'encodeURIComponent', 'decodeURIComponent', 'btoa', 'atob',
      'setTimeout', 'setInterval', 'clearTimeout', 'clearInterval',
      'Promise', 'Array', 'Object', 'String', 'Number', 'Boolean',
      'RegExp', 'Map', 'Set', 'WeakMap', 'WeakSet', 'Proxy', 'Reflect', 'Symbol', 'Intl',
      'ArrayBuffer', 'Uint8Array', 'TextEncoder', 'TextDecoder', 'URL', 'URLSearchParams',
      'FormData', 'Blob', 'File', 'Error', 'TypeError', 'RangeError',
      'window', 'document', 'navigator', 'location', 'fetch', 'XMLHttpRequest', 'WebSocket',
      'localStorage', 'sessionStorage', 'indexedDB', 'eval', 'Function', 'globalThis',
      'self', 'parent', 'top', 'opener', 'chrome',
      safeScript,
    )
    await runScriptWithTimeout(async () => {
      await fn(
        pm, postman, scriptConsole, Math, Date, parseInt, parseFloat,
        JSON, CryptoJS, encodeURIComponent, decodeURIComponent, btoa, atob,
        setTimeout, setInterval, clearTimeout, clearInterval,
        Promise, Array, Object, String, Number, Boolean,
        RegExp, Map, Set, WeakMap, WeakSet, Proxy, Reflect, Symbol, Intl,
        ArrayBuffer, Uint8Array, TextEncoder, TextDecoder, URL, URLSearchParams,
        typeof FormData === 'undefined' ? undefined : FormData,
        typeof Blob === 'undefined' ? undefined : Blob,
        typeof File === 'undefined' ? undefined : File,
        Error, TypeError, RangeError,
        deniedGlobal, deniedGlobal, deniedGlobal, deniedGlobal, deniedGlobal, deniedGlobal, deniedGlobal,
        deniedGlobal, deniedGlobal, deniedGlobal, deniedGlobal, deniedGlobal, deniedGlobal,
        deniedGlobal, deniedGlobal, deniedGlobal, deniedGlobal, deniedGlobal,
      )
      await Promise.all(pendingTests)
    }, timeoutMs)
  } catch (err) {
    appendLog('error', `脚本执行错误: ${err instanceof Error ? err.message : String(err)}`)
  }

  for (const result of tests) {
    appendLog(result.passed ? 'log' : 'error', result.skipped ? `[SKIP] ${result.name}` : result.passed ? `[PASS] ${result.name}` : `[FAIL] ${result.name}: ${result.error}`)
  }
}

function parseJsonPath(path: string): Array<string | number | '*'> {
  const source = path.trim().replace(/^json(?=\.)/, '$')
  const tokens: Array<string | number | '*'> = []
  let i = source.startsWith('$') ? 1 : 0
  while (i < source.length) {
    const char = source[i]
    if (char === '.') {
      i += 1
      if (source[i] === '*') { tokens.push('*'); i += 1; continue }
      let key = ''
      while (i < source.length && !['.', '['].includes(source[i])) key += source[i++]
      if (key) tokens.push(key)
      continue
    }
    if (char === '[') {
      const end = source.indexOf(']', i)
      if (end < 0) break
      const raw = source.slice(i + 1, end).trim()
      if (raw === '*') tokens.push('*')
      else if (/^['"].*['"]$/.test(raw)) tokens.push(raw.slice(1, -1))
      else if (/^-?\d+$/.test(raw)) tokens.push(Number(raw))
      else if (raw) tokens.push(raw)
      i = end + 1
      continue
    }
    let key = ''
    while (i < source.length && !['.', '['].includes(source[i])) key += source[i++]
    if (key) tokens.push(key)
  }
  return tokens
}

function jsonPathQuery(data: unknown, path: string): unknown {
  const tokens = parseJsonPath(path)
  if (tokens.length === 0) return data
  const visit = (current: unknown, index: number): unknown => {
    if (index >= tokens.length) return current
    const token = tokens[index]
    if (token === '*') {
      const list = Array.isArray(current)
        ? current
        : current && typeof current === 'object'
          ? Object.values(current as Record<string, unknown>)
          : []
      return list.map(item => visit(item, index + 1)).filter(item => item !== undefined)
    }
    if (current == null) return null
    if (Array.isArray(current) && typeof token === 'number') return visit(current[token], index + 1)
    if (typeof current === 'object') return visit((current as Record<string, unknown>)[String(token)], index + 1)
    return null
  }
  return visit(data, 0)
}

function createExpectChain(value: unknown) {
  const state = { negate: false, deep: false }
  const assert = (condition: boolean, message: string) => {
    const failed = state.negate ? condition : !condition
    state.negate = false
    state.deep = false
    if (failed) throw new Error(message)
  }
  const isType = (expected: string) => {
    const normalized = expected.toLowerCase()
    if (normalized === 'array') return Array.isArray(value)
    if (normalized === 'null') return value === null
    return typeof value === normalized
  }
  const actualType = () => Array.isArray(value) ? 'array' : value === null ? 'null' : typeof value
  const deepEqual = (left: unknown, right: unknown) => JSON.stringify(left) === JSON.stringify(right)
  const getLength = (target: unknown) => typeof target === 'string' || Array.isArray(target)
    ? target.length
    : target && typeof target === 'object'
      ? Object.keys(target).length
      : undefined

  const chain: any = {
    get not() { state.negate = !state.negate; return chain },
    get to() { return chain },
    get be() { return chain },
    get been() { return chain },
    get is() { return chain },
    get that() { return chain },
    get which() { return chain },
    get and() { return chain },
    get have() { return chain },
    get has() { return chain },
    get with() { return chain },
    get at() { return chain },
    get of() { return chain },
    get same() { return chain },
    get deep() { state.deep = true; return chain },
    get contain() { return chain },
    get contains() { return chain },
    get ok() {
      assert(Boolean(value), `Expected ${formatLogArg(value)} to ${state.negate ? 'not ' : ''}be truthy`)
      return chain
    },
    get true() {
      assert(value === true, `Expected ${formatLogArg(value)} to ${state.negate ? 'not ' : ''}be true`)
      return chain
    },
    get false() {
      assert(value === false, `Expected ${formatLogArg(value)} to ${state.negate ? 'not ' : ''}be false`)
      return chain
    },
    get null() {
      assert(value === null, `Expected ${formatLogArg(value)} to ${state.negate ? 'not ' : ''}be null`)
      return chain
    },
    get undefined() {
      assert(value === undefined, `Expected ${formatLogArg(value)} to ${state.negate ? 'not ' : ''}be undefined`)
      return chain
    },
    get exist() {
      assert(value != null, `Expected value to ${state.negate ? 'not ' : ''}exist`)
      return chain
    },
    get empty() {
      const length = getLength(value)
      assert(length === 0, `Expected ${formatLogArg(value)} to ${state.negate ? 'not ' : ''}be empty`)
      return chain
    },
    get finite() {
      assert(Number.isFinite(Number(value)), `Expected ${formatLogArg(value)} to ${state.negate ? 'not ' : ''}be finite`)
      return chain
    },
    a(type: string) {
      assert(isType(type), `Expected ${actualType()} to ${state.negate ? 'not ' : ''}be ${type}`)
      return chain
    },
    an(type: string) {
      assert(isType(type), `Expected ${actualType()} to ${state.negate ? 'not ' : ''}be ${type}`)
      return chain
    },
    eql(expected: unknown) {
      assert(deepEqual(value, expected), `Expected ${JSON.stringify(value)} to ${state.negate ? 'not ' : ''}deep equal ${JSON.stringify(expected)}`)
      return chain
    },
    equal(expected: unknown) {
      assert(state.deep ? deepEqual(value, expected) : value === expected, `Expected ${formatLogArg(value)} to ${state.negate ? 'not ' : ''}equal ${formatLogArg(expected)}`)
      return chain
    },
    equals(expected: unknown) { return chain.equal(expected) },
    oneOf(expected: unknown[]) {
      assert(expected.includes(value), `Expected ${formatLogArg(value)} to ${state.negate ? 'not ' : ''}be one of ${JSON.stringify(expected)}`)
      return chain
    },
    match(regex: RegExp | string) {
      const matcher = typeof regex === 'string' ? new RegExp(regex) : regex
      assert(matcher.test(String(value)), `Expected ${formatLogArg(value)} to ${state.negate ? 'not ' : ''}match ${matcher}`)
      return chain
    },
    include(substring: unknown) {
      if (typeof value === 'string') assert(value.includes(String(substring)), `Expected "${value}" to ${state.negate ? 'not ' : ''}include "${substring}"`)
      else if (Array.isArray(value)) assert(value.includes(substring), `Expected array to ${state.negate ? 'not ' : ''}include ${formatLogArg(substring)}`)
      else if (value && typeof value === 'object') assert(String(substring) in (value as Record<string, unknown>), `Expected object to ${state.negate ? 'not ' : ''}include key ${String(substring)}`)
      else assert(false, 'Expected value to be string, array or object')
      return chain
    },
    includes(substring: unknown) { return chain.include(substring) },
    above(n: number) {
      assert(Number(value) > n, `Expected ${formatLogArg(value)} to be above ${n}`)
      return chain
    },
    greaterThan(n: number) { return chain.above(n) },
    below(n: number) {
      assert(Number(value) < n, `Expected ${formatLogArg(value)} to be below ${n}`)
      return chain
    },
    lessThan(n: number) { return chain.below(n) },
    within(min: number, max: number) {
      assert(Number(value) >= min && Number(value) <= max, `Expected ${formatLogArg(value)} to be within ${min}..${max}`)
      return chain
    },
    property(name: string, expected?: unknown) {
      const obj = value as Record<string, unknown>
      const shouldDeepEqual = state.deep
      assert(obj != null && typeof obj === 'object' && name in obj, `Expected object to ${state.negate ? 'not ' : ''}have property "${name}"`)
      if (arguments.length > 1) assert(shouldDeepEqual ? deepEqual(obj[name], expected) : obj[name] === expected, `Expected property "${name}" to equal ${formatLogArg(expected)}`)
      return createExpectChain(obj?.[name])
    },
    ownProperty(name: string) { return chain.property(name) },
    ownPropertyDescriptor(name: string) {
      const descriptor = value != null && typeof value === 'object' ? Object.getOwnPropertyDescriptor(value, name) : undefined
      assert(Boolean(descriptor), `Expected object to ${state.negate ? 'not ' : ''}have own property descriptor "${name}"`)
      return createExpectChain(descriptor)
    },
    key(name: string) {
      const obj = value as Record<string, unknown>
      assert(obj != null && typeof obj === 'object' && name in obj, `Expected object to ${state.negate ? 'not ' : ''}contain key "${name}"`)
      return chain
    },
    keys(...names: string[]) {
      const expected = Array.isArray(names[0]) ? names[0] as unknown as string[] : names
      const obj = value as Record<string, unknown>
      assert(obj != null && typeof obj === 'object' && expected.every(name => name in obj), `Expected object to contain keys ${expected.join(', ')}`)
      return chain
    },
    lengthOf(expected: number) {
      const length = getLength(value)
      assert(length === expected, `Expected length ${length} to ${state.negate ? 'not ' : ''}equal ${expected}`)
      return chain
    },
    length(expected: number) { return chain.lengthOf(expected) },
    least(n: number) {
      assert(Number(value) >= n, `Expected ${formatLogArg(value)} to be at least ${n}`)
      return chain
    },
    gte(n: number) { return chain.least(n) },
    most(n: number) {
      assert(Number(value) <= n, `Expected ${formatLogArg(value)} to be at most ${n}`)
      return chain
    },
    lte(n: number) { return chain.most(n) },
    members(expected: unknown[]) {
      assert(Array.isArray(value) && Array.isArray(expected) && expected.every(item => (value as unknown[]).includes(item)), `Expected array to include members ${JSON.stringify(expected)}`)
      return chain
    },
    satisfy(predicate: (value: unknown) => boolean) {
      assert(typeof predicate === 'function' && predicate(value), 'Expected value to satisfy predicate')
      return chain
    },
    'throw'(expected?: RegExp | string) {
      assert(typeof value === 'function', 'Expected value to be a function')
      let thrown: unknown
      try { (value as () => unknown)() } catch (err) { thrown = err }
      const didThrow = thrown !== undefined
      if (expected && didThrow) {
        const message = thrown instanceof Error ? thrown.message : String(thrown)
        const matched = typeof expected === 'string' ? message.includes(expected) : expected.test(message)
        assert(matched, `Expected thrown error to match ${expected}`)
      } else {
        assert(didThrow, `Expected function to ${state.negate ? 'not ' : ''}throw`)
      }
      return chain
    },
    throws(expected?: RegExp | string) { return chain.throw(expected) },
  }
  chain.bea = (type: string) => {
    assert(typeof value === type, `Expected ${typeof value} to ${state.negate ? 'not ' : ''}be ${type}`)
    return chain
  }
  return chain
}

export function createDefaultBodyConfig(): BodyConfig {
  return {
    type: 'none',
    raw: '',
    formData: [],
    urlEncoded: [],
    binaryFile: null,
    contentType: '',
  }
}

export function createDefaultAuthConfig(): AuthConfig {
  return createDefaultAuthConfigValue()
}

export function createDefaultCookies(): CookieItem[] {
  return []
}
