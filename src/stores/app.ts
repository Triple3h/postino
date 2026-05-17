import { defineStore } from 'pinia'
import { ref, shallowRef } from 'vue'
import type { ApiConfig, Category, Environment, HistoryEntry, InterfaceNode, Module as ApiModule, ResponseData, AppSettings, Group } from '@/types'
import type { ScriptLog, ScriptTestResult, ScriptVisualization } from '@/utils/pre-request'
import { db } from '@/db'
import { derivePlannedWorkspaceModel, useWorkspaceStore } from '@/stores/workspace'
import { DEFAULT_SHORTCUTS } from '@/utils/shortcuts'
import { createDefaultAuthConfig, normalizeAuthConfig } from '@/utils/auth'

const defaultSettings: AppSettings = {
  corsMode: 'cors',
  proxyUrl: 'https://corsproxy.io/?',
  theme: 'system',
  maxHistory: 100,
  autoSave: true,
  fontSize: 13,
  customShortcuts: { ...DEFAULT_SHORTCUTS },
}

function defaultAuth(): ApiConfig['auth'] {
  return createDefaultAuthConfig()
}

function defaultBody(raw = '', contentType = ''): ApiConfig['body'] {
  return {
    type: raw ? (contentType.includes('json') ? 'json' : 'raw') : 'none',
    raw,
    formData: [],
    urlEncoded: [],
    binaryFile: null,
    contentType,
  }
}

function starterApi(input: Pick<ApiConfig, 'id' | 'name' | 'method' | 'url'> & Partial<ApiConfig>, now: number): ApiConfig {
  return {
    id: input.id,
    name: input.name,
    description: input.description || '',
    method: input.method,
    url: input.url,
    headers: input.headers || [],
    params: input.params || [],
    cookies: input.cookies || [],
    body: input.body || defaultBody(),
    auth: normalizeAuthConfig(input.auth),
    requestVariables: input.requestVariables || [],
    preRequestScript: input.preRequestScript || '',
    postRequestScript: input.postRequestScript || '',
    folder: input.folder ?? null,
    createdAt: now,
    updatedAt: now,
  }
}

async function seedStarterWorkspace(): Promise<void> {
  const now = Date.now()
  const category: Category = {
    id: 'category:starter',
    name: '示例项目',
    color: '#6366f1',
    order: 0,
    createdAt: now,
    updatedAt: now,
  }
  const modules: ApiModule[] = [
    {
      id: 'module:starter-jsonplaceholder',
      categoryId: category.id,
      name: 'JSONPlaceholder',
      type: 'generic',
      description: '免鉴权示例接口，可用于快速体验 GET/POST、变量和 Body 编辑。',
      variables: {
        jsonplaceholderBaseUrl: {
          remote: 'https://jsonplaceholder.typicode.com',
          local: '',
          description: 'JSONPlaceholder 示例服务地址',
        },
      },
      dataSource: null,
      stats: { interfaceCount: 2 },
      moduleType: { mode: 'visual', description: '可视化 API 模块' },
      exportConfig: { format: 'openapi3', autoBackup: false, backupTarget: 'local', teamRole: 'owner', conflictStrategy: 'prompt', permissions: { editSettings: true, editVariables: true, syncDataSource: true, backup: true } },
      meta: { createdAt: now, updatedAt: now, version: '1.0.0' },
      order: 0,
      createdAt: now,
      updatedAt: now,
    },
    {
      id: 'module:starter-weather',
      categoryId: category.id,
      name: '天气 API',
      type: 'generic',
      description: 'Open-Meteo 免鉴权天气接口示例，用于零配置启动体验。',
      variables: {
        weatherBaseUrl: {
          remote: 'https://api.open-meteo.com/v1',
          local: '',
          description: 'Open-Meteo 示例服务地址',
        },
      },
      dataSource: null,
      stats: { interfaceCount: 1 },
      moduleType: { mode: 'visual', description: '可视化 API 模块' },
      exportConfig: { format: 'openapi3', autoBackup: false, backupTarget: 'local', teamRole: 'owner', conflictStrategy: 'prompt', permissions: { editSettings: true, editVariables: true, syncDataSource: true, backup: true } },
      meta: { createdAt: now, updatedAt: now, version: '1.0.0' },
      order: 1,
      createdAt: now,
      updatedAt: now,
    },
  ]
  const apis = [
    starterApi({
      id: 'api:starter-jsonplaceholder-posts',
      name: '获取文章列表',
      description: '获取 JSONPlaceholder 文章列表，默认限制 5 条。',
      method: 'GET',
      url: '{{jsonplaceholderBaseUrl}}/posts',
      params: [{ key: '_limit', value: '5', enabled: true }],
      postRequestScript: 'pm.test("状态码为 200", () => pm.expect(pm.response.code).to.equal(200));\npm.test("响应是数组", () => pm.expect(pm.response.json()).to.be.an("array"));',
    }, now),
    starterApi({
      id: 'api:starter-jsonplaceholder-create-post',
      name: '创建文章',
      description: 'POST JSON Body 示例，可体验 Body 美化/压缩和发送。',
      method: 'POST',
      url: '{{jsonplaceholderBaseUrl}}/posts',
      headers: [{ key: 'Content-Type', value: 'application/json', enabled: true }],
      body: defaultBody(JSON.stringify({ title: 'ApiFix Bin', body: 'Hello from starter project', userId: 1 }, null, 2), 'application/json'),
      postRequestScript: 'pm.test("创建成功", () => pm.expect(pm.response.code).to.be.within(200, 201));',
    }, now),
    starterApi({
      id: 'api:starter-weather-current',
      name: '获取当前天气',
      description: 'Open-Meteo 当前天气示例，无需 API Key。',
      method: 'GET',
      url: '{{weatherBaseUrl}}/forecast',
      params: [
        { key: 'latitude', value: '31.2304', enabled: true, description: '上海纬度' },
        { key: 'longitude', value: '121.4737', enabled: true, description: '上海经度' },
        { key: 'current_weather', value: 'true', enabled: true },
      ],
    }, now),
  ]
  const interfaces: InterfaceNode[] = [
    { id: 'interface:starter-jsonplaceholder-posts', moduleId: modules[0].id, apiId: apis[0].id, nodeType: 'request', parentId: null, name: apis[0].name, method: apis[0].method, url: apis[0].url, order: 0, createdAt: now, updatedAt: now },
    { id: 'interface:starter-jsonplaceholder-create-post', moduleId: modules[0].id, apiId: apis[1].id, nodeType: 'request', parentId: null, name: apis[1].name, method: apis[1].method, url: apis[1].url, order: 1, createdAt: now, updatedAt: now },
    { id: 'interface:starter-weather-current', moduleId: modules[1].id, apiId: apis[2].id, nodeType: 'request', parentId: null, name: apis[2].name, method: apis[2].method, url: apis[2].url, order: 0, createdAt: now, updatedAt: now },
  ]
  const environment: Environment = {
    id: 'env:starter-local',
    name: '本地开发',
    variables: [
      { key: 'jsonplaceholderBaseUrl', value: 'https://jsonplaceholder.typicode.com', enabled: true },
      { key: 'weatherBaseUrl', value: 'https://api.open-meteo.com/v1', enabled: true },
    ],
  }

  await db.transaction('rw', [db.apis, db.environments, db.categories, db.modules, db.interfaces, db.settings], async () => {
    await db.categories.put(category)
    await db.modules.bulkPut(modules)
    await db.interfaces.bulkPut(interfaces)
    await db.apis.bulkPut(apis)
    await db.environments.put(environment)
    await db.settings.put({ key: 'starterSeeded', value: true })
  })
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
  const scriptVisualizations = ref<ScriptVisualization[]>([])
  const scriptTests = ref<ScriptTestResult[]>([])
  const autoCarryCookies = ref(false)
  const requestAbortController = shallowRef<AbortController | null>(null)

  let initialized = false

  async function init(): Promise<void> {
    if (initialized) return
    initialized = true

    try {
      let [apiList, groupList, envList, historyList, settingsList] = await Promise.all([
        db.apis.toArray(),
        db.groups.toArray(),
        db.environments.toArray(),
        db.history.orderBy('timestamp').reverse().toArray(),
        db.settings.toArray(),
      ])

      const starterSeeded = settingsList.some(item => item.key === 'starterSeeded' && item.value)
      const [categoryCount, moduleCount, interfaceCount] = await Promise.all([
        db.categories.count(),
        db.modules.count(),
        db.interfaces.count(),
      ])
      if (!starterSeeded && apiList.length === 0 && envList.length === 0 && groupList.length === 0 && categoryCount === 0 && moduleCount === 0 && interfaceCount === 0) {
        await seedStarterWorkspace()
        ;[apiList, groupList, envList, historyList, settingsList] = await Promise.all([
          db.apis.toArray(),
          db.groups.toArray(),
          db.environments.toArray(),
          db.history.orderBy('timestamp').reverse().toArray(),
          db.settings.toArray(),
        ])
      }

      const apiMap: Record<string, ApiConfig> = {}
      for (const api of apiList) {
        api.auth = normalizeAuthConfig(api.auth)
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
      if (updates.auth) merged.auth = normalizeAuthConfig(updates.auth)
      Object.assign(api, merged)
      db.apis.update(id, merged).catch(e => console.error('Failed to update API in IndexedDB:', e))
      useWorkspaceStore().syncInterfaceFromApi(api).catch(e => console.error('Failed to sync interface in IndexedDB:', e))
    }
  }

  async function addApi(api: ApiConfig, moduleId?: string | null, parentId: string | null = null): Promise<void> {
    api.auth = normalizeAuthConfig(api.auth)
    apis.value[api.id] = api
    try {
      await db.apis.put(api)
      await useWorkspaceStore().addInterfaceForApi(api, moduleId ?? undefined, parentId)
    } catch (e) {
      console.error('Failed to add API to IndexedDB:', e)
    }
  }

  function deleteApi(id: string) {
    delete apis.value[id]
    if (currentApiId.value === id) {
      currentApiId.value = null
    }
    db.apis.delete(id).catch(e => console.error('Failed to delete API from IndexedDB:', e))
    useWorkspaceStore().removeInterfacesForApi(id).catch(e => console.error('Failed to delete interface from IndexedDB:', e))
  }

  function addHistory(entry: HistoryEntry) {
    const workspace = useWorkspaceStore()
    const interfaceNode = workspace.interfaces.find(item => item.apiId === entry.apiId)
    const normalized: HistoryEntry = {
      ...entry,
      moduleId: entry.moduleId || interfaceNode?.moduleId,
      interfaceId: entry.interfaceId || interfaceNode?.id,
      starred: entry.starred === undefined ? false : entry.starred,
    }
    history.value.unshift(normalized)
    if (history.value.length > settings.value.maxHistory) {
      const removed = history.value.splice(settings.value.maxHistory)
      const removedIds = removed.map(h => h.id)
      db.history.bulkDelete(removedIds).catch(e => console.error('Failed to delete old history from IndexedDB:', e))
    }
    db.history.add(normalized).catch(e => console.error('Failed to add history to IndexedDB:', e))
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

  async function upsertEnvironment(env: Environment): Promise<void> {
    const idx = environments.value.findIndex(e => e.id === env.id)
    if (idx === -1) {
      environments.value.push(env)
    } else {
      environments.value[idx] = env
    }
    currentEnvId.value = env.id
    await db.environments.put(env)
  }

  async function deleteEnvironment(id: string): Promise<void> {
    environments.value = environments.value.filter(e => e.id !== id)
    if (currentEnvId.value === id) {
      currentEnvId.value = environments.value[0]?.id ?? null
    }
    await db.environments.delete(id)
  }

  function getEnvVariables(): Record<string, string> {
    const env = environments.value.find(e => e.id === currentEnvId.value)
    const vars: Record<string, string> = {}

    if (env) {
      for (const v of env.variables) {
        if (v.enabled) vars[v.key] = v.value
      }
    }

    const workspace = useWorkspaceStore()
    const interfaceNode = workspace.interfaces.find(item => item.apiId === currentApiId.value)
    const module = interfaceNode ? workspace.modules.find(item => item.id === interfaceNode.moduleId) : null
    for (const [key, value] of Object.entries(module?.variables ?? {})) {
      if (value.remote) vars[key] = value.remote
      if (currentEnvId.value && value.environmentValues?.[currentEnvId.value]) {
        vars[key] = value.environmentValues[currentEnvId.value]
      }
      if (value.local) vars[key] = value.local
    }
    for (const item of workspace.modules) {
      for (const [key, value] of Object.entries(item.variables ?? {})) {
        const scopedValue = (currentEnvId.value && value.environmentValues?.[currentEnvId.value])
          || value.local
          || value.remote
        if (scopedValue) vars[`${item.name}.${key}`] = scopedValue
      }
    }
    const currentApi = currentApiId.value ? apis.value[currentApiId.value] : null
    for (const item of currentApi?.requestVariables ?? []) {
      if (item.enabled && item.key) vars[item.key] = item.value
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

  function setRequestAbortController(controller: AbortController | null): void {
    requestAbortController.value = controller
  }

  function clearRequestAbortController(controller?: AbortController): void {
    if (!controller || requestAbortController.value === controller) {
      requestAbortController.value = null
    }
  }

  function cancelCurrentRequest(): void {
    const controller = requestAbortController.value
    if (!controller || controller.signal.aborted) return
    controller.abort(new DOMException('Request cancelled', 'AbortError'))
  }

  return {
    apis, groups, groupOrder, currentApiId, activeTab,
    response, loading, environments, currentEnvId,
    history, settings, expandedFolders, scriptLogs, scriptVisualizations, scriptTests, autoCarryCookies,
    requestAbortController,
    init, getCurrentApi, updateApi, addApi, deleteApi,
    addHistory, toggleStar, deleteHistoryEntry, clearHistory,
    upsertEnvironment, deleteEnvironment,
    getEnvVariables, saveGroupOrder, saveSettings,
    setRequestAbortController, clearRequestAbortController, cancelCurrentRequest,
  }
})
