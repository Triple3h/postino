import { defineStore } from 'pinia'
import { ref, watch } from 'vue'
import type { ApiConfig, Environment, HistoryEntry, ResponseData, AppSettings, Group, AppState } from '@/types'
import type { ScriptLog } from '@/utils/pre-request'

const STORAGE_KEY = 'apifix_bin_data'
const ENV_KEY = 'apifix_env_vars'
const HISTORY_KEY = 'apifix_history'

function loadFromStorage<T>(key: string, fallback: T): T {
  try {
    const raw = localStorage.getItem(key)
    return raw ? JSON.parse(raw) : fallback
  } catch {
    return fallback
  }
}

const defaultSettings: AppSettings = {
  corsMode: 'cors',
  proxyUrl: 'https://corsproxy.io/?',
  theme: 'light',
  maxHistory: 100,
  autoSave: true,
  fontSize: 13,
}

export const useAppStore = defineStore('app', () => {
  const apis = ref<Record<string, ApiConfig>>(loadFromStorage(STORAGE_KEY, {}).apis || {})
  const groups = ref<Record<string, Group>>(loadFromStorage(STORAGE_KEY, {}).groups || {})
  const groupOrder = ref<string[]>(loadFromStorage(STORAGE_KEY, {}).groupOrder || [])
  const currentApiId = ref<string | null>(null)
  const activeTab = ref<string>('params')
  const response = ref<ResponseData | null>(null)
  const loading = ref(false)
  const environments = ref<Environment[]>(loadFromStorage(ENV_KEY, []))
  const currentEnvId = ref<string | null>(environments.value[0]?.id ?? null)
  const history = ref<HistoryEntry[]>(loadFromStorage(HISTORY_KEY, []))
  const settings = ref<AppSettings>(defaultSettings)
  const expandedFolders = ref<string[]>([])
  const scriptLogs = ref<ScriptLog[]>([])

  // Persist to localStorage on changes
  watch([apis, groups, groupOrder], () => {
    localStorage.setItem(STORAGE_KEY, JSON.stringify({
      apis: apis.value,
      groups: groups.value,
      groupOrder: groupOrder.value,
    }))
  }, { deep: true })

  watch(environments, () => {
    localStorage.setItem(ENV_KEY, JSON.stringify(environments.value))
  }, { deep: true })

  watch(history, () => {
    localStorage.setItem(HISTORY_KEY, JSON.stringify(history.value))
  }, { deep: true })

  function getCurrentApi(): ApiConfig | null {
    if (!currentApiId.value) return null
    return apis.value[currentApiId.value] ?? null
  }

  function updateApi(id: string, updates: Partial<ApiConfig>) {
    const api = apis.value[id]
    if (api) {
      Object.assign(api, updates, { updatedAt: Date.now() })
    }
  }

  function addApi(api: ApiConfig) {
    apis.value[api.id] = api
  }

  function deleteApi(id: string) {
    delete apis.value[id]
    if (currentApiId.value === id) {
      currentApiId.value = null
    }
  }

  function addHistory(entry: HistoryEntry) {
    history.value.unshift(entry)
    if (history.value.length > settings.value.maxHistory) {
      history.value = history.value.slice(0, settings.value.maxHistory)
    }
  }

  function getEnvVariables(): Record<string, string> {
    const env = environments.value.find(e => e.id === currentEnvId.value)
    if (!env) return {}
    const vars: Record<string, string> = {}
    for (const v of env.variables) {
      if (v.enabled) vars[v.key] = v.value
    }
    return vars
  }

  return {
    apis, groups, groupOrder, currentApiId, activeTab,
    response, loading, environments, currentEnvId,
    history, settings, expandedFolders, scriptLogs,
    getCurrentApi, updateApi, addApi, deleteApi,
    addHistory, getEnvVariables,
  }
})
