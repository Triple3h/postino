import type { HttpMethod, ResponseData, ApiConfig, AuthConfig, BodyConfig, KvPair, CookieItem } from '@/types'
import { resolveTemplateVars } from '@/utils/template'
import { arrayBufferToBase64, isBinaryContentType } from '@/utils/binary-response'

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
}): Promise<ResponseData> {
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
          timestamp: Date.now(),
        })
      }
    )
  })
}

const PROXY_URLS = {
  'corsproxy.io': 'https://corsproxy.io/?',
  'allorigins': 'https://api.allorigins.win/raw?url=',
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
          fd.append(resolveValue(item.key, envVars), resolveValue(item.value, envVars))
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

function resolveValue(value: string, envVars: Record<string, string>): string {
  return resolveTemplateVars(value, { globalVars: envVars })
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
  const { method, url, headers, params, cookies, autoCarryCookies, body, auth, corsMode, proxyUrl, envVars, timeoutMs, followRedirects } = options

  const finalUrl = buildUrl(url, params, auth, envVars)
  const finalHeaders = buildHeaders(headers, auth, envVars)
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
    const extBody: any = { method, url: finalUrl, headers: finalHeaders, autoCarryCookies, timeoutMs, followRedirects }
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
    return sendRequestViaExtension(extBody)
  }

  let fetchUrl = finalUrl
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
  const controller = typeof AbortController !== 'undefined' && timeoutMs && timeoutMs > 0 ? new AbortController() : null
  let timeoutId: ReturnType<typeof setTimeout> | undefined
  if (controller) {
    fetchOptions.signal = controller.signal
    timeoutId = setTimeout(() => controller.abort(), timeoutMs)
  }

  try {
    const resp = await fetch(fetchUrl, fetchOptions)
    const duration = Math.round(performance.now() - startTime)

    status = resp.status
    statusText = resp.statusText

    resp.headers.forEach((v, k) => {
      respHeaders[k] = v
    })

    const contentTypeHeader = resp.headers.get('content-type') || ''
    if (isBinaryContentType(contentTypeHeader)) {
      const buffer = await resp.arrayBuffer()
      respBody = arrayBufferToBase64(buffer)
      bodyEncoding = 'base64'
      size = buffer.byteLength
    } else {
      respBody = await resp.text()
      size = new Blob([respBody]).size
    }

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
      timestamp: Date.now(),
    }
  } catch (err: any) {
    const duration = Math.round(performance.now() - startTime)
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
      timestamp: Date.now(),
    }
  } finally {
    if (timeoutId) clearTimeout(timeoutId)
  }
}
