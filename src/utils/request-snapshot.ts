import type { ApiConfig, BodyConfig, KvPair, ResponseData } from '@/types'
import { createDefaultAuthConfig } from '@/utils/auth'

/**
 * FR-2「实际请求」tab:从 ResponseData 的发送快照(URL/headers/body)还原事实视图,
 * 并构造轻量临时 ApiConfig 供 utils/export.ts 的代码生成器复用。
 * 生成器入参 envVars 一律传 {}:快照值已是发送时的最终解析结果,再做模板替换只会双重点换。
 */

export interface RequestBodyPair {
  key: string
  value: string
}

export type RequestBodyKind = 'none' | 'json' | 'urlencoded' | 'form' | 'raw'

/** 实际发送的最终 URL;旧记录无 requestUrl 字段时回退 url */
export function requestUrlOf(response: ResponseData): string {
  return response.requestUrl ?? response.url
}

/**
 * 请求 Body 快照;旧记录回退 requestBody,
 * 但排除 FormData 的 "[object FormData]" 占位串(说明快照实际缺失)。
 */
export function requestBodySnapshotOf(response: ResponseData): string | null {
  if (response.requestBodySnapshot !== undefined) return response.requestBodySnapshot
  const legacy = response.requestBody
  if (!legacy || legacy === '[object FormData]') return null
  return legacy
}

/** 依据请求 Content-Type 判定 Body 实际形态 */
export function requestBodyKind(response: ResponseData): RequestBodyKind {
  const snapshot = requestBodySnapshotOf(response)
  if (snapshot == null || snapshot === '') return 'none'
  const ct = Object.entries(response.requestHeaders ?? {})
    .find(([key]) => key.toLowerCase() === 'content-type')?.[1]?.toLowerCase() ?? ''
  if (ct.includes('application/json')) return 'json'
  if (ct.includes('x-www-form-urlencoded')) return 'urlencoded'
  if (ct.includes('multipart/form-data')) return 'form'
  return 'raw'
}

/** GET/HEAD 语义上无 Body;有 Body 但快照缺失时用于降级提示 */
export function methodHasBody(method: string): boolean {
  return !['GET', 'HEAD'].includes(method.toUpperCase())
}

function safeDecode(value: string): string {
  try {
    return decodeURIComponent(value)
  } catch {
    return value
  }
}

/** urlencoded 快照即实际发送的 k=v&… 编码串,按 &/= 拆回并解码 */
export function parseUrlencodedSnapshot(snapshot: string): RequestBodyPair[] {
  return snapshot.split('&').filter(Boolean).map(part => {
    const eq = part.indexOf('=')
    const key = eq === -1 ? part : part.slice(0, eq)
    const value = eq === -1 ? '' : part.slice(eq + 1)
    return { key: safeDecode(key), value: safeDecode(value) }
  })
}

/** form 快照为逐行 key=value(文件字段 value 形如 "(file) name") */
export function parseFormSnapshot(snapshot: string): RequestBodyPair[] {
  return snapshot.split('\n').filter(Boolean).map(line => {
    const eq = line.indexOf('=')
    return eq === -1
      ? { key: line, value: '' }
      : { key: line.slice(0, eq), value: line.slice(eq + 1) }
  })
}

/** JSON 快照美化;不可解析时返回 null */
export function prettyJsonIfPossible(text: string): string | null {
  try {
    return JSON.stringify(JSON.parse(text), null, 2)
  } catch {
    return null
  }
}

function pairsToKv(pairs: RequestBodyPair[]): KvPair[] {
  return pairs.filter(pair => pair.key).map(pair => ({ key: pair.key, value: pair.value, enabled: true }))
}

function requestContentType(response: ResponseData): string {
  return Object.entries(response.requestHeaders ?? {})
    .find(([key]) => key.toLowerCase() === 'content-type')?.[1] ?? ''
}

/**
 * 由响应快照构造临时 ApiConfig(「已发送事实」视角):
 * auth 置 none(Cookie/Authorization 已在快照 headers 里,避免生成器二次拼接)、params 置空(URL 已是最终拼接结果)。
 */
export function buildApiConfigFromSnapshot(response: ResponseData): ApiConfig {
  const snapshot = requestBodySnapshotOf(response)
  const kind = requestBodyKind(response)
  const ct = requestContentType(response)

  let body: BodyConfig = { type: 'none', raw: '', formData: [], urlEncoded: [], binaryFile: null, contentType: '' }
  if (snapshot != null && snapshot !== '') {
    if (kind === 'json') {
      body = { ...body, type: 'json', raw: snapshot }
    } else if (kind === 'urlencoded') {
      body = { ...body, type: 'urlencoded', urlEncoded: pairsToKv(parseUrlencodedSnapshot(snapshot)) }
    } else if (kind === 'form') {
      body = { ...body, type: 'form', formData: pairsToKv(parseFormSnapshot(snapshot)) }
    } else {
      body = { ...body, type: 'raw', raw: snapshot, contentType: ct || 'text/plain' }
    }
  }

  const headers: KvPair[] = Object.entries(response.requestHeaders ?? {})
    .map(([key, value]) => ({ key, value, enabled: true }))
    .filter(pair => pair.key)

  const now = Date.now()
  return {
    id: `snapshot:${response.timestamp}`,
    name: '实际请求',
    method: response.method,
    url: requestUrlOf(response),
    headers,
    params: [],
    cookies: [],
    body,
    auth: createDefaultAuthConfig(),
    preRequestScript: '',
    postRequestScript: '',
    folder: null,
    createdAt: now,
    updatedAt: now,
  }
}
