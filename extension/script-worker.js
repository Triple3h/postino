function formatLogArg(arg) {
  if (arg instanceof Error) return `${arg.name}: ${arg.message}`
  if (typeof arg === 'string') return arg
  if (arg == null) return String(arg)
  try { return typeof arg === 'object' ? JSON.stringify(arg) : String(arg) } catch { return Object.prototype.toString.call(arg) }
}

function escapeRegExp(value) {
  return String(value).replace(/[.*+?^${}()|[\]\\]/g, '\\$&')
}

function headerLookup(headers, key) {
  const lower = String(key).toLowerCase()
  const matched = Object.keys(headers || {}).find(item => item.toLowerCase() === lower)
  return matched ? headers[matched] : undefined
}

function setHeaderValue(headers, key, value) {
  const lower = String(key).toLowerCase()
  const matched = Object.keys(headers || {}).find(item => item.toLowerCase() === lower)
  headers[matched || key] = String(value ?? '')
}

function removeHeaderValue(headers, key) {
  const lower = String(key).toLowerCase()
  const matched = Object.keys(headers || {}).find(item => item.toLowerCase() === lower)
  if (matched) delete headers[matched]
}

function createMutableHeaderFacade(headerStore) {
  const methods = {
    _store: headerStore,
    add(input, value) {
      for (const item of normalizeKvInput(input, value)) {
        if (headerLookup(headerStore, item.key) === undefined) headerStore[item.key] = item.value
      }
    },
    set(key, value) { setHeaderValue(headerStore, key, value) },
    upsert(input, value) {
      for (const item of normalizeKvInput(input, value)) setHeaderValue(headerStore, item.key, item.value)
    },
    get(key) { return headerLookup(headerStore, key) },
    remove(key) { removeHeaderValue(headerStore, key) },
    has(key) { return headerLookup(headerStore, key) !== undefined },
    all() { return { ...headerStore } },
    toObject() { return { ...headerStore } },
    each(callback) { Object.entries(headerStore).forEach(([key, value]) => callback(value, key)) },
    clear() { Object.keys(headerStore).forEach(key => delete headerStore[key]) },
  }
  return new Proxy(methods, {
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
    ownKeys() { return Object.keys(headerStore) },
    getOwnPropertyDescriptor(target, prop) {
      if (typeof prop !== 'string') return Reflect.getOwnPropertyDescriptor(target, prop)
      if (prop in target) return { configurable: true, enumerable: false, writable: true, value: Reflect.get(target, prop) }
      const matched = Object.keys(headerStore).find(key => key.toLowerCase() === prop.toLowerCase())
      if (!matched) return undefined
      return { configurable: true, enumerable: true, writable: true, value: headerStore[matched] }
    },
  })
}

function createCryptoJsShim() {
  const K = [
    0x428a2f98, 0x71374491, 0xb5c0fbcf, 0xe9b5dba5, 0x3956c25b, 0x59f111f1, 0x923f82a4, 0xab1c5ed5,
    0xd807aa98, 0x12835b01, 0x243185be, 0x550c7dc3, 0x72be5d74, 0x80deb1fe, 0x9bdc06a7, 0xc19bf174,
    0xe49b69c1, 0xefbe4786, 0x0fc19dc6, 0x240ca1cc, 0x2de92c6f, 0x4a7484aa, 0x5cb0a9dc, 0x76f988da,
    0x983e5152, 0xa831c66d, 0xb00327c8, 0xbf597fc7, 0xc6e00bf3, 0xd5a79147, 0x06ca6351, 0x14292967,
    0x27b70a85, 0x2e1b2138, 0x4d2c6dfc, 0x53380d13, 0x650a7354, 0x766a0abb, 0x81c2c92e, 0x92722c85,
    0xa2bfe8a1, 0xa81a664b, 0xc24b8b70, 0xc76c51a3, 0xd192e819, 0xd6990624, 0xf40e3585, 0x106aa070,
    0x19a4c116, 0x1e376c08, 0x2748774c, 0x34b0bcb5, 0x391c0cb3, 0x4ed8aa4a, 0x5b9cca4f, 0x682e6ff3,
    0x748f82ee, 0x78a5636f, 0x84c87814, 0x8cc70208, 0x90befffa, 0xa4506ceb, 0xbef9a3f7, 0xc67178f2,
  ]
  const stringToBytes = str => {
    const bytes = []
    for (let i = 0; i < str.length; i++) {
      const code = str.charCodeAt(i)
      if (code < 0x80) bytes.push(code)
      else if (code < 0x800) bytes.push(0xc0 | (code >> 6), 0x80 | (code & 0x3f))
      else if (code < 0xd800 || code >= 0xe000) bytes.push(0xe0 | (code >> 12), 0x80 | ((code >> 6) & 0x3f), 0x80 | (code & 0x3f))
      else { i++; const cp = 0x10000 + (((code & 0x3ff) << 10) | (str.charCodeAt(i) & 0x3ff)); bytes.push(0xf0 | (cp >> 18), 0x80 | ((cp >> 12) & 0x3f), 0x80 | ((cp >> 6) & 0x3f), 0x80 | (cp & 0x3f)) }
    }
    return bytes
  }
  const sha256 = bytes => {
    const padded = bytes.slice(); padded.push(0x80)
    while (padded.length % 64 !== 56) padded.push(0)
    const bitLen = bytes.length * 8
    for (let i = 56; i >= 0; i -= 8) padded.push(Math.floor(bitLen / Math.pow(2, i)) & 0xff)
    let h0 = 0x6a09e667, h1 = 0xbb67ae85, h2 = 0x3c6ef372, h3 = 0xa54ff53a
    let h4 = 0x510e527f, h5 = 0x9b05688c, h6 = 0x1f83d9ab, h7 = 0x5be0cd19
    for (let offset = 0; offset < padded.length; offset += 64) {
      const w = new Array(64)
      for (let j = 0; j < 16; j++) w[j] = (padded[offset + j * 4] << 24) | (padded[offset + j * 4 + 1] << 16) | (padded[offset + j * 4 + 2] << 8) | padded[offset + j * 4 + 3]
      for (let j = 16; j < 64; j++) { const s0 = ((w[j - 15] >>> 7) | (w[j - 15] << 25)) ^ ((w[j - 15] >>> 18) | (w[j - 15] << 14)) ^ (w[j - 15] >>> 3); const s1 = ((w[j - 2] >>> 17) | (w[j - 2] << 15)) ^ ((w[j - 2] >>> 19) | (w[j - 2] << 13)) ^ (w[j - 2] >>> 10); w[j] = (w[j - 16] + s0 + w[j - 7] + s1) | 0 }
      let a = h0, b = h1, c = h2, d = h3, e = h4, f = h5, g = h6, h = h7
      for (let j = 0; j < 64; j++) { const S1 = ((e >>> 6) | (e << 26)) ^ ((e >>> 11) | (e << 21)) ^ ((e >>> 25) | (e << 7)); const ch = (e & f) ^ (~e & g); const temp1 = (h + S1 + ch + K[j] + w[j]) | 0; const S0 = ((a >>> 2) | (a << 30)) ^ ((a >>> 13) | (a << 19)) ^ ((a >>> 22) | (a << 10)); const maj = (a & b) ^ (a & c) ^ (b & c); const temp2 = (S0 + maj) | 0; h = g; g = f; f = e; e = (d + temp1) | 0; d = c; c = b; b = a; a = (temp1 + temp2) | 0 }
      h0 = (h0 + a) | 0; h1 = (h1 + b) | 0; h2 = (h2 + c) | 0; h3 = (h3 + d) | 0; h4 = (h4 + e) | 0; h5 = (h5 + f) | 0; h6 = (h6 + g) | 0; h7 = (h7 + h) | 0
    }
    return [h0, h1, h2, h3, h4, h5, h6, h7].map(item => ('00000000' + (item >>> 0).toString(16)).slice(-8)).join('')
  }
  return { SHA256(message) { const bytes = typeof message === 'string' ? stringToBytes(message) : Array.isArray(message) ? message : stringToBytes(String(message ?? '')); const hashHex = sha256(bytes); return { toString: () => hashHex } } }
}

function normalizeKvInput(input, value) {
  if (Array.isArray(input)) return input.flatMap(item => normalizeKvInput(item))
  if (input && typeof input === 'object') {
    if (!('key' in input) && !('name' in input)) {
      if (typeof input.entries === 'function') return kvPairsFromEntries(input.entries())
      return Object.entries(input).map(([key, entryValue]) => ({ key, value: String(entryValue ?? ''), enabled: true })).filter(field => field.key)
    }
    const key = String(input.key ?? input.name ?? '')
    if (!key) return []
    return [{ key, value: String(input.value ?? ''), enabled: input.disabled === undefined ? true : !input.disabled, description: input.description == null ? undefined : String(input.description) }]
  }
  if (typeof input === 'string') return [{ key: input, value: String(value ?? ''), enabled: true }]
  return []
}


function upsertField(fields, field) {
  const existing = fields.find(item => item.key === field.key)
  if (existing) Object.assign(existing, field, { enabled: field.enabled !== false })
  else fields.push({ ...field, enabled: field.enabled !== false })
}

function kvPairsFromEntries(entries) {
  return Array.from(entries).map(([key, value]) => ({ key: String(key), value: String(value ?? ''), enabled: true })).filter(item => item.key)
}

function stringifyBodyInput(value) {
  if (value == null) return ''
  if (typeof value === 'string') return value
  if (typeof value === 'number' || typeof value === 'boolean') return String(value)
  try { return JSON.stringify(value) } catch { return String(value) }
}

function applyBodyInput(bodyFacade, value) {
  const setRaw = rawValue => {
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


function getCookieJarKey(url) {
  try { return new URL(url || 'http://apifix.local').origin } catch (_err) { return url || '__default__' }
}

function createCookieFacade(cookieStore, currentUrl = '') {
  const currentKey = getCookieJarKey(currentUrl)
  const jarStore = new Map([[currentKey, cookieStore]])
  const getBucket = url => {
    const key = getCookieJarKey(url || currentUrl)
    if (!jarStore.has(key)) jarStore.set(key, [])
    return jarStore.get(key)
  }
  const toObject = (bucket = cookieStore) => Object.fromEntries(bucket.filter(item => item.enabled !== false).map(item => [item.key, item.value]))
  const setCookie = (bucket, name, value) => upsertField(bucket, { key: String(name), value: String(value ?? ''), enabled: true })
  const unsetCookie = (bucket, name) => { const index = bucket.findIndex(item => item.key === name); if (index >= 0) bucket.splice(index, 1) }
  const withCallback = (valueFactory, callback) => {
    const promise = Promise.resolve().then(valueFactory)
    if (callback) promise.then(value => callback(null, value)).catch(err => callback(err instanceof Error ? err : new Error(String(err))))
    return promise
  }
  const jar = {
    get(url, name, callback) { return withCallback(() => getBucket(url).find(item => item.key === name && item.enabled !== false)?.value, callback) },
    getAll(url, callback) { return withCallback(() => toObject(getBucket(url)), callback) },
    set(url, name, value, callback) { return withCallback(() => { setCookie(getBucket(url), name, value); return String(value ?? '') }, callback) },
    unset(url, name, callback) { return withCallback(() => { unsetCookie(getBucket(url), name); return undefined }, callback) },
    clear(url, callback) { return withCallback(() => { getBucket(url).splice(0); return undefined }, callback) },
    toObject(url) { return toObject(getBucket(url)) },
  }
  return {
    jar: () => jar,
    get(name) { return cookieStore.find(item => item.key === name && item.enabled !== false)?.value },
    has(name) { return cookieStore.some(item => item.key === name && item.enabled !== false) },
    set(name, value) { setCookie(cookieStore, name, value) },
    unset(name) { unsetCookie(cookieStore, name) },
    clear() { cookieStore.splice(0) },
    toObject: () => toObject(cookieStore),
    all: () => cookieStore.map(item => ({ ...item })),
    each(callback) { cookieStore.filter(item => item.enabled !== false).forEach(item => callback(item.value, item.key)) },
  }
}

function parseJsonPath(path) {
  const source = String(path || '').trim().replace(/^json(?=\.)/, '$')
  const tokens = []
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

function jsonPathQuery(data, path) {
  const tokens = parseJsonPath(path)
  if (tokens.length === 0) return data
  const visit = (current, index) => {
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

function createHeaderFacade(headers) {
  const facade = {}
  for (const [key, value] of Object.entries(headers || {})) {
    facade[key] = value
    facade[key.toLowerCase()] = value
  }
  Object.defineProperties(facade, {
    get: { value: key => headerLookup(headers, key), enumerable: false },
    has: { value: key => headerLookup(headers, key) !== undefined, enumerable: false },
    all: { value: () => ({ ...headers }), enumerable: false },
    toObject: { value: () => ({ ...headers }), enumerable: false },
  })
  return facade
}

function createResponseFacade(data) {
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
    jsonPath: path => { try { return jsonPathQuery(JSON.parse(response.body), path) } catch { return null } },
    match: pattern => { const matched = response.body.match(typeof pattern === 'string' ? new RegExp(pattern) : pattern); return matched ? matched[0] : null },
    to: { have: {
      status(expected) { if (response.status !== expected) throw new Error(`expected status ${expected} but got ${response.status}`) },
      header(key) { if (headerLookup(response.headers, key) === undefined) throw new Error(`expected response to have header ${key}`) },
      body(expected) { const ok = typeof expected === 'string' ? response.body.includes(expected) : expected.test(response.body); if (!ok) throw new Error('expected response body to match') },
      jsonBody(path, expected) {
        let parsed
        try { parsed = JSON.parse(response.body) } catch (_err) { throw new Error('expected response body to be valid JSON') }
        const actual = path ? jsonPathQuery(parsed, path) : parsed
        if (expected !== undefined && JSON.stringify(actual) !== JSON.stringify(expected)) throw new Error(`expected JSON body ${path || '$'} to equal ${JSON.stringify(expected)}`)
      },
      bodyContains(expected) { if (!response.body.includes(expected)) throw new Error(`expected response body to contain ${expected}`) },
    }},
    toJSON: () => data,
  }
}

function createExpectChain(value) {
  const state = { negate: false, deep: false }
  const assert = (condition, message) => {
    const failed = state.negate ? condition : !condition
    state.negate = false
    state.deep = false
    if (failed) throw new Error(message)
  }
  const isType = expected => {
    const normalized = String(expected).toLowerCase()
    if (normalized === 'array') return Array.isArray(value)
    if (normalized === 'null') return value === null
    return typeof value === normalized
  }
  const actualType = () => Array.isArray(value) ? 'array' : value === null ? 'null' : typeof value
  const deepEqual = (left, right) => JSON.stringify(left) === JSON.stringify(right)
  const getLength = target => typeof target === 'string' || Array.isArray(target) ? target.length : target && typeof target === 'object' ? Object.keys(target).length : undefined

  const chain = {
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
    a(type) {
      assert(isType(type), `Expected ${actualType()} to ${state.negate ? 'not ' : ''}be ${type}`)
      return chain
    },
    an(type) { return chain.a(type) },
    eql(expected) {
      assert(deepEqual(value, expected), `Expected ${JSON.stringify(value)} to ${state.negate ? 'not ' : ''}deep equal ${JSON.stringify(expected)}`)
      return chain
    },
    equal(expected) {
      assert(state.deep ? deepEqual(value, expected) : value === expected, `Expected ${formatLogArg(value)} to ${state.negate ? 'not ' : ''}equal ${formatLogArg(expected)}`)
      return chain
    },
    equals(expected) { return chain.equal(expected) },
    oneOf(expected) {
      assert(Array.isArray(expected) && expected.includes(value), `Expected ${formatLogArg(value)} to ${state.negate ? 'not ' : ''}be one of ${JSON.stringify(expected)}`)
      return chain
    },
    match(regex) {
      const matcher = typeof regex === 'string' ? new RegExp(regex) : regex
      assert(matcher.test(String(value)), `Expected ${formatLogArg(value)} to ${state.negate ? 'not ' : ''}match ${matcher}`)
      return chain
    },
    include(substring) {
      if (typeof value === 'string') assert(value.includes(String(substring)), `Expected "${value}" to ${state.negate ? 'not ' : ''}include "${substring}"`)
      else if (Array.isArray(value)) assert(value.includes(substring), `Expected array to ${state.negate ? 'not ' : ''}include ${formatLogArg(substring)}`)
      else if (value && typeof value === 'object') assert(substring in value, `Expected object to ${state.negate ? 'not ' : ''}include key ${String(substring)}`)
      else assert(false, 'Expected value to be string, array or object')
      return chain
    },
    includes(substring) { return chain.include(substring) },
    above(n) {
      assert(Number(value) > n, `Expected ${formatLogArg(value)} to be above ${n}`)
      return chain
    },
    greaterThan(n) { return chain.above(n) },
    below(n) {
      assert(Number(value) < n, `Expected ${formatLogArg(value)} to be below ${n}`)
      return chain
    },
    lessThan(n) { return chain.below(n) },
    within(min, max) {
      assert(Number(value) >= min && Number(value) <= max, `Expected ${formatLogArg(value)} to be within ${min}..${max}`)
      return chain
    },
    property(name, expected) {
      const obj = value
      const shouldDeepEqual = state.deep
      assert(obj != null && typeof obj === 'object' && name in obj, `Expected object to ${state.negate ? 'not ' : ''}have property "${name}"`)
      if (arguments.length > 1) assert(shouldDeepEqual ? deepEqual(obj[name], expected) : obj[name] === expected, `Expected property "${name}" to equal ${formatLogArg(expected)}`)
      return createExpectChain(obj?.[name])
    },
    ownProperty(name) { return chain.property(name) },
    ownPropertyDescriptor(name) {
      const descriptor = value != null && typeof value === 'object' ? Object.getOwnPropertyDescriptor(value, name) : undefined
      assert(Boolean(descriptor), `Expected object to ${state.negate ? 'not ' : ''}have own property descriptor "${name}"`)
      return createExpectChain(descriptor)
    },
    key(name) {
      const obj = value
      assert(obj != null && typeof obj === 'object' && name in obj, `Expected object to ${state.negate ? 'not ' : ''}contain key "${name}"`)
      return chain
    },
    keys(...names) {
      const expected = Array.isArray(names[0]) ? names[0] : names
      const obj = value
      assert(obj != null && typeof obj === 'object' && expected.every(name => name in obj), `Expected object to contain keys ${expected.join(', ')}`)
      return chain
    },
    lengthOf(expected) {
      const length = getLength(value)
      assert(length === expected, `Expected length ${length} to ${state.negate ? 'not ' : ''}equal ${expected}`)
      return chain
    },
    length(expected) { return chain.lengthOf(expected) },
    least(n) {
      assert(Number(value) >= n, `Expected ${formatLogArg(value)} to be at least ${n}`)
      return chain
    },
    gte(n) { return chain.least(n) },
    most(n) {
      assert(Number(value) <= n, `Expected ${formatLogArg(value)} to be at most ${n}`)
      return chain
    },
    lte(n) { return chain.most(n) },
    members(expected) {
      assert(Array.isArray(value) && Array.isArray(expected) && expected.every(item => value.includes(item)), `Expected array to include members ${JSON.stringify(expected)}`)
      return chain
    },
    satisfy(predicate) {
      assert(typeof predicate === 'function' && predicate(value), 'Expected value to satisfy predicate')
      return chain
    },
    'throw'(expected) {
      assert(typeof value === 'function', 'Expected value to be a function')
      let thrown
      try { value() } catch (err) { thrown = err }
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
    throws(expected) { return chain.throw(expected) },
  }
  chain.bea = type => chain.a(type)
  return chain
}

function renderTemplate(template, data) {
  if (!data || typeof data !== 'object') return template
  const resolvePath = key => key.split('.').reduce((current, part) => current && typeof current === 'object' ? current[part] : undefined, data)
  const interpolate = (_, key) => {
    const value = resolvePath(String(key).trim())
    return value == null ? '' : String(value)
  }
  return String(template)
    .replace(/\{\{\s*([\w.-]+)\s*\}\}/g, interpolate)
    .replace(/<%=\s*([\w.-]+)\s*%>/g, interpolate)
}


function createVaultFacade(initialValues = {}) {
  const store = new Map(Object.entries(initialValues).map(([key, value]) => [key, String(value ?? '')]))
  const resolveValue = (valueFactory, callback) => {
    const promise = Promise.resolve().then(valueFactory)
    if (callback) promise.then(value => callback(null, value)).catch(err => callback(err instanceof Error ? err : new Error(String(err))))
    return promise
  }
  return {
    get(key, callback) { return resolveValue(() => store.get(String(key)), callback) },
    set(key, value, callback) { return resolveValue(() => { const normalized = String(value ?? ''); store.set(String(key), normalized); return normalized }, callback) },
    unset(key, callback) { return resolveValue(() => { store.delete(String(key)); return undefined }, callback) },
    clear(callback) { return resolveValue(() => { store.clear(); return undefined }, callback) },
    has(key, callback) { return resolveValue(() => store.has(String(key)), callback) },
    toObject() { return Object.fromEntries(store.entries()) },
  }
}

function createPmVariableScope(ownStore = {}, fallbackScopes = []) {
  return {
    set(key, value) { ownStore[key] = String(value) },
    get(key) {
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
    unset(key) { delete ownStore[key] },
    has(key) { return key in ownStore || fallbackScopes.some(scope => scope.has ? scope.has(key) : scope.get(key) !== undefined) },
    clear() { for (const key of Object.keys(ownStore)) delete ownStore[key] },
    import(values) { for (const [key, value] of Object.entries(values || {})) ownStore[key] = String(value) },
    toObject() { return { ...ownStore } },
    replaceIn(template) {
      return String(template).replace(/\{\{\s*([\w.-]+)\s*\}\}/g, (_, key) => {
        const value = this.get(key)
        return value == null ? '' : String(value)
      })
    },
  }
}

function createVisualizer(visualizations, log) {
  return {
    set(content, data) { this.template(content, data) },
    template(template, data) {
      visualizations.push({ id: `${Date.now().toString(36)}${Math.random().toString(36).slice(2)}`, type: 'template', title: 'Visualizer', content: renderTemplate(template, data), data, createdAt: Date.now() })
      log('info', 'pm.visualizer.template rendered')
    },
    table(data, options) {
      const legacyTitleMode = typeof data === 'string' && Array.isArray(options)
      const title = legacyTitleMode ? data : (options && options.title) || 'Table'
      const list = Array.isArray(legacyTitleMode ? options : data) ? (legacyTitleMode ? options : data) : []
      const escape = value => String(value ?? '').replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;').replace(/'/g, '&#39;')
      const columns = list.length && typeof list[0] === 'object' ? Object.keys(list[0]) : []
      const html = `<h3>${escape(title)}</h3><table><thead><tr>${columns.map(col => `<th>${escape(col)}</th>`).join('')}</tr></thead><tbody>${list.map(row => `<tr>${columns.map(col => `<td>${escape(row[col])}</td>`).join('')}</tr>`).join('')}</tbody></table>`
      visualizations.push({ id: `${Date.now().toString(36)}${Math.random().toString(36).slice(2)}`, type: 'table', title, content: html, data: list, createdAt: Date.now() })
      log('info', 'pm.visualizer.table rendered')
    },
  }
}

function createSendRequestFacade(requestId) {
  let seq = 0
  const send = (input, callback) => {
    const callId = `${requestId}:${++seq}`
    const promise = new Promise((resolve, reject) => {
      const handler = event => {
        if (event.data?.type !== 'SCRIPT_SEND_RESPONSE' || event.data.requestId !== requestId || event.data.callId !== callId) return
        self.removeEventListener('message', handler)
        if (event.data.success) resolve(createResponseFacade(event.data.response))
        else reject(new Error(event.data.error || 'pm.sendRequest failed'))
      }
      self.addEventListener('message', handler)
      self.postMessage({ type: 'SCRIPT_SEND_REQUEST', requestId, callId, input })
    })
    if (callback) promise.then(resp => callback(null, resp)).catch(err => callback(err, null))
    return promise
  }
  send.sendInterface = (interfaceOrApiId, overrides, callback) => {
    if (typeof overrides === 'function') { callback = overrides; overrides = undefined }
    const callId = `${requestId}:iface:${++seq}`
    const promise = new Promise((resolve, reject) => {
      const handler = event => {
        if (event.data?.type !== 'SCRIPT_SEND_RESPONSE' || event.data.requestId !== requestId || event.data.callId !== callId) return
        self.removeEventListener('message', handler)
        if (event.data.success) resolve(createResponseFacade(event.data.response))
        else reject(new Error(event.data.error || 'pm.sendRequest.sendInterface failed'))
      }
      self.addEventListener('message', handler)
      self.postMessage({ type: 'SCRIPT_SEND_REQUEST', requestId, callId, interfaceOrApiId, overrides })
    })
    if (callback) promise.then(resp => callback(null, resp)).catch(err => callback(err, null))
    return promise
  }
  return send
}

function createExecutionFacade(requestId, log, info) {
  const state = { skipRequest: false, nextRequest: null, runRequestCount: 0 }
  const runRequest = (interfaceOrApiId, overrides, callback) => {
    if (typeof overrides === 'function') { callback = overrides; overrides = undefined }
    state.runRequestCount += 1
    if (state.runRequestCount > 10) {
      const err = new Error('pm.execution.runRequest 每个脚本最多调用 10 次')
      if (callback) callback(err, null)
      return Promise.reject(err)
    }
    const callId = `${requestId}:exec:${Date.now().toString(36)}:${Math.random().toString(36).slice(2)}`
    const promise = new Promise((resolve, reject) => {
      const handler = event => {
        if (event.data?.type !== 'SCRIPT_SEND_RESPONSE' || event.data.requestId !== requestId || event.data.callId !== callId) return
        self.removeEventListener('message', handler)
        if (event.data.success) resolve(createResponseFacade(event.data.response))
        else reject(new Error(event.data.error || 'pm.execution.runRequest failed'))
      }
      self.addEventListener('message', handler)
      self.postMessage({ type: 'SCRIPT_SEND_REQUEST', requestId, callId, interfaceOrApiId, overrides })
    })
    if (callback) promise.then(resp => callback(null, resp)).catch(err => callback(err, null))
    return promise
  }
  return {
    _state: state,
    location: (() => { const parts = [info?.categoryName, info?.moduleName, info?.interfaceName].filter(Boolean).map(String); return Object.assign(parts, { current: parts[parts.length - 1] || '' }) })(),
    setNextRequest(requestNameOrId) { state.nextRequest = requestNameOrId == null ? null : String(requestNameOrId); log('info', `pm.execution.setNextRequest：${state.nextRequest ?? 'null'}`) },
    skipRequest() { state.skipRequest = true; log('warn', 'pm.execution.skipRequest：已跳过当前请求发送') },
    runRequest,
    get nextRequest() { return state.nextRequest },
    get skipped() { return state.skipRequest },
  }
}

self.addEventListener('message', async event => {
  const { type, script, envVars, method, headers, cookies, url, body, urlencoded, formdata, requestId, responseData, info } = event.data || {}
  if (type !== 'EXECUTE_SCRIPT') return

  const logs = []
  const tests = []
  const pendingTests = []
  const visualizations = []
  const envStore = { ...(envVars || {}) }
  const changedEnvKeys = new Set()
  const log = (level, ...args) => logs.push({ level, args: args.map(formatLogArg), timestamp: Date.now() })
  const sandboxedConsole = { log: (...a) => log('log', ...a), info: (...a) => log('info', ...a), warn: (...a) => log('warn', ...a), error: (...a) => log('error', ...a), table: (...a) => log('table', ...a) }
  const headerStore = { ...(headers || {}) }
  const cookieStore = (cookies || []).map(cookie => ({ ...cookie }))
  const cookiesFacade = createCookieFacade(cookieStore, url || '')
  let requestMethod = String(method || 'GET').toUpperCase()

  const vault = createVaultFacade()
  const execution = createExecutionFacade(requestId, log, info)

  const pm = {
    info: { moduleName: '', categoryName: '', interfaceName: '', eventName: responseData ? 'test' : 'prerequest', ...(info || {}) },
    request: {
      get method() { return requestMethod },
      set method(value) { requestMethod = String(value || 'GET').toUpperCase() },
      setMethod(value) { pm.request.method = value },
      addHeader(input, value) { pm.request.headers.add(input, value) },
      setHeader(key, value) { setHeaderValue(headerStore, key, value) },
      getHeader(key) { return headerLookup(headerStore, key) },
      removeHeader(key) { const lower = String(key).toLowerCase(); const matched = Object.keys(headerStore).find(item => item.toLowerCase() === lower); if (matched) delete headerStore[matched] },
      addQueryParam(input, value) { pm.request.url.addQueryParams(input, value) },
      removeQueryParam(key) { pm.request.url.removeQueryParams(key) },
      addCookie(input, value) { pm.request.cookies.add(input, value) },
      setCookie(key, value) { pm.request.cookies.upsert(key, value) },
      getCookie(key) { return pm.request.cookies.get(key) },
      removeCookie(key) { pm.request.cookies.remove(key) },
      setPathParam(key, value) { const escapedKey = escapeRegExp(key); pm.request.url._url = pm.request.url._url.replace(new RegExp(`(:${escapedKey}|\\{${escapedKey}\\}|\\{\\{\\s*${escapedKey}\\s*\\}\\})`, 'g'), encodeURIComponent(String(value))) },
      headers: createMutableHeaderFacade(headerStore),
      cookies: {
        _store: cookieStore,
        add(input, value) { for (const item of normalizeKvInput(input, value)) cookieStore.push(item) },
        set(key, value) { this.upsert(key, value) },
        upsert(input, value) { for (const item of normalizeKvInput(input, value)) upsertField(cookieStore, item) },
        get(key) { return cookieStore.find(item => item.key === key)?.value },
        remove(key) { const index = cookieStore.findIndex(item => item.key === key); if (index >= 0) cookieStore.splice(index, 1) },
        has(key) { return cookieStore.some(item => item.key === key) },
        all() { return cookieStore.map(item => ({ ...item })) },
        toObject() { return Object.fromEntries(cookieStore.filter(item => item.enabled !== false).map(item => [item.key, item.value])) },
        each(callback) { cookieStore.forEach(item => callback(item.value, item.key)) },
        clear() { cookieStore.splice(0, cookieStore.length) },
      },
      body: {
        _raw: body || '', _fields: [...(urlencoded || [])], _formdata: [...(formdata || [])],
        get raw() { return this._raw }, set raw(val) { applyBodyInput(this, val) }, update(val) { applyBodyInput(this, val) },
        set(key, value) { const existing = this._fields.find(f => f.key === key); if (existing) { existing.value = String(value); existing.enabled = true } else this._fields.push({ key, value: String(value), enabled: true }) },
        get(key) { return this._fields.find(f => f.key === key)?.value },
        remove(key) { this._fields = this._fields.filter(f => f.key !== key) },
        text() { return this._raw },
        json() { try { return JSON.parse(this._raw) } catch (_err) { return null } },
        toObject() { return { raw: this._raw, urlencoded: this._fields.map(f => ({ ...f })), formdata: this._formdata.map(f => ({ ...f })) } },
        all() { return this.toObject() },
        toString() { return this._raw },
        urlencoded: {
          add(input, value) { for (const item of normalizeKvInput(input, value)) upsertField(pm.request.body._fields, item) },
          upsert(input, value) { for (const item of normalizeKvInput(input, value)) upsertField(pm.request.body._fields, item) },
          remove(key) { pm.request.body._fields = pm.request.body._fields.filter(item => item.key !== key) },
          all() { return pm.request.body._fields.map(item => ({ ...item })) },
        },
        formdata: {
          add(input, value) { for (const item of normalizeKvInput(input, value)) upsertField(pm.request.body._formdata, item) },
          upsert(input, value) { for (const item of normalizeKvInput(input, value)) upsertField(pm.request.body._formdata, item) },
          remove(key) { pm.request.body._formdata = pm.request.body._formdata.filter(item => item.key !== key) },
          all() { return pm.request.body._formdata.map(item => ({ ...item })) },
        },
      },
      url: {
        _url: url || '',
        get raw() { return this._url }, set raw(val) { this._url = String(val ?? '') },
        get href() { return this._url }, set href(val) { this._url = String(val ?? '') },
        set(val) { this._url = String(val) }, get() { return this._url },
        toJSON() { return this._url }, valueOf() { return this._url }, toString() { return this._url }, [Symbol.toPrimitive]() { return this._url },
        includes(search, position) { return this._url.includes(search, position) },
        startsWith(search, position) { return this._url.startsWith(search, position) },
        endsWith(search, endPosition) { return this._url.endsWith(search, endPosition) },
        match(pattern) { return this._url.match(pattern) },
        replace(pattern, replacement) { return this._url.replace(pattern, replacement) },
        addQueryParams(input, value) {
          const params = normalizeKvInput(input, value).filter(item => item.enabled !== false)
          for (const item of params) this._url += (this._url.includes('?') ? '&' : '?') + encodeURIComponent(item.key) + '=' + encodeURIComponent(item.value)
        },
        upsertQueryParams(input, value) {
          const params = normalizeKvInput(input, value).filter(item => item.enabled !== false)
          for (const item of params) { this.removeQueryParams(item.key); this.addQueryParams(item.key, item.value) }
        },
        removeQueryParams(key) {
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
      set(key, value) { envStore[key] = String(value); changedEnvKeys.add(key) },
      get(key) { return envStore[key] },
      unset(key) { delete envStore[key]; changedEnvKeys.add(key) },
      has(key) { return key in envStore },
      clear() { for (const key of Object.keys(envStore)) { delete envStore[key]; changedEnvKeys.add(key) } },
      import(values) { for (const [key, value] of Object.entries(values || {})) { envStore[key] = String(value); changedEnvKeys.add(key) } },
      toObject() { return { ...envStore } },
      replaceIn(template) { return createPmVariableScope(envStore).replaceIn(template) },
    },
    visualizer: createVisualizer(visualizations, log),
    sendRequest: createSendRequestFacade(requestId),
    response: createResponseFacade(responseData),
    test(name, fn) {
      try {
        const maybe = fn()
        if (maybe && typeof maybe.then === 'function') pendingTests.push(maybe.then(() => tests.push({ name, passed: true })).catch(err => tests.push({ name, passed: false, error: err.message || String(err) })))
        else tests.push({ name, passed: true })
      } catch (err) { tests.push({ name, passed: false, error: err.message || String(err) }) }
    },
    expect: value => createExpectChain(value),
  }
  pm.test.skip = name => tests.push({ name, passed: true, skipped: true })
  pm.request = new Proxy(pm.request, {
    set(target, prop, value) {
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
    const route = (fallback, key, value, scope) => {
      const normalized = String(scope || '').toLowerCase()
      if (normalized === 'global' || normalized === 'globals') globalsSet(key, value)
      else if (normalized === 'module' || normalized === 'collection' || normalized === 'collectionvariables') collectionSet(key, value)
      else if (normalized === 'local' || normalized === 'variable' || normalized === 'variables') variablesSet(key, value)
      else if (normalized === 'environment' || normalized === 'env') environmentSet(key, value)
      else fallback(key, value)
    }
    pm.environment.set = (key, value, scope) => route(environmentSet, key, value, scope)
    pm.globals.set = (key, value, scope) => route(globalsSet, key, value, scope)
    pm.collectionVariables.set = (key, value, scope) => route(collectionSet, key, value, scope)
    pm.variables.set = (key, value, scope) => route(variablesSet, key, value, scope)
  }
  wireScopedVariableSet()

  const postman = {
    setEnvironmentVariable: (key, value) => pm.environment.set(key, value), getEnvironmentVariable: key => pm.environment.get(key), clearEnvironmentVariable: key => pm.environment.unset(key),
    setGlobalVariable: (key, value) => pm.globals.set(key, value), getGlobalVariable: key => pm.globals.get(key), clearGlobalVariable: key => pm.globals.unset(key),
    environment: pm.environment, globals: pm.globals, collection: pm.collection, collectionVariables: pm.collectionVariables, variables: pm.variables, iterationData: pm.iterationData,
    cookies: pm.cookies, cookieJar: pm.cookieJar, vault: pm.vault, execution: pm.execution,
    request: pm.request, response: pm.response, info: pm.info, test: pm.test, expect: pm.expect,
  }

  try {
    const AsyncFunction = Object.getPrototypeOf(async function(){}).constructor
    const deniedGlobal = undefined
    const CryptoJS = createCryptoJsShim()
    const safeScript = `'use strict';\n${script}`
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
    for (const result of tests) log(result.passed ? 'log' : 'error', result.skipped ? `- ${result.name} (skipped)` : result.passed ? `✓ ${result.name}` : `✗ ${result.name}: ${result.error}`)
    self.postMessage({ type: 'SCRIPT_RESULT', requestId, success: true, result: { method: pm.request.method, headers: pm.request.headers._store, cookies: pm.request.cookies._store, url: pm.request.url._url, body: pm.request.body._raw, urlencoded: pm.request.body._fields, formdata: pm.request.body._formdata, envVars: envStore, envChangedKeys: [...changedEnvKeys], skipRequest: Boolean(pm.execution?._state?.skipRequest), nextRequest: pm.execution?._state?.nextRequest ?? null, logs, visualizations, tests } })
  } catch (err) {
    log('error', `脚本执行错误: ${err.message || String(err)}`)
    self.postMessage({ type: 'SCRIPT_RESULT', requestId, success: false, error: err.message || String(err), result: { method: pm.request.method, headers: pm.request.headers._store, cookies: pm.request.cookies._store, url: pm.request.url._url, body: pm.request.body._raw, urlencoded: pm.request.body._fields, formdata: pm.request.body._formdata, envVars: envStore, envChangedKeys: [...changedEnvKeys], skipRequest: Boolean(pm.execution?._state?.skipRequest), nextRequest: pm.execution?._state?.nextRequest ?? null, logs, visualizations, tests } })
  }
})
