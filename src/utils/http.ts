import type { HttpMethod, ResponseData, ApiConfig, AuthConfig, BodyConfig, KvPair } from '@/types'

export interface RequestOptions {
  method: HttpMethod
  url: string
  headers: KvPair[]
  params: KvPair[]
  body: BodyConfig
  auth: AuthConfig
  corsMode: 'cors' | 'proxy' | 'no-cors'
  proxyUrl: string
  envVars: Record<string, string>
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

function buildUrl(baseUrl: string, params: KvPair[], auth: AuthConfig, envVars: Record<string, string>): string {
  let url = resolveValue(baseUrl, envVars)

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
  return value.replace(/\{\{(\w+)\}\}/g, (_, key) => envVars[key] ?? `{{${key}}}`)
}

export async function sendRequest(options: RequestOptions): Promise<ResponseData> {
  const { method, url, headers, params, body, auth, corsMode, proxyUrl, envVars } = options

  const finalUrl = buildUrl(url, params, auth, envVars)
  const finalHeaders = buildHeaders(headers, auth, envVars)
  const { body: reqBody, contentType } = buildBody(body, envVars)

  if (contentType && !finalHeaders['Content-Type']) {
    finalHeaders['Content-Type'] = contentType
  }

  let fetchUrl = finalUrl
  const fetchOptions: RequestInit = {
    method,
    headers: finalHeaders,
    body: method !== 'GET' && method !== 'HEAD' ? reqBody : undefined,
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
  let size = 0

  try {
    const resp = await fetch(fetchUrl, fetchOptions)
    const duration = Math.round(performance.now() - startTime)

    status = resp.status
    statusText = resp.statusText

    resp.headers.forEach((v, k) => {
      respHeaders[k] = v
    })

    respBody = await resp.text()
    size = new Blob([respBody]).size

    return {
      status,
      statusText,
      headers: respHeaders,
      body: respBody,
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
  }
}
