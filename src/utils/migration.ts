import type { ApiConfig, HttpMethod, KvPair, BodyConfig, Environment, EnvVariable, HistoryEntry } from '@/types'
import { loadFromStorage } from './storage'

const LEGACY_KEYS = {
  DATA: 'apifix_bin_data',
  ENV: 'apifix_env_vars',
  HISTORY: 'apifix_history',
} as const

function generateId(): string {
  return Date.now().toString(36) + Math.random().toString(36).slice(2, 8)
}

interface LegacyApi {
  id?: string
  name?: string
  method?: string
  url?: string
  headers?: Array<{ key: string; value: string; enabled?: boolean; description?: string }>
  params?: Array<{ key: string; value: string; enabled?: boolean; description?: string }>
  bodyType?: string
  body?: string
  formdata?: Array<{ key: string; value: string; enabled?: boolean }>
  urlencoded?: Array<{ key: string; value: string; enabled?: boolean }>
  authType?: string
  bearerToken?: string
  basicUser?: string
  basicPass?: string
  preRequestScript?: string
  group?: string
}

interface LegacyData {
  apis?: Record<string, LegacyApi>
  groups?: Record<string, string[]>
  groupOrder?: string[]
}

interface LegacyEnvVar {
  key: string
  value: string
  enabled?: boolean
}

interface LegacyHistoryEntry {
  id?: string
  apiId?: string
  method?: string
  url?: string
  status?: number
  statusText?: string
  duration?: number
  timestamp?: number
}

export interface MigrationResult {
  apis: Record<string, ApiConfig>
  groups: Record<string, { name: string; apiIds: string[] }>
  groupOrder: string[]
  environments: Environment[]
  history: HistoryEntry[]
  migrated: boolean
  counts: {
    apis: number
    groups: number
    envVars: number
    historyEntries: number
  }
}

function convertLegacyApi(legacy: LegacyApi): ApiConfig {
  const headers: KvPair[] = (legacy.headers || []).map(h => ({
    key: h.key || '',
    value: h.value || '',
    enabled: h.enabled !== false,
    description: h.description,
  }))

  const params: KvPair[] = (legacy.params || []).map(p => ({
    key: p.key || '',
    value: p.value || '',
    enabled: p.enabled !== false,
    description: p.description,
  }))

  let body: BodyConfig = { type: 'none', raw: '', formData: [], urlEncoded: [], binaryFile: null, contentType: '' }
  switch (legacy.bodyType) {
    case 'json':
      body = { type: 'json', raw: legacy.body || '', formData: [], urlEncoded: [], binaryFile: null, contentType: 'application/json' }
      break
    case 'text':
    case 'raw':
      body = { type: 'raw', raw: legacy.body || '', formData: [], urlEncoded: [], binaryFile: null, contentType: 'text/plain' }
      break
    case 'formdata':
      body = {
        type: 'form',
        raw: '',
        formData: (legacy.formdata || []).map(f => ({ key: f.key, value: f.value, enabled: f.enabled !== false })),
        urlEncoded: [],
        binaryFile: null,
        contentType: '',
      }
      break
    case 'urlencoded':
      body = {
        type: 'urlencoded',
        raw: '',
        formData: [],
        urlEncoded: (legacy.urlencoded || []).map(f => ({ key: f.key, value: f.value, enabled: f.enabled !== false })),
        binaryFile: null,
        contentType: 'application/x-www-form-urlencoded',
      }
      break
  }

  return {
    id: legacy.id || generateId(),
    name: legacy.name || 'Untitled Request',
    method: (legacy.method || 'GET').toUpperCase() as HttpMethod,
    url: legacy.url || '',
    headers,
    params,
    cookies: [],
    body,
    auth: {
      type: (legacy.authType as any) || 'none',
      bearerToken: legacy.bearerToken || '',
      basicUsername: legacy.basicUser || '',
      basicPassword: legacy.basicPass || '',
      apiKeyName: '',
      apiKeyValue: '',
      apiKeyIn: 'header',
    },
    preRequestScript: legacy.preRequestScript || '',
    postRequestScript: '',
    folder: null,
    createdAt: Date.now(),
    updatedAt: Date.now(),
  }
}

export function migrateLegacyData(): MigrationResult {
  const result: MigrationResult = {
    apis: {},
    groups: {},
    groupOrder: [],
    environments: [],
    history: [],
    migrated: false,
    counts: { apis: 0, groups: 0, envVars: 0, historyEntries: 0 },
  }

  // Migrate APIs and groups
  const legacyData = loadFromStorage<LegacyData>(LEGACY_KEYS.DATA, {} as LegacyData)
  if (legacyData.apis && Object.keys(legacyData.apis).length > 0) {
    result.migrated = true
    for (const [id, legacyApi] of Object.entries(legacyData.apis)) {
      const api = convertLegacyApi(legacyApi)
      result.apis[api.id] = api
      result.counts.apis++
    }

    // Migrate groups
    if (legacyData.groups) {
      for (const [groupName, apiIds] of Object.entries(legacyData.groups)) {
        const mappedIds = (apiIds as string[]).map(oldId => {
          const legacyApi = legacyData.apis?.[oldId]
          return legacyApi ? (legacyApi.id || oldId) : oldId
        })
        result.groups[groupName] = { name: groupName, apiIds: mappedIds }
        result.counts.groups++
      }
    }

    if (legacyData.groupOrder) {
      result.groupOrder = legacyData.groupOrder
    }
  }

  // Migrate environment variables
  const legacyEnv = loadFromStorage<LegacyEnvVar[]>(LEGACY_KEYS.ENV, [])
  if (legacyEnv.length > 0) {
    result.migrated = true
    const env: Environment = {
      id: generateId(),
      name: '默认环境',
      variables: legacyEnv.map(v => ({
        key: v.key,
        value: v.value,
        enabled: v.enabled !== false,
      })),
    }
    result.environments.push(env)
    result.counts.envVars = env.variables.length
  }

  // Migrate history
  const legacyHistory = loadFromStorage<LegacyHistoryEntry[]>(LEGACY_KEYS.HISTORY, [])
  if (legacyHistory.length > 0) {
    result.migrated = true
    result.history = legacyHistory.map(h => ({
      id: h.id || generateId(),
      apiId: h.apiId || '',
      method: (h.method || 'GET') as HttpMethod,
      url: h.url || '',
      status: h.status || 0,
      statusText: h.statusText || '',
      duration: h.duration || 0,
      timestamp: h.timestamp || Date.now(),
      requestHeaders: {},
      requestBody: null,
      responseSize: 0,
    }))
    result.counts.historyEntries = result.history.length
  }

  return result
}

export function hasLegacyData(): boolean {
  try {
    const data = localStorage.getItem(LEGACY_KEYS.DATA)
    const env = localStorage.getItem(LEGACY_KEYS.ENV)
    const history = localStorage.getItem(LEGACY_KEYS.HISTORY)
    return !!(data || env || history)
  } catch {
    return false
  }
}
