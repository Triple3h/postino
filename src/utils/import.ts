import type { ApiConfig, HttpMethod, KvPair, BodyConfig, AuthConfig, CookieItem, EnvVariable } from '@/types'
import { createDefaultAuthConfig, normalizeAuthConfig } from '@/utils/auth'

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
    auth: normalizeAuthConfig(partial.auth),
    requestVariables: partial.requestVariables || [],
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
      if (!inSingle && !inDouble && input[i + 1] === '\r' && input[i + 2] === '\n') {
        i += 2
      } else if (!inSingle && !inDouble && input[i + 1] === '\n') {
        i++
      } else if (inDouble) {
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
  event?: PostmanEvent[]
  variable?: PostmanVariable[]
  request?: {
    method?: string
    url?: string | { raw?: string; host?: string[]; path?: string[]; query?: Array<{ key: string; value: string }> }
    header?: Array<{ key: string; value: string; disabled?: boolean }>
    cookie?: Array<{ key: string; value: string; disabled?: boolean }>
    auth?: PostmanAuth
    body?: {
      mode?: string
      raw?: string
      urlencoded?: Array<{ key: string; value: string; disabled?: boolean }>
      formdata?: Array<{ key: string; value: string; type?: string; disabled?: boolean }>
    }
  }
}

interface PostmanAuth {
  type?: string
  bearer?: Array<{ key: string; value: string }>
  basic?: Array<{ key: string; value: string }>
  apikey?: Array<{ key: string; value: string }>
}

interface PostmanEvent {
  listen?: string
  script?: {
    exec?: string[] | string
    type?: string
  }
}

interface PostmanFolder {
  name?: string
  event?: PostmanEvent[]
  variable?: PostmanVariable[]
  auth?: PostmanAuth
  item: PostmanNode[]
}

type PostmanNode = PostmanItem | PostmanFolder

interface PostmanVariable {
  key?: string
  value?: unknown
  disabled?: boolean
}

interface PostmanCollection {
  info?: { name?: string; description?: string | { content?: string } }
  item?: PostmanNode[]
  variable?: PostmanVariable[]
  auth?: PostmanAuth
  event?: PostmanEvent[]
}

interface PostmanEnvValue {
  key?: string
  value?: unknown
  enabled?: boolean
  type?: string
}

interface PostmanEnvironment {
  name?: string
  values?: PostmanEnvValue[]
}

type PostmanUrl = string | { raw?: string; host?: string[]; path?: string[]; query?: Array<{ key: string; value: string; disabled?: boolean }> }

function stripQueryFromUrl(raw: string): string {
  const hashIndex = raw.indexOf('#')
  const beforeHash = hashIndex >= 0 ? raw.slice(0, hashIndex) : raw
  const hash = hashIndex >= 0 ? raw.slice(hashIndex) : ''
  const queryIndex = beforeHash.indexOf('?')
  return queryIndex >= 0 ? `${beforeHash.slice(0, queryIndex)}${hash}` : raw
}

function resolvePostmanUrl(url: PostmanUrl | undefined): string {
  if (!url) return ''
  if (typeof url === 'string') return url
  if (url.raw) return url.query?.length ? stripQueryFromUrl(url.raw) : url.raw
  let result = ''
  if (url.host) result += url.host.join('.')
  if (url.path) result += '/' + url.path.join('/')
  return result
}

function resolvePostmanParams(url: PostmanUrl | undefined): KvPair[] {
  if (!url || typeof url === 'string') return []
  return (url.query || [])
    .filter(param => param.key)
    .map(param => ({ key: param.key, value: param.value ?? '', enabled: !param.disabled }))
}

function parsePostmanVariables(variables: PostmanVariable[] | undefined): KvPair[] {
  return (variables || [])
    .filter(variable => Boolean(variable.key))
    .map(variable => ({
      key: variable.key || '',
      value: variable.value == null ? '' : String(variable.value),
      enabled: !variable.disabled,
    }))
}

function mergeKvPairs(primary: KvPair[], fallback: KvPair[]): KvPair[] {
  const merged = primary.map(item => ({ ...item }))
  const existingKeys = new Set(merged.map(item => item.key))
  for (const item of fallback) {
    if (!existingKeys.has(item.key)) {
      merged.push({ ...item })
      existingKeys.add(item.key)
    }
  }
  return merged
}

function resolvePostmanScript(events: PostmanEvent[] | undefined, listen: string): string {
  const event = events?.find(item => item.listen === listen)
  const exec = event?.script?.exec
  if (Array.isArray(exec)) return exec.join('\n')
  return typeof exec === 'string' ? exec : ''
}

function joinPostmanScripts(...scripts: Array<string | undefined>): string {
  return scripts
    .map(script => script?.trim() ?? '')
    .filter(Boolean)
    .join('\n\n')
}

function postmanAuthValue(auth: PostmanAuth | undefined, group: keyof PostmanAuth, key: string): string {
  const entries = auth?.[group]
  return Array.isArray(entries) ? entries.find(item => item.key === key)?.value ?? '' : ''
}

function parsePostmanAuth(auth: PostmanAuth | undefined): AuthConfig {
  const empty: AuthConfig = createDefaultAuthConfig()
  if (!auth?.type || auth.type === 'noauth') return empty
  if (auth.type === 'bearer') return { ...empty, type: 'bearer', bearerToken: postmanAuthValue(auth, 'bearer', 'token') }
  if (auth.type === 'basic') {
    return {
      ...empty,
      type: 'basic',
      basicUsername: postmanAuthValue(auth, 'basic', 'username'),
      basicPassword: postmanAuthValue(auth, 'basic', 'password'),
    }
  }
  if (auth.type === 'apikey') {
    return {
      ...empty,
      type: 'apikey',
      apiKeyName: postmanAuthValue(auth, 'apikey', 'key'),
      apiKeyValue: postmanAuthValue(auth, 'apikey', 'value'),
      apiKeyIn: postmanAuthValue(auth, 'apikey', 'in') === 'query' ? 'query' : 'header',
    }
  }
  return empty
}

function parsePostmanItem(item: PostmanItem, inheritedPreRequestScript = '', inheritedPostRequestScript = ''): ApiConfig | null {
  if (!item.request) return null

  const method = (item.request.method || 'GET').toUpperCase() as HttpMethod
  const url = resolvePostmanUrl(item.request.url)
  const headers: KvPair[] = (item.request.header || []).map(h => ({
    key: h.key,
    value: h.value,
    enabled: !h.disabled,
  }))
  const params = resolvePostmanParams(item.request.url)
  const cookies: CookieItem[] = (item.request.cookie || [])
    .filter(cookie => cookie.key)
    .map(cookie => ({
      key: cookie.key,
      value: cookie.value ?? '',
      enabled: !cookie.disabled,
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
    params,
    cookies,
    body,
    auth: parsePostmanAuth(item.request.auth),
    preRequestScript: joinPostmanScripts(inheritedPreRequestScript, resolvePostmanScript(item.event, 'prerequest')),
    postRequestScript: joinPostmanScripts(inheritedPostRequestScript, resolvePostmanScript(item.event, 'test')),
  })
}

type FlattenedPostmanItem = {
  item: PostmanItem
  folder: string | null
  inheritedPreRequestScript: string
  inheritedPostRequestScript: string
  inheritedVariables: KvPair[]
}

function flattenItems(
  items: PostmanNode[],
  folder: string | null = null,
  inheritedPreRequestScript = '',
  inheritedPostRequestScript = '',
  inheritedVariables: KvPair[] = [],
): FlattenedPostmanItem[] {
  const result: FlattenedPostmanItem[] = []
  for (const item of items) {
    if ('item' in item && Array.isArray(item.item)) {
      result.push(...flattenItems(
        item.item,
        item.name || folder,
        joinPostmanScripts(inheritedPreRequestScript, resolvePostmanScript(item.event, 'prerequest')),
        joinPostmanScripts(inheritedPostRequestScript, resolvePostmanScript(item.event, 'test')),
        mergeKvPairs(parsePostmanVariables(item.variable), inheritedVariables),
      ))
    } else if ('request' in item) {
      result.push({
        item: item as PostmanItem,
        folder,
        inheritedPreRequestScript,
        inheritedPostRequestScript,
        inheritedVariables: mergeKvPairs(parsePostmanVariables(item.variable), inheritedVariables),
      })
    }
  }
  return result
}

export function importPostman(jsonStr: string): ApiConfig[] {
  try {
    const collection: PostmanCollection = JSON.parse(jsonStr)
    if (!collection.item || !Array.isArray(collection.item)) return []

    const collectionVariables = parsePostmanVariables(collection.variable)
    const flatItems = flattenItems(collection.item)
    const imported: ApiConfig[] = []

    for (const { item, folder, inheritedPreRequestScript, inheritedPostRequestScript, inheritedVariables } of flatItems) {
      const api = parsePostmanItem(item, inheritedPreRequestScript, inheritedPostRequestScript)
      if (!api) continue
      imported.push({
        ...api,
        folder,
        requestVariables: mergeKvPairs(api.requestVariables || [], mergeKvPairs(inheritedVariables, collectionVariables)),
      })
    }

    return imported
  } catch {
    return []
  }
}

// ── Postman v2.1 树形导入(Phase 4.4):不拍平文件夹,集合/文件夹级 auth/变量/脚本落到对应节点 ──

export interface ImportedPostmanFolder {
  key: string
  parentKey: string | null
  name: string
  auth?: AuthConfig
  preRequestScript: string
  postRequestScript: string
  variables: KvPair[]
}

export interface ImportedPostmanRequest {
  parentKey: string | null
  api: ApiConfig
}

export interface ImportedPostmanTree {
  name: string
  description?: string
  auth?: AuthConfig
  preRequestScript: string
  postRequestScript: string
  variables: KvPair[]
  folders: ImportedPostmanFolder[]
  requests: ImportedPostmanRequest[]
}

export function importPostmanTree(jsonStr: string): ImportedPostmanTree | null {
  try {
    const collection: PostmanCollection = JSON.parse(jsonStr)
    if (!collection.item || !Array.isArray(collection.item)) return null

    const folders: ImportedPostmanFolder[] = []
    const requests: ImportedPostmanRequest[] = []
    let seq = 0
    // 集合级脚本(根),作为所有分支继承的起点
    const treePreRequestScript = resolvePostmanScript(collection.event, 'prerequest')
    const treePostRequestScript = resolvePostmanScript(collection.event, 'test')

    const walk = (items: PostmanNode[], parentKey: string | null, inheritedPreRequestScript = '', inheritedPostRequestScript = '') => {
      for (const node of items) {
        if ('item' in node && Array.isArray(node.item)) {
          const key = `pf:${++seq}:${generateId()}`
          // 文件夹自身脚本 + 上级继承脚本,一起传给更深层(Postman 脚本从集合→文件夹→请求逐层叠加)
          const folderPre = joinPostmanScripts(inheritedPreRequestScript, resolvePostmanScript(node.event, 'prerequest'))
          const folderPost = joinPostmanScripts(inheritedPostRequestScript, resolvePostmanScript(node.event, 'test'))
          folders.push({
            key,
            parentKey,
            name: node.name || `Folder ${seq}`,
            auth: node.auth ? normalizeAuthConfig(parsePostmanAuth(node.auth)) : undefined,
            preRequestScript: folderPre,
            postRequestScript: folderPost,
            variables: parsePostmanVariables(node.variable),
          })
          walk(node.item, key, folderPre, folderPost)
        } else if ('request' in node) {
          // 树形模式:请求携带上一级继承下来的集合/文件夹脚本(根→叶链)
          const api = parsePostmanItem(
            node as PostmanItem,
            inheritedPreRequestScript,
            inheritedPostRequestScript,
          )
          if (!api) continue
          // 树形模式:请求只保留自身脚本与自身 auth;无 auth 时留 inherit 以继承上级
          if (!(node as PostmanItem).request?.auth) {
            api.auth = { ...createDefaultAuthConfig(), type: 'inherit' }
          }
          requests.push({ parentKey, api })
        }
      }
    }
    walk(collection.item, null, treePreRequestScript, treePostRequestScript)

    const description = collection.info?.description
    return {
      name: collection.info?.name || 'Imported Collection',
      description: typeof description === 'string' ? description : description?.content,
      auth: collection.auth ? normalizeAuthConfig(parsePostmanAuth(collection.auth)) : undefined,
      preRequestScript: treePreRequestScript,
      postRequestScript: treePostRequestScript,
      variables: parsePostmanVariables(collection.variable),
      folders,
      requests,
    }
  } catch {
    return null
  }
}

/** Postman environment JSON(下载的 {environment:{...}} 或 {name,values})→ 集合环境草稿 */
export function importPostmanEnvironment(jsonStr: string): { name: string; variables: EnvVariable[] } | null {
  try {
    const parsed = JSON.parse(jsonStr) as { environment?: PostmanEnvironment } & PostmanEnvironment
    const env = parsed.environment ?? parsed
    if (!env || !Array.isArray(env.values)) return null
    const name = String(env.name || '').trim()
    if (!name) return null
    return {
      name,
      variables: env.values
        .filter((item): item is PostmanEnvValue & { key: string } => Boolean(item?.key))
        .map(item => ({
          key: item.key,
          value: item.value == null ? '' : String(item.value),
          enabled: item.enabled !== false,
          secret: item.type === 'secret' ? true : undefined,
        })),
    }
  } catch {
    return null
  }
}

// ── HAR Parser ──

interface HarHeader {
  name?: string
  key?: string
  value?: string
}

interface HarPostDataParam {
  name?: string
  value?: string
}

interface HarPostData {
  mimeType?: string
  text?: string
  params?: HarPostDataParam[]
}

interface HarRequest {
  method?: string
  url?: string
  headers?: HarHeader[]
  queryString?: HarHeader[]
  postData?: HarPostData
}

interface HarEntry {
  request?: HarRequest
  startedDateTime?: string
}

interface HarArchive {
  log?: {
    entries?: HarEntry[]
  }
}

function headerName(header: HarHeader): string {
  return header.name ?? header.key ?? ''
}

function convertHarBody(postData?: HarPostData): BodyConfig {
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
        key: param.name || '',
        value: param.value || '',
        enabled: true,
      })),
      binaryFile: null,
      contentType: 'application/x-www-form-urlencoded',
    }
  }

  if (mimeType.includes('multipart/form-data')) {
    return {
      type: 'form',
      raw: '',
      formData: (postData.params || []).map(param => ({
        key: param.name || '',
        value: param.value || '',
        enabled: true,
      })),
      urlEncoded: [],
      binaryFile: null,
      contentType: '',
    }
  }

  return {
    type: mimeType.includes('json') ? 'json' : 'raw',
    raw: postData.text || '',
    formData: [],
    urlEncoded: [],
    binaryFile: null,
    contentType: mimeType || (postData.text ? 'text/plain' : ''),
  }
}

export function importHar(jsonStr: string): ApiConfig[] {
  try {
    const archive: HarArchive = JSON.parse(jsonStr)
    const entries = archive.log?.entries
    if (!Array.isArray(entries)) return []

    return entries
      .map((entry, index) => {
        const req = entry.request
        if (!req?.url) return null
        const method = (req.method || 'GET').toUpperCase() as HttpMethod
        const url = req.url
        const urlWithoutQuery = url.split('?')[0] || url

        const headers: KvPair[] = (req.headers || [])
          .filter(h => headerName(h) && headerName(h).toLowerCase() !== 'cookie')
          .map(h => ({ key: headerName(h), value: h.value || '', enabled: true }))

        const params: KvPair[] = (req.queryString || [])
          .filter(p => headerName(p))
          .map(p => ({ key: headerName(p), value: p.value || '', enabled: true }))

        return createDefaultApi({
          name: `${method} ${new URL(url, 'http://localhost').pathname || `HAR Request ${index + 1}`}`,
          method,
          url: urlWithoutQuery,
          headers,
          params,
          body: convertHarBody(req.postData),
          folder: entry.startedDateTime ? new Date(entry.startedDateTime).toLocaleDateString() : 'HAR 导入',
        })
      })
      .filter((api): api is ApiConfig => api !== null)
  } catch {
    return []
  }
}
