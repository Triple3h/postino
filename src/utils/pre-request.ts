import type { KvPair } from '@/types'

export interface ScriptResult {
  headers: Record<string, string>
  url: string
  body: string
  urlencoded: KvPair[]
  formdata: KvPair[]
  envVars: Record<string, string>
  logs: ScriptLog[]
}

export interface ScriptLog {
  level: 'log' | 'warn' | 'error' | 'info' | 'table'
  timestamp: number
  args: unknown[]
}

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
    logs.push({ level, timestamp: Date.now(), args })
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
          if (existing) {
            existing.value = value
            existing.enabled = true
          } else {
            this._fields.push({ key, value, enabled: true })
          }
        },
        get(key: string) {
          return this._fields.find(f => f.key === key)?.value
        },
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