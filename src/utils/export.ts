import type { ApiConfig, AuthConfig, Collection, CollectionExportDocument, CollectionNode, CollectionVariable, Environment, KvPair } from '@/types'
import { COLLECTION_EXPORT_VERSION } from '@/types'

export function generateCurl(api: ApiConfig, envVars: Record<string, string> = {}): string {
  const parts: string[] = ['curl']

  parts.push(`-X ${api.method}`)

  // Headers
  for (const h of api.headers) {
    if (h.enabled && h.key) {
      parts.push(`-H '${h.key}: ${resolveValue(h.value, envVars)}'`)
    }
  }

  // Auth headers
  if (api.auth.type === 'bearer') {
    parts.push(`-H 'Authorization: Bearer ${resolveValue(api.auth.bearerToken, envVars)}'`)
  } else if (api.auth.type === 'basic') {
    const encoded = btoa(`${resolveValue(api.auth.basicUsername, envVars)}:${resolveValue(api.auth.basicPassword, envVars)}`)
    parts.push(`-H 'Authorization: Basic ${encoded}'`)
  }
  const cookieHeader = buildCookieHeader(api, envVars)
  if (cookieHeader) {
    parts.push(`-b '${cookieHeader}'`)
  }

  // Body
  if (api.body.type === 'json' && api.body.raw) {
    parts.push(`-d '${resolveValue(api.body.raw, envVars)}'`)
  } else if (api.body.type === 'raw' && api.body.raw) {
    parts.push(`-d '${resolveValue(api.body.raw, envVars)}'`)
  } else if (api.body.type === 'urlencoded') {
    for (const f of api.body.urlEncoded) {
      if (f.enabled && f.key) {
        parts.push(`-d '${resolveValue(f.key, envVars)}=${resolveValue(f.value, envVars)}'`)
      }
    }
  } else if (api.body.type === 'form') {
    for (const f of api.body.formData) {
      if (f.enabled && f.key) {
        parts.push(`-F '${resolveValue(f.key, envVars)}=${resolveValue(f.value, envVars)}'`)
      }
    }
  }

  // URL with query params
  let url = resolveValue(api.url, envVars)
  const queryParts: string[] = []
  for (const p of api.params) {
    if (p.enabled && p.key) {
      queryParts.push(`${encodeURIComponent(resolveValue(p.key, envVars))}=${encodeURIComponent(resolveValue(p.value, envVars))}`)
    }
  }
  if (queryParts.length > 0) {
    url += '?' + queryParts.join('&')
  }
  parts.push(`'${url}'`)

  return parts.join(' \\\n  ')
}

export function generatePythonRequests(api: ApiConfig, envVars: Record<string, string> = {}): string {
  const lines: string[] = ['import requests']
  lines.push('')
  lines.push(`url = "${resolveValue(api.url, envVars)}"`)

  // Headers
  const headers: Record<string, string> = {}
  for (const h of api.headers) {
    if (h.enabled && h.key) headers[h.key] = resolveValue(h.value, envVars)
  }
  if (api.auth.type === 'bearer') {
    headers['Authorization'] = `Bearer ${resolveValue(api.auth.bearerToken, envVars)}`
  }
  if (Object.keys(headers).length > 0) {
    lines.push(`headers = ${JSON.stringify(headers, null, 4)}`)
  }

  // Params
  const params: Record<string, string> = {}
  for (const p of api.params) {
    if (p.enabled && p.key) params[p.key] = resolveValue(p.value, envVars)
  }
  if (Object.keys(params).length > 0) {
    lines.push(`params = ${JSON.stringify(params, null, 4)}`)
  }

  const cookies = getEnabledCookies(api, envVars)
  if (Object.keys(cookies).length > 0) {
    lines.push(`cookies = ${JSON.stringify(cookies, null, 4)}`)
  }

  // Body
  let bodyLine = ''
  if (api.body.type === 'json' && api.body.raw) {
    bodyLine = `json=${resolveValue(api.body.raw, envVars)}`
  } else if (api.body.type === 'urlencoded') {
    const data: Record<string, string> = {}
    for (const f of api.body.urlEncoded) {
      if (f.enabled && f.key) data[f.key] = resolveValue(f.value, envVars)
    }
    bodyLine = `data=${JSON.stringify(data)}`
  }

  // Auth
  let authLine = ''
  if (api.auth.type === 'basic') {
    authLine = `, auth=("${resolveValue(api.auth.basicUsername, envVars)}", "${resolveValue(api.auth.basicPassword, envVars)}")`
  }

  const method = api.method.toLowerCase()
  const kwargs: string[] = []
  if (Object.keys(headers).length > 0) kwargs.push('headers=headers')
  if (Object.keys(params).length > 0) kwargs.push('params=params')
  if (Object.keys(cookies).length > 0) kwargs.push('cookies=cookies')
  if (bodyLine) kwargs.push(bodyLine)

  lines.push(`response = requests.${method}(url${kwargs.length > 0 ? ', ' + kwargs.join(', ') : ''}${authLine})`)
  lines.push('')
  lines.push('print(response.status_code)')
  lines.push('print(response.json() if response.headers.get("content-type", "").startswith("application/json") else response.text)')

  return lines.join('\n')
}

export function generateJavaScriptFetch(api: ApiConfig, envVars: Record<string, string> = {}): string {
  const headers: Record<string, string> = {}
  for (const h of api.headers) {
    if (h.enabled && h.key) headers[h.key] = resolveValue(h.value, envVars)
  }
  if (api.auth.type === 'bearer') {
    headers['Authorization'] = `Bearer ${resolveValue(api.auth.bearerToken, envVars)}`
  }
  const cookieHeader = buildCookieHeader(api, envVars)
  if (cookieHeader && !hasHeader(headers, 'Cookie')) {
    headers['Cookie'] = cookieHeader
  }

  const options: Record<string, unknown> = {
    method: api.method,
  }
  if (Object.keys(headers).length > 0) options.headers = headers

  if (api.body.type === 'json' && api.body.raw) {
    options.body = resolveValue(api.body.raw, envVars)
    if (!headers['Content-Type']) headers['Content-Type'] = 'application/json'
  } else if (api.body.type === 'urlencoded') {
    const params = new URLSearchParams()
    for (const f of api.body.urlEncoded) {
      if (f.enabled && f.key) params.append(resolveValue(f.key, envVars), resolveValue(f.value, envVars))
    }
    options.body = params.toString()
  }

  let url = resolveValue(api.url, envVars)
  const queryParts: string[] = []
  for (const p of api.params) {
    if (p.enabled && p.key) {
      queryParts.push(`${encodeURIComponent(resolveValue(p.key, envVars))}=${encodeURIComponent(resolveValue(p.value, envVars))}`)
    }
  }
  if (queryParts.length > 0) url += '?' + queryParts.join('&')

  const lines: string[] = []
  lines.push(`fetch("${url}", ${JSON.stringify(options, null, 2)})`)
  lines.push('  .then(response => {')
  lines.push('    console.log(response.status);')
  lines.push('    return response.json();')
  lines.push('  })')
  lines.push('  .then(data => console.log(data))')
  lines.push('  .catch(error => console.error(error));')

  return lines.join('\n')
}

export function generateJavaScriptAxios(api: ApiConfig, envVars: Record<string, string> = {}): string {
  const headers: Record<string, string> = {}
  for (const h of api.headers) {
    if (h.enabled && h.key) headers[h.key] = resolveValue(h.value, envVars)
  }
  if (api.auth.type === 'bearer') {
    headers['Authorization'] = `Bearer ${resolveValue(api.auth.bearerToken, envVars)}`
  }
  const cookieHeader = buildCookieHeader(api, envVars)
  if (cookieHeader && !hasHeader(headers, 'Cookie')) {
    headers['Cookie'] = cookieHeader
  }

  const config: Record<string, unknown> = {
    method: api.method.toLowerCase(),
    url: resolveValue(api.url, envVars),
  }
  if (Object.keys(headers).length > 0) config.headers = headers

  // Params
  const params: Record<string, string> = {}
  for (const p of api.params) {
    if (p.enabled && p.key) params[p.key] = resolveValue(p.value, envVars)
  }
  if (Object.keys(params).length > 0) config.params = params

  // Body
  if (api.body.type === 'json' && api.body.raw) {
    config.data = JSON.parse(resolveValue(api.body.raw, envVars))
  } else if (api.body.type === 'urlencoded') {
    const data: Record<string, string> = {}
    for (const f of api.body.urlEncoded) {
      if (f.enabled && f.key) data[f.key] = resolveValue(f.value, envVars)
    }
    config.data = data
  }

  const lines: string[] = ['import axios from "axios";', '', `const response = await axios(${JSON.stringify(config, null, 2)});`, '', 'console.log(response.status);', 'console.log(response.data);']

  return lines.join('\n')
}

export function generateJavaHttpClient(api: ApiConfig, envVars: Record<string, string> = {}): string {
  const headers: Record<string, string> = {}
  for (const h of api.headers) {
    if (h.enabled && h.key) headers[h.key] = resolveValue(h.value, envVars)
  }
  if (api.auth.type === 'bearer') {
    headers['Authorization'] = `Bearer ${resolveValue(api.auth.bearerToken, envVars)}`
  } else if (api.auth.type === 'basic') {
    headers['Authorization'] = `Basic ${btoa(`${resolveValue(api.auth.basicUsername, envVars)}:${resolveValue(api.auth.basicPassword, envVars)}`)}`
  } else if (api.auth.type === 'apikey' && api.auth.apiKeyIn === 'header' && api.auth.apiKeyName) {
    headers[api.auth.apiKeyName] = resolveValue(api.auth.apiKeyValue, envVars)
  }
  const cookieHeader = buildCookieHeader(api, envVars)
  if (cookieHeader && !hasHeader(headers, 'Cookie')) {
    headers['Cookie'] = cookieHeader
  }

  let url = resolveValue(api.url, envVars)
  const queryParts: string[] = []
  for (const p of api.params) {
    if (p.enabled && p.key) {
      queryParts.push(`${encodeURIComponent(resolveValue(p.key, envVars))}=${encodeURIComponent(resolveValue(p.value, envVars))}`)
    }
  }
  if (api.auth.type === 'apikey' && api.auth.apiKeyIn === 'query' && api.auth.apiKeyName) {
    queryParts.push(`${encodeURIComponent(api.auth.apiKeyName)}=${encodeURIComponent(resolveValue(api.auth.apiKeyValue, envVars))}`)
  }
  if (queryParts.length > 0) url += (url.includes('?') ? '&' : '?') + queryParts.join('&')

  const body = getRequestBodyString(api, envVars)
  if (body && api.body.type === 'json' && !hasHeader(headers, 'Content-Type')) {
    headers['Content-Type'] = 'application/json'
  } else if (body && api.body.type === 'urlencoded' && !hasHeader(headers, 'Content-Type')) {
    headers['Content-Type'] = 'application/x-www-form-urlencoded'
  }

  const lines: string[] = [
    'import java.net.URI;',
    'import java.net.http.HttpClient;',
    'import java.net.http.HttpRequest;',
    'import java.net.http.HttpResponse;',
    '',
    'public class ApiRequest {',
    '    public static void main(String[] args) throws Exception {',
    '        HttpClient client = HttpClient.newHttpClient();',
    '        HttpRequest.Builder builder = HttpRequest.newBuilder()',
    `            .uri(URI.create("${escapeJavaString(url)}"));`,
  ]

  for (const [key, value] of Object.entries(headers)) {
    lines.push(`        builder.header("${escapeJavaString(key)}", "${escapeJavaString(value)}");`)
  }

  if (body) {
    lines.push(`        HttpRequest request = builder.method("${api.method}", HttpRequest.BodyPublishers.ofString("${escapeJavaString(body)}")).build();`)
  } else {
    lines.push(`        HttpRequest request = builder.method("${api.method}", HttpRequest.BodyPublishers.noBody()).build();`)
  }

  lines.push('')
  lines.push('        HttpResponse<String> response = client.send(request, HttpResponse.BodyHandlers.ofString());')
  lines.push('        System.out.println(response.statusCode());')
  lines.push('        System.out.println(response.body());')
  lines.push('    }')
  lines.push('}')

  return lines.join('\n')
}

export function generatePostmanCollection(apis: ApiConfig[], name: string = 'API Fox Lite Export'): string {
  const variableMap = new Map<string, string>()
  for (const api of apis) {
    for (const variable of api.requestVariables || []) {
      if (variable.enabled !== false && variable.key && !variableMap.has(variable.key)) {
        variableMap.set(variable.key, variable.value)
      }
    }
  }
  const variables = Array.from(variableMap, ([key, value]) => ({ key, value, type: 'string' }))

  const collection = {
    info: {
      name,
      schema: 'https://schema.getpostman.com/json/collection/v2.1.0/collection.json',
    },
    variable: variables.length ? variables : undefined,
    item: apis.map(api => buildPostmanRequestItem(api)),
  }

  return JSON.stringify(collection, null, 2)
}

// ── Phase 4.5:Postman v2.1 共享构建块(单请求与树形导出共用)──

function buildPostmanAuth(auth: AuthConfig): Record<string, unknown> | undefined {
  if (auth.type === 'bearer' && auth.bearerToken) {
    return { type: 'bearer', bearer: [{ key: 'token', value: auth.bearerToken, type: 'string' }] }
  }
  if (auth.type === 'basic' && (auth.basicUsername || auth.basicPassword)) {
    return {
      type: 'basic',
      basic: [
        { key: 'username', value: auth.basicUsername, type: 'string' },
        { key: 'password', value: auth.basicPassword, type: 'string' },
      ],
    }
  }
  if (auth.type === 'apikey' && auth.apiKeyName) {
    return {
      type: 'apikey',
      apikey: [
        { key: 'key', value: auth.apiKeyName, type: 'string' },
        { key: 'value', value: auth.apiKeyValue, type: 'string' },
        { key: 'in', value: auth.apiKeyIn, type: 'string' },
      ],
    }
  }
  return undefined
}

function buildPostmanEvents(preRequestScript?: string, postRequestScript?: string): unknown[] | undefined {
  const events = []
  if (preRequestScript?.trim()) {
    events.push({
      listen: 'prerequest',
      script: { type: 'text/javascript', exec: preRequestScript.split(/\r?\n/) },
    })
  }
  if (postRequestScript?.trim()) {
    events.push({
      listen: 'test',
      script: { type: 'text/javascript', exec: postRequestScript.split(/\r?\n/) },
    })
  }
  return events.length ? events : undefined
}

function buildPostmanRequestItem(api: ApiConfig): Record<string, unknown> {
  const request: Record<string, unknown> = {
    method: api.method,
    header: api.headers.filter(h => h.enabled).map(h => ({ key: h.key, value: h.value })),
    cookie: api.cookies.filter(cookie => cookie.enabled).map(cookie => ({ key: cookie.key, value: cookie.value })),
    url: {
      raw: api.url,
      query: api.params.filter(p => p.enabled).map(p => ({ key: p.key, value: p.value })),
    },
    body: api.body.type !== 'none' ? {
      mode: api.body.type === 'json' || api.body.type === 'raw' ? 'raw' : api.body.type === 'form' ? 'formdata' : 'urlencoded',
      raw: api.body.type === 'json' || api.body.type === 'raw' ? api.body.raw : undefined,
      formdata: api.body.type === 'form' ? api.body.formData.filter(f => f.enabled).map(f => ({ key: f.key, value: f.value, type: 'text' })) : undefined,
      urlencoded: api.body.type === 'urlencoded' ? api.body.urlEncoded.filter(f => f.enabled).map(f => ({ key: f.key, value: f.value })) : undefined,
    } : undefined,
  }
  const auth = buildPostmanAuth(api.auth)
  if (auth) request.auth = auth

  const item: Record<string, unknown> = {
    name: api.name,
    request,
  }
  const event = buildPostmanEvents(api.preRequestScript, api.postRequestScript)
  if (event) item.event = event
  return item
}

/** Phase 4.5:单集合导出为 Postman v2.1 树(保留文件夹层级与集合/文件夹级 auth/变量/脚本) */
export function generatePostmanCollectionTree(input: {
  collection: Collection
  nodes: CollectionNode[]
  apis: Record<string, ApiConfig>
}): string {
  const { collection, nodes, apis } = input

  const childrenOf = new Map<string | null, CollectionNode[]>()
  for (const node of nodes) {
    const key = node.parentId ?? null
    if (!childrenOf.has(key)) childrenOf.set(key, [])
    childrenOf.get(key)!.push(node)
  }
  const sortNodes = (list: CollectionNode[]) => [...list].sort((a, b) => a.order - b.order)

  /** Hoppscotch 同款:导出剥离 secret 取值,取值优先 initialValue */
  const toPostmanVariables = (vars: CollectionVariable[] | undefined) => (vars || [])
    .filter(v => v.key)
    .map(v => ({ key: v.key, value: v.secret ? '' : (v.initialValue || v.currentValue), type: 'string' }))

  const explicitAuth = (auth?: AuthConfig) =>
    auth && auth.type !== 'inherit' && auth.type !== 'none' ? buildPostmanAuth(auth) : undefined

  const buildItems = (parentId: string | null): unknown[] | undefined => {
    const children = sortNodes(childrenOf.get(parentId) ?? [])
    if (!children.length) return undefined
    return children.map(node => {
      if ((node.nodeType ?? 'request') === 'folder') {
        const item: Record<string, unknown> = { name: node.name }
        const inner = buildItems(node.id)
        if (inner) item.item = inner
        const event = buildPostmanEvents(node.preRequestScript, node.postRequestScript)
        if (event) item.event = event
        const vars = toPostmanVariables(node.variables)
        if (vars.length) item.variable = vars
        const auth = explicitAuth(node.auth)
        if (auth) item.auth = auth
        return item
      }
      const api = node.apiId ? apis[node.apiId] : undefined
      if (!api) {
        return { name: node.name, request: { method: node.method || 'GET', url: { raw: node.url || '' } } }
      }
      return buildPostmanRequestItem(api)
    })
  }

  const doc: Record<string, unknown> = {
    info: {
      name: collection.name,
      description: collection.description || undefined,
      schema: 'https://schema.getpostman.com/json/collection/v2.1.0/collection.json',
    },
    variable: toPostmanVariables(collection.variables).length ? toPostmanVariables(collection.variables) : undefined,
    auth: explicitAuth(collection.auth),
    event: buildPostmanEvents(collection.preRequestScript, collection.postRequestScript),
    item: buildItems(null) ?? [],
  }

  return JSON.stringify(doc, null, 2)
}

/** Phase 4.5:集合环境导出为 Postman environment 文件内容(secret 值剥离),每环境一份 */
export function generatePostmanEnvironmentFiles(environments: Environment[]): string[] {
  return environments.map(env => JSON.stringify({
    name: env.name,
    values: (env.variables || [])
      .filter(v => v.key)
      .map(v => ({ key: v.key, value: v.secret ? '' : v.value, enabled: v.enabled !== false })),
  }, null, 2))
}

// ── Phase 4.5:自有带版本备份格式(主备份格式,secret 值剥离)──

export function generateCollectionBackup(input: {
  collections: Collection[]
  nodes: CollectionNode[]
  environments: Environment[]
  apis: Record<string, ApiConfig>
}): string {
  const collections = input.collections.map(collection => ({
    ...collection,
    variables: (collection.variables || []).map(v => v.secret ? { ...v, initialValue: '', currentValue: '' } : v),
  }))
  const environments = input.environments.map(env => ({
    ...env,
    variables: (env.variables || []).map(v => v.secret ? { ...v, value: '' } : v),
  }))
  const doc: CollectionExportDocument = {
    v: COLLECTION_EXPORT_VERSION,
    exportedAt: Date.now(),
    collections,
    nodes: input.nodes,
    environments,
    apis: input.apis,
  }
  return JSON.stringify(doc, null, 2)
}

export function parseCollectionBackup(jsonStr: string): CollectionExportDocument | null {
  try {
    const doc = JSON.parse(jsonStr) as CollectionExportDocument
    if (!doc || typeof doc !== 'object' || typeof doc.v !== 'number' || !Array.isArray(doc.collections)) return null
    return doc
  } catch {
    return null
  }
}

export function generateOpenApiSpec(apis: ApiConfig[], title: string = 'API Fox Lite Export'): string {
  const paths: Record<string, Record<string, unknown>> = {}
  const servers = new Set<string>()

  for (const api of apis) {
    const parsed = parseApiUrl(api.url)
    if (parsed.server) servers.add(parsed.server)

    const method = api.method.toLowerCase()
    const operation: Record<string, unknown> = {
      summary: api.name,
      operationId: sanitizeOperationId(`${api.method}_${api.name || api.id}`),
      parameters: buildOpenApiParameters(api),
      responses: {
        '200': {
          description: 'Successful response',
        },
      },
    }
    if (api.description) operation.description = api.description

    const requestBody = buildOpenApiRequestBody(api)
    if (requestBody) operation.requestBody = requestBody

    const security = buildOpenApiSecurity(api)
    if (security) operation.security = security

    if (!paths[parsed.path]) paths[parsed.path] = {}
    paths[parsed.path][method] = operation
  }

  const spec: Record<string, unknown> = {
    openapi: '3.0.3',
    info: {
      title,
      version: '1.0.0',
    },
    paths,
  }

  if (servers.size > 0) {
    spec.servers = Array.from(servers).map(url => ({ url }))
  }

  const securitySchemes = buildOpenApiSecuritySchemes(apis)
  if (Object.keys(securitySchemes).length > 0) {
    spec.components = {
      securitySchemes,
    }
  }

  return JSON.stringify(spec, null, 2)
}

export function generateOpenApiYamlSpec(apis: ApiConfig[], title: string = 'API Fox Lite Export'): string {
  const spec = JSON.parse(generateOpenApiSpec(apis, title))
  return `${stringifyYaml(spec)}\n`
}

export function generateMarkdownDoc(api: ApiConfig): string {
  const lines: string[] = []
  lines.push(`## ${api.name}`)
  lines.push('')
  lines.push(`**${api.method}** \`${api.url}\``)
  lines.push('')
  if (api.description) {
    lines.push(api.description)
    lines.push('')
  }

  if (api.headers.length > 0) {
    lines.push('### Headers')
    lines.push('')
    lines.push('| Key | Value | Description |')
    lines.push('|-----|-------|-------------|')
    for (const h of api.headers.filter(h => h.enabled)) {
      lines.push(`| ${h.key} | ${h.value} | ${h.description || ''} |`)
    }
    lines.push('')
  }

  if (api.params.length > 0) {
    lines.push('### Query Parameters')
    lines.push('')
    lines.push('| Key | Value | Description |')
    lines.push('|-----|-------|-------------|')
    for (const p of api.params.filter(p => p.enabled)) {
      lines.push(`| ${p.key} | ${p.value} | ${p.description || ''} |`)
    }
    lines.push('')
  }

  if (api.cookies.length > 0) {
    lines.push('### Cookies')
    lines.push('')
    lines.push('| Key | Value | Description |')
    lines.push('|-----|-------|-------------|')
    for (const cookie of api.cookies.filter(cookie => cookie.enabled)) {
      lines.push(`| ${cookie.key} | ${cookie.value} | ${cookie.description || ''} |`)
    }
    lines.push('')
  }

  if (api.body.type !== 'none') {
    lines.push('### Request Body')
    lines.push('')
    if (api.body.raw) {
      lines.push('```json')
      lines.push(api.body.raw)
      lines.push('```')
    }
    lines.push('')
  }

  lines.push('### cURL')
  lines.push('')
  lines.push('```bash')
  lines.push(generateCurl(api))
  lines.push('```')

  return lines.join('\n')
}

export function generateHtmlDoc(api: ApiConfig, envVars: Record<string, string> = {}): string {
  const headers = api.headers.filter(h => h.enabled && h.key)
  const params = api.params.filter(p => p.enabled && p.key)
  const cookies = api.cookies.filter(cookie => cookie.enabled && cookie.key)
  const body = getRequestBodyString(api, envVars)
  const curl = generateCurl(api, envVars)

  return `<!doctype html>
<html lang="zh-CN">
<head>
  <meta charset="utf-8">
  <meta name="viewport" content="width=device-width, initial-scale=1">
  <title>${escapeHtml(api.name || 'API 文档')}</title>
  <style>
    body { font-family: -apple-system, BlinkMacSystemFont, "Segoe UI", sans-serif; line-height: 1.5; margin: 32px; color: #1f2937; background: #fff; }
    h1 { font-size: 24px; margin: 0 0 8px; }
    h2 { font-size: 18px; margin: 24px 0 8px; }
    code, pre { font-family: ui-monospace, SFMono-Regular, Menlo, Consolas, monospace; }
    .endpoint { margin: 12px 0 20px; padding: 12px; background: #f8fafc; border: 1px solid #e5e7eb; border-radius: 6px; }
    .method { font-weight: 700; margin-right: 8px; }
    table { width: 100%; border-collapse: collapse; margin-top: 8px; }
    th, td { text-align: left; padding: 8px; border: 1px solid #e5e7eb; vertical-align: top; }
    th { background: #f8fafc; }
    pre { padding: 12px; overflow: auto; background: #111827; color: #f9fafb; border-radius: 6px; }
  </style>
</head>
<body>
  <h1>${escapeHtml(api.name || '未命名请求')}</h1>
  ${api.description ? `<p>${escapeHtml(api.description)}</p>` : ''}
  <div class="endpoint"><span class="method">${escapeHtml(api.method)}</span><code>${escapeHtml(resolveValue(api.url, envVars))}</code></div>
  ${renderHtmlTable('Headers', headers)}
  ${renderHtmlTable('Query Parameters', params)}
  ${renderHtmlTable('Cookies', cookies)}
  ${body ? `<h2>Request Body</h2><pre>${escapeHtml(body)}</pre>` : ''}
  <h2>cURL</h2>
  <pre>${escapeHtml(curl)}</pre>
</body>
</html>`
}

function resolveValue(value: string, envVars: Record<string, string>): string {
  return value.replace(/\{\{(\w+)\}\}/g, (_, key) => envVars[key] ?? `{{${key}}}`)
}

function getEnabledCookies(api: ApiConfig, envVars: Record<string, string>): Record<string, string> {
  const cookies: Record<string, string> = {}
  for (const cookie of api.cookies.filter(cookie => cookie.enabled && cookie.key)) {
    cookies[resolveValue(cookie.key, envVars)] = resolveValue(cookie.value, envVars)
  }
  return cookies
}

function buildCookieHeader(api: ApiConfig, envVars: Record<string, string>): string {
  return Object.entries(getEnabledCookies(api, envVars))
    .map(([key, value]) => `${key}=${value}`)
    .join('; ')
}

function getRequestBodyString(api: ApiConfig, envVars: Record<string, string>): string {
  if ((api.body.type === 'json' || api.body.type === 'raw') && api.body.raw) {
    return resolveValue(api.body.raw, envVars)
  }
  if (api.body.type === 'urlencoded') {
    return api.body.urlEncoded
      .filter(f => f.enabled && f.key)
      .map(f => `${encodeURIComponent(resolveValue(f.key, envVars))}=${encodeURIComponent(resolveValue(f.value, envVars))}`)
      .join('&')
  }
  if (api.body.type === 'form') {
    return api.body.formData
      .filter(f => f.enabled && f.key)
      .map(f => `${resolveValue(f.key, envVars)}=${resolveValue(f.value, envVars)}`)
      .join('\n')
  }
  return ''
}

function hasHeader(headers: Record<string, string>, key: string): boolean {
  return Object.keys(headers).some(h => h.toLowerCase() === key.toLowerCase())
}

function escapeJavaString(value: string): string {
  return value
    .replace(/\\/g, '\\\\')
    .replace(/"/g, '\\"')
    .replace(/\r/g, '\\r')
    .replace(/\n/g, '\\n')
    .replace(/\t/g, '\\t')
}

function escapeHtml(value: string): string {
  return value
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#39;')
}

function renderHtmlTable(title: string, rows: KvPair[]): string {
  if (rows.length === 0) return ''
  return `<h2>${escapeHtml(title)}</h2>
  <table>
    <thead><tr><th>Key</th><th>Value</th><th>Description</th></tr></thead>
    <tbody>
      ${rows.map(row => `<tr><td>${escapeHtml(row.key)}</td><td>${escapeHtml(row.value)}</td><td>${escapeHtml(row.description || '')}</td></tr>`).join('\n      ')}
    </tbody>
  </table>`
}

function parseApiUrl(rawUrl: string): { server: string | null; path: string } {
  try {
    const parsed = new URL(rawUrl)
    return {
      server: parsed.origin,
      path: parsed.pathname || '/',
    }
  } catch {
    const cleanUrl = rawUrl.split('?')[0] || '/'
    return {
      server: null,
      path: cleanUrl.startsWith('/') ? cleanUrl : `/${cleanUrl}`,
    }
  }
}

function buildOpenApiParameters(api: ApiConfig): unknown[] {
  const parameters: unknown[] = []
  for (const p of api.params.filter(p => p.enabled && p.key)) {
    parameters.push({
      name: p.key,
      in: 'query',
      description: p.description || undefined,
      required: false,
      schema: { type: 'string' },
      example: p.value || undefined,
    })
  }
  for (const h of api.headers.filter(h => h.enabled && h.key)) {
    parameters.push({
      name: h.key,
      in: 'header',
      description: h.description || undefined,
      required: false,
      schema: { type: 'string' },
      example: h.value || undefined,
    })
  }
  for (const cookie of api.cookies.filter(cookie => cookie.enabled && cookie.key)) {
    parameters.push({
      name: cookie.key,
      in: 'cookie',
      description: cookie.description || undefined,
      required: false,
      schema: { type: 'string' },
      example: cookie.value || undefined,
    })
  }
  if (api.auth.type === 'apikey' && api.auth.apiKeyIn === 'query' && api.auth.apiKeyName) {
    parameters.push({
      name: api.auth.apiKeyName,
      in: 'query',
      required: true,
      schema: { type: 'string' },
    })
  }
  return parameters
}

function buildOpenApiRequestBody(api: ApiConfig): unknown | null {
  if (api.body.type === 'none') return null

  if ((api.body.type === 'json' || api.body.type === 'raw') && api.body.raw) {
    const contentType = api.body.type === 'json' ? 'application/json' : api.body.contentType || 'text/plain'
    return {
      required: true,
      content: {
        [contentType]: {
          schema: api.body.type === 'json' ? { type: 'object' } : { type: 'string' },
          example: parseJsonExample(api.body.raw),
        },
      },
    }
  }

  if (api.body.type === 'urlencoded') {
    return {
      required: true,
      content: {
        'application/x-www-form-urlencoded': {
          schema: {
            type: 'object',
            properties: kvPairsToStringProperties(api.body.urlEncoded),
          },
        },
      },
    }
  }

  if (api.body.type === 'form') {
    return {
      required: true,
      content: {
        'multipart/form-data': {
          schema: {
            type: 'object',
            properties: kvPairsToStringProperties(api.body.formData),
          },
        },
      },
    }
  }

  return null
}

function buildOpenApiSecurity(api: ApiConfig): unknown[] | null {
  if (api.auth.type === 'bearer') return [{ bearerAuth: [] }]
  if (api.auth.type === 'basic') return [{ basicAuth: [] }]
  if (api.auth.type === 'apikey') return [{ apiKeyAuth: [] }]
  return null
}

function buildOpenApiSecuritySchemes(apis: ApiConfig[]): Record<string, unknown> {
  const schemes: Record<string, unknown> = {}
  if (apis.some(api => api.auth.type === 'bearer')) {
    schemes.bearerAuth = {
      type: 'http',
      scheme: 'bearer',
    }
  }
  if (apis.some(api => api.auth.type === 'basic')) {
    schemes.basicAuth = {
      type: 'http',
      scheme: 'basic',
    }
  }
  const apiKeyApi = apis.find(api => api.auth.type === 'apikey' && api.auth.apiKeyName)
  if (apiKeyApi) {
    schemes.apiKeyAuth = {
      type: 'apiKey',
      name: apiKeyApi.auth.apiKeyName,
      in: apiKeyApi.auth.apiKeyIn,
    }
  }
  return schemes
}

function kvPairsToStringProperties(pairs: KvPair[]): Record<string, unknown> {
  const properties: Record<string, unknown> = {}
  for (const pair of pairs.filter(pair => pair.enabled && pair.key)) {
    properties[pair.key] = {
      type: 'string',
      description: pair.description || undefined,
      example: pair.value || undefined,
    }
  }
  return properties
}

function parseJsonExample(value: string): unknown {
  try {
    return JSON.parse(value)
  } catch {
    return value
  }
}

function sanitizeOperationId(value: string): string {
  const id = value.replace(/[^a-zA-Z0-9_]/g, '_').replace(/_+/g, '_').replace(/^_|_$/g, '')
  return id || 'apiRequest'
}

function stringifyYaml(value: unknown, indent = 0): string {
  const pad = ' '.repeat(indent)

  if (Array.isArray(value)) {
    if (value.length === 0) return `${pad}[]`
    return value.map(item => {
      if (isYamlScalar(item)) return `${pad}- ${formatYamlScalar(item)}`
      return `${pad}-\n${stringifyYaml(item, indent + 2)}`
    }).join('\n')
  }

  if (value && typeof value === 'object') {
    const entries = Object.entries(value as Record<string, unknown>)
      .filter(([, item]) => item !== undefined)
    if (entries.length === 0) return `${pad}{}`
    return entries.map(([key, item]) => {
      if (isYamlScalar(item)) return `${pad}${formatYamlKey(key)}: ${formatYamlScalar(item)}`
      return `${pad}${formatYamlKey(key)}:\n${stringifyYaml(item, indent + 2)}`
    }).join('\n')
  }

  return `${pad}${formatYamlScalar(value)}`
}

function isYamlScalar(value: unknown): boolean {
  return value === null || ['string', 'number', 'boolean'].includes(typeof value)
}

function formatYamlKey(key: string): string {
  return /^[A-Za-z0-9_./{}-]+$/.test(key) ? key : JSON.stringify(key)
}

function formatYamlScalar(value: unknown): string {
  if (typeof value === 'string') return JSON.stringify(value)
  if (typeof value === 'number' || typeof value === 'boolean') return String(value)
  return 'null'
}
