import type { ApiConfig, HttpMethod, KvPair, BodyConfig, AuthConfig } from '@/types'

function generateId(): string {
  return Date.now().toString(36) + Math.random().toString(36).slice(2, 8)
}

function createDefaultApi(partial: Partial<ApiConfig> = {}): ApiConfig {
  return {
    id: generateId(),
    name: partial.name || 'Untitled Request',
    method: partial.method || 'GET',
    url: partial.url || '',
    headers: partial.headers || [],
    params: partial.params || [],
    cookies: partial.cookies || [],
    body: partial.body || { type: 'none', raw: '', formData: [], urlEncoded: [], binaryFile: null, contentType: '' },
    auth: partial.auth || { type: 'none', bearerToken: '', basicUsername: '', basicPassword: '', apiKeyName: '', apiKeyValue: '', apiKeyIn: 'header' },
    preRequestScript: partial.preRequestScript || '',
    postRequestScript: partial.postRequestScript || '',
    folder: partial.folder || null,
    createdAt: Date.now(),
    updatedAt: Date.now(),
  }
}

// ── cURL Parser ──

interface CurlParseResult {
  method: HttpMethod
  url: string
  headers: KvPair[]
  body: BodyConfig
}

export function parseCurl(curlStr: string): CurlParseResult | null {
  try {
    const tokens = tokenizeCurl(curlStr)
    if (tokens.length === 0) return null

    let method: HttpMethod = 'GET'
    let url = ''
    const headers: KvPair[] = []
    let bodyType: BodyConfig['type'] = 'none'
    let bodyRaw = ''
    const formData: KvPair[] = []
    const urlEncoded: KvPair[] = []

    let i = 0
    // Skip 'curl' command itself
    if (tokens[0].toLowerCase() === 'curl') i++

    while (i < tokens.length) {
      const token = tokens[i]

      if (token === '-X' || token === '--request') {
        i++
        method = (tokens[i] || 'GET').toUpperCase() as HttpMethod
      } else if (token === '-H' || token === '--header') {
        i++
        const headerStr = tokens[i] || ''
        const colonIdx = headerStr.indexOf(':')
        if (colonIdx > 0) {
          headers.push({
            key: headerStr.slice(0, colonIdx).trim(),
            value: headerStr.slice(colonIdx + 1).trim(),
            enabled: true,
          })
        }
      } else if (token === '-d' || token === '--data' || token === '--data-raw' || token === '--data-binary') {
        i++
        bodyRaw = tokens[i] || ''
        bodyType = 'raw'
        const contentType = headers.find(h => h.key.toLowerCase() === 'content-type')
        if (!contentType) {
          headers.push({ key: 'Content-Type', value: 'application/x-www-form-urlencoded', enabled: true })
        }
        if (method === 'GET') method = 'POST'
      } else if (token === '-F' || token === '--form') {
        i++
        const formStr = tokens[i] || ''
        const eqIdx = formStr.indexOf('=')
        if (eqIdx > 0) {
          formData.push({
            key: formStr.slice(0, eqIdx),
            value: formStr.slice(eqIdx + 1),
            enabled: true,
          })
        }
        bodyType = 'form'
        if (method === 'GET') method = 'POST'
      } else if (!token.startsWith('-')) {
        url = token.replace(/^['"]|['"]$/g, '')
      }

      i++
    }

    if (!url) return null

    const body: BodyConfig = bodyType === 'form'
      ? { type: 'form', raw: '', formData, urlEncoded: [], binaryFile: null, contentType: '' }
      : bodyType === 'raw'
        ? { type: 'raw', raw: bodyRaw, formData: [], urlEncoded: [], binaryFile: null, contentType: 'application/x-www-form-urlencoded' }
        : { type: 'none', raw: '', formData: [], urlEncoded: [], binaryFile: null, contentType: '' }

    return { method, url, headers, body }
  } catch {
    return null
  }
}

function tokenizeCurl(input: string): string[] {
  const tokens: string[] = []
  let current = ''
  let inSingle = false
  let inDouble = false
  let escaped = false

  for (let i = 0; i < input.length; i++) {
    const ch = input[i]

    if (escaped) {
      current += ch
      escaped = false
      continue
    }

    if (ch === '\\') {
      if (inDouble) {
        escaped = true
      } else {
        current += ch
      }
      continue
    }

    if (ch === "'" && !inDouble) {
      inSingle = !inSingle
      continue
    }

    if (ch === '"' && !inSingle) {
      inDouble = !inDouble
      continue
    }

    if ((ch === ' ' || ch === '\t' || ch === '\n') && !inSingle && !inDouble) {
      if (current) {
        tokens.push(current)
        current = ''
      }
      continue
    }

    current += ch
  }

  if (current) tokens.push(current)
  return tokens
}

export function importCurl(curlStr: string): ApiConfig | null {
  const parsed = parseCurl(curlStr)
  if (!parsed) return null

  return createDefaultApi({
    method: parsed.method,
    url: parsed.url,
    headers: parsed.headers,
    body: parsed.body,
    name: parsed.url,
  })
}

// ── Postman Collection Parser ──

interface PostmanItem {
  name?: string
  request?: {
    method?: string
    url?: string | { raw?: string; host?: string[]; path?: string[]; query?: Array<{ key: string; value: string }> }
    header?: Array<{ key: string; value: string; disabled?: boolean }>
    body?: {
      mode?: string
      raw?: string
      urlencoded?: Array<{ key: string; value: string; disabled?: boolean }>
      formdata?: Array<{ key: string; value: string; type?: string; disabled?: boolean }>
    }
  }
}

interface PostmanCollection {
  info?: { name?: string }
  item?: (PostmanItem | { item: PostmanItem[] })[]
}

function resolvePostmanUrl(url: string | { raw?: string; host?: string[]; path?: string[]; query?: Array<{ key: string; value: string }> } | undefined): string {
  if (!url) return ''
  if (typeof url === 'string') return url
  if (url.raw) return url.raw
  let result = ''
  if (url.host) result += url.host.join('.')
  if (url.path) result += '/' + url.path.join('/')
  if (url.query && url.query.length > 0) {
    result += '?' + url.query.map(q => `${q.key}=${q.value}`).join('&')
  }
  return result
}

function parsePostmanItem(item: PostmanItem): ApiConfig | null {
  if (!item.request) return null

  const method = (item.request.method || 'GET').toUpperCase() as HttpMethod
  const url = resolvePostmanUrl(item.request.url)
  const headers: KvPair[] = (item.request.header || []).map(h => ({
    key: h.key,
    value: h.value,
    enabled: !h.disabled,
  }))

  let body: BodyConfig = { type: 'none', raw: '', formData: [], urlEncoded: [], binaryFile: null, contentType: '' }

  if (item.request.body) {
    const b = item.request.body
    switch (b.mode) {
      case 'raw':
        body = { type: 'raw', raw: b.raw || '', formData: [], urlEncoded: [], binaryFile: null, contentType: 'application/json' }
        break
      case 'urlencoded':
        body = {
          type: 'urlencoded',
          raw: '',
          formData: [],
          urlEncoded: (b.urlencoded || []).map(p => ({ key: p.key, value: p.value, enabled: !p.disabled })),
          binaryFile: null,
          contentType: 'application/x-www-form-urlencoded',
        }
        break
      case 'formdata':
        body = {
          type: 'form',
          raw: '',
          formData: (b.formdata || []).map(p => ({ key: p.key, value: p.value, enabled: !p.disabled })),
          urlEncoded: [],
          binaryFile: null,
          contentType: '',
        }
        break
    }
  }

  return createDefaultApi({
    name: item.name || url,
    method,
    url,
    headers,
    body,
  })
}

function flattenItems(items: (PostmanItem | { item: PostmanItem[] })[]): PostmanItem[] {
  const result: PostmanItem[] = []
  for (const item of items) {
    if ('item' in item && Array.isArray(item.item)) {
      result.push(...flattenItems(item.item as (PostmanItem | { item: PostmanItem[] })[]))
    } else if ('request' in item) {
      result.push(item as PostmanItem)
    }
  }
  return result
}

export function importPostman(jsonStr: string): ApiConfig[] {
  try {
    const collection: PostmanCollection = JSON.parse(jsonStr)
    if (!collection.item || !Array.isArray(collection.item)) return []

    const flatItems = flattenItems(collection.item)
    return flatItems.map(parsePostmanItem).filter((a): a is ApiConfig => a !== null)
  } catch {
    return []
  }
}
