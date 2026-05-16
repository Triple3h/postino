import { defineStore } from 'pinia'
import { ref } from 'vue'
import type { ApiConfig, Environment, HistoryEntry, ResponseData, AppSettings, Group } from '@/types'
import type { ScriptLog } from '@/utils/pre-request'
import { db } from '@/db'
import { derivePlannedWorkspaceModel } from '@/stores/workspace'

const defaultSettings: AppSettings = {
  corsMode: 'cors',
  proxyUrl: 'https://corsproxy.io/?',
  theme: 'light',
  maxHistory: 100,
  autoSave: true,
  fontSize: 13,
}

export const useAppStore = defineStore('app', () => {
  const apis = ref<Record<string, ApiConfig>>({})
  const groups = ref<Record<string, Group>>({})
  const groupOrder = ref<string[]>([])
  const currentApiId = ref<string | null>(null)
  const activeTab = ref<string>('params')
  const response = ref<ResponseData | null>(null)
  const loading = ref(false)
  const environments = ref<Environment[]>([])
  const currentEnvId = ref<string | null>(null)
  const history = ref<HistoryEntry[]>([])
  const settings = ref<AppSettings>({ ...defaultSettings })
  const expandedFolders = ref<string[]>([])
  const scriptLogs = ref<ScriptLog[]>([])
  const autoCarryCookies = ref(false)

  let initialized = false

  async function init(): Promise<void> {
    if (initialized) return
    initialized = true

    try {
      const [apiList, groupList, envList, historyList, settingsList] = await Promise.all([
        db.apis.toArray(),
        db.groups.toArray(),
        db.environments.toArray(),
        db.history.orderBy('timestamp').reverse().toArray(),
        db.settings.toArray(),
      ])

      const apiMap: Record<string, ApiConfig> = {}
      for (const api of apiList) {
        apiMap[api.id] = api
      }
      apis.value = apiMap

      const groupMap: Record<string, Group> = {}
      for (const g of groupList) {
        groupMap[g.name] = g.group
      }
      groups.value = groupMap

      environments.value = envList
      currentEnvId.value = envList[0]?.id ?? null
      history.value = historyList

      const loadedSettings: Partial<AppSettings> = {}
      for (const s of settingsList) {
        loadedSettings[s.key as keyof AppSettings] = s.value
      }
      settings.value = { ...defaultSettings, ...loadedSettings }

      const go = settingsList.find(s => s.key === 'groupOrder')
      if (go) {
        groupOrder.value = go.value
      }

      const plannedCount = await db.categories.count()
      if (plannedCount === 0 && Object.keys(apiMap).length > 0) {
        const plannedModel = derivePlannedWorkspaceModel(apiMap, groupMap, groupOrder.value)
        await db.transaction('rw', db.categories, db.modules, db.interfaces, async () => {
          await db.categories.bulkPut(plannedModel.categories)
          await db.modules.bulkPut(plannedModel.modules)
          await db.interfaces.bulkPut(plannedModel.interfaces)
        })
      }
    } catch (e) {
      console.error('Failed to load from IndexedDB:', e)
    }
  }

  function getCurrentApi(): ApiConfig | null {
    if (!currentApiId.value) return null
    return apis.value[currentApiId.value] ?? null
  }

  function updateApi(id: string, updates: Partial<ApiConfig>) {
    const api = apis.value[id]
    if (api) {
      const merged = { ...updates, updatedAt: Date.now() }
      Object.assign(api, merged)
      db.apis.update(id, merged).catch(e => console.error('Failed to update API in IndexedDB:', e))
    }
  }

  function addApi(api: ApiConfig) {
    apis.value[api.id] = api
    db.apis.add(api).catch(e => console.error('Failed to add API to IndexedDB:', e))
  }

  function deleteApi(id: string) {
    delete apis.value[id]
    if (currentApiId.value === id) {
      currentApiId.value = null
    }
    db.apis.delete(id).catch(e => console.error('Failed to delete API from IndexedDB:', e))
  }

  function addHistory(entry: HistoryEntry) {
    if (entry.starred === undefined) entry.starred = false
    history.value.unshift(entry)
    if (history.value.length > settings.value.maxHistory) {
      const removed = history.value.splice(settings.value.maxHistory)
      const removedIds = removed.map(h => h.id)
      db.history.bulkDelete(removedIds).catch(e => console.error('Failed to delete old history from IndexedDB:', e))
    }
    db.history.add(entry).catch(e => console.error('Failed to add history to IndexedDB:', e))
  }

  function toggleStar(id: string) {
    const entry = history.value.find(h => h.id === id)
    if (!entry) return
    entry.starred = !entry.starred
    db.history.update(id, { starred: entry.starred }).catch(e => console.error('Failed to update star in IndexedDB:', e))
  }

  function deleteHistoryEntry(id: string) {
    const idx = history.value.findIndex(h => h.id === id)
    if (idx !== -1) history.value.splice(idx, 1)
    db.history.delete(id).catch(e => console.error('Failed to delete history entry from IndexedDB:', e))
  }

  function clearHistory() {
    history.value = []
    db.history.clear().catch(e => console.error('Failed to clear history in IndexedDB:', e))
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

  async function saveGroupOrder(): Promise<void> {
    await db.settings.put({ key: 'groupOrder', value: groupOrder.value })
  }

  async function saveSettings(): Promise<void> {
    const entries = Object.entries(settings.value).map(([key, value]) => ({ key, value }))
    await db.settings.bulkPut(entries)
  }

  return {
    apis, groups, groupOrder, currentApiId, activeTab,
    response, loading, environments, currentEnvId,
    history, settings, expandedFolders, scriptLogs, autoCarryCookies,
    init, getCurrentApi, updateApi, addApi, deleteApi,
    addHistory, toggleStar, deleteHistoryEntry, clearHistory,
    getEnvVariables, saveGroupOrder, saveSettings,
  }
})
