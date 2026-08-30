/**
 * pm.* 门面运行时(Phase 4.3 沙箱双副本收敛)
 *
 * 单一真源:由 Vite lib 模式构建为 IIFE 产物 `extension/pm-facade.js`(勿手改该产物),
 * `script-worker.js` 经 importScripts 加载,`sandbox.html` 经 <script src> 加载 ——
 * 两处消费同一产物,天然一致。
 *
 * 环境差异(Worker self ⇄ 沙箱 iframe window/parent)收敛为 FacadeTransport,
 * 文件底部按 importScripts 是否存在自动装配,并防重复安装。
 */

import { createCryptoJsShim } from './crypto-shim'

interface FacadeTransport {
  addMessageListener(listener: (event: MessageEvent) => void): void
  removeMessageListener(listener: (event: MessageEvent) => void): void
  /** 发送 SCRIPT_SEND_REQUEST 到宿主 */
  postScriptRequest(payload: Record<string, unknown>): void
  /** 发送 SCRIPT_RESULT 到宿主 */
  postResult(payload: Record<string, unknown>): void
}

export function installPmFacade(transport: FacadeTransport): void {

  function formatLogArg(arg: any): string {
    if (arg instanceof Error) return `${arg.name}: ${arg.message}`
    if (typeof arg === 'string') return arg
    if (arg == null) return String(arg)
    try { return typeof arg === 'object' ? JSON.stringify(arg) : String(arg) } catch { return Object.prototype.toString.call(arg) }
  }

  function escapeRegExp(value: any): string {
    return String(value).replace(/[.*+?^${}()|[\]\\]/g, '\\$&')
  }

  function headerLookup(headers: any, key: any): any {
    const lower = String(key).toLowerCase()
    const matched = Object.keys(headers || {}).find(item => item.toLowerCase() === lower)
    return matched ? headers[matched] : undefined
  }

  function setHeaderValue(headers: any, key: any, value: any): void {
    const lower = String(key).toLowerCase()
    const matched = Object.keys(headers || {}).find(item => item.toLowerCase() === lower)
    headers[matched || key] = String(value ?? '')
  }

  function removeHeaderValue(headers: any, key: any): void {
    const lower = String(key).toLowerCase()
    const matched = Object.keys(headers || {}).find(item => item.toLowerCase() === lower)
    if (matched) delete headers[matched]
  }

  function createMutableHeaderFacade(headerStore: any): any {
    const methods: any = {
      _store: headerStore,
      add(input: any, value?: any) {
        for (const item of normalizeKvInput(input, value)) {
          if (headerLookup(headerStore, item.key) === undefined) headerStore[item.key] = item.value
        }
      },
      set(key: any, value: any) { setHeaderValue(headerStore, key, value) },
      upsert(input: any, value?: any) {
        for (const item of normalizeKvInput(input, value)) setHeaderValue(headerStore, item.key, item.value)
      },
      get(key: any) { return headerLookup(headerStore, key) },
      remove(key: any) { removeHeaderValue(headerStore, key) },
      has(key: any) { return headerLookup(headerStore, key) !== undefined },
      all() { return { ...headerStore } },
      toObject() { return { ...headerStore } },
      each(callback: any) { Object.entries(headerStore).forEach(([key, value]) => callback(value, key)) },
      clear() { Object.keys(headerStore).forEach(key => delete headerStore[key]) },
    }
    return new Proxy(methods, {
      get(target: any, prop) {
        if (typeof prop !== 'string') return Reflect.get(target, prop)
        if (prop in target) return Reflect.get(target, prop)
        return headerLookup(headerStore, prop)
      },
      set(target: any, prop, value) {
        if (typeof prop !== 'string') return Reflect.set(target, prop, value)
        if (prop in target) return Reflect.set(target, prop, value)
        setHeaderValue(headerStore, prop, value)
        return true
      },
      deleteProperty(target: any, prop) {
        if (typeof prop !== 'string') return Reflect.deleteProperty(target, prop)
        if (prop in target) return false
        removeHeaderValue(headerStore, prop)
        return true
      },
      has(target: any, prop) {
        if (typeof prop !== 'string') return Reflect.has(target, prop)
        return prop in target || headerLookup(headerStore, prop) !== undefined
      },
      ownKeys() { return Object.keys(headerStore) },
      getOwnPropertyDescriptor(target: any, prop) {
        if (typeof prop !== 'string') return Reflect.getOwnPropertyDescriptor(target, prop)
        if (prop in target) return { configurable: true, enumerable: false, writable: true, value: Reflect.get(target, prop) }
        const matched = Object.keys(headerStore).find(key => key.toLowerCase() === prop.toLowerCase())
        if (!matched) return undefined
        return { configurable: true, enumerable: true, writable: true, value: headerStore[matched] }
      },
    })
  }

  function normalizeKvInput(input: any, value?: any): any[] {
    if (Array.isArray(input)) return input.flatMap(item => normalizeKvInput(item))
    if (input && typeof input === 'object') {
      if (!('key' in input) && !('name' in input)) {
        if (typeof input.entries === 'function') return kvPairsFromEntries(input.entries())
        return Object.entries(input).map(([key, entryValue]) => ({ key, value: String(entryValue ?? ''), enabled: true })).filter((field: any) => field.key)
      }
      const key = String(input.key ?? input.name ?? '')
      if (!key) return []
      return [{ key, value: String(input.value ?? ''), enabled: input.disabled === undefined ? true : !input.disabled, description: input.description == null ? undefined : String(input.description) }]
    }
    if (typeof input === 'string') return [{ key: input, value: String(value ?? ''), enabled: true }]
    return []
  }

  function upsertField(fields: any, field: any): void {
    const existing = fields.find((item: any) => item.key === field.key)
    if (existing) Object.assign(existing, field, { enabled: field.enabled !== false })
    else fields.push({ ...field, enabled: field.enabled !== false })
  }

  function kvPairsFromEntries(entries: any): any[] {
    return Array.from(entries).map(([key, value]: any) => ({ key: String(key), value: String(value ?? ''), enabled: true })).filter((item: any) => item.key)
  }

  function stringifyBodyInput(value: any): string {
    if (value == null) return ''
    if (typeof value === 'string') return value
    if (typeof value === 'number' || typeof value === 'boolean') return String(value)
    try { return JSON.stringify(value) } catch { return String(value) }
  }

  function applyBodyInput(bodyFacade: any, value: any): void {
    const setRaw = (rawValue: any) => {
      bodyFacade._raw = stringifyBodyInput(rawValue)
      bodyFacade._fields = []
      bodyFacade._formdata = []
    }
    if (value && typeof value === 'object') {
      const mode = String(value.mode ?? value.type ?? '').toLowerCase()
      if ((mode === 'urlencoded' || mode === 'x-www-form-urlencoded') && ('urlencoded' in value || 'data' in value || 'content' in value)) {
        bodyFacade._fields = normalizeKvInput(value.urlencoded ?? value.data ?? value.content ?? [])
        bodyFacade._formdata = []
        bodyFacade._raw = ''
        return
      }
      if ((mode === 'formdata' || mode === 'form') && ('formdata' in value || 'formData' in value || 'data' in value || 'content' in value)) {
        bodyFacade._formdata = normalizeKvInput(value.formdata ?? value.formData ?? value.data ?? value.content ?? [])
        bodyFacade._fields = []
        bodyFacade._raw = ''
        return
      }
      if (typeof value.entries === 'function') {
        const pairs = kvPairsFromEntries(value.entries())
        const ctorName = String(value.constructor?.name ?? '').toLowerCase()
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
        setRaw(value.raw ?? value.content ?? '')
        return
      }
      if (mode === 'json' && 'content' in value) {
        setRaw(value.content)
        return
      }
    }
    setRaw(value)
  }

  function getCookieJarKey(url: any): string {
    try { return new URL(url || 'http://apifix.local').origin } catch (_err) { return url || '__default__' }
  }

  function createCookieFacade(cookieStore: any, currentUrl = ''): any {
    const currentKey = getCookieJarKey(currentUrl)
    const jarStore = new Map([[currentKey, cookieStore]])
    const getBucket = (url: any) => {
      const key = getCookieJarKey(url || currentUrl)
      if (!jarStore.has(key)) jarStore.set(key, [])
      return jarStore.get(key)
    }
    const toObject = (bucket: any = cookieStore) => Object.fromEntries(bucket.filter((item: any) => item.enabled !== false).map((item: any) => [item.key, item.value]))
    const setCookie = (bucket: any, name: any, value: any) => upsertField(bucket, { key: String(name), value: String(value ?? ''), enabled: true })
    const unsetCookie = (bucket: any, name: any) => { const index = bucket.findIndex((item: any) => item.key === name); if (index >= 0) bucket.splice(index, 1) }
    const withCallback = (valueFactory: any, callback: any) => {
      const promise = Promise.resolve().then(valueFactory)
      if (callback) promise.then((value: any) => callback(null, value)).catch((err: any) => callback(err instanceof Error ? err : new Error(String(err))))
      return promise
    }
    const jar: any = {
      get(url: any, name: any, callback?: any) { return withCallback(() => getBucket(url).find((item: any) => item.key === name && item.enabled !== false)?.value, callback) },
      getAll(url: any, callback?: any) { return withCallback(() => toObject(getBucket(url)), callback) },
      set(url: any, name: any, value: any, callback?: any) { return withCallback(() => { setCookie(getBucket(url), name, value); return String(value ?? '') }, callback) },
      unset(url: any, name: any, callback?: any) { return withCallback(() => { unsetCookie(getBucket(url), name); return undefined }, callback) },
      clear(url: any, callback?: any) { return withCallback(() => { getBucket(url).splice(0); return undefined }, callback) },
      toObject(url: any) { return toObject(getBucket(url)) },
    }
    return {
      jar: () => jar,
      get(name: any) { return cookieStore.find((item: any) => item.key === name && item.enabled !== false)?.value },
      has(name: any) { return cookieStore.some((item: any) => item.key === name && item.enabled !== false) },
      set(name: any, value: any) { setCookie(cookieStore, name, value) },
      unset(name: any) { unsetCookie(cookieStore, name) },
      clear() { cookieStore.splice(0) },
      toObject: () => toObject(cookieStore),
      all: () => cookieStore.map((item: any) => ({ ...item })),
      each(callback: any) { cookieStore.filter((item: any) => item.enabled !== false).forEach((item: any) => callback(item.value, item.key)) },
    }
  }

  function parseJsonPath(path: any): any[] {
    const source = String(path || '').trim().replace(/^json(?=\.)/, '$')
    const tokens: any[] = []
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

  function jsonPathQuery(data: any, path: any): any {
    const tokens = parseJsonPath(path)
    if (tokens.length === 0) return data
    const visit = (current: any, index: number): any => {
      if (index >= tokens.length) return current
      const token = tokens[index]
      if (token === '*') {
        const list = Array.isArray(current) ? current : current && typeof current === 'object' ? Object.values(current) : []
        return list.map(item => visit(item, index + 1)).filter(item => item !== undefined)
      }
      if (current == null) return null
      if (Array.isArray(current) && typeof token === 'number') return visit(current[token], index + 1)
      if (typeof current === 'object') return visit(current[String(token)], index + 1)
      return null
    }
    return visit(data, 0)
  }

  function createHeaderFacade(headers: any): any {
    const facade: any = {}
    for (const [key, value] of Object.entries(headers || {})) {
      facade[key] = value
      facade[key.toLowerCase()] = value
    }
    Object.defineProperties(facade, {
      get: { value: (key: any) => headerLookup(headers, key), enumerable: false },
      has: { value: (key: any) => headerLookup(headers, key) !== undefined, enumerable: false },
      all: { value: () => ({ ...headers }), enumerable: false },
      toObject: { value: () => ({ ...headers }), enumerable: false },
    })
    return facade
  }

  function createResponseFacade(data: any): any {
    if (!data) return undefined
    const response = {
      status: data.status,
      statusText: data.statusText,
      headers: data.headers || {},
      body: data.body || '',
      duration: data.duration || 0,
      size: data.responseSize || data.size || 0,
    }
    return {
      code: response.status,
      status: response.statusText,
      responseTime: response.duration,
      responseSize: response.size,
      size: response.size,
      headers: createHeaderFacade(response.headers),
      body: response.body,
      text: () => response.body,
      json: () => { try { return JSON.parse(response.body) } catch { return null } },
      xml: () => {
        if (typeof DOMParser === 'undefined') return null
        try { return new DOMParser().parseFromString(response.body, 'application/xml') } catch { return null }
      },
      blob: async () => new Blob([response.body], { type: headerLookup(response.headers, 'content-type') || 'text/plain' }),
      jsonPath: (path: any) => { try { return jsonPathQuery(JSON.parse(response.body), path) } catch { return null } },
      match: (pattern: any) => { const matched = response.body.match(typeof pattern === 'string' ? new RegExp(pattern) : pattern); return matched ? matched[0] : null },
      to: { have: {
        status(expected: any) { if (response.status !== expected) throw new Error(`expected status ${expected} but got ${response.status}`) },
        header(key: any) { if (headerLookup(response.headers, key) === undefined) throw new Error(`expected response to have header ${key}`) },
        body(expected: any) { const ok = typeof expected === 'string' ? response.body.includes(expected) : expected.test(response.body); if (!ok) throw new Error('expected response body to match') },
        jsonBody(path: any, expected: any) {
          let parsed: any
          try { parsed = JSON.parse(response.body) } catch (_err) { throw new Error('expected response body to be valid JSON') }
          const actual = path ? jsonPathQuery(parsed, path) : parsed
          if (expected !== undefined && JSON.stringify(actual) !== JSON.stringify(expected)) throw new Error(`expected JSON body ${path || '$'} to equal ${JSON.stringify(expected)}`)
        },
        bodyContains(expected: any) { if (!response.body.includes(expected)) throw new Error(`expected response body to contain ${expected}`) },
      }},
      toJSON: () => data,
    }
  }

  function createExpectChain(value: any): any {
    const state = { negate: false, deep: false }
    const assert = (condition: any, message: string) => {
      const failed = state.negate ? condition : !condition
      state.negate = false
      state.deep = false
      if (failed) throw new Error(message)
    }
    const isType = (expected: any) => {
      const normalized = String(expected).toLowerCase()
      if (normalized === 'array') return Array.isArray(value)
      if (normalized === 'null') return value === null
      return typeof value === normalized
    }
    const actualType = () => Array.isArray(value) ? 'array' : value === null ? 'null' : typeof value
    const deepEqual = (left: any, right: any) => JSON.stringify(left) === JSON.stringify(right)
    const getLength = (target: any) => typeof target === 'string' || Array.isArray(target) ? target.length : target && typeof target === 'object' ? Object.keys(target).length : undefined

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
      a(type: any) {
        assert(isType(type), `Expected ${actualType()} to ${state.negate ? 'not ' : ''}be ${type}`)
        return chain
      },
      an(type: any) { return chain.a(type) },
      eql(expected: any) {
        assert(deepEqual(value, expected), `Expected ${JSON.stringify(value)} to ${state.negate ? 'not ' : ''}deep equal ${JSON.stringify(expected)}`)
        return chain
      },
      equal(expected: any) {
        assert(state.deep ? deepEqual(value, expected) : value === expected, `Expected ${formatLogArg(value)} to ${state.negate ? 'not ' : ''}equal ${formatLogArg(expected)}`)
        return chain
      },
      equals(expected: any) { return chain.equal(expected) },
      oneOf(expected: any) {
        assert(Array.isArray(expected) && expected.includes(value), `Expected ${formatLogArg(value)} to ${state.negate ? 'not ' : ''}be one of ${JSON.stringify(expected)}`)
        return chain
      },
      match(regex: any) {
        const matcher = typeof regex === 'string' ? new RegExp(regex) : regex
        assert(matcher.test(String(value)), `Expected ${formatLogArg(value)} to ${state.negate ? 'not ' : ''}match ${matcher}`)
        return chain
      },
      include(substring: any) {
        if (typeof value === 'string') assert(value.includes(String(substring)), `Expected "${value}" to ${state.negate ? 'not ' : ''}include "${substring}"`)
        else if (Array.isArray(value)) assert(value.includes(substring), `Expected array to ${state.negate ? 'not ' : ''}include ${formatLogArg(substring)}`)
        else if (value && typeof value === 'object') assert(substring in value, `Expected object to ${state.negate ? 'not ' : ''}include key ${String(substring)}`)
        else assert(false, 'Expected value to be string, array or object')
        return chain
      },
      includes(substring: any) { return chain.include(substring) },
      above(n: any) {
        assert(Number(value) > n, `Expected ${formatLogArg(value)} to be above ${n}`)
        return chain
      },
      greaterThan(n: any) { return chain.above(n) },
      below(n: any) {
        assert(Number(value) < n, `Expected ${formatLogArg(value)} to be below ${n}`)
        return chain
      },
      lessThan(n: any) { return chain.below(n) },
      within(min: any, max: any) {
        assert(Number(value) >= min && Number(value) <= max, `Expected ${formatLogArg(value)} to be within ${min}..${max}`)
        return chain
      },
      property(name: any, expected?: any) {
        const obj = value
        const shouldDeepEqual = state.deep
        assert(obj != null && typeof obj === 'object' && name in obj, `Expected object to ${state.negate ? 'not ' : ''}have property "${name}"`)
        if (arguments.length > 1) assert(shouldDeepEqual ? deepEqual(obj[name], expected) : obj[name] === expected, `Expected property "${name}" to equal ${formatLogArg(expected)}`)
        return createExpectChain(obj?.[name])
      },
      ownProperty(name: any) { return chain.property(name) },
      ownPropertyDescriptor(name: any) {
        const descriptor = value != null && typeof value === 'object' ? Object.getOwnPropertyDescriptor(value, name) : undefined
        assert(Boolean(descriptor), `Expected object to ${state.negate ? 'not ' : ''}have own property descriptor "${name}"`)
        return createExpectChain(descriptor)
      },
      key(name: any) {
        const obj = value
        assert(obj != null && typeof obj === 'object' && name in obj, `Expected object to ${state.negate ? 'not ' : ''}contain key "${name}"`)
        return chain
      },
      keys(...names: any[]) {
        const expected = Array.isArray(names[0]) ? names[0] : names
        const obj = value
        assert(obj != null && typeof obj === 'object' && expected.every((name: any) => name in obj), `Expected object to contain keys ${expected.join(', ')}`)
        return chain
      },
      lengthOf(expected: any) {
        const length = getLength(value)
        assert(length === expected, `Expected length ${length} to ${state.negate ? 'not ' : ''}equal ${expected}`)
        return chain
      },
      length(expected: any) { return chain.lengthOf(expected) },
      least(n: any) {
        assert(Number(value) >= n, `Expected ${formatLogArg(value)} to be at least ${n}`)
        return chain
      },
      gte(n: any) { return chain.least(n) },
      most(n: any) {
        assert(Number(value) <= n, `Expected ${formatLogArg(value)} to be at most ${n}`)
        return chain
      },
      lte(n: any) { return chain.most(n) },
      members(expected: any) {
        assert(Array.isArray(value) && Array.isArray(expected) && expected.every((item: any) => value.includes(item)), `Expected array to include members ${JSON.stringify(expected)}`)
        return chain
      },
      satisfy(predicate: any) {
        assert(typeof predicate === 'function' && predicate(value), 'Expected value to satisfy predicate')
        return chain
      },
      'throw'(expected: any) {
        assert(typeof value === 'function', 'Expected value to be a function')
        let thrown: any
        try { value() } catch (err: any) { thrown = err }
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
      throws(expected: any) { return chain.throw(expected) },
    }
    chain.bea = (type: any) => chain.a(type)
    return chain
  }

  function renderTemplate(template: any, data: any): any {
    if (!data || typeof data !== 'object') return template
    const resolvePath = (key: any) => key.split('.').reduce((current: any, part: any) => current && typeof current === 'object' ? current[part] : undefined, data)
    const interpolate = (_: any, key: any) => {
      const value = resolvePath(String(key).trim())
      return value == null ? '' : String(value)
    }
    return String(template)
      .replace(/\{\{\s*([\w.-]+)\s*\}\}/g, interpolate)
      .replace(/<%=\s*([\w.-]+)\s*%>/g, interpolate)
  }

  function createVaultFacade(initialValues: any = {}): any {
    const store = new Map(Object.entries(initialValues).map(([key, value]) => [key, String(value ?? '')]))
    const resolveValue = (valueFactory: any, callback: any) => {
      const promise = Promise.resolve().then(valueFactory)
      if (callback) promise.then((value: any) => callback(null, value)).catch((err: any) => callback(err instanceof Error ? err : new Error(String(err))))
      return promise
    }
    return {
      get(key: any, callback?: any) { return resolveValue(() => store.get(String(key)), callback) },
      set(key: any, value: any, callback?: any) { return resolveValue(() => { const normalized = String(value ?? ''); store.set(String(key), normalized); return normalized }, callback) },
      unset(key: any, callback?: any) { return resolveValue(() => { store.delete(String(key)); return undefined }, callback) },
      clear(callback?: any) { return resolveValue(() => { store.clear(); return undefined }, callback) },
      has(key: any, callback?: any) { return resolveValue(() => store.has(String(key)), callback) },
      toObject() { return Object.fromEntries(store.entries()) },
    }
  }

  function createPmVariableScope(ownStore: any = {}, fallbackScopes: any[] = []): any {
    return {
      set(key: any, value: any) { ownStore[key] = String(value) },
      get(key: any) {
        if (key in ownStore) return ownStore[key]
        for (const scope of fallbackScopes) {
          const hasValue = scope.has ? scope.has(key) : scope.get(key) !== undefined
          if (hasValue) {
            const value = scope.get(key)
            return value == null ? undefined : String(value)
          }
        }
        return undefined
      },
      unset(key: any) { delete ownStore[key] },
      has(key: any) { return key in ownStore || fallbackScopes.some(scope => scope.has ? scope.has(key) : scope.get(key) !== undefined) },
      clear() { for (const key of Object.keys(ownStore)) delete ownStore[key] },
      import(values: any) { for (const [key, value] of Object.entries(values || {})) ownStore[key] = String(value) },
      toObject() { return { ...ownStore } },
      replaceIn(template: any) {
        return String(template).replace(/\{\{\s*([\w.-]+)\s*\}\}/g, (_: any, key: any) => {
          const value = this.get(key)
          return value == null ? '' : String(value)
        })
      },
    }
  }

  function createVisualizer(visualizations: any, log: any): any {
    return {
      set(this: any, content: any, data: any) { this.template(content, data) },
      template(template: any, data: any) {
        visualizations.push({ id: `${Date.now().toString(36)}${Math.random().toString(36).slice(2)}`, type: 'template', title: 'Visualizer', content: renderTemplate(template, data), data, createdAt: Date.now() })
        log('info', 'pm.visualizer.template rendered')
      },
      table(data: any, options: any) {
        const legacyTitleMode = typeof data === 'string' && Array.isArray(options)
        const title = legacyTitleMode ? data : (options && options.title) || 'Table'
        const list = Array.isArray(legacyTitleMode ? options : data) ? (legacyTitleMode ? options : data) : []
        const escape = (value: any) => String(value ?? '').replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;').replace(/'/g, '&#39;')
        const columns = list.length && typeof list[0] === 'object' ? Object.keys(list[0]) : []
        const html = `<h3>${escape(title)}</h3><table><thead><tr>${columns.map((col: any) => `<th>${escape(col)}</th>`).join('')}</tr></thead><tbody>${list.map((row: any) => `<tr>${columns.map((col: any) => `<td>${escape(row[col])}</td>`).join('')}</tr>`).join('')}</tbody></table>`
        visualizations.push({ id: `${Date.now().toString(36)}${Math.random().toString(36).slice(2)}`, type: 'table', title, content: html, data: list, createdAt: Date.now() })
        log('info', 'pm.visualizer.table rendered')
      },
    }
  }

  function createSendRequestFacade(requestId: any): any {
    let seq = 0
    const send = (input: any, callback?: any) => {
      const callId = `${requestId}:${++seq}`
      const promise = new Promise((resolve, reject) => {
        const handler = (event: any) => {
          if (event.data?.type !== 'SCRIPT_SEND_RESPONSE' || event.data.requestId !== requestId || event.data.callId !== callId) return
          transport.removeMessageListener(handler)
          if (event.data.success) resolve(createResponseFacade(event.data.response))
          else reject(new Error(event.data.error || 'pm.sendRequest failed'))
        }
        transport.addMessageListener(handler)
        transport.postScriptRequest({ type: 'SCRIPT_SEND_REQUEST', requestId, callId, input })
      })
      if (callback) promise.then((resp: any) => callback(null, resp)).catch((err: any) => callback(err, null))
      return promise
    }
    send.sendInterface = (interfaceOrApiId: any, overrides?: any, callback?: any) => {
      if (typeof overrides === 'function') { callback = overrides; overrides = undefined }
      const callId = `${requestId}:iface:${++seq}`
      const promise = new Promise((resolve, reject) => {
        const handler = (event: any) => {
          if (event.data?.type !== 'SCRIPT_SEND_RESPONSE' || event.data.requestId !== requestId || event.data.callId !== callId) return
          transport.removeMessageListener(handler)
          if (event.data.success) resolve(createResponseFacade(event.data.response))
          else reject(new Error(event.data.error || 'pm.sendRequest.sendInterface failed'))
        }
        transport.addMessageListener(handler)
        transport.postScriptRequest({ type: 'SCRIPT_SEND_REQUEST', requestId, callId, interfaceOrApiId, overrides })
      })
      if (callback) promise.then((resp: any) => callback(null, resp)).catch((err: any) => callback(err, null))
      return promise
    }
    return send
  }

  function createExecutionFacade(requestId: any, log: any, info: any): any {
    const state = { skipRequest: false, nextRequest: null as string | null, runRequestCount: 0 }
    const runRequest = (interfaceOrApiId: any, overrides?: any, callback?: any) => {
      if (typeof overrides === 'function') { callback = overrides; overrides = undefined }
      state.runRequestCount += 1
      if (state.runRequestCount > 10) {
        const err = new Error('pm.execution.runRequest 每个脚本最多调用 10 次')
        if (callback) callback(err, null)
        return Promise.reject(err)
      }
      const callId = `${requestId}:exec:${Date.now().toString(36)}:${Math.random().toString(36).slice(2)}`
      const promise = new Promise((resolve, reject) => {
        const handler = (event: any) => {
          if (event.data?.type !== 'SCRIPT_SEND_RESPONSE' || event.data.requestId !== requestId || event.data.callId !== callId) return
          transport.removeMessageListener(handler)
          if (event.data.success) resolve(createResponseFacade(event.data.response))
          else reject(new Error(event.data.error || 'pm.execution.runRequest failed'))
        }
        transport.addMessageListener(handler)
        transport.postScriptRequest({ type: 'SCRIPT_SEND_REQUEST', requestId, callId, interfaceOrApiId, overrides })
      })
      if (callback) promise.then((resp: any) => callback(null, resp)).catch((err: any) => callback(err, null))
      return promise
    }
    return {
      _state: state,
      location: (() => { const parts = [info?.categoryName, info?.moduleName, info?.interfaceName].filter(Boolean).map(String); return Object.assign(parts, { current: parts[parts.length - 1] || '' }) })(),
      setNextRequest(requestNameOrId: any) { state.nextRequest = requestNameOrId == null ? null : String(requestNameOrId); log('info', `pm.execution.setNextRequest：${state.nextRequest ?? 'null'}`) },
      skipRequest() { state.skipRequest = true; log('warn', 'pm.execution.skipRequest：已跳过当前请求发送') },
      runRequest,
      get nextRequest() { return state.nextRequest },
      get skipped() { return state.skipRequest },
    }
  }

  transport.addMessageListener(async (event: any) => {
    const { type, script, envVars, method, headers, cookies, url, body, urlencoded, formdata, requestId, responseData, info } = event.data || {}
    if (type !== 'EXECUTE_SCRIPT') return

    const logs: any[] = []
    const tests: any[] = []
    const pendingTests: any[] = []
    const visualizations: any[] = []
    const envStore: any = { ...(envVars || {}) }
    const changedEnvKeys = new Set()
    const log = (level: any, ...args: any[]) => logs.push({ level, args: args.map(formatLogArg), timestamp: Date.now() })
    const sandboxedConsole = { log: (...a: any[]) => log('log', ...a), info: (...a: any[]) => log('info', ...a), warn: (...a: any[]) => log('warn', ...a), error: (...a: any[]) => log('error', ...a), table: (...a: any[]) => log('table', ...a) }
    const headerStore: any = { ...(headers || {}) }
    const cookieStore: any = (cookies || []).map((cookie: any) => ({ ...cookie }))
    const cookiesFacade = createCookieFacade(cookieStore, url || '')
    let requestMethod = String(method || 'GET').toUpperCase()

    const vault = createVaultFacade()
    const execution = createExecutionFacade(requestId, log, info)

    const pm: any = {
      info: { moduleName: '', categoryName: '', interfaceName: '', eventName: responseData ? 'test' : 'prerequest', ...(info || {}) },
      request: {
        get method() { return requestMethod },
        set method(value) { requestMethod = String(value || 'GET').toUpperCase() },
        setMethod(value: any) { pm.request.method = value },
        addHeader(input: any, value?: any) { pm.request.headers.add(input, value) },
        setHeader(key: any, value: any) { setHeaderValue(headerStore, key, value) },
        getHeader(key: any) { return headerLookup(headerStore, key) },
        removeHeader(key: any) { const lower = String(key).toLowerCase(); const matched = Object.keys(headerStore).find(item => item.toLowerCase() === lower); if (matched) delete headerStore[matched] },
        addQueryParam(input: any, value?: any) { pm.request.url.addQueryParams(input, value) },
        removeQueryParam(key: any) { pm.request.url.removeQueryParams(key) },
        addCookie(input: any, value?: any) { pm.request.cookies.add(input, value) },
        setCookie(key: any, value: any) { pm.request.cookies.upsert(key, value) },
        getCookie(key: any) { return pm.request.cookies.get(key) },
        removeCookie(key: any) { pm.request.cookies.remove(key) },
        setPathParam(key: any, value: any) { const escapedKey = escapeRegExp(key); pm.request.url._url = pm.request.url._url.replace(new RegExp(`(:${escapedKey}|\\{${escapedKey}\\}|\\{\\{\\s*${escapedKey}\\s*\\}\\})`, 'g'), encodeURIComponent(String(value))) },
        headers: createMutableHeaderFacade(headerStore),
        cookies: {
          _store: cookieStore,
          add(input: any, value?: any) { for (const item of normalizeKvInput(input, value)) cookieStore.push(item) },
          set(key: any, value: any) { this.upsert(key, value) },
          upsert(input: any, value?: any) { for (const item of normalizeKvInput(input, value)) upsertField(cookieStore, item) },
          get(key: any) { return cookieStore.find((item: any) => item.key === key)?.value },
          remove(key: any) { const index = cookieStore.findIndex((item: any) => item.key === key); if (index >= 0) cookieStore.splice(index, 1) },
          has(key: any) { return cookieStore.some((item: any) => item.key === key) },
          all() { return cookieStore.map((item: any) => ({ ...item })) },
          toObject() { return Object.fromEntries(cookieStore.filter((item: any) => item.enabled !== false).map((item: any) => [item.key, item.value])) },
          each(callback: any) { cookieStore.forEach((item: any) => callback(item.value, item.key)) },
          clear() { cookieStore.splice(0, cookieStore.length) },
        },
        body: {
          _raw: body || '', _fields: [...(urlencoded || [])], _formdata: [...(formdata || [])],
          get raw() { return this._raw }, set raw(val) { applyBodyInput(this, val) }, update(val: any) { applyBodyInput(this, val) },
          set(key: any, value: any) { const existing = this._fields.find((f: any) => f.key === key); if (existing) { existing.value = String(value); existing.enabled = true } else this._fields.push({ key, value: String(value), enabled: true }) },
          get(key: any) { return this._fields.find((f: any) => f.key === key)?.value },
          remove(key: any) { this._fields = this._fields.filter((f: any) => f.key !== key) },
          text() { return this._raw },
          json() { try { return JSON.parse(this._raw) } catch (_err) { return null } },
          toObject() { return { raw: this._raw, urlencoded: this._fields.map((f: any) => ({ ...f })), formdata: this._formdata.map((f: any) => ({ ...f })) } },
          all() { return this.toObject() },
          toString() { return this._raw },
          urlencoded: {
            add(input: any, value?: any) { for (const item of normalizeKvInput(input, value)) upsertField(pm.request.body._fields, item) },
            upsert(input: any, value?: any) { for (const item of normalizeKvInput(input, value)) upsertField(pm.request.body._fields, item) },
            remove(key: any) { pm.request.body._fields = pm.request.body._fields.filter((item: any) => item.key !== key) },
            all() { return pm.request.body._fields.map((item: any) => ({ ...item })) },
          },
          formdata: {
            add(input: any, value?: any) { for (const item of normalizeKvInput(input, value)) upsertField(pm.request.body._formdata, item) },
            upsert(input: any, value?: any) { for (const item of normalizeKvInput(input, value)) upsertField(pm.request.body._formdata, item) },
            remove(key: any) { pm.request.body._formdata = pm.request.body._formdata.filter((item: any) => item.key !== key) },
            all() { return pm.request.body._formdata.map((item: any) => ({ ...item })) },
          },
        },
        url: {
          _url: url || '',
          get raw() { return this._url }, set raw(val) { this._url = String(val ?? '') },
          get href() { return this._url }, set href(val) { this._url = String(val ?? '') },
          set(val: any) { this._url = String(val) }, get() { return this._url },
          toJSON() { return this._url }, valueOf() { return this._url }, toString() { return this._url }, [Symbol.toPrimitive]() { return this._url },
          includes(search: any, position?: any) { return this._url.includes(search, position) },
          startsWith(search: any, position?: any) { return this._url.startsWith(search, position) },
          endsWith(search: any, endPosition?: any) { return this._url.endsWith(search, endPosition) },
          match(pattern: any) { return this._url.match(pattern) },
          replace(pattern: any, replacement: any) { return this._url.replace(pattern, replacement) },
          addQueryParams(input: any, value?: any) {
            const params = normalizeKvInput(input, value).filter((item: any) => item.enabled !== false)
            for (const item of params) this._url += (this._url.includes('?') ? '&' : '?') + encodeURIComponent(item.key) + '=' + encodeURIComponent(item.value)
          },
          upsertQueryParams(input: any, value?: any) {
            const params = normalizeKvInput(input, value).filter((item: any) => item.enabled !== false)
            for (const item of params) { this.removeQueryParams(item.key); this.addQueryParams(item.key, item.value) }
          },
          removeQueryParams(key: any) {
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
        },
      },
      cookies: cookiesFacade,
      cookieJar: cookiesFacade.jar(),
      vault,
      execution,
      environment: {
        set(key: any, value: any) { envStore[key] = String(value); changedEnvKeys.add(key) },
        get(key: any) { return envStore[key] },
        unset(key: any) { delete envStore[key]; changedEnvKeys.add(key) },
        has(key: any) { return key in envStore },
        clear() { for (const key of Object.keys(envStore)) { delete envStore[key]; changedEnvKeys.add(key) } },
        import(values: any) { for (const [key, value] of Object.entries(values || {})) { envStore[key] = String(value); changedEnvKeys.add(key) } },
        toObject() { return { ...envStore } },
        replaceIn(template: any) { return createPmVariableScope(envStore).replaceIn(template) },
      },
      visualizer: createVisualizer(visualizations, log),
      sendRequest: createSendRequestFacade(requestId),
      response: createResponseFacade(responseData),
      test(name: any, fn: any) {
        try {
          const maybe = fn()
          if (maybe && typeof maybe.then === 'function') pendingTests.push(maybe.then(() => tests.push({ name, passed: true })).catch((err: any) => tests.push({ name, passed: false, error: err.message || String(err) })))
          else tests.push({ name, passed: true })
        } catch (err: any) { tests.push({ name, passed: false, error: err.message || String(err) }) }
      },
      expect: (value: any) => createExpectChain(value),
    }
    pm.test.skip = (name: any) => tests.push({ name, passed: true, skipped: true })
    pm.request = new Proxy(pm.request, {
      set(target: any, prop, value) {
        if (prop === 'url') { target.url.set(String(value ?? '')); return true }
        if (prop === 'body') { target.body.update(value); return true }
        if (prop === 'method') { target.method = value; return true }
        target[prop] = value
        return true
      },
    })
    pm.globals = createPmVariableScope({}, [pm.environment])
    pm.collectionVariables = createPmVariableScope({}, [pm.environment])
    pm.collection = pm.collectionVariables
    pm.variables = createPmVariableScope({}, [pm.environment, pm.collectionVariables, pm.globals])
    pm.iterationData = createPmVariableScope({}, [pm.environment])
    const wireScopedVariableSet = () => {
      const environmentSet = pm.environment.set.bind(pm.environment)
      const globalsSet = pm.globals.set.bind(pm.globals)
      const collectionSet = pm.collectionVariables.set.bind(pm.collectionVariables)
      const variablesSet = pm.variables.set.bind(pm.variables)
      const route = (fallback: any, key: any, value: any, scope: any) => {
        const normalized = String(scope || '').toLowerCase()
        if (normalized === 'global' || normalized === 'globals') globalsSet(key, value)
        else if (normalized === 'module' || normalized === 'collection' || normalized === 'collectionvariables') collectionSet(key, value)
        else if (normalized === 'local' || normalized === 'variable' || normalized === 'variables') variablesSet(key, value)
        else if (normalized === 'environment' || normalized === 'env') environmentSet(key, value)
        else fallback(key, value)
      }
      pm.environment.set = (key: any, value: any, scope?: any) => route(environmentSet, key, value, scope)
      pm.globals.set = (key: any, value: any, scope?: any) => route(globalsSet, key, value, scope)
      pm.collectionVariables.set = (key: any, value: any, scope?: any) => route(collectionSet, key, value, scope)
      pm.variables.set = (key: any, value: any, scope?: any) => route(variablesSet, key, value, scope)
    }
    wireScopedVariableSet()

    const postman = {
      setEnvironmentVariable: (key: any, value: any) => pm.environment.set(key, value), getEnvironmentVariable: (key: any) => pm.environment.get(key), clearEnvironmentVariable: (key: any) => pm.environment.unset(key),
      setGlobalVariable: (key: any, value: any) => pm.globals.set(key, value), getGlobalVariable: (key: any) => pm.globals.get(key), clearGlobalVariable: (key: any) => pm.globals.unset(key),
      environment: pm.environment, globals: pm.globals, collection: pm.collection, collectionVariables: pm.collectionVariables, variables: pm.variables, iterationData: pm.iterationData,
      cookies: pm.cookies, cookieJar: pm.cookieJar, vault: pm.vault, execution: pm.execution,
      request: pm.request, response: pm.response, info: pm.info, test: pm.test, expect: pm.expect,
    }

    try {
      const AsyncFunction = Object.getPrototypeOf(async function(){}).constructor
      const deniedGlobal = undefined
      const CryptoJS = createCryptoJsShim()
      // 不能加 'use strict':strict 下 'eval' 不能作为参数名,沙箱函数会构造失败(遮蔽失效)
      const safeScript = String(script ?? '')
      const fn = new AsyncFunction(
        'pm', 'postman', 'console', 'Math', 'Date', 'parseInt', 'parseFloat', 'JSON', 'CryptoJS', 'encodeURIComponent', 'decodeURIComponent', 'btoa', 'atob',
        'setTimeout', 'setInterval', 'clearTimeout', 'clearInterval', 'Promise', 'Array', 'Object', 'String', 'Number', 'Boolean', 'RegExp', 'Map', 'Set', 'WeakMap', 'WeakSet',
        'Proxy', 'Reflect', 'Symbol', 'Intl', 'ArrayBuffer', 'Uint8Array', 'TextEncoder', 'TextDecoder', 'URL', 'URLSearchParams', 'FormData', 'Blob', 'File', 'Error', 'TypeError', 'RangeError',
        'window', 'document', 'navigator', 'location', 'fetch', 'XMLHttpRequest', 'WebSocket', 'localStorage', 'sessionStorage', 'indexedDB', 'eval', 'Function', 'globalThis', 'self', 'parent', 'top', 'opener', 'chrome',
        safeScript,
      )
      await fn(
        pm, postman, sandboxedConsole, Math, Date, parseInt, parseFloat, JSON, CryptoJS, encodeURIComponent, decodeURIComponent, btoa, atob,
        setTimeout, setInterval, clearTimeout, clearInterval, Promise, Array, Object, String, Number, Boolean, RegExp, Map, Set, WeakMap, WeakSet,
        Proxy, Reflect, Symbol, Intl, ArrayBuffer, Uint8Array, TextEncoder, TextDecoder, URL, URLSearchParams, typeof FormData === 'undefined' ? undefined : FormData, typeof Blob === 'undefined' ? undefined : Blob, typeof File === 'undefined' ? undefined : File, Error, TypeError, RangeError,
        deniedGlobal, deniedGlobal, deniedGlobal, deniedGlobal, deniedGlobal, deniedGlobal, deniedGlobal, deniedGlobal, deniedGlobal, deniedGlobal, deniedGlobal, deniedGlobal, deniedGlobal, deniedGlobal, deniedGlobal, deniedGlobal, deniedGlobal, deniedGlobal,
      )
      await Promise.all(pendingTests)
      for (const result of tests) log(result.passed ? 'log' : 'error', result.skipped ? `[SKIP] ${result.name}` : result.passed ? `[PASS] ${result.name}` : `[FAIL] ${result.name}: ${result.error}`)
      transport.postResult({ type: 'SCRIPT_RESULT', requestId, success: true, result: { method: pm.request.method, headers: pm.request.headers._store, cookies: pm.request.cookies._store, url: pm.request.url._url, body: pm.request.body._raw, urlencoded: pm.request.body._fields, formdata: pm.request.body._formdata, envVars: envStore, envChangedKeys: [...changedEnvKeys], skipRequest: Boolean(pm.execution?._state?.skipRequest), nextRequest: pm.execution?._state?.nextRequest ?? null, logs, visualizations, tests } })
    } catch (err: any) {
      log('error', `脚本执行错误: ${err.message || String(err)}`)
      transport.postResult({ type: 'SCRIPT_RESULT', requestId, success: false, error: err.message || String(err), result: { method: pm.request.method, headers: pm.request.headers._store, cookies: pm.request.cookies._store, url: pm.request.url._url, body: pm.request.body._raw, urlencoded: pm.request.body._fields, formdata: pm.request.body._formdata, envVars: envStore, envChangedKeys: [...changedEnvKeys], skipRequest: Boolean(pm.execution?._state?.skipRequest), nextRequest: pm.execution?._state?.nextRequest ?? null, logs, visualizations, tests } })
    }
  })
}

// 自动装配:Worker 环境(self.postMessage)或沙箱 iframe(parent.postMessage);
// 防重复安装(script-worker importScripts 与页面脚本同时存在时只装一次)。
// Node(测试)环境两者皆无,跳过安装,由测试用例显式调用 installPmFacade。
const globalScope = globalThis as any
const hasWorkerEnv = typeof globalScope.importScripts === 'function'
const hasWindowEnv = typeof globalScope.window !== 'undefined'
if ((hasWorkerEnv || hasWindowEnv) && !globalScope.__apifixPmFacadeInstalled) {
  globalScope.__apifixPmFacadeInstalled = true
  if (hasWorkerEnv) {
    installPmFacade({
      addMessageListener: listener => self.addEventListener('message', listener as EventListener),
      removeMessageListener: listener => self.removeEventListener('message', listener as EventListener),
      postScriptRequest: payload => (self as any).postMessage(payload),
      postResult: payload => (self as any).postMessage(payload),
    })
  } else {
    installPmFacade({
      addMessageListener: listener => window.addEventListener('message', listener as EventListener),
      removeMessageListener: listener => window.removeEventListener('message', listener as EventListener),
      postScriptRequest: payload => (window as any).parent.postMessage(payload, '*'),
      postResult: payload => (window as any).parent.postMessage(payload, '*'),
    })
  }
}
