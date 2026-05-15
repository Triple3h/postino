import type { ApiConfig, HttpMethod, KvPair, BodyConfig } from '@/types'

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
    body: partial.body || { type: 'none', raw: '', formData: [], urlEncoded: [], binaryFile: null, contentType: '' },
    auth: partial.auth || { type: 'none', bearerToken: '', basicUsername: '', basicPassword: '', apiKeyName: '', apiKeyValue: '', apiKeyIn: 'header' },
    preRequestScript: '',
    postRequestScript: '',
    folder: partial.folder || null,
    createdAt: Date.now(),
    updatedAt: Date.now(),
  }
}

interface OpenApiSpec {
  openapi?: string
  swagger?: string
  info?: { title?: string; version?: string }
  servers?: Array<{ url?: string; description?: string }>
  host?: string
  basePath?: string
  schemes?: string[]
  paths?: Record<string, Record<string, OpenApiOperation>>
  components?: { securitySchemes?: Record<string, OpenApiSecurityScheme> }
  securityDefinitions?: Record<string, OpenApiSecurityScheme>
}

interface OpenApiOperation {
  operationId?: string
  summary?: string
  description?: string
  tags?: string[]
  parameters?: OpenApiParameter[]
  requestBody?: OpenApiRequestBody
  responses?: Record<string, OpenApiResponse>
  security?: Array<Record<string, string[]>>
}

interface OpenApiParameter {
  name: string
  in: 'query' | 'header' | 'path' | 'cookie'
  required?: boolean
  description?: string
  schema?: { type?: string; default?: unknown; enum?: unknown[]; example?: unknown }
}

interface OpenApiRequestBody {
  required?: boolean
  content?: Record<string, { schema?: OpenApiSchema; example?: unknown; examples?: Record<string, { value: unknown }> }>
}

interface OpenApiSchema {
  type?: string
  properties?: Record<string, OpenApiSchema>
  items?: OpenApiSchema
  required?: string[]
  $ref?: string
  example?: unknown
}

interface OpenApiResponse {
  description?: string
  content?: Record<string, { schema?: OpenApiSchema; example?: unknown }>
}

interface OpenApiSecurityScheme {
  type: 'apiKey' | 'http' | 'oauth2' | 'openIdConnect'
  scheme?: string
  bearerFormat?: string
  name?: string
  in?: 'query' | 'header' | 'cookie'
}

function resolveRef(spec: OpenApiSpec, ref: string): any {
  if (!ref.startsWith('#/')) return null
  const parts = ref.slice(2).split('/')
  let current: any = spec
  for (const part of parts) {
    if (current == null || typeof current !== 'object') return null
    current = current[part]
  }
  return current
}

function resolveSchema(spec: OpenApiSpec, schema: OpenApiSchema): any {
  if (schema.$ref) {
    const resolved = resolveRef(spec, schema.$ref)
    if (resolved) return resolveSchema(spec, resolved)
    return null
  }

  if (schema.type === 'object' && schema.properties) {
    const obj: Record<string, unknown> = {}
    for (const [key, prop] of Object.entries(schema.properties)) {
      obj[key] = resolveSchema(spec, prop)
    }
    return obj
  }

  if (schema.type === 'array' && schema.items) {
    return [resolveSchema(spec, schema.items)]
  }

  if (schema.example !== undefined) return schema.example

  switch (schema.type) {
    case 'string': return ''
    case 'number': case 'integer': return 0
    case 'boolean': return false
    default: return null
  }
}

function getBaseUrl(spec: OpenApiSpec): string {
  if (spec.servers && spec.servers.length > 0 && spec.servers[0].url) {
    return spec.servers[0].url.replace(/\/$/, '')
  }
  const scheme = spec.schemes?.[0] || 'https'
  const host = spec.host || 'localhost'
  const basePath = spec.basePath || ''
  return `${scheme}://${host}${basePath}`
}

function parseOperation(
  spec: OpenApiSpec,
  path: string,
  method: string,
  op: OpenApiOperation,
  baseUrl: string,
): ApiConfig {
  const url = `${baseUrl}${path}`
  const headers: KvPair[] = []
  const params: KvPair[] = []
  let body: BodyConfig = { type: 'none', raw: '', formData: [], urlEncoded: [], binaryFile: null, contentType: '' }

  // Parse parameters
  for (const param of op.parameters || []) {
    const kv: KvPair = {
      key: param.name,
      value: param.schema?.default?.toString() ?? param.schema?.example?.toString() ?? '',
      enabled: true,
      description: param.description,
    }

    if (param.in === 'query') {
      params.push(kv)
    } else if (param.in === 'header') {
      headers.push(kv)
    }
  }

  // Parse request body (OpenAPI 3.x)
  if (op.requestBody?.content) {
    for (const [contentType, mediaType] of Object.entries(op.requestBody.content)) {
      if (contentType.includes('application/json')) {
        const example = mediaType.example ?? (mediaType.schema ? resolveSchema(spec, mediaType.schema) : null)
        body = {
          type: 'json',
          raw: example ? JSON.stringify(example, null, 2) : '{\n  \n}',
          formData: [],
          urlEncoded: [],
          binaryFile: null,
          contentType: 'application/json',
        }
        break
      } else if (contentType.includes('application/x-www-form-urlencoded')) {
        body = {
          type: 'urlencoded',
          raw: '',
          formData: [],
          urlEncoded: [],
          binaryFile: null,
          contentType: 'application/x-www-form-urlencoded',
        }
        break
      } else if (contentType.includes('multipart/form-data')) {
        body = {
          type: 'form',
          raw: '',
          formData: [],
          urlEncoded: [],
          binaryFile: null,
          contentType: '',
        }
        break
      }
    }
  }

  return createDefaultApi({
    name: op.summary || op.operationId || `${method.toUpperCase()} ${path}`,
    method: method.toUpperCase() as HttpMethod,
    url,
    headers,
    params,
    body,
    folder: op.tags?.[0] || null,
  })
}

export function importOpenApi(content: string): ApiConfig[] {
  let spec: OpenApiSpec

  try {
    spec = JSON.parse(content)
  } catch {
    // Try YAML (basic parsing - for full YAML support would need a library)
    return []
  }

  if (!spec.openapi && !spec.swagger) return []

  const baseUrl = getBaseUrl(spec)
  const apis: ApiConfig[] = []

  for (const [path, methods] of Object.entries(spec.paths || {})) {
    for (const [method, operation] of Object.entries(methods)) {
      if (['get', 'post', 'put', 'delete', 'patch', 'head', 'options'].includes(method.toLowerCase())) {
        apis.push(parseOperation(spec, path, method, operation as OpenApiOperation, baseUrl))
      }
    }
  }

  return apis
}
