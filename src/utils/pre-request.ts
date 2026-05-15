import type { KvPair } from '@/types'

export interface ScriptResult {
  headers: Record<string, string>
  url: string
  body: string
  urlencoded: KvPair[]
  formdata: KvPair[]
  envVars: Record<string, string>
  logs: ScriptLog[]
  error?: string
}

export interface ScriptLog {
  level: 'log' | 'warn' | 'error' | 'info' | 'table'
  timestamp: number
  args: string[]
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

let sandboxIframe: HTMLIFrameElement | null = null
let pendingRequests: Map<string, { resolve: (result: ScriptResult) => void; reject: (err: Error) => void }> = new Map()

function getSandboxIframe(): HTMLIFrameElement {
  if (!sandboxIframe) {
    sandboxIframe = document.createElement('iframe')
    sandboxIframe.src = '/sandbox.html'
    sandboxIframe.style.display = 'none'
    sandboxIframe.sandbox.add('allow-scripts')
    document.body.appendChild(sandboxIframe)

    window.addEventListener('message', (event) => {
      if (event.data?.type !== 'SCRIPT_RESULT') return
      const { requestId, success, error, result } = event.data
      const pending = pendingRequests.get(requestId)
      if (!pending) return
      pendingRequests.delete(requestId)

      if (success) {
        pending.resolve({
          headers: result.headers || {},
          url: result.url || '',
          body: result.body || '',
          urlencoded: result.urlencoded || [],
          formdata: result.formdata || [],
          envVars: result.envVars || {},
          logs: result.logs || [],
        })
      } else {
        pending.resolve({
          headers: result.headers || {},
          url: result.url || '',
          body: result.body || '',
          urlencoded: result.urlencoded || [],
          formdata: result.formdata || [],
          envVars: result.envVars || {},
          logs: result.logs || [],
          error,
        })
      }
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
): Promise<ScriptResult> {
  if (!script || !script.trim()) {
    return {
      headers,
      url,
      body,
      urlencoded,
      formdata,
      envVars,
      logs: [],
    }
  }

  const iframe = getSandboxIframe()
  const requestId = generateRequestId()

  return new Promise((resolve, reject) => {
    pendingRequests.set(requestId, { resolve, reject })

    const message: any = {
      type: 'EXECUTE_SCRIPT',
      script,
      envVars,
      headers,
      url,
      body,
      urlencoded,
      formdata,
      requestId,
    }

    if (responseData) {
      message.responseData = responseData
    }

    const contentWindow = iframe.contentWindow
    if (contentWindow) {
      contentWindow.postMessage(message, '*')
    } else {
      pendingRequests.delete(requestId)
      reject(new Error('Sandbox iframe not ready'))
    }

    // Timeout after 30 seconds
    setTimeout(() => {
      if (pendingRequests.has(requestId)) {
        pendingRequests.delete(requestId)
        reject(new Error('Script execution timed out (30s)'))
      }
    }, 30000)
  })
}

// Fallback: direct execution (for environments without sandbox)
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
  if (!script || !script.trim()) {
    return {
      headers: currentHeaders,
      url: currentUrl,
      body: currentBody,
      urlencoded: currentUrlencoded,
      formdata: currentFormdata,
      envVars,
      logs: [],
    }
  }

  const logs: ScriptLog[] = []

  function appendLog(level: ScriptLog['level'], ...args: unknown[]) {
    logs.push({ level, timestamp: Date.now(), args: args.map(String) })
  }

  const headerStore: Record<string, string> = { ...currentHeaders }
  const envStore: Record<string, string> = { ...envVars }

  const pm = {
    request: {
      headers: {
        _store: headerStore,
        set(key: string, value: string) { headerStore[key] = value },
        get(key: string) { return headerStore[key] },
        remove(key: string) { delete headerStore[key] },
        has(key: string) { return key in headerStore },
      },
      body: {
        _raw: currentBody,
        _fields: currentUrlencoded.map(f => ({ ...f })),
        _formdata: currentFormdata.map(f => ({ ...f })),
        get raw() { return this._raw },
        set raw(val: string) { this._raw = val },
        set(key: string, value: string) {
          const existing = this._fields.find(f => f.key === key)
          if (existing) { existing.value = value; existing.enabled = true }
          else this._fields.push({ key, value, enabled: true })
        },
        get(key: string) { return this._fields.find(f => f.key === key)?.value },
      },
      url: {
        _url: currentUrl,
        set(val: string) { this._url = val },
        get() { return this._url },
        addQueryParams(key: string, value: string) {
          const sep = this._url.includes('?') ? '&' : '?'
          this._url += sep + encodeURIComponent(key) + '=' + encodeURIComponent(value)
        },
      },
    },
    environment: {
      set(key: string, value: string) {
        envStore[key] = value
        envVars[key] = value
        if (onEnvSave) onEnvSave(envVars)
      },
      get(key: string) { return envStore[key] },
      unset(key: string) {
        delete envStore[key]
        delete envVars[key]
        if (onEnvSave) onEnvSave(envVars)
      },
      has(key: string) { return key in envStore },
    },
  }

  const postman = {
    setEnvironmentVariable: (key: string, value: string) => pm.environment.set(key, value),
    getEnvironmentVariable: (key: string) => pm.environment.get(key),
    clearEnvironmentVariable: (key: string) => pm.environment.unset(key),
    setGlobalVariable: (key: string, value: string) => pm.environment.set(key, value),
    getGlobalVariable: (key: string) => pm.environment.get(key),
    clearGlobalVariable: (key: string) => pm.environment.unset(key),
    environment: pm.environment,
    globals: pm.environment,
    request: pm.request,
  }

  const scriptConsole = {
    log: (...args: unknown[]) => appendLog('log', ...args),
    warn: (...args: unknown[]) => appendLog('warn', ...args),
    error: (...args: unknown[]) => appendLog('error', ...args),
    info: (...args: unknown[]) => appendLog('info', ...args),
    table: (...args: unknown[]) => appendLog('table', ...args),
  }

  try {
    const fn = new Function(
      'pm', 'postman', 'console', 'Math', 'Date', 'parseInt', 'parseFloat',
      'JSON', 'encodeURIComponent', 'decodeURIComponent', 'btoa', 'atob',
      'setTimeout', 'Promise',
      script,
    )
    fn(pm, postman, scriptConsole, Math, Date, parseInt, parseFloat, JSON, encodeURIComponent, decodeURIComponent, btoa, atob, setTimeout, Promise)
  } catch (err: any) {
    appendLog('error', `脚本执行错误: ${err.message}`)
  }

  return {
    headers: pm.request.headers._store,
    url: pm.request.url._url,
    body: pm.request.body._raw,
    urlencoded: pm.request.body._fields,
    formdata: pm.request.body._formdata,
    envVars: envStore,
    logs,
  }
}

// Post-response script execution with pm.response API
export function executePostResponseScript(
  script: string,
  responseData: PostResponseData,
  envVars: Record<string, string>,
  onEnvSave?: (vars: Record<string, string>) => void,
): ScriptResult {
  if (!script || !script.trim()) {
    return {
      headers: {},
      url: '',
      body: '',
      urlencoded: [],
      formdata: [],
      envVars,
      logs: [],
    }
  }

  const logs: ScriptLog[] = []
  const envStore: Record<string, string> = { ...envVars }
  const testResults: Array<{ name: string; passed: boolean; error?: string }> = []

  function appendLog(level: ScriptLog['level'], ...args: unknown[]) {
    logs.push({ level, timestamp: Date.now(), args: args.map(String) })
  }

  const pm = {
    response: {
      code: responseData.status,
      status: responseData.statusText,
      responseTime: responseData.duration,
      responseSize: responseData.responseSize,
      headers: {
        get(key: string) { return responseData.headers[key.toLowerCase()] },
        has(key: string) { return key.toLowerCase() in responseData.headers },
        all() { return { ...responseData.headers } },
      },
      text() { return responseData.body },
      json() {
        try { return JSON.parse(responseData.body) }
        catch { return null }
      },
      jsonPath(path: string) {
        try {
          const data = JSON.parse(responseData.body)
          return jsonPathQuery(data, path)
        } catch { return null }
      },
      match(pattern: string | RegExp) {
        const regex = typeof pattern === 'string' ? new RegExp(pattern) : pattern
        return regex.test(responseData.body)
      },
    },
    environment: {
      set(key: string, value: string) {
        envStore[key] = value
        envVars[key] = value
        if (onEnvSave) onEnvSave(envVars)
      },
      get(key: string) { return envStore[key] },
      unset(key: string) {
        delete envStore[key]
        delete envVars[key]
        if (onEnvSave) onEnvSave(envVars)
      },
      has(key: string) { return key in envStore },
    },
    test: (name: string, fn: () => void) => {
      try {
        fn()
        testResults.push({ name, passed: true })
      } catch (err: any) {
        testResults.push({ name, passed: false, error: err.message })
      }
    },
    expect: (value: unknown) => createExpectChain(value),
  }

  const postman = {
    environment: pm.environment,
    response: pm.response,
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
    const fn = new Function(
      'pm', 'postman', 'console', 'Math', 'Date', 'parseInt', 'parseFloat',
      'JSON', 'encodeURIComponent', 'decodeURIComponent', 'btoa', 'atob',
      'setTimeout', 'Promise',
      script,
    )
    fn(pm, postman, scriptConsole, Math, Date, parseInt, parseFloat, JSON, encodeURIComponent, decodeURIComponent, btoa, atob, setTimeout, Promise)
  } catch (err: any) {
    appendLog('error', `脚本执行错误: ${err.message}`)
  }

  // Add test results to logs
  for (const result of testResults) {
    if (result.passed) {
      appendLog('log', `✓ ${result.name}`)
    } else {
      appendLog('error', `✗ ${result.name}: ${result.error}`)
    }
  }

  return {
    headers: {},
    url: '',
    body: '',
    urlencoded: [],
    formdata: [],
    envVars: envStore,
    logs,
  }
}

// Simple jsonPath query
function jsonPathQuery(data: any, path: string): any {
  const parts = path.replace(/^\$\.?/, '').split('.')
  let current = data
  for (const part of parts) {
    if (current == null) return null
    if (Array.isArray(current) && /^\d+$/.test(part)) {
      current = current[parseInt(part)]
    } else {
      current = current[part]
    }
  }
  return current
}

// Minimal Chai-style expect chain
function createExpectChain(value: unknown) {
  const negation = { value: false }

  function assert(condition: boolean, message: string) {
    if (negation.value ? condition : !condition) {
      throw new Error(message)
    }
  }

  return {
    get not() {
      negation.value = !negation.value
      return this
    },
    to: {
      get be() { return this },
      get have() { return this },
      get equal() { return this },
      eql(expected: unknown) {
        assert(JSON.stringify(value) === JSON.stringify(expected),
          `Expected ${JSON.stringify(value)} to ${negation.value ? 'not ' : ''}deep equal ${JSON.stringify(expected)}`)
      },
      equal(expected: unknown) {
        assert(value === expected,
          `Expected ${value} to ${negation.value ? 'not ' : ''}equal ${expected}`)
      },
      bea(type: string) {
        assert(typeof value === type,
          `Expected ${typeof value} to ${negation.value ? 'not ' : ''}be ${type}`)
      },
      include(substring: string) {
        if (typeof value === 'string') {
          assert(value.includes(substring),
            `Expected "${value}" to ${negation.value ? 'not ' : ''}include "${substring}"`)
        } else if (Array.isArray(value)) {
          assert(value.includes(substring),
            `Expected array to ${negation.value ? 'not ' : ''}include ${substring}`)
        }
      },
      exist() {
        assert(value != null,
          `Expected value to ${negation.value ? 'not ' : ''}exist`)
      },
      above(n: number) {
        assert((value as number) > n,
          `Expected ${value} to be above ${n}`)
      },
      below(n: number) {
        assert((value as number) < n,
          `Expected ${value} to be below ${n}`)
      },
      property(name: string) {
        const obj = value as Record<string, unknown>
        assert(name in obj,
          `Expected object to ${negation.value ? 'not ' : ''}have property "${name}"`)
      },
    },
  }
}