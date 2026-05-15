import type { ApiConfig, KvPair } from '@/types'

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

export function generatePostmanCollection(apis: ApiConfig[], name: string = 'API Fox Lite Export'): string {
  const collection = {
    info: {
      name,
      schema: 'https://schema.getpostman.com/json/collection/v2.1.0/collection.json',
    },
    item: apis.map(api => ({
      name: api.name,
      request: {
        method: api.method,
        header: api.headers.filter(h => h.enabled).map(h => ({ key: h.key, value: h.value })),
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
      },
    })),
  }

  return JSON.stringify(collection, null, 2)
}

export function generateMarkdownDoc(api: ApiConfig): string {
  const lines: string[] = []
  lines.push(`## ${api.name}`)
  lines.push('')
  lines.push(`**${api.method}** \`${api.url}\``)
  lines.push('')

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

function resolveValue(value: string, envVars: Record<string, string>): string {
  return value.replace(/\{\{(\w+)\}\}/g, (_, key) => envVars[key] ?? `{{${key}}}`)
}