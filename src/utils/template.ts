import type { Environment } from '@/types'

export type VarScope = 'request' | 'local' | 'remote' | 'global' | 'dynamic'

export interface VarSource {
  scope: VarScope
  name: string
  value: string
}

const DYNAMIC_FUNCTIONS: Record<string, () => string> = {
  $timestamp: () => Math.floor(Date.now() / 1000).toString(),
  $timestampMs: () => Date.now().toString(),
  $guid: () => 'xxxxxxxx-xxxx-4xxx-yxxx-xxxxxxxxxxxx'.replace(/[xy]/g, (c) => {
    const r = Math.random() * 16 | 0
    return (c === 'x' ? r : (r & 0x3 | 0x8)).toString(16)
  }),
  $randomInt: () => Math.floor(Math.random() * 1000).toString(),
  $randomFloat: () => (Math.random() * 100).toFixed(2),
  $randomAlphaNumeric: () => {
    const chars = 'ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789'
    let result = ''
    for (let i = 0; i < 8; i++) result += chars.charAt(Math.floor(Math.random() * chars.length))
    return result
  },
  $randomBoolean: () => Math.random() > 0.5 ? 'true' : 'false',
  $randomColor: () => '#' + Math.floor(Math.random() * 16777215).toString(16).padStart(6, '0'),
  $randomIP: () => Array.from({ length: 4 }, () => Math.floor(Math.random() * 256)).join('.'),
  $randomURL: () => `https://example${Math.floor(Math.random() * 100)}.com`,
  $randomEmail: () => `user${Math.floor(Math.random() * 10000)}@example.com`,
  $randomPhone: () => `1${Array.from({ length: 10 }, () => Math.floor(Math.random() * 10)).join('')}`,
  $date: () => new Date().toISOString().split('T')[0],
  $isoTimestamp: () => new Date().toISOString(),
  $localDatetime: () => new Date().toLocaleString(),
}

export function resolveTemplateVars(
  str: string,
  scopes: {
    requestVars?: Record<string, string>
    localVars?: Record<string, string>
    remoteVars?: Record<string, string>
    globalVars?: Record<string, string>
    environments?: Environment[]
    currentEnvId?: string | null
  },
): string {
  if (typeof str !== 'string') return str

  return str.replace(/\{\{([^}]+)\}\}/g, (match, expr: string) => {
    expr = expr.trim()

    // Dynamic functions: {{$timestamp}}, {{$guid}}, etc.
    if (expr.startsWith('$')) {
      const fn = DYNAMIC_FUNCTIONS[expr]
      if (fn) return fn()
      return match
    }

    // Default value syntax: {{var:default}}
    const colonIdx = expr.indexOf(':')
    const key = colonIdx > 0 ? expr.slice(0, colonIdx).trim() : expr
    const defaultVal = colonIdx > 0 ? expr.slice(colonIdx + 1).trim() : match

    // Four-level scope resolution: request > local > remote > global
    if (scopes.requestVars && key in scopes.requestVars) {
      return scopes.requestVars[key]
    }
    if (scopes.localVars && key in scopes.localVars) {
      return scopes.localVars[key]
    }
    if (scopes.remoteVars && key in scopes.remoteVars) {
      return scopes.remoteVars[key]
    }
    if (scopes.globalVars && key in scopes.globalVars) {
      return scopes.globalVars[key]
    }

    // Current environment variables
    if (scopes.environments && scopes.currentEnvId) {
      const env = scopes.environments.find(e => e.id === scopes.currentEnvId)
      if (env) {
        const v = env.variables.find(v => v.key === key && v.enabled)
        if (v) return v.value
      }
    }

    return defaultVal
  })
}

export function getVarSources(
  key: string,
  scopes: {
    requestVars?: Record<string, string>
    localVars?: Record<string, string>
    remoteVars?: Record<string, string>
    globalVars?: Record<string, string>
    environments?: Environment[]
    currentEnvId?: string | null
  },
): VarSource[] {
  const sources: VarSource[] = []

  if (scopes.requestVars && key in scopes.requestVars) {
    sources.push({ scope: 'request', name: key, value: scopes.requestVars[key] })
  }
  if (scopes.localVars && key in scopes.localVars) {
    sources.push({ scope: 'local', name: key, value: scopes.localVars[key] })
  }
  if (scopes.remoteVars && key in scopes.remoteVars) {
    sources.push({ scope: 'remote', name: key, value: scopes.remoteVars[key] })
  }
  if (scopes.globalVars && key in scopes.globalVars) {
    sources.push({ scope: 'global', name: key, value: scopes.globalVars[key] })
  }

  if (scopes.environments) {
    for (const env of scopes.environments) {
      const v = env.variables.find(v => v.key === key && v.enabled)
      if (v) {
        sources.push({ scope: 'remote', name: `${env.name}.${key}`, value: v.value })
      }
    }
  }

  if (key.startsWith('$') && key in DYNAMIC_FUNCTIONS) {
    sources.push({ scope: 'dynamic', name: key, value: DYNAMIC_FUNCTIONS[key]() })
  }

  return sources
}
