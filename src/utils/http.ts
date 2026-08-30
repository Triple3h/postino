import type { HttpMethod, ResponseData, ApiConfig, AuthConfig, BodyConfig, KvPair, CookieItem, ResponseStreamChunk, StreamMergeConfig } from '@/types'
import { resolveTemplateVars } from '@/utils/template'
import { arrayBufferToBase64, isBinaryContentType } from '@/utils/binary-response'
import { createDefaultAuthConfig } from '@/utils/auth'
import { StreamMerger } from '@/utils/stream-merge'

export interface RequestOptions {
  method: HttpMethod
  url: string
  headers: KvPair[]
  params: KvPair[]
  cookies: CookieItem[]
  autoCarryCookies: boolean
  body: BodyConfig
  auth: AuthConfig
  corsMode: 'cors' | 'proxy' | 'no-cors'
  proxyUrl: string
  envVars: Record<string, string>
  timeoutMs?: number
  followRedirects?: boolean
  signal?: AbortSignal
  onStreamingUpdate?: (response: ResponseData) => void
  /** 流式合并规则(SSE/NDJSON):从 JSON 载荷提取字段并拼接,如 data.content */
  streamMerge?: StreamMergeConfig
}

type StreamType = NonNullable<ResponseData['streamType']>

interface StreamParserState {
  streamType: StreamType
  buffer: string
  bodyParts: string[]
  chunks: ResponseStreamChunk[]
  rawBody: string
  merger: StreamMerger | null
  bomStripped: boolean
}

interface AbortContext {
  signal?: AbortSignal
  timedOut: () => boolean
  cleanup: () => void
}

/** FR-4:ws/wss scheme 是浏览器唯一可靠的 WS 判据(new WebSocket 仅接受 ws/wss 握手) */
export function isWebSocketUrl(url: string): boolean {
  return /^wss?:\/\//i.test(url.trim())
}

function isExtensionEnvironment(): boolean {
  return typeof chrome !== 'undefined' && !!chrome.runtime && !!chrome.runtime.sendMessage
}

function getChromeRuntime() {
  return typeof chrome !== 'undefined' ? chrome.runtime : undefined
}

function sendRequestViaExtension(data: {
  method: HttpMethod
  url: string
  headers: Record<string, string>
  body?: string
  bodyType?: string
  formdataFields?: KvPair[]
  autoCarryCookies?: boolean
  timeoutMs?: number
  followRedirects?: boolean
  /** FR-2:实际 Body 快照(form 数据在 background 侧才组装,由调用方随消息带来) */
  requestBodySnapshot?: string | null
}, options: Pick<RequestOptions, 'signal' | 'onStreamingUpdate' | 'streamMerge'> = {}): Promise<ResponseData> {
  if (options.signal || options.onStreamingUpdate) {
    return sendStreamingRequestViaExtension(data, options)
  }

  return new Promise((resolve, reject) => {
    const runtime = getChromeRuntime()
    if (!runtime?.sendMessage) {
      reject(new Error('Chrome extension runtime is unavailable'))
      return
    }

    runtime.sendMessage(
      { type: 'API_REQUEST', data },
      (result: any) => {
        if (runtime.lastError) {
          reject(new Error(runtime.lastError.message))
          return
        }
        if (!result || !result.success) {
          reject(new Error(result?.error || 'Extension request failed'))
          return
        }
        const d = result.data
        const headers: Record<string, string> = {}
        if (Array.isArray(d.headers)) {
          for (const h of d.headers) {
            headers[h.key] = h.value
          }
        }
        resolve({
          status: d.status,
          statusText: d.statusText,
          headers,
          body: d.body,
          bodyEncoding: d.bodyEncoding ?? 'text',
          contentType: d.contentType,
          duration: d.duration,
          size: d.size,
          url: data.url,
          method: data.method,
          requestHeaders: data.headers,
          requestBody: data.body ?? null,
          requestUrl: data.url,
          requestBodySnapshot: data.requestBodySnapshot ?? data.body ?? null,
          timestamp: Date.now(),
        })
      }
    )
  })
}

function sendStreamingRequestViaExtension(data: {
  method: HttpMethod
  url: string
  headers: Record<string, string>
  body?: string
  bodyType?: string
  formdataFields?: KvPair[]
  autoCarryCookies?: boolean
  timeoutMs?: number
  followRedirects?: boolean
  requestBodySnapshot?: string | null
}, options: Pick<RequestOptions, 'signal' | 'onStreamingUpdate' | 'streamMerge'>): Promise<ResponseData> {
  return new Promise((resolve, reject) => {
    const runtime = getChromeRuntime()
    const runtimeAny = runtime as any
    if (!runtimeAny?.sendMessage || !runtimeAny?.onMessage?.addListener) {
      reject(new Error('Chrome extension runtime is unavailable'))
      return
    }

    const streamId = `stream:${Date.now().toString(36)}:${Math.random().toString(36).slice(2)}`
    let response: ResponseData | null = null
    let parser: StreamParserState | null = null
    let bodyEncoding: ResponseData['bodyEncoding'] = 'text'
    let cancelled = false

    const cancelExtensionStream = () => {
      cancelled = true
      try {
        runtimeAny.sendMessage({ type: 'CANCEL_STREAMING', streamId }, () => undefined)
      } catch {}
    }

    const cleanup = () => {
      runtimeAny.onMessage.removeListener(listener)
      options.signal?.removeEventListener('abort', cancelExtensionStream)
    }

    const publish = (next: ResponseData) => {
      response = next
      options.onStreamingUpdate?.(next)
    }

    const finishWithCancellation = () => {
      cleanup()
      const cancelledResponse = createCancelledResponse(response, data.url, data.method, data.headers, data.body ?? null)
      resolve(cancelledResponse)
    }

    const listener = (message: any) => {
      if (!message || message.type !== 'STREAM_CHUNK' || message.streamId !== streamId) return
      const phase = message.phase
      const payload = message.data || {}

      if (phase === 'headers') {
        const headers = headersArrayToRecord(payload.headers)
        const streamType = getStreamingContentType(payload.contentType)
        parser = streamType ? createStreamParser(streamType, options.streamMerge) : null
        bodyEncoding = payload.bodyEncoding ?? 'text'
        publish({
          status: payload.status,
          statusText: payload.statusText,
          headers,
          body: '',
          bodyEncoding,
          contentType: payload.contentType,
          duration: payload.duration ?? 0,
          size: 0,
          url: data.url,
          method: data.method,
          requestHeaders: data.headers,
          requestBody: data.body ?? null,
          requestUrl: data.url,
          requestBodySnapshot: data.requestBodySnapshot ?? data.body ?? null,
          timestamp: Date.now(),
          isStreaming: Boolean(streamType),
          streamType: streamType ?? undefined,
          chunks: [],
          finalBody: '',
          streamCompleted: false,
        })
        return
      }

      if (phase === 'body') {
        if (!response) return
        if (parser) {
          appendStreamText(parser, payload.chunk || '')
          publish({
            ...response,
            body: currentStreamDisplayBody(parser),
            duration: payload.duration ?? response.duration,
            size: payload.totalSize ?? response.size,
            chunks: [...parser.chunks],
            finalBody: currentStreamDisplayBody(parser),
            isStreaming: true,
            streamCompleted: false,
          })
        } else if (bodyEncoding === 'text') {
          const nextBody = `${response.body || ''}${payload.chunk || ''}`
          publish({
            ...response,
            body: nextBody,
            duration: payload.duration ?? response.duration,
            size: payload.totalSize ?? new Blob([nextBody]).size,
            finalBody: nextBody,
          })
        }
        return
      }

      if (phase === 'done') {
        if (!response) {
          cleanup()
          reject(new Error('Extension streaming request completed without headers'))
          return
        }
        if (parser) finalizeStreamParser(parser)
        const finalBody = parser ? currentStreamDisplayBody(parser) : (payload.body ?? response.body ?? '')
        const finalResponse: ResponseData = {
          ...response,
          body: finalBody,
          bodyEncoding: payload.bodyEncoding ?? response.bodyEncoding,
          duration: payload.duration ?? response.duration,
          size: payload.size ?? new Blob([finalBody]).size,
          chunks: parser ? [...parser.chunks] : response.chunks,
          mergedText: currentStreamMergedText(parser) ?? response.mergedText,
          mergedReasoning: currentStreamMergedReasoning(parser) ?? response.mergedReasoning,
          finalBody,
          isStreaming: false,
          streamCompleted: Boolean(parser),
        }
        cleanup()
        resolve(finalResponse)
        return
      }

      if (phase === 'aborted') {
        finishWithCancellation()
        return
      }

      if (phase === 'error') {
        cleanup()
        if (cancelled || options.signal?.aborted) {
          resolve(createCancelledResponse(response, data.url, data.method, data.headers, data.body ?? null))
        } else {
          reject(new Error(payload.error || 'Extension streaming request failed'))
        }
      }
    }

    runtimeAny.onMessage.addListener(listener)
    options.signal?.addEventListener('abort', cancelExtensionStream, { once: true })

    if (options.signal?.aborted) {
      cancelExtensionStream()
      cleanup()
      resolve(createCancelledResponse(null, data.url, data.method, data.headers, data.body ?? null))
      return
    }

    runtimeAny.sendMessage(
      { type: 'STREAMING_REQUEST', data: { ...data, streamId } },
      (result: any) => {
        if (runtime?.lastError) {
          cleanup()
          reject(new Error(runtime.lastError.message))
          return
        }
        if (!result || !result.success) {
          cleanup()
          reject(new Error(result?.error || 'Extension streaming request failed'))
        }
      }
    )
  })
}

const PROXY_URLS = {
  'corsproxy.io': 'https://corsproxy.io/?',
  'allorigins': 'https://api.allorigins.win/raw?url=',
}

// --- MD5 implementation (inline, no external dependency) ---
function md5(input: string): string {
  function safeAdd(x: number, y: number): number {
    const lsw = (x & 0xffff) + (y & 0xffff)
    const msw = (x >> 16) + (y >> 16) + (lsw >> 16)
    return (msw << 16) | (lsw & 0xffff)
  }
  function bitRotateLeft(num: number, cnt: number): number {
    return (num << cnt) | (num >>> (32 - cnt))
  }
  function md5cmn(q: number, a: number, b: number, x: number, s: number, t: number): number {
    return safeAdd(bitRotateLeft(safeAdd(safeAdd(a, q), safeAdd(x, t)), s), b)
  }
  function md5ff(a: number, b: number, c: number, d: number, x: number, s: number, t: number): number {
    return md5cmn((b & c) | (~b & d), a, b, x, s, t)
  }
  function md5gg(a: number, b: number, c: number, d: number, x: number, s: number, t: number): number {
    return md5cmn((b & d) | (c & ~d), a, b, x, s, t)
  }
  function md5hh(a: number, b: number, c: number, d: number, x: number, s: number, t: number): number {
    return md5cmn(b ^ c ^ d, a, b, x, s, t)
  }
  function md5ii(a: number, b: number, c: number, d: number, x: number, s: number, t: number): number {
    return md5cmn(c ^ (b | ~d), a, b, x, s, t)
  }
  function binlMD5(x: number[], len: number): number[] {
    x[len >> 5] |= 0x80 << (len % 32)
    x[(((len + 64) >>> 9) << 4) + 14] = len
    let a = 1732584193, b = -271733879, c = -1732584194, d = 271733878
    for (let i = 0; i < x.length; i += 16) {
      const olda = a, oldb = b, oldc = c, oldd = d
      a = md5ff(a, b, c, d, x[i], 7, -680876936)
      d = md5ff(d, a, b, c, x[i + 1], 12, -389564586)
      c = md5ff(c, d, a, b, x[i + 2], 17, 606105819)
      b = md5ff(b, c, d, a, x[i + 3], 22, -1044525330)
      a = md5ff(a, b, c, d, x[i + 4], 7, -176418897)
      d = md5ff(d, a, b, c, x[i + 5], 12, 1200080426)
      c = md5ff(c, d, a, b, x[i + 6], 17, -1473231341)
      b = md5ff(b, c, d, a, x[i + 7], 22, -45705983)
      a = md5ff(a, b, c, d, x[i + 8], 7, 1770035416)
      d = md5ff(d, a, b, c, x[i + 9], 12, -1958414417)
      c = md5ff(c, d, a, b, x[i + 10], 17, -42063)
      b = md5ff(b, c, d, a, x[i + 11], 22, -1990404162)
      a = md5ff(a, b, c, d, x[i + 12], 7, 1804603682)
      d = md5ff(d, a, b, c, x[i + 13], 12, -40341101)
      c = md5ff(c, d, a, b, x[i + 14], 17, -1502002290)
      b = md5ff(b, c, d, a, x[i + 15], 22, 1236535329)
      a = md5gg(a, b, c, d, x[i + 1], 5, -165796510)
      d = md5gg(d, a, b, c, x[i + 6], 9, -1069501632)
      c = md5gg(c, d, a, b, x[i + 11], 14, 643717713)
      b = md5gg(b, c, d, a, x[i], 20, -373897302)
      a = md5gg(a, b, c, d, x[i + 5], 5, -701558691)
      d = md5gg(d, a, b, c, x[i + 10], 9, 38016083)
      c = md5gg(c, d, a, b, x[i + 15], 14, -660478335)
      b = md5gg(b, c, d, a, x[i + 4], 20, -405537848)
      a = md5gg(a, b, c, d, x[i + 9], 5, 568446438)
      d = md5gg(d, a, b, c, x[i + 14], 9, -1019803690)
      c = md5gg(c, d, a, b, x[i + 3], 14, -187363961)
      b = md5gg(b, c, d, a, x[i + 8], 20, 1163531501)
      a = md5gg(a, b, c, d, x[i + 13], 5, -1444681467)
      d = md5gg(d, a, b, c, x[i + 2], 9, -51403784)
      c = md5gg(c, d, a, b, x[i + 7], 14, 1735328473)
      b = md5gg(b, c, d, a, x[i + 12], 20, -1926607734)
      a = md5hh(a, b, c, d, x[i + 5], 4, -378558)
      d = md5hh(d, a, b, c, x[i + 8], 11, -2022574463)
      c = md5hh(c, d, a, b, x[i + 11], 16, 1839030562)
      b = md5hh(b, c, d, a, x[i + 14], 23, -35309556)
      a = md5hh(a, b, c, d, x[i + 1], 4, -1530992060)
      d = md5hh(d, a, b, c, x[i + 4], 11, 1272893353)
      c = md5hh(c, d, a, b, x[i + 7], 16, -155497632)
      b = md5hh(b, c, d, a, x[i + 10], 23, -1094730640)
      a = md5hh(a, b, c, d, x[i + 13], 4, 681279174)
      d = md5hh(d, a, b, c, x[i], 11, -358537222)
      c = md5hh(c, d, a, b, x[i + 3], 16, -722521979)
      b = md5hh(b, c, d, a, x[i + 6], 23, 76029189)
      a = md5hh(a, b, c, d, x[i + 9], 4, -640364487)
      d = md5hh(d, a, b, c, x[i + 12], 11, -421815835)
      c = md5hh(c, d, a, b, x[i + 15], 16, 530742520)
      b = md5hh(b, c, d, a, x[i + 2], 23, -995338651)
      a = md5ii(a, b, c, d, x[i], 6, -198630844)
      d = md5ii(d, a, b, c, x[i + 7], 10, 1126891415)
      c = md5ii(c, d, a, b, x[i + 14], 15, -1416354905)
      b = md5ii(b, c, d, a, x[i + 5], 21, -57434055)
      a = md5ii(a, b, c, d, x[i + 12], 6, 1700485571)
      d = md5ii(d, a, b, c, x[i + 3], 10, -1894986606)
      c = md5ii(c, d, a, b, x[i + 10], 15, -1051523)
      b = md5ii(b, c, d, a, x[i + 1], 21, -2054922799)
      a = md5ii(a, b, c, d, x[i + 8], 6, 1873313359)
      d = md5ii(d, a, b, c, x[i + 15], 10, -30611744)
      c = md5ii(c, d, a, b, x[i + 6], 15, -1560198380)
      b = md5ii(b, c, d, a, x[i + 13], 21, 1309151649)
      a = md5ii(a, b, c, d, x[i + 4], 6, -145523070)
      d = md5ii(d, a, b, c, x[i + 11], 10, -1120210379)
      c = md5ii(c, d, a, b, x[i + 2], 15, 718787259)
      b = md5ii(b, c, d, a, x[i + 9], 21, -343485551)
      a = safeAdd(a, olda)
      b = safeAdd(b, oldb)
      c = safeAdd(c, oldc)
      d = safeAdd(d, oldd)
    }
    return [a, b, c, d]
  }
  function str2binl(str: string): number[] {
    const bin: number[] = []
    const mask = (1 << 8) - 1
    for (let i = 0; i < str.length * 8; i += 8) {
      bin[i >> 5] |= (str.charCodeAt(i / 8) & mask) << (i % 32)
    }
    return bin
  }
  function binl2hex(binarray: number[]): string {
    const hexTab = '0123456789abcdef'
    let str = ''
    for (let i = 0; i < binarray.length * 4; i++) {
      str += hexTab.charAt((binarray[i >> 2] >> ((i % 4) * 8 + 4)) & 0xf) +
             hexTab.charAt((binarray[i >> 2] >> ((i % 4) * 8)) & 0xf)
    }
    return str
  }
  // Encode to UTF-8 before hashing
  const utf8 = unescape(encodeURIComponent(input))
  return binl2hex(binlMD5(str2binl(utf8), utf8.length * 8))
}

// --- Digest Auth helpers ---
interface DigestChallenge {
  realm: string
  nonce: string
  uri: string
  qop?: string
  algorithm?: string
  opaque?: string
  nc: number
  cnonce: string
}

function parseDigestChallenge(wwwAuth: string): Partial<DigestChallenge> | null {
  const digestMatch = wwwAuth.match(/^Digest\s+(.+)$/i)
  if (!digestMatch) return null
  const params = digestMatch[1]
  const result: Partial<DigestChallenge> = {}
  const regex = /(\w+)=(?:"([^"]+)"|([\w/+=]+))/g
  let match
  while ((match = regex.exec(params)) !== null) {
    const key = match[1]
    const value = match[2] || match[3]
    switch (key) {
      case 'realm': result.realm = value; break
      case 'nonce': result.nonce = value; break
      case 'qop': result.qop = value; break
      case 'algorithm': result.algorithm = value; break
      case 'opaque': result.opaque = value; break
    }
  }
  return result
}

function generateCnonce(): string {
  const chars = 'abcdef0123456789'
  let result = ''
  for (let i = 0; i < 16; i++) {
    result += chars.charAt(Math.floor(Math.random() * chars.length))
  }
  return result
}

function buildDigestAuthHeader(
  challenge: Partial<DigestChallenge>,
  username: string,
  password: string,
  method: string,
  uri: string,
): string {
  const realm = challenge.realm || ''
  const nonce = challenge.nonce || ''
  const qop = challenge.qop
  const opaque = challenge.opaque
  const algorithm = (challenge.algorithm || 'MD5').toUpperCase()
  const nc = 1
  const cnonce = generateCnonce()

  // HA1
  let ha1: string
  if (algorithm === 'MD5-SESS') {
    ha1 = md5(md5(`${username}:${realm}:${password}`) + ':' + cnonce)
  } else {
    ha1 = md5(`${username}:${realm}:${password}`)
  }

  // HA2
  const ha2 = md5(`${method}:${uri}`)

  // Response
  let response: string
  if (qop) {
    // Use 'auth' qop if available
    const qopValue = qop.split(',').map(s => s.trim()).includes('auth') ? 'auth' : qop.split(',')[0].trim()
    const ncStr = nc.toString().padStart(8, '0')
    response = md5(`${ha1}:${nonce}:${ncStr}:${cnonce}:${qopValue}:${ha2}`)
    let header = `Digest username="${username}", realm="${realm}", nonce="${nonce}", uri="${uri}", qop=${qopValue}, nc=${ncStr}, cnonce="${cnonce}", response="${response}"`
    if (opaque) header += `, opaque="${opaque}"`
    if (algorithm !== 'MD5') header += `, algorithm=${algorithm}`
    return header
  } else {
    response = md5(`${ha1}:${nonce}:${ha2}`)
    let header = `Digest username="${username}", realm="${realm}", nonce="${nonce}", uri="${uri}", response="${response}"`
    if (opaque) header += `, opaque="${opaque}"`
    if (algorithm !== 'MD5') header += `, algorithm=${algorithm}`
    return header
  }
}

// --- OAuth2 token fetch ---
async function fetchOAuth2Token(auth: AuthConfig, envVars: Record<string, string>): Promise<string | null> {
  const tokenUrl = resolveValue(auth.oauth2AccessTokenUrl, envVars)
  const clientId = resolveValue(auth.oauth2ClientId, envVars)
  const clientSecret = resolveValue(auth.oauth2ClientSecret, envVars)

  if (!tokenUrl || !clientId) return null

  const bodyParams: Record<string, string> = {
    grant_type: auth.oauth2GrantType,
    client_id: clientId,
  }
  if (clientSecret) bodyParams.client_secret = clientSecret
  if (auth.oauth2Scope) bodyParams.scope = resolveValue(auth.oauth2Scope, envVars)

  if (auth.oauth2GrantType === 'password') {
    bodyParams.username = resolveValue(auth.oauth2Username, envVars)
    bodyParams.password = resolveValue(auth.oauth2Password, envVars)
  }

  const formBody = Object.entries(bodyParams)
    .map(([k, v]) => `${encodeURIComponent(k)}=${encodeURIComponent(v)}`)
    .join('&')

  try {
    const resp = await fetch(tokenUrl, {
      method: 'POST',
      headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
      body: formBody,
    })
    const data = await resp.json()
    return data.access_token || null
  } catch {
    return null
  }
}

function buildHeaders(headers: KvPair[], auth: AuthConfig, envVars: Record<string, string>): Record<string, string> {
  const result: Record<string, string> = {}
  for (const h of headers) {
    if (h.enabled && h.key) {
      result[h.key] = resolveValue(h.value, envVars)
    }
  }

  if (auth.type === 'bearer' && auth.bearerToken) {
    result['Authorization'] = `Bearer ${resolveValue(auth.bearerToken, envVars)}`
  } else if (auth.type === 'basic' && auth.basicUsername) {
    const encoded = btoa(`${resolveValue(auth.basicUsername, envVars)}:${resolveValue(auth.basicPassword, envVars)}`)
    result['Authorization'] = `Basic ${encoded}`
  } else if (auth.type === 'oauth2' && auth.oauth2Token) {
    result['Authorization'] = `Bearer ${resolveValue(auth.oauth2Token, envVars)}`
  } else if (auth.type === 'apikey' && auth.apiKeyName && auth.apiKeyValue) {
    if (auth.apiKeyIn === 'header') {
      result[resolveValue(auth.apiKeyName, envVars)] = resolveValue(auth.apiKeyValue, envVars)
    }
  }

  return result
}

function joinRequestPrefix(prefix: string, path: string): string {
  const cleanPrefix = prefix.replace(/\/+$/, '')
  const cleanPath = path.startsWith('/') ? path : `/${path}`
  return `${cleanPrefix}${cleanPath}`
}

function buildUrl(baseUrl: string, params: KvPair[], auth: AuthConfig, envVars: Record<string, string>): string {
  let url = resolveValue(baseUrl, envVars)
  const requestPrefix = envVars.requestPrefix || envVars.baseUrl
  if (requestPrefix && url.startsWith('/')) {
    url = joinRequestPrefix(resolveValue(requestPrefix, envVars), url)
  }

  const queryParts: string[] = []
  const urlObj = new URL(url.startsWith('http') ? url : `http://${url}`)
  urlObj.searchParams.forEach((v, k) => queryParts.push(`${k}=${v}`))

  for (const p of params) {
    if (p.enabled && p.key) {
      queryParts.push(`${encodeURIComponent(resolveValue(p.key, envVars))}=${encodeURIComponent(resolveValue(p.value, envVars))}`)
    }
  }

  if (auth.type === 'apikey' && auth.apiKeyIn === 'query' && auth.apiKeyName && auth.apiKeyValue) {
    queryParts.push(`${encodeURIComponent(resolveValue(auth.apiKeyName, envVars))}=${encodeURIComponent(resolveValue(auth.apiKeyValue, envVars))}`)
  }

  const base = url.split('?')[0]
  return queryParts.length > 0 ? `${base}?${queryParts.join('&')}` : base
}

function buildBody(body: BodyConfig, envVars: Record<string, string>): { body: BodyInit | undefined; contentType: string } {
  switch (body.type) {
    case 'none':
      return { body: undefined, contentType: '' }
    case 'json': {
      const raw = resolveValue(body.raw, envVars)
      return { body: raw, contentType: 'application/json' }
    }
    case 'raw': {
      const raw = resolveValue(body.raw, envVars)
      return { body: raw, contentType: body.contentType || 'text/plain' }
    }
    case 'form': {
      const fd = new FormData()
      for (const item of body.formData) {
        if (item.enabled && item.key) {
          const key = resolveValue(item.key, envVars)
          if (item.type === 'file' && item.value && item.value.startsWith('data:')) {
            // Convert base64 data URL to Blob and append as file
            const blob = dataUrlToBlob(item.value)
            const fileName = item.fileName || 'file'
            fd.append(key, blob, fileName)
          } else {
            fd.append(key, resolveValue(item.value, envVars))
          }
        }
      }
      return { body: fd, contentType: '' }
    }
    case 'urlencoded': {
      const parts: string[] = []
      for (const item of body.urlEncoded) {
        if (item.enabled && item.key) {
          parts.push(`${encodeURIComponent(resolveValue(item.key, envVars))}=${encodeURIComponent(resolveValue(item.value, envVars))}`)
        }
      }
      return { body: parts.join('&'), contentType: 'application/x-www-form-urlencoded' }
    }
    default:
      return { body: undefined, contentType: '' }
  }
}

function dataUrlToBlob(dataUrl: string): Blob {
  const parts = dataUrl.split(',')
  const mimeMatch = parts[0].match(/:(.*?);/)
  const mime = mimeMatch ? mimeMatch[1] : 'application/octet-stream'
  const b64 = atob(parts[1])
  const bytes = new Uint8Array(b64.length)
  for (let i = 0; i < b64.length; i++) {
    bytes[i] = b64.charCodeAt(i)
  }
  return new Blob([bytes], { type: mime })
}

function resolveValue(value: string, envVars: Record<string, string>): string {
  return resolveTemplateVars(value, { globalVars: envVars })
}

/**
 * FR-2:最终 fetch 前的请求 Body 快照,与 buildBody 的实际发送形态对应。
 * form 数据没有单一字符串形态,序列化为逐行 key=value(文件字段只标注文件名)。
 */
function buildRequestBodySnapshot(body: BodyConfig, envVars: Record<string, string>): string | null {
  switch (body.type) {
    case 'json':
    case 'raw':
      return resolveValue(body.raw, envVars) || null
    case 'urlencoded':
      return body.urlEncoded
        .filter(item => item.enabled && item.key)
        .map(item => `${encodeURIComponent(resolveValue(item.key, envVars))}=${encodeURIComponent(resolveValue(item.value, envVars))}`)
        .join('&') || null
    case 'form':
      return body.formData
        .filter(item => item.enabled && item.key)
        .map(item => item.type === 'file'
          ? `${resolveValue(item.key, envVars)}=(file) ${item.fileName || '(binary)'}`
          : `${resolveValue(item.key, envVars)}=${resolveValue(item.value, envVars)}`)
        .join('\n') || null
    default:
      return null
  }
}

function getStreamingContentType(contentType: string | undefined | null): StreamType | null {
  const ct = String(contentType || '').toLowerCase()
  if (ct.includes('text/event-stream')) return 'sse'
  if (ct.includes('application/x-ndjson')) return 'ndjson'
  return null
}

function createStreamParser(streamType: StreamType, streamMerge?: StreamMergeConfig | null): StreamParserState {
  return {
    streamType,
    buffer: '',
    bodyParts: [],
    chunks: [],
    rawBody: '',
    merger: streamMerge && streamMerge.mode !== 'off' ? new StreamMerger(streamMerge) : null,
    bomStripped: false,
  }
}

function appendStreamText(state: StreamParserState, rawText: string): void {
  if (!rawText) return
  let text = rawText
  if (!state.bomStripped) {
    state.bomStripped = true
    text = text.replace(/^\uFEFF/, '')
    if (!text) return
  }
  state.rawBody += text
  state.buffer += text
  if (state.streamType === 'sse') {
    drainSseEvents(state, false)
  } else {
    drainNdjsonLines(state, false)
  }
}

function finalizeStreamParser(state: StreamParserState): void {
  if (state.streamType === 'sse') {
    drainSseEvents(state, true)
  } else {
    drainNdjsonLines(state, true)
  }
}

function drainSseEvents(state: StreamParserState, flush: boolean): void {
  const parts = state.buffer.split(/\r?\n\r?\n/)
  state.buffer = flush ? '' : (parts.pop() ?? '')
  const events = flush ? parts.filter(Boolean).concat(state.buffer ? [state.buffer] : []) : parts

  for (const rawEvent of events) {
    const lines = rawEvent.split(/\r?\n/)
    const dataLines: string[] = []
    let eventName: string | undefined
    let eventId: string | undefined

    for (const line of lines) {
      // 注释行(:heartbeat)跳过
      if (line.startsWith(':')) continue
      const colonIdx = line.indexOf(':')
      const field = colonIdx === -1 ? line : line.slice(0, colonIdx)
      const value = colonIdx === -1 ? '' : line.slice(colonIdx + 1).replace(/^ /, '')
      if (field === 'event') {
        eventName = value
      } else if (field === 'data') {
        // 多行 data 按行拼接(SSE 规范)
        dataLines.push(value)
      } else if (field === 'id') {
        eventId = value
      }
      // retry 字段仅作容错读取,不影响合并
    }

    const data = dataLines.join('\n')
    if (!data && !eventName && !eventId) continue
    const chunk: ResponseStreamChunk = {
      id: `${state.streamType}-${state.chunks.length + 1}`,
      type: state.streamType,
      raw: rawEvent,
      data,
      event: eventName,
      timestamp: Date.now(),
    }
    if (eventId !== undefined) chunk.sseId = eventId
    try {
      const parsed = JSON.parse(data)
      if (parsed !== null && typeof parsed === 'object') chunk.json = parsed
    } catch {}
    state.bodyParts.push(data)
    state.chunks.push(chunk)
    state.merger?.push(chunk)
  }

  if (flush) state.buffer = ''
}

function drainNdjsonLines(state: StreamParserState, flush: boolean): void {
  const lines = state.buffer.split(/\r?\n/)
  state.buffer = flush ? '' : (lines.pop() ?? '')
  const completeLines = flush ? lines.filter(Boolean).concat(state.buffer ? [state.buffer] : []) : lines

  for (const rawLine of completeLines) {
    const line = rawLine.trim()
    if (!line) continue
    let parsed: unknown
    let data = line
    try {
      parsed = JSON.parse(line)
      data = JSON.stringify(parsed, null, 2)
    } catch {}
    const chunk: ResponseStreamChunk = {
      id: `${state.streamType}-${state.chunks.length + 1}`,
      type: state.streamType,
      raw: rawLine,
      data,
      json: parsed,
      timestamp: Date.now(),
    }
    state.bodyParts.push(data)
    state.chunks.push(chunk)
    state.merger?.push(chunk)
  }

  if (flush) state.buffer = ''
}

function currentStreamDisplayBody(state: StreamParserState): string {
  return state.bodyParts.length > 0 ? state.bodyParts.join('\n') : state.rawBody
}

function currentStreamMergedText(state: StreamParserState | null): string | undefined {
  return state?.merger ? state.merger.state.merged : undefined
}

function currentStreamMergedReasoning(state: StreamParserState | null): string | undefined {
  return state?.merger ? (state.merger.state.reasoning || undefined) : undefined
}

function headersArrayToRecord(headers: Array<{ key: string; value: string }> | undefined): Record<string, string> {
  const result: Record<string, string> = {}
  for (const h of headers ?? []) {
    result[h.key] = h.value
  }
  return result
}

function createAbortContext(signal?: AbortSignal, timeoutMs?: number): AbortContext {
  if (typeof AbortController === 'undefined') {
    return { signal, timedOut: () => false, cleanup: () => undefined }
  }

  const controller = new AbortController()
  let timeoutHit = false
  let timeoutId: ReturnType<typeof setTimeout> | undefined
  const abortFromExternal = () => controller.abort(signal?.reason)

  if (signal) {
    if (signal.aborted) controller.abort(signal.reason)
    else signal.addEventListener('abort', abortFromExternal, { once: true })
  }

  if (timeoutMs && timeoutMs > 0) {
    timeoutId = setTimeout(() => {
      timeoutHit = true
      controller.abort(new DOMException(`Timeout ${timeoutMs}ms`, 'TimeoutError'))
    }, timeoutMs)
  }

  return {
    signal: controller.signal,
    timedOut: () => timeoutHit,
    cleanup: () => {
      if (timeoutId) clearTimeout(timeoutId)
      signal?.removeEventListener('abort', abortFromExternal)
    },
  }
}

function createCancelledResponse(
  partial: ResponseData | null,
  url: string,
  method: HttpMethod,
  requestHeaders: Record<string, string>,
  requestBody: string | null,
  requestUrl?: string,
  requestBodySnapshot?: string | null,
): ResponseData {
  const body = partial?.body || '请求已取消（Request cancelled）'
  return {
    status: partial?.status ?? 0,
    statusText: 'Request cancelled',
    headers: partial?.headers ?? {},
    body,
    bodyEncoding: partial?.bodyEncoding ?? 'text',
    contentType: partial?.contentType,
    duration: partial?.duration ?? 0,
    size: partial?.size ?? new Blob([body]).size,
    url: partial?.url ?? url,
    method: partial?.method ?? method,
    requestHeaders: partial?.requestHeaders ?? requestHeaders,
    requestBody: partial?.requestBody ?? requestBody,
    requestUrl: partial?.requestUrl ?? requestUrl ?? url,
    requestBodySnapshot: partial?.requestBodySnapshot ?? requestBodySnapshot ?? requestBody,
    timestamp: Date.now(),
    isStreaming: false,
    streamType: partial?.streamType,
    chunks: partial?.chunks ?? [],
    finalBody: body,
    streamCompleted: false,
    cancelled: true,
  }
}

function buildCookieHeader(cookies: CookieItem[], autoCarryCookies: boolean, envVars: Record<string, string>): string {
  const cookieMap: Record<string, string> = {}

  if (autoCarryCookies) {
    try {
      const docCookies = document.cookie
      if (docCookies) {
        for (const pair of docCookies.split(';')) {
          const trimmed = pair.trim()
          const eqIdx = trimmed.indexOf('=')
          if (eqIdx > 0) {
            cookieMap[trimmed.slice(0, eqIdx)] = trimmed.slice(eqIdx + 1)
          }
        }
      }
    } catch {}
  }

  for (const c of cookies) {
    if (c.enabled && c.key) {
      cookieMap[resolveValue(c.key, envVars)] = resolveValue(c.value, envVars)
    }
  }

  return Object.entries(cookieMap).map(([k, v]) => `${k}=${v}`).join('; ')
}

export async function sendRequest(options: RequestOptions): Promise<ResponseData> {
  const { method, url, headers, params, cookies, autoCarryCookies, body, auth, corsMode, proxyUrl, envVars, timeoutMs, followRedirects, signal, onStreamingUpdate, streamMerge } = options

  // OAuth2: auto-fetch token for client_credentials / password grants if no token yet
  let effectiveAuth = auth
  if (auth.type === 'oauth2' && !auth.oauth2Token &&
      (auth.oauth2GrantType === 'client_credentials' || auth.oauth2GrantType === 'password') &&
      auth.oauth2AccessTokenUrl && auth.oauth2ClientId) {
    const token = await fetchOAuth2Token(auth, envVars)
    if (token) {
      effectiveAuth = { ...auth, oauth2Token: token }
    }
  }

  const finalUrl = buildUrl(url, params, effectiveAuth, envVars)
  const finalHeaders = buildHeaders(headers, effectiveAuth, envVars)
  const { body: reqBody, contentType } = buildBody(body, envVars)

  const cookieHeader = buildCookieHeader(cookies, autoCarryCookies, envVars)
  if (cookieHeader) {
    finalHeaders['Cookie'] = cookieHeader
  }

  if (contentType && !finalHeaders['Content-Type']) {
    finalHeaders['Content-Type'] = contentType
  }

  // Extension environment: bypass CORS via background service worker
  if (isExtensionEnvironment()) {
    const extBody: any = { method, url: finalUrl, headers: finalHeaders, autoCarryCookies, timeoutMs, followRedirects, requestBodySnapshot: buildRequestBodySnapshot(body, envVars) }
    if (body.type === 'form' && reqBody instanceof FormData) {
      extBody.bodyType = 'formdata'
      extBody.formdataFields = body.formData.filter(f => f.enabled && f.key)
    } else if (body.type === 'urlencoded') {
      extBody.bodyType = 'urlencoded'
      extBody.body = reqBody as string
    } else if (body.type === 'json' || body.type === 'raw') {
      extBody.bodyType = body.type
      extBody.body = reqBody as string
    }
    // For Digest auth in extension mode, pass auth info so background can handle retry
    if (effectiveAuth.type === 'digest' && effectiveAuth.digestUsername) {
      extBody.auth = {
        type: 'digest',
        digestUsername: resolveValue(effectiveAuth.digestUsername, envVars),
        digestPassword: resolveValue(effectiveAuth.digestPassword, envVars),
      }
    }
    return sendRequestViaExtension(extBody, { signal, onStreamingUpdate, streamMerge })
  }

  let fetchUrl = finalUrl
  // FR-2:最终 fetch 前的请求快照(真实 URL + Body 实际发送形态)
  const requestSnapshot = { url: finalUrl, body: buildRequestBodySnapshot(body, envVars) }
  const fetchOptions: RequestInit = {
    method,
    headers: finalHeaders,
    body: method !== 'GET' && method !== 'HEAD' ? reqBody : undefined,
    redirect: followRedirects === false ? 'manual' : 'follow',
  }

  if (corsMode === 'proxy') {
    const proxy = proxyUrl || PROXY_URLS['corsproxy.io']
    fetchUrl = `${proxy}${encodeURIComponent(finalUrl)}`
    fetchOptions.mode = 'cors'
  } else if (corsMode === 'no-cors') {
    fetchOptions.mode = 'no-cors'
  }

  const startTime = performance.now()
  let status = 0
  let statusText = ''
  let respHeaders: Record<string, string> = {}
  let respBody = ''
  let bodyEncoding: ResponseData['bodyEncoding'] = 'text'
  let size = 0
  let streamingResponse: ResponseData | null = null
  const abortContext = createAbortContext(signal, timeoutMs)
  if (abortContext.signal) fetchOptions.signal = abortContext.signal

  try {
    const resp = await fetch(fetchUrl, fetchOptions)

    // Digest Auth: handle 401 with WWW-Authenticate: Digest challenge
    if (resp.status === 401 && effectiveAuth.type === 'digest' && effectiveAuth.digestUsername) {
      const wwwAuth = resp.headers.get('www-authenticate') || ''
      const challenge = parseDigestChallenge(wwwAuth)
      if (challenge?.nonce) {
        const uri = new URL(finalUrl).pathname + new URL(finalUrl).search
        const digestHeader = buildDigestAuthHeader(
          challenge,
          resolveValue(effectiveAuth.digestUsername, envVars),
          resolveValue(effectiveAuth.digestPassword, envVars),
          method,
          uri || '/',
        )
        finalHeaders['Authorization'] = digestHeader
        const retryOptions: RequestInit = {
          method,
          headers: finalHeaders,
          body: method !== 'GET' && method !== 'HEAD' ? reqBody : undefined,
          redirect: followRedirects === false ? 'manual' : 'follow',
        }
        if (abortContext.signal) retryOptions.signal = abortContext.signal
        if (corsMode === 'proxy') {
          retryOptions.mode = 'cors'
        } else if (corsMode === 'no-cors') {
          retryOptions.mode = 'no-cors'
        }
        const retryResp = await fetch(fetchUrl, retryOptions)
        return await processResponse(retryResp, finalUrl, method, finalHeaders, reqBody, startTime, abortContext, onStreamingUpdate, streamMerge, requestSnapshot)
      }
    }

    return await processResponse(resp, finalUrl, method, finalHeaders, reqBody, startTime, abortContext, onStreamingUpdate, streamMerge, requestSnapshot)
  } catch (err: any) {
    const duration = Math.round(performance.now() - startTime)
    if (err?.name === 'AbortError' || err?.name === 'TimeoutError') {
      if (!abortContext.timedOut() && signal?.aborted) {
        const cancelled = createCancelledResponse(streamingResponse, finalUrl, method, finalHeaders, reqBody?.toString() ?? null, requestSnapshot.url, requestSnapshot.body)
        return { ...cancelled, duration }
      }
      return {
        status,
        statusText: timeoutMs ? `请求超时（${timeoutMs}ms）` : 'Request aborted',
        headers: respHeaders,
        body: '',
        duration,
        size: 0,
        url: finalUrl,
        method,
        requestHeaders: finalHeaders,
        requestBody: reqBody?.toString() ?? null,
        requestUrl: requestSnapshot.url,
        requestBodySnapshot: requestSnapshot.body,
        timestamp: Date.now(),
      }
    }
    return {
      status: 0,
      statusText: err.message || 'Network Error',
      headers: {},
      body: '',
      duration,
      size: 0,
      url: finalUrl,
      method,
      requestHeaders: finalHeaders,
      requestBody: reqBody?.toString() ?? null,
      requestUrl: requestSnapshot.url,
      requestBodySnapshot: requestSnapshot.body,
      timestamp: Date.now(),
    }
  } finally {
    abortContext.cleanup()
  }
}

async function processResponse(
  resp: Response,
  finalUrl: string,
  method: HttpMethod,
  finalHeaders: Record<string, string>,
  reqBody: BodyInit | undefined,
  startTime: number,
  abortContext: AbortContext,
  onStreamingUpdate?: (response: ResponseData) => void,
  streamMerge?: StreamMergeConfig,
  requestSnapshot?: { url: string; body: string | null },
): Promise<ResponseData> {
  const status = resp.status
  const statusText = resp.statusText
  const respHeaders: Record<string, string> = {}
  resp.headers.forEach((v, k) => {
    respHeaders[k] = v
  })

  const contentTypeHeader = resp.headers.get('content-type') || ''
  const streamType = getStreamingContentType(contentTypeHeader)

  if (streamType && resp.body) {
    const parser = createStreamParser(streamType, streamMerge)
    const reader = resp.body.getReader()
    const decoder = new TextDecoder('utf-8')
    let size = 0

    const streamingResponse: ResponseData = {
      status,
      statusText,
      headers: respHeaders,
      body: '',
      bodyEncoding: 'text',
      contentType: contentTypeHeader,
      duration: Math.round(performance.now() - startTime),
      size: 0,
      url: finalUrl,
      method,
      requestHeaders: finalHeaders,
      requestBody: reqBody?.toString() ?? null,
      requestUrl: requestSnapshot?.url ?? finalUrl,
      requestBodySnapshot: requestSnapshot?.body ?? null,
      timestamp: Date.now(),
      isStreaming: true,
      streamType,
      chunks: [],
      finalBody: '',
      streamCompleted: false,
    }
    onStreamingUpdate?.(streamingResponse)

    while (true) {
      const { done, value } = await reader.read()
      if (done) break
      size += value.byteLength
      appendStreamText(parser, decoder.decode(value, { stream: true }))
      const respBody = currentStreamDisplayBody(parser)
      const updated: ResponseData = {
        ...streamingResponse,
        body: respBody,
        duration: Math.round(performance.now() - startTime),
        size,
        chunks: [...parser.chunks],
        mergedText: currentStreamMergedText(parser),
        mergedReasoning: currentStreamMergedReasoning(parser),
        finalBody: respBody,
        isStreaming: true,
        streamCompleted: false,
      }
      onStreamingUpdate?.(updated)
    }

    appendStreamText(parser, decoder.decode())
    finalizeStreamParser(parser)
    const respBody = currentStreamDisplayBody(parser)
    size = new Blob([respBody]).size
    const duration = Math.round(performance.now() - startTime)
    return {
      ...streamingResponse,
      body: respBody,
      duration,
      size,
      chunks: [...parser.chunks],
      mergedText: currentStreamMergedText(parser),
      mergedReasoning: currentStreamMergedReasoning(parser),
      finalBody: respBody,
      isStreaming: false,
      streamCompleted: true,
    }
  }

  let respBody = ''
  let bodyEncoding: ResponseData['bodyEncoding'] = 'text'
  let size = 0

  if (isBinaryContentType(contentTypeHeader)) {
    const buffer = await resp.arrayBuffer()
    respBody = arrayBufferToBase64(buffer)
    bodyEncoding = 'base64'
    size = buffer.byteLength
  } else {
    respBody = await resp.text()
    size = new Blob([respBody]).size
  }
  const duration = Math.round(performance.now() - startTime)

  return {
    status,
    statusText,
    headers: respHeaders,
    body: respBody,
    bodyEncoding,
    contentType: contentTypeHeader,
    duration,
    size,
    url: finalUrl,
    method,
    requestHeaders: finalHeaders,
    requestBody: reqBody?.toString() ?? null,
    requestUrl: requestSnapshot?.url ?? finalUrl,
    requestBodySnapshot: requestSnapshot?.body ?? null,
    timestamp: Date.now(),
  }
}

export interface BackupRequestResult {
  ok: boolean
  status: number
  statusText: string
  body: string
  headers: Record<string, string>
}

export async function sendBackupRequest(options: {
  method: HttpMethod
  url: string
  headers?: Record<string, string>
  body?: string
  timeoutMs?: number
  signal?: AbortSignal
}): Promise<BackupRequestResult> {
  const response = await sendRequest({
    method: options.method,
    url: options.url,
    headers: Object.entries(options.headers ?? {}).map(([key, value]) => ({ key, value, enabled: true })),
    params: [],
    cookies: [],
    autoCarryCookies: false,
    body: {
      type: 'raw',
      raw: options.body ?? '',
      formData: [],
      urlEncoded: [],
      binaryFile: null,
      contentType: 'application/json',
    },
    auth: createDefaultAuthConfig(),
    corsMode: 'cors',
    proxyUrl: '',
    envVars: {},
    timeoutMs: options.timeoutMs ?? 30000,
    signal: options.signal,
  })
  return {
    ok: response.status >= 200 && response.status < 300,
    status: response.status,
    statusText: response.statusText,
    body: response.body,
    headers: response.headers,
  }
}
