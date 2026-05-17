import type { ApiConfig, HttpMethod, KvPair, BodyConfig, AuthConfig, CookieItem } from '@/types'

function generateId(): string {
  return Date.now().toString(36) + Math.random().toString(36).slice(2, 8)
}

function createDefaultApi(partial: Partial<ApiConfig> = {}): ApiConfig {
  return {
    id: generateId(),
    name: partial.name || 'Untitled Request',
    description: partial.description || '',
    method: partial.method || 'GET',
    url: partial.url || '',
    headers: partial.headers || [],
    params: partial.params || [],
    cookies: partial.cookies || [],
    body: partial.body || { type: 'none', raw: '', formData: [], urlEncoded: [], binaryFile: null, contentType: '' },
    auth: partial.auth || { type: 'none', bearerToken: '', basicUsername: '', basicPassword: '', apiKeyName: '', apiKeyValue: '', apiKeyIn: 'header' },
    requestVariables: partial.requestVariables || [],
    preRequestScript: '',
    postRequestScript: '',
    folder: partial.folder || null,
    createdAt: Date.now(),
    updatedAt: Date.now(),
  }
}

export interface OpenApiSpec {
  openapi?: string
  swagger?: string
  info?: { title?: string; version?: string }
  servers?: Array<{ url?: string; description?: string }>
  host?: string
  basePath?: string
  schemes?: string[]
  paths?: Record<string, Record<string, OpenApiOperation>>
  security?: Array<Record<string, string[]>>
  components?: { securitySchemes?: Record<string, OpenApiSecurityScheme> }
  securityDefinitions?: Record<string, OpenApiSecurityScheme>
}

export interface ParsedOpenApiDocument {
  spec: OpenApiSpec
  apis: ApiConfig[]
}

export interface OpenApiOperationMetadata {
  method: HttpMethod
  path: string
  url: string
  operationId?: string
  summary?: string
  description?: string
  tags?: string[]
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
  in: 'query' | 'header' | 'path' | 'cookie' | 'body' | 'formData'
  required?: boolean
  description?: string
  type?: string
  default?: unknown
  example?: unknown
  examples?: Record<string, { value?: unknown } | unknown>
  enum?: unknown[]
  schema?: OpenApiSchema
  content?: Record<string, { schema?: OpenApiSchema; example?: unknown; examples?: Record<string, { value?: unknown } | unknown> }>
}

interface OpenApiRequestBody {
  required?: boolean
  content?: Record<string, { schema?: OpenApiSchema; example?: unknown; examples?: Record<string, { value: unknown }> }>
}

interface OpenApiSchema {
  type?: string | string[]
  properties?: Record<string, OpenApiSchema>
  items?: OpenApiSchema
  prefixItems?: OpenApiSchema[]
  required?: string[]
  $ref?: string
  allOf?: OpenApiSchema[]
  oneOf?: OpenApiSchema[]
  anyOf?: OpenApiSchema[]
  const?: unknown
  default?: unknown
  enum?: unknown[]
  example?: unknown
  examples?: unknown[] | Record<string, unknown>
  nullable?: boolean
  readOnly?: boolean
  writeOnly?: boolean
  additionalProperties?: boolean | OpenApiSchema
  minItems?: number
  maxItems?: number
  minProperties?: number
  maxProperties?: number
  minLength?: number
  maxLength?: number
  pattern?: string
  format?: string
  minimum?: number
  maximum?: number
  exclusiveMinimum?: number | boolean
  exclusiveMaximum?: number | boolean
  multipleOf?: number
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

interface YamlLine {
  indent: number
  text: string
}

interface YamlParseContext {
  anchors: Record<string, unknown>
}

function deepClone<T>(value: T): T {
  if (value === null || typeof value !== 'object') return value
  return JSON.parse(JSON.stringify(value))
}

function stripYamlComment(line: string): string {
  let quote: '"' | "'" | null = null
  for (let i = 0; i < line.length; i++) {
    const char = line[i]
    if ((char === '"' || char === "'") && line[i - 1] !== '\\') {
      quote = quote === char ? null : quote ?? char
    }
    if (char === '#' && !quote && (i === 0 || /\s/.test(line[i - 1]))) {
      return line.slice(0, i)
    }
  }
  return line
}

function splitYamlKeyValue(text: string): [string, string] | null {
  let quote: '"' | "'" | null = null
  for (let i = 0; i < text.length; i++) {
    const char = text[i]
    if ((char === '"' || char === "'") && text[i - 1] !== '\\') {
      quote = quote === char ? null : quote ?? char
    }
    if (char === ':' && !quote) {
      return [text.slice(0, i).trim(), text.slice(i + 1).trim()]
    }
  }
  return null
}

function splitTopLevel(value: string, delimiter: string): string[] {
  const result: string[] = []
  let quote: '"' | "'" | null = null
  let depth = 0
  let start = 0
  for (let i = 0; i < value.length; i++) {
    const char = value[i]
    if ((char === '"' || char === "'") && value[i - 1] !== '\\') {
      quote = quote === char ? null : quote ?? char
      continue
    }
    if (quote) continue
    if (char === '[' || char === '{') depth++
    if (char === ']' || char === '}') depth--
    if (char === delimiter && depth === 0) {
      result.push(value.slice(start, i).trim())
      start = i + 1
    }
  }
  result.push(value.slice(start).trim())
  return result.filter(Boolean)
}

function splitFlowKeyValue(value: string): [string, string] | null {
  let quote: '"' | "'" | null = null
  let depth = 0
  for (let i = 0; i < value.length; i++) {
    const char = value[i]
    if ((char === '"' || char === "'") && value[i - 1] !== '\\') {
      quote = quote === char ? null : quote ?? char
      continue
    }
    if (quote) continue
    if (char === '[' || char === '{') depth++
    if (char === ']' || char === '}') depth--
    if (char === ':' && depth === 0) {
      return [value.slice(0, i).trim(), value.slice(i + 1).trim()]
    }
  }
  return null
}

function unquoteYaml(value: string): string {
  const trimmed = value.trim()
  if ((trimmed.startsWith('"') && trimmed.endsWith('"')) || (trimmed.startsWith("'") && trimmed.endsWith("'"))) {
    return trimmed.slice(1, -1)
  }
  return trimmed
}

function parseFlowValue(value: string, context: YamlParseContext): unknown {
  const trimmed = value.trim()
  if (trimmed.startsWith('[') && trimmed.endsWith(']')) {
    const inner = trimmed.slice(1, -1).trim()
    return inner ? splitTopLevel(inner, ',').map(item => parseYamlScalar(item, context)) : []
  }
  if (trimmed.startsWith('{') && trimmed.endsWith('}')) {
    const inner = trimmed.slice(1, -1).trim()
    const obj: Record<string, unknown> = {}
    if (!inner) return obj
    for (const part of splitTopLevel(inner, ',')) {
      const pair = splitFlowKeyValue(part)
      if (pair) {
        obj[unquoteYaml(pair[0])] = parseYamlScalar(pair[1], context)
      }
    }
    return obj
  }
  throw new Error('not a flow value')
}

function readAnchorPrefix(value: string): { anchor?: string; rest: string } {
  const match = value.trim().match(/^&([A-Za-z0-9_-]+)(?:\s+(.*))?$/)
  return match ? { anchor: match[1], rest: match[2]?.trim() ?? '' } : { rest: value }
}

function parseYamlScalar(value: string, context: YamlParseContext): unknown {
  const trimmed = value.trim()
  if (!trimmed) return ''
  if (trimmed.startsWith('*')) {
    return deepClone(context.anchors[trimmed.slice(1)])
  }
  if (trimmed === 'null' || trimmed === '~') return null
  if (trimmed === 'true') return true
  if (trimmed === 'false') return false
  if (/^-?\d+(\.\d+)?$/.test(trimmed)) return Number(trimmed)
  if ((trimmed.startsWith('"') && trimmed.endsWith('"')) || (trimmed.startsWith("'") && trimmed.endsWith("'"))) {
    return trimmed.slice(1, -1)
  }
  if (trimmed.startsWith('[') || trimmed.startsWith('{')) {
    try { return JSON.parse(trimmed.replace(/'/g, '"')) } catch {}
    try { return parseFlowValue(trimmed, context) } catch {}
  }
  return trimmed
}

function prepareYamlLines(content: string): YamlLine[] {
  return content
    .replace(/\t/g, '  ')
    .split(/\r?\n/)
    .map(line => stripYamlComment(line).replace(/\s+$/, ''))
    .filter(line => line.trim().length > 0 && !line.trim().startsWith('---') && !line.trim().startsWith('...'))
    .map(line => ({
      indent: line.match(/^ */)?.[0].length ?? 0,
      text: line.trim(),
    }))
}

function parseYamlBlock(lines: YamlLine[], startIndex: number, indent: number, context: YamlParseContext): [unknown, number] {
  if (startIndex >= lines.length) return [{}, startIndex]
  if (lines[startIndex].indent < indent) return [{}, startIndex]
  return lines[startIndex].text.startsWith('- ')
    ? parseYamlArray(lines, startIndex, lines[startIndex].indent, context)
    : parseYamlObject(lines, startIndex, lines[startIndex].indent, context)
}

function readYamlBlockScalar(lines: YamlLine[], startIndex: number, fallbackIndent: number, style: '|' | '>'): [string, number] {
  const blockIndent = lines[startIndex]?.indent ?? fallbackIndent
  const block: string[] = []
  let index = startIndex
  while (index < lines.length && lines[index].indent >= blockIndent) {
    block.push(lines[index].text)
    index++
  }
  return [style === '>' ? block.join(' ') : block.join('\n'), index]
}

function parseYamlArray(lines: YamlLine[], startIndex: number, indent: number, context: YamlParseContext): [unknown[], number] {
  const result: unknown[] = []
  let index = startIndex

  while (index < lines.length) {
    const line = lines[index]
    if (line.indent < indent || line.indent !== indent || !line.text.startsWith('- ')) break

    const anchorInfo = readAnchorPrefix(line.text.slice(2).trim())
    const rest = anchorInfo.rest
    if (!rest) {
      const [child, nextIndex] = parseYamlBlock(lines, index + 1, indent + 2, context)
      if (anchorInfo.anchor) context.anchors[anchorInfo.anchor] = deepClone(child)
      result.push(child)
      index = nextIndex
      continue
    }

    const pair = splitYamlKeyValue(rest)
    if (pair) {
      const [key, rawValue] = pair
      const item: Record<string, unknown> = {}
      const valueAnchorInfo = readAnchorPrefix(rawValue)
      if (valueAnchorInfo.rest === '|' || valueAnchorInfo.rest === '>') {
        const [block, nextIndex] = readYamlBlockScalar(lines, index + 1, indent + 2, valueAnchorInfo.rest)
        item[key] = block
        if (valueAnchorInfo.anchor) context.anchors[valueAnchorInfo.anchor] = deepClone(block)
        index = nextIndex
      } else if (!valueAnchorInfo.rest) {
        const [child, nextIndex] = parseYamlBlock(lines, index + 1, indent + 2, context)
        if (valueAnchorInfo.anchor) context.anchors[valueAnchorInfo.anchor] = deepClone(child)
        item[key] = child
        index = nextIndex
      } else {
        item[key] = parseYamlScalar(valueAnchorInfo.rest, context)
        if (valueAnchorInfo.anchor) context.anchors[valueAnchorInfo.anchor] = deepClone(item[key])
        index++
      }

      if (index < lines.length && lines[index].indent > indent && !lines[index].text.startsWith('- ')) {
        const [extra, nextIndex] = parseYamlObject(lines, index, lines[index].indent, context)
        Object.assign(item, extra)
        index = nextIndex
      }
      if (anchorInfo.anchor) context.anchors[anchorInfo.anchor] = deepClone(item)
      result.push(item)
    } else {
      const value = parseYamlScalar(rest, context)
      if (anchorInfo.anchor) context.anchors[anchorInfo.anchor] = deepClone(value)
      result.push(value)
      index++
    }
  }

  return [result, index]
}

function parseYamlObject(lines: YamlLine[], startIndex: number, indent: number, context: YamlParseContext): [Record<string, unknown>, number] {
  const result: Record<string, unknown> = {}
  let index = startIndex

  while (index < lines.length) {
    const line = lines[index]
    if (line.indent < indent || line.indent !== indent || line.text.startsWith('- ')) break

    const pair = splitYamlKeyValue(line.text)
    if (!pair) {
      index++
      continue
    }

    const [key, rawValue] = pair
    const valueAnchorInfo = readAnchorPrefix(rawValue)
    const effectiveRawValue = valueAnchorInfo.rest
    if (effectiveRawValue === '|' || effectiveRawValue === '>') {
      const [block, nextIndex] = readYamlBlockScalar(lines, index + 1, indent + 2, effectiveRawValue)
      result[key] = block
      if (valueAnchorInfo.anchor) context.anchors[valueAnchorInfo.anchor] = deepClone(result[key])
      index = nextIndex
      continue
    }

    if (!effectiveRawValue) {
      if (index + 1 < lines.length && lines[index + 1].indent > indent) {
        const [child, nextIndex] = parseYamlBlock(lines, index + 1, lines[index + 1].indent, context)
        result[key] = child
        if (valueAnchorInfo.anchor) context.anchors[valueAnchorInfo.anchor] = deepClone(child)
        index = nextIndex
      } else {
        result[key] = {}
        if (valueAnchorInfo.anchor) context.anchors[valueAnchorInfo.anchor] = {}
        index++
      }
    } else {
      const parsed = parseYamlScalar(effectiveRawValue, context)
      if (key === '<<' && parsed && typeof parsed === 'object' && !Array.isArray(parsed)) {
        Object.assign(result, parsed)
      } else {
        result[key] = parsed
      }
      if (valueAnchorInfo.anchor) context.anchors[valueAnchorInfo.anchor] = deepClone(parsed)
      index++
    }
  }

  return [result, index]
}

function parseBasicYaml(content: string): unknown {
  const lines = prepareYamlLines(content)
  if (lines.length === 0) return null
  return parseYamlBlock(lines, 0, lines[0].indent, { anchors: {} })[0]
}

export function parseOpenApiSpec(content: string): OpenApiSpec | null {
  try {
    const spec = JSON.parse(content) as OpenApiSpec
    return spec && typeof spec === 'object' && (spec.openapi || spec.swagger) ? spec : null
  } catch {
    const parsed = parseBasicYaml(content)
    if (!parsed || typeof parsed !== 'object') return null
    const spec = parsed as OpenApiSpec
    return spec.openapi || spec.swagger ? spec : null
  }
}

function resolveRef(spec: OpenApiSpec, ref: string): any {
  if (!ref.startsWith('#/')) return null
  const parts = ref.slice(2).split('/').map(part => decodeURIComponent(part.replace(/~1/g, '/').replace(/~0/g, '~')))
  let current: any = spec
  for (const part of parts) {
    if (current == null || typeof current !== 'object') return null
    current = current[part]
  }
  return current
}

function firstSchemaExample(examples: OpenApiSchema['examples']): unknown {
  if (Array.isArray(examples)) return examples[0]
  if (examples && typeof examples === 'object') {
    const first = Object.values(examples)[0] as any
    return first && typeof first === 'object' && 'value' in first ? first.value : first
  }
  return undefined
}

function firstParameterExample(examples: OpenApiParameter['examples']): unknown {
  if (!examples || typeof examples !== 'object') return undefined
  const first = Object.values(examples)[0] as any
  return first && typeof first === 'object' && 'value' in first ? first.value : first
}

function firstMediaTypeExample(mediaType?: { schema?: OpenApiSchema; example?: unknown; examples?: Record<string, { value?: unknown } | unknown> }): unknown {
  if (!mediaType) return undefined
  if (mediaType.example !== undefined) return mediaType.example
  return firstParameterExample(mediaType.examples)
}

function resolveParameterExample(spec: OpenApiSpec, param: OpenApiParameter, schema: OpenApiSchema): unknown {
  if (param.example !== undefined) return param.example
  const paramExample = firstParameterExample(param.examples)
  if (paramExample !== undefined) return paramExample
  const mediaType = param.content ? Object.values(param.content)[0] : undefined
  const mediaExample = firstMediaTypeExample(mediaType)
  if (mediaExample !== undefined) return mediaExample
  if (mediaType?.schema) return resolveSchema(spec, mediaType.schema)
  return resolveSchema(spec, schema)
}

function stringifyExampleValue(value: unknown): string {
  if (value == null) return ''
  if (typeof value === 'string') return value
  if (typeof value === 'number' || typeof value === 'boolean') return String(value)
  try {
    return JSON.stringify(value)
  } catch {
    return String(value)
  }
}

function sampleFromStringFormat(format?: string): string | undefined {
  switch (format?.toLowerCase()) {
    case 'date-time': return '2026-01-01T00:00:00.000Z'
    case 'date': return '2026-01-01'
    case 'time': return '00:00:00'
    case 'email':
    case 'idn-email':
      return 'user@example.com'
    case 'uri':
    case 'url':
    case 'iri':
      return 'https://example.com'
    case 'hostname':
    case 'idn-hostname':
      return 'example.com'
    case 'uuid': return '00000000-0000-4000-8000-000000000000'
    case 'ipv4': return '127.0.0.1'
    case 'ipv6': return '::1'
    case 'byte': return 'c2FtcGxl'
    case 'binary': return '<binary>'
    case 'password': return '<password>'
    default: return undefined
  }
}

function sampleFromSimplePattern(pattern?: string): string | undefined {
  if (!pattern) return undefined
  const normalized = pattern.replace(/^\^/, '').replace(/\$$/, '')
  const repeatedClass = normalized.match(/^\\d\{(\d+)\}$/)
    ?? normalized.match(/^\[0-9\]\{(\d+)\}$/)
  if (repeatedClass) return '1'.repeat(Math.min(Number(repeatedClass[1]) || 1, 12))

  const alphaUpper = normalized.match(/^\[A-Z\]\{(\d+)\}$/)
  if (alphaUpper) return 'A'.repeat(Math.min(Number(alphaUpper[1]) || 1, 12))

  const alphaLower = normalized.match(/^\[a-z\]\{(\d+)\}$/)
  if (alphaLower) return 'a'.repeat(Math.min(Number(alphaLower[1]) || 1, 12))

  const word = normalized.match(/^\[A-Za-z0-9\]\{(\d+)\}$/)
  if (word) return 'a'.repeat(Math.min(Number(word[1]) || 1, 12))

  return pattern
}

function numberSample(schema: OpenApiSchema): number {
  let value = 0
  if (typeof schema.exclusiveMinimum === 'number') value = schema.exclusiveMinimum + (schema.multipleOf ?? 1)
  else if (schema.exclusiveMinimum === true && typeof schema.minimum === 'number') value = schema.minimum + (schema.multipleOf ?? 1)
  else if (typeof schema.minimum === 'number') value = schema.minimum
  else if (typeof schema.multipleOf === 'number' && schema.multipleOf > 0) value = schema.multipleOf

  if (typeof schema.multipleOf === 'number' && schema.multipleOf > 0) {
    value = Math.ceil(value / schema.multipleOf) * schema.multipleOf
    if (typeof schema.minimum === 'number' && schema.exclusiveMinimum === true && value <= schema.minimum) {
      value += schema.multipleOf
    }
  }

  if (typeof schema.maximum === 'number' && value > schema.maximum) return schema.maximum
  if (typeof schema.exclusiveMaximum === 'number' && value >= schema.exclusiveMaximum) return schema.exclusiveMaximum - (schema.multipleOf ?? 1)
  if (schema.exclusiveMaximum === true && typeof schema.maximum === 'number' && value >= schema.maximum) return schema.maximum - (schema.multipleOf ?? 1)
  return value
}

function normalizeSchemaTypes(schema: OpenApiSchema): string[] {
  const rawTypes = Array.isArray(schema.type) ? schema.type : schema.type ? [schema.type] : []
  const withoutNull = rawTypes.filter(type => type !== 'null')
  if (withoutNull.length > 0) return withoutNull
  if (schema.properties || schema.additionalProperties || schema.minProperties) return ['object']
  if (schema.items || schema.prefixItems) return ['array']
  if (schema.format || schema.pattern || schema.minLength) return ['string']
  if (
    schema.minimum !== undefined
    || schema.maximum !== undefined
    || schema.exclusiveMinimum !== undefined
    || schema.exclusiveMaximum !== undefined
    || schema.multipleOf !== undefined
  ) return ['number']
  return rawTypes
}

function resolveSchema(spec: OpenApiSpec, schema: OpenApiSchema, seenRefs = new Set<string>(), depth = 0): any {
  if (!schema || depth > 40) return null
  if (schema.$ref) {
    if (seenRefs.has(schema.$ref)) return null
    const resolved = resolveRef(spec, schema.$ref)
    if (resolved) {
      const nextSeenRefs = new Set(seenRefs)
      nextSeenRefs.add(schema.$ref)
      return resolveSchema(spec, resolved, nextSeenRefs, depth + 1)
    }
    return null
  }

  if (schema.example !== undefined) return schema.example
  const examplesValue = firstSchemaExample(schema.examples)
  if (examplesValue !== undefined) return examplesValue
  if (schema.default !== undefined) return schema.default
  if (schema.const !== undefined) return schema.const
  if (schema.enum && schema.enum.length > 0) return schema.enum[0]
  if (schema.nullable && normalizeSchemaTypes(schema).length === 0) return null

  if (schema.allOf && schema.allOf.length > 0) {
    const merged: Record<string, unknown> = {}
    for (const item of schema.allOf) {
      const value = resolveSchema(spec, item, new Set(seenRefs), depth + 1)
      if (value && typeof value === 'object' && !Array.isArray(value)) {
        Object.assign(merged, value)
      }
    }
    return Object.keys(merged).length > 0 ? merged : resolveSchema(spec, schema.allOf[0], new Set(seenRefs), depth + 1)
  }

  const fallbackSchema = schema.oneOf?.[0] ?? schema.anyOf?.[0]
  if (fallbackSchema) {
    return resolveSchema(spec, fallbackSchema, new Set(seenRefs), depth + 1)
  }

  const schemaTypes = normalizeSchemaTypes(schema)
  const primaryType = schemaTypes[0]

  if (primaryType === 'object') {
    const obj: Record<string, unknown> = {}
    for (const [key, prop] of Object.entries(schema.properties ?? {})) {
      if (prop.readOnly) continue
      obj[key] = resolveSchema(spec, prop, new Set(seenRefs), depth + 1)
    }
    const propertyLimit = Math.min(schema.maxProperties ?? 3, 3)
    const minProperties = Math.min(schema.minProperties ?? 0, propertyLimit)
    const additionalSchema = schema.additionalProperties && typeof schema.additionalProperties === 'object'
      ? schema.additionalProperties
      : null
    while (Object.keys(obj).length < minProperties && Object.keys(obj).length < propertyLimit) {
      const key = `property${Object.keys(obj).length + 1}`
      obj[key] = additionalSchema ? resolveSchema(spec, additionalSchema, new Set(seenRefs), depth + 1) : null
    }
    if (Object.keys(obj).length === 0 && additionalSchema) {
      obj.additionalProperty = resolveSchema(spec, additionalSchema, new Set(seenRefs), depth + 1)
    }
    return obj
  }

  if (primaryType === 'array') {
    const prefixSamples = (schema.prefixItems ?? []).map(item => resolveSchema(spec, item, new Set(seenRefs), depth + 1))
    const itemLimit = Math.min(schema.maxItems ?? 3, 3)
    const minItems = Math.min(Math.max(schema.minItems ?? 0, prefixSamples.length), itemLimit)
    if (prefixSamples.length > 0) {
      const result = prefixSamples.slice(0, itemLimit)
      const itemSample = schema.items ? resolveSchema(spec, schema.items, new Set(seenRefs), depth + 1) : null
      while (result.length < minItems) result.push(deepClone(itemSample))
      return result
    }
    if (!schema.items) return minItems > 0 ? Array.from({ length: minItems }, () => null) : []
    const sample = resolveSchema(spec, schema.items, new Set(seenRefs), depth + 1)
    return minItems > 1 ? Array.from({ length: minItems }, () => deepClone(sample)) : [sample]
  }

  switch (primaryType) {
    case 'string': {
      const sample = sampleFromStringFormat(schema.format) ?? sampleFromSimplePattern(schema.pattern) ?? ''
      if (schema.minLength && sample.length < schema.minLength) {
        const expanded = sample + 'x'.repeat(Math.min(schema.minLength - sample.length, 8))
        return schema.maxLength ? expanded.slice(0, schema.maxLength) : expanded
      }
      return schema.maxLength ? sample.slice(0, schema.maxLength) : sample
    }
    case 'number':
    case 'integer':
      return numberSample(schema)
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

function emptyAuth(): AuthConfig {
  return {
    type: 'none',
    bearerToken: '',
    basicUsername: '',
    basicPassword: '',
    apiKeyName: '',
    apiKeyValue: '',
    apiKeyIn: 'header',
  }
}

function resolveOperationAuth(spec: OpenApiSpec, op: OpenApiOperation): AuthConfig {
  const schemes = {
    ...(spec.securityDefinitions ?? {}),
    ...(spec.components?.securitySchemes ?? {}),
  }
  const security = op.security ?? spec.security ?? []
  for (const requirement of security) {
    for (const schemeName of Object.keys(requirement)) {
      const scheme = schemes[schemeName]
      if (!scheme) continue
      if (scheme.type === 'http' && scheme.scheme?.toLowerCase() === 'bearer') {
        return { ...emptyAuth(), type: 'bearer', bearerToken: `{{${schemeName}}}` }
      }
      if (scheme.type === 'http' && scheme.scheme?.toLowerCase() === 'basic') {
        return { ...emptyAuth(), type: 'basic', basicUsername: `{{${schemeName}.username}}`, basicPassword: `{{${schemeName}.password}}` }
      }
      if (scheme.type === 'oauth2' || scheme.type === 'openIdConnect') {
        return { ...emptyAuth(), type: 'bearer', bearerToken: `{{${schemeName}.accessToken}}` }
      }
      if (scheme.type === 'apiKey' && scheme.name) {
        return {
          ...emptyAuth(),
          type: 'apikey',
          apiKeyName: scheme.name,
          apiKeyValue: `{{${schemeName}}}`,
          apiKeyIn: scheme.in === 'query' ? 'query' : 'header',
        }
      }
    }
  }
  return emptyAuth()
}

function pathToTemplate(path: string): string {
  return path.replace(/\{([^}]+)\}/g, (_match, key) => `{{${String(key).trim()}}}`)
}

function parseOperation(
  spec: OpenApiSpec,
  path: string,
  method: string,
  op: OpenApiOperation,
  baseUrl: string,
): ApiConfig {
  const url = `${baseUrl}${pathToTemplate(path)}`
  const headers: KvPair[] = []
  const params: KvPair[] = []
  const cookies: CookieItem[] = []
  const requestVariables: KvPair[] = []
  let body: BodyConfig = { type: 'none', raw: '', formData: [], urlEncoded: [], binaryFile: null, contentType: '' }

  // Parse parameters
  for (const param of op.parameters || []) {
    const schema: OpenApiSchema = param.schema ?? { type: param.type, default: param.default, example: param.example, examples: param.examples as OpenApiSchema['examples'], enum: param.enum }
    const paramExample = resolveParameterExample(spec, param, schema)
    const kv: KvPair = {
      key: param.name,
      value: stringifyExampleValue(paramExample),
      enabled: true,
      description: param.description,
    }

    if (param.in === 'query') {
      params.push(kv)
    } else if (param.in === 'header') {
      headers.push(kv)
    } else if (param.in === 'cookie') {
      cookies.push(kv)
    } else if (param.in === 'path') {
      requestVariables.push({
        ...kv,
        value: kv.value || (param.required ? `<${param.name}>` : ''),
      })
    } else if (param.in === 'body' && param.schema) {
      const example = resolveSchema(spec, param.schema)
      body = {
        type: 'json',
        raw: example ? JSON.stringify(example, null, 2) : '{\n  \n}',
        formData: [],
        urlEncoded: [],
        binaryFile: null,
        contentType: 'application/json',
      }
    } else if (param.in === 'formData') {
      const item = { ...kv, value: kv.value || (param.type === 'file' ? '<file>' : '') }
      if (body.type !== 'form') {
        body = {
          type: 'form',
          raw: '',
          formData: [],
          urlEncoded: [],
          binaryFile: null,
          contentType: '',
        }
      }
      body.formData.push(item)
    }
  }

  // Parse request body (OpenAPI 3.x)
  if (op.requestBody?.content) {
    for (const [contentType, mediaType] of Object.entries(op.requestBody.content)) {
      if (contentType.includes('application/json')) {
        const exampleFromExamples = mediaType.examples ? Object.values(mediaType.examples)[0]?.value : undefined
        const example = mediaType.example ?? exampleFromExamples ?? (mediaType.schema ? resolveSchema(spec, mediaType.schema) : null)
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
        const fields = mediaType.schema?.properties
          ? Object.entries(mediaType.schema.properties).map(([key, schema]) => ({
              key,
              value: String(resolveSchema(spec, schema) ?? ''),
              enabled: true,
              description: '',
            }))
          : []
        body = {
          type: 'urlencoded',
          raw: '',
          formData: [],
          urlEncoded: fields,
          binaryFile: null,
          contentType: 'application/x-www-form-urlencoded',
        }
        break
      } else if (contentType.includes('multipart/form-data')) {
        const fields = mediaType.schema?.properties
          ? Object.entries(mediaType.schema.properties).map(([key, schema]) => ({
              key,
              value: String(resolveSchema(spec, schema) ?? ''),
              enabled: true,
              description: '',
            }))
          : []
        body = {
          type: 'form',
          raw: '',
          formData: fields,
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
    description: op.description || op.summary || '',
    method: method.toUpperCase() as HttpMethod,
    url,
    headers,
    params,
    cookies,
    body,
    requestVariables,
    auth: resolveOperationAuth(spec, op),
    folder: op.tags?.[0] || null,
  })
}

export function listOpenApiOperationMetadata(spec: OpenApiSpec): OpenApiOperationMetadata[] {
  const baseUrl = getBaseUrl(spec)
  const operations: OpenApiOperationMetadata[] = []

  for (const [path, methods] of Object.entries(spec.paths || {})) {
    if (!methods || typeof methods !== 'object') continue
    for (const [method, operation] of Object.entries(methods)) {
      if (['get', 'post', 'put', 'delete', 'patch', 'head', 'options'].includes(method.toLowerCase())) {
        const op = operation as OpenApiOperation
        operations.push({
          method: method.toUpperCase() as HttpMethod,
          path,
          url: `${baseUrl}${pathToTemplate(path)}`,
          operationId: op.operationId,
          summary: op.summary,
          description: op.description,
          tags: op.tags,
        })
      }
    }
  }

  return operations
}

export function importOpenApiSpec(spec: OpenApiSpec): ApiConfig[] {
  const baseUrl = getBaseUrl(spec)
  const apis: ApiConfig[] = []

  for (const [path, methods] of Object.entries(spec.paths || {})) {
    if (!methods || typeof methods !== 'object') continue
    const pathParameters = Array.isArray((methods as any).parameters) ? (methods as any).parameters : []
    for (const [method, operation] of Object.entries(methods)) {
      if (['get', 'post', 'put', 'delete', 'patch', 'head', 'options'].includes(method.toLowerCase())) {
        const op = operation as OpenApiOperation
        apis.push(parseOperation(spec, path, method, {
          ...op,
          parameters: [...pathParameters, ...(op.parameters ?? [])],
        }, baseUrl))
      }
    }
  }

  return apis
}

export function importOpenApi(content: string): ApiConfig[] {
  const spec = parseOpenApiSpec(content)
  return spec ? importOpenApiSpec(spec) : []
}
