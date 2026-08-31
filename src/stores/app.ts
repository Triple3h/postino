import { defineStore } from 'pinia'
import { computed, ref, shallowRef } from 'vue'
import type { ApiConfig, Category, CollectionExportDocument, CollectionVariable, Environment, HistoryEntry, InterfaceNode, Module as ApiModule, ResponseData, AppSettings, Group } from '@/types'
import type { ScriptLog, ScriptTestResult, ScriptVisualization } from '@/utils/pre-request'
import type { ImportedPostmanTree } from '@/utils/import'
import { db, plainPut } from '@/db'
import { useDialog } from '@/composables/useDialog'
import { derivePlannedWorkspaceModel, useWorkspaceStore } from '@/stores/workspace'
import { DEFAULT_SHORTCUTS } from '@/utils/shortcuts'
import { createDefaultAuthConfig, normalizeAuthConfig } from '@/utils/auth'
import { collectionFromModule } from '@/utils/collection-migration'
import { resolveVariableResolutions, type VariableResolution } from '@/utils/variables'

const defaultSettings: AppSettings = {
  corsMode: 'cors',
  proxyUrl: 'https://corsproxy.io/?',
  theme: 'system',
  accent: 'indigo',
  expandNavigation: false,
  sidebarOnLeft: true,
  editorLayout: 'vertical',
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
      body: defaultBody(JSON.stringify({ title: 'Postino', body: 'Hello from starter project', userId: 1 }, null, 2), 'application/json'),
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
    { id: 'interface:starter-jsonplaceholder-posts', moduleId: modules[0].id, collectionId: modules[0].id, apiId: apis[0].id, nodeType: 'request', parentId: null, name: apis[0].name, method: apis[0].method, url: apis[0].url, order: 0, createdAt: now, updatedAt: now },
    { id: 'interface:starter-jsonplaceholder-create-post', moduleId: modules[0].id, collectionId: modules[0].id, apiId: apis[1].id, nodeType: 'request', parentId: null, name: apis[1].name, method: apis[1].method, url: apis[1].url, order: 1, createdAt: now, updatedAt: now },
    { id: 'interface:starter-weather-current', moduleId: modules[1].id, collectionId: modules[1].id, apiId: apis[2].id, nodeType: 'request', parentId: null, name: apis[2].name, method: apis[2].method, url: apis[2].url, order: 0, createdAt: now, updatedAt: now },
  ]
  const environment: Environment = {
    id: 'env:starter-local',
    name: '本地开发',
    collectionId: 'global',
    variables: [
      { key: 'jsonplaceholderBaseUrl', value: 'https://jsonplaceholder.typicode.com', enabled: true },
      { key: 'weatherBaseUrl', value: 'https://api.open-meteo.com/v1', enabled: true },
    ],
  }
  // 每个示例集合自带独立环境(Phase 2 起按集合解析)
  const collectionEnvironments: Environment[] = [
    {
      id: 'env:starter-jsonplaceholder-local',
      name: 'local',
      collectionId: modules[0].id,
      variables: [{ key: 'jsonplaceholderBaseUrl', value: 'https://jsonplaceholder.typicode.com', enabled: true }],
    },
    {
      id: 'env:starter-weather-local',
      name: 'local',
      collectionId: modules[1].id,
      variables: [{ key: 'weatherBaseUrl', value: 'https://api.open-meteo.com/v1', enabled: true }],
    },
  ]
  const collections = modules.map((module, index) => ({
    ...collectionFromModule(module, category, index),
    selectedEnvId: collectionEnvironments[index].id,
  }))

  await db.transaction('rw', [db.apis, db.environments, db.categories, db.modules, db.interfaces, db.collections, db.settings], async () => {
    await db.categories.put(category)
    await db.modules.bulkPut(modules)
    await db.interfaces.bulkPut(interfaces)
    await db.collections.bulkPut(collections)
    await db.apis.bulkPut(apis)
    await db.environments.bulkPut([environment, ...collectionEnvironments])
    await db.settings.put({ key: 'starterSeeded', value: true })
  })
}

/** 打开标签页的持久化 settings 键(不走 AppSettings,避免污染设置对象) */
const OPEN_TABS_SETTINGS_KEY = 'openTabIds'
const ACTIVE_TAB_SETTINGS_KEY = 'activeTabId'

export interface PropertyTabTarget {
  type: 'collection' | 'folder'
  id: string
}

interface PropertyTabHandler {
  save: () => Promise<boolean>
  discard: () => void
}

export function propertyTabKey(target: PropertyTabTarget): string {
  return `${target.type}:${target.id}`
}

/** 每个标签页私有的编辑态(切换标签时暂存/恢复) */
interface TabEditorState {
  response: ResponseData | null
  scriptLogs: ScriptLog[]
  scriptVisualizations: ScriptVisualization[]
  scriptTests: ScriptTestResult[]
}

/** 请求内容基线:打开标签/保存成功时拍快照,dirty = 当前内容与基线不一致 */
interface ApiSnapshot {
  /** 剥离 updatedAt 后的 JSON(逐键比较用) */
  json: string
  /** 拍快照时的完整副本(放弃修改时回滚用) */
  baseline: ApiConfig
}

/** 快照 JSON:updatedAt 每次编辑都会刷新,归一成常量再比较 */
function apiSnapshotJson(api: ApiConfig): string {
  return JSON.stringify({ ...api, updatedAt: 0 })
}

function cloneApi(api: ApiConfig): ApiConfig {
  // 必须转纯对象:reactive Proxy 无法被 IndexedDB 结构化克隆(DataCloneError)
  return JSON.parse(JSON.stringify(api)) as ApiConfig
}

export const useAppStore = defineStore('app', () => {
  const apis = ref<Record<string, ApiConfig>>({})
  const groups = ref<Record<string, Group>>({})
  const groupOrder = ref<string[]>([])
  const currentApiId = ref<string | null>(null)
  /** 已打开的请求标签(apiId 顺序即标签顺序);currentApiId 即当前激活标签 */
  const openTabs = ref<string[]>([])
  /** 集合/文件夹属性页与请求共用顶部标签栏。 */
  const openPropertyTabs = ref<PropertyTabTarget[]>([])
  const activePropertyTabKey = ref<string | null>(null)
  const propertyTabDirty = ref<Record<string, boolean>>({})
  /** 新建未保存请求的预期落点(SaveRequestModal 预选用) */
  const pendingSaveTarget = ref<{ moduleId?: string; parentId?: string | null } | null>(null)
  const activeTab = ref<string>('params')
  const response = ref<ResponseData | null>(null)
  const loading = ref(false)
  /** 非激活标签的编辑态暂存(运行时,不持久化) */
  const tabStates: Record<string, TabEditorState> = {}
  /** 每个已打开标签的请求内容基线(运行时,不持久化) */
  const apiSnapshots: Record<string, ApiSnapshot> = {}
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
  const propertyTabHandlers = new Map<string, PropertyTabHandler>()

  const activePropertyTarget = computed(() => openPropertyTabs.value.find(
    target => propertyTabKey(target) === activePropertyTabKey.value,
  ) ?? null)

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
        // 标签页状态单独恢复,不进 AppSettings
        if (s.key === OPEN_TABS_SETTINGS_KEY || s.key === ACTIVE_TAB_SETTINGS_KEY) continue
        loadedSettings[s.key as keyof AppSettings] = s.value
      }
      settings.value = { ...defaultSettings, ...loadedSettings }

      // 恢复上次的打开标签(仅保留仍存在的请求)
      const savedTabs = settingsList.find(s => s.key === OPEN_TABS_SETTINGS_KEY)?.value
      const savedActive = settingsList.find(s => s.key === ACTIVE_TAB_SETTINGS_KEY)?.value
      if (Array.isArray(savedTabs)) {
        openTabs.value = savedTabs.filter(id => typeof id === 'string' && Boolean(apis.value[id]))
        for (const id of openTabs.value) markApiSnapshot(id)
        const active = typeof savedActive === 'string' && openTabs.value.includes(savedActive)
          ? savedActive
          : openTabs.value[0] ?? null
        if (active) currentApiId.value = active
      }

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

  // ─── 多标签管理(currentApiId 即当前激活标签)───

  async function persistTabs(): Promise<void> {
    try {
      await db.settings.bulkPut([
        { key: OPEN_TABS_SETTINGS_KEY, value: [...openTabs.value] },
        { key: ACTIVE_TAB_SETTINGS_KEY, value: currentApiId.value },
      ])
    } catch (e) {
      console.error('Failed to persist open tabs:', e)
    }
  }

  /** 切换激活标签,并按标签暂存/恢复各自的响应与脚本产物 */
  function activateTab(apiId: string): void {
    if (currentApiId.value === apiId && !activePropertyTabKey.value) return
    const previousId = currentApiId.value
    if (previousId) {
      tabStates[previousId] = {
        response: response.value,
        scriptLogs: scriptLogs.value,
        scriptVisualizations: scriptVisualizations.value,
        scriptTests: scriptTests.value,
      }
    }
    currentApiId.value = apiId
    activePropertyTabKey.value = null
    const next = tabStates[apiId]
    response.value = next?.response ?? null
    scriptLogs.value = next?.scriptLogs ?? []
    scriptVisualizations.value = next?.scriptVisualizations ?? []
    scriptTests.value = next?.scriptTests ?? []
    delete tabStates[apiId]
    void persistTabs()
  }

  function activatePropertyTab(key: string): void {
    if (activePropertyTabKey.value === key) return
    const target = openPropertyTabs.value.find(item => propertyTabKey(item) === key)
    if (!target) return
    const previousId = currentApiId.value
    if (previousId) {
      tabStates[previousId] = {
        response: response.value,
        scriptLogs: scriptLogs.value,
        scriptVisualizations: scriptVisualizations.value,
        scriptTests: scriptTests.value,
      }
    }
    currentApiId.value = null
    activePropertyTabKey.value = key
    response.value = null
    scriptLogs.value = []
    scriptVisualizations.value = []
    scriptTests.value = []
    void persistTabs()
  }

  function openPropertiesInTab(target: PropertyTabTarget): void {
    const key = propertyTabKey(target)
    if (!openPropertyTabs.value.some(item => propertyTabKey(item) === key)) {
      openPropertyTabs.value.push({ ...target })
    }
    activatePropertyTab(key)
  }

  function registerPropertyTabHandler(key: string, handler: PropertyTabHandler): () => void {
    propertyTabHandlers.set(key, handler)
    return () => propertyTabHandlers.delete(key)
  }

  function setPropertyTabDirty(key: string, dirty: boolean): void {
    propertyTabDirty.value = { ...propertyTabDirty.value, [key]: dirty }
  }

  async function saveActivePropertyTab(): Promise<boolean> {
    const key = activePropertyTabKey.value
    if (!key) return false
    return await propertyTabHandlers.get(key)?.save() ?? false
  }

  function activateEditorTab(key: string): void {
    if (key.startsWith('api:')) activateTab(key.slice(4))
    else activatePropertyTab(key.slice('properties:'.length))
  }

  function editorTabKeys(): string[] {
    return [
      ...openTabs.value.map(id => `api:${id}`),
      ...openPropertyTabs.value.map(target => `properties:${propertyTabKey(target)}`),
    ]
  }

  async function closePropertyTab(key: string): Promise<boolean> {
    const index = openPropertyTabs.value.findIndex(item => propertyTabKey(item) === key)
    if (index === -1) return true
    if (propertyTabDirty.value[key]) {
      const target = openPropertyTabs.value[index]
      const workspace = useWorkspaceStore()
      const name = target.type === 'collection'
        ? workspace.collections.find(item => item.id === target.id)?.name
        : workspace.interfaces.find(item => item.id === target.id)?.name
      const choice = await useDialog().confirmTertiary({
        title: '未保存的修改',
        message: `「${name ?? '属性配置'}」有未保存的修改，关闭前要保存吗？`,
        confirmText: '保存并关闭',
        tertiaryText: '不保存',
        cancelText: '取消',
      })
      if (choice === 'cancel') return false
      if (choice === 'confirm') {
        const saved = await propertyTabHandlers.get(key)?.save()
        if (!saved) return false
      } else {
        propertyTabHandlers.get(key)?.discard()
      }
    }

    const allKeys = editorTabKeys()
    const closedEditorIndex = allKeys.indexOf(`properties:${key}`)
    openPropertyTabs.value.splice(index, 1)
    delete propertyTabDirty.value[key]
    if (activePropertyTabKey.value === key) {
      activePropertyTabKey.value = null
      const remaining = editorTabKeys()
      const next = remaining[Math.min(closedEditorIndex, remaining.length - 1)]
      if (next) activateEditorTab(next)
    }
    void persistTabs()
    return true
  }

  async function closeEditorTab(key: string): Promise<boolean> {
    if (key.startsWith('properties:')) return closePropertyTab(key.slice('properties:'.length))
    const apiId = key.slice(4)
    const allowed = await confirmCloseTargets([apiId])
    if (!allowed) return false
    closeTabNow(apiId)
    return true
  }

  async function closeOtherEditorTabs(key: string): Promise<void> {
    for (const candidate of editorTabKeys().filter(item => item !== key)) {
      if (!await closeEditorTab(candidate)) return
    }
  }

  async function closeEditorTabsToTheRight(key: string): Promise<void> {
    const keys = editorTabKeys()
    const index = keys.indexOf(key)
    if (index === -1) return
    for (const candidate of keys.slice(index + 1)) {
      if (!await closeEditorTab(candidate)) return
    }
  }

  async function closeAllEditorTabs(): Promise<void> {
    for (const key of [...editorTabKeys()]) {
      if (!await closeEditorTab(key)) return
    }
  }

  /** 在标签页中打开请求(已打开则仅激活);新开标签拍内容基线 */
  function openApiInTab(apiId: string, options: { activate?: boolean } = {}): void {
    if (!apis.value[apiId]) return
    if (!openTabs.value.includes(apiId)) {
      openTabs.value.push(apiId)
      markApiSnapshot(apiId)
    }
    if (options.activate === false) {
      void persistTabs()
      return
    }
    activateTab(apiId)
  }

  /** 关闭标签的底层动作(无确认);激活标签被关时自动移到相邻标签 */
  function closeTabNow(apiId: string): void {
    const idx = openTabs.value.indexOf(apiId)
    if (idx === -1) return
    openTabs.value.splice(idx, 1)
    delete tabStates[apiId]
    delete apiSnapshots[apiId]
    if (currentApiId.value === apiId) {
      const next = openTabs.value[Math.min(idx, openTabs.value.length - 1)] ?? null
      currentApiId.value = next
      response.value = null
      scriptLogs.value = []
      scriptVisualizations.value = []
      scriptTests.value = []
      if (next) activateTab(next)
      else if (openPropertyTabs.value.length) activatePropertyTab(propertyTabKey(openPropertyTabs.value[0]))
    }
    void persistTabs()
  }

  /**
   * 关闭前对存在未保存修改的标签统一确认(保存并关闭 / 不保存 / 取消)。
   * 返回实际允许关闭的 id 列表;取消返回 null。
   * 新建未保存(不在集合树)的请求无法静默保存:选「保存并关闭」时保留标签并弹出命名保存。
   */
  async function confirmCloseTargets(targets: string[]): Promise<string[] | null> {
    const dirtyTargets = targets.filter(id => isApiDirty(id))
    if (dirtyTargets.length === 0) return targets

    const dialog = useDialog()
    if (targets.length === 1) {
      const id = targets[0]
      const name = apis.value[id]?.name ?? '未命名请求'
      if (!isApiUnsaved(id)) {
        const choice = await dialog.confirmTertiary({
          title: '未保存的修改',
          message: `「${name}」有未保存的修改，关闭前要保存吗？`,
          confirmText: '保存并关闭',
          tertiaryText: '不保存',
          cancelText: '取消',
        })
        if (choice === 'cancel') return null
        if (choice === 'confirm') await saveApi(id)
        else await discardApiChanges(id)
        return targets
      }
      // 新建未保存请求:保存需要命名 + 选落点,弹出保存弹窗且不自动关闭
      const choice = await dialog.confirmTertiary({
        title: '未保存的请求',
        message: `「${name}」尚未保存进集合树，关闭将放弃本次编辑的内容。`,
        confirmText: '去保存',
        tertiaryText: '放弃并关闭',
        cancelText: '取消',
        danger: true,
      })
      if (choice === 'cancel') return null
      if (choice === 'confirm') {
        activateTab(id)
        window.dispatchEvent(new CustomEvent('postino:save-request'))
        return null
      }
      await discardApiChanges(id)
      return targets
    }

    const choice = await dialog.confirmTertiary({
      title: '未保存的修改',
      message: `${dirtyTargets.length} 个标签存在未保存的修改，关闭前要保存吗？`,
      confirmText: '保存并关闭',
      tertiaryText: '不保存',
      cancelText: '取消',
    })
    if (choice === 'cancel') return null
    if (choice === 'tertiary') {
      for (const id of dirtyTargets) await discardApiChanges(id)
      return targets
    }
    const keepOpen = new Set<string>()
    for (const id of dirtyTargets) {
      if (isApiUnsaved(id)) {
        keepOpen.add(id)
        continue
      }
      await saveApi(id)
    }
    return targets.filter(id => !keepOpen.has(id))
  }

  /** 关闭标签;有未保存修改时先确认 */
  async function closeTab(apiId: string): Promise<void> {
    const allowed = await confirmCloseTargets([apiId])
    if (!allowed) return
    closeTabNow(apiId)
  }

  async function closeOtherTabs(apiId: string): Promise<void> {
    const allowed = await confirmCloseTargets(openTabs.value.filter(id => id !== apiId))
    if (!allowed) return
    for (const id of allowed) closeTabNow(id)
  }

  async function closeTabsToTheRight(apiId: string): Promise<void> {
    const idx = openTabs.value.indexOf(apiId)
    if (idx === -1) return
    const allowed = await confirmCloseTargets(openTabs.value.slice(idx + 1))
    if (!allowed) return
    for (const id of allowed) closeTabNow(id)
  }

  async function closeAllTabs(): Promise<void> {
    const allowed = await confirmCloseTargets([...openTabs.value])
    if (!allowed) return
    for (const id of allowed) closeTabNow(id)
  }

  /**
   * 新建请求 = 直接开一个新标签(不再先弹命名框):
   * 请求先只写 apis 表、不进集合树(标签上显示待保存圆点),
   * 首次 Cmd+S 保存时才命名 + 选落点。
   */
  async function newRequestTab(target?: { moduleId?: string; parentId?: string | null }): Promise<ApiConfig> {
    const now = Date.now()
    const api: ApiConfig = {
      id: Date.now().toString(36) + Math.random().toString(36).slice(2, 8),
      name: '未命名请求',
      method: 'GET',
      url: '',
      headers: [],
      params: [],
      cookies: [],
      body: { type: 'none', raw: '', formData: [], urlEncoded: [], binaryFile: null, contentType: '' },
      auth: normalizeAuthConfig(undefined),
      requestVariables: [],
      preRequestScript: '',
      postRequestScript: '',
      folder: null,
      createdAt: now,
      updatedAt: now,
    }
    apis.value[api.id] = api
    try {
      await db.apis.put(api)
    } catch (e) {
      console.error('Failed to add API to IndexedDB:', e)
    }
    markApiSnapshot(api.id)
    pendingSaveTarget.value = target ?? null
    if (currentApiId.value) {
      tabStates[currentApiId.value] = {
        response: response.value,
        scriptLogs: scriptLogs.value,
        scriptVisualizations: scriptVisualizations.value,
        scriptTests: scriptTests.value,
      }
    }
    currentApiId.value = api.id
    activePropertyTabKey.value = null
    response.value = null
    scriptLogs.value = []
    scriptVisualizations.value = []
    scriptTests.value = []
    openTabs.value.push(api.id)
    void persistTabs()
    return api
  }

  /** 请求是否尚未保存进集合树(标签待保存圆点依据) */
  function isApiUnsaved(apiId: string | null): boolean {
    if (!apiId || !apis.value[apiId]) return false
    return !useWorkspaceStore().interfaces.some(item => item.apiId === apiId && (item.nodeType ?? 'request') === 'request')
  }

  /** 编辑器改动:只写内存(标签圆点亮起),显式保存(saveApi / Cmd+S)才落库 */
  function updateApi(id: string, updates: Partial<ApiConfig>) {
    const api = apis.value[id]
    if (api) {
      const merged = { ...updates, updatedAt: Date.now() }
      if (updates.auth) merged.auth = normalizeAuthConfig(updates.auth)
      Object.assign(api, merged)
    }
  }

  /** 拍/重置请求的内容基线(新开标签、保存成功后调用),未保存圆点随之熄灭 */
  function markApiSnapshot(apiId: string): void {
    const api = apis.value[apiId]
    if (!api) return
    apiSnapshots[apiId] = { json: apiSnapshotJson(api), baseline: cloneApi(api) }
  }

  /** 请求是否有未保存修改(仅对已打开标签有意义) */
  function isApiDirty(apiId: string | null): boolean {
    if (!apiId || !openTabs.value.includes(apiId)) return false
    const snap = apiSnapshots[apiId]
    const api = apis.value[apiId]
    if (!snap || !api) return false
    return apiSnapshotJson(api) !== snap.json
  }

  /** 显式保存:内存内容写入 IndexedDB 并同步集合树,随后熄灭未保存圆点 */
  async function saveApi(id: string): Promise<void> {
    const api = apis.value[id]
    if (!api) return
    api.updatedAt = Date.now()
    try {
      await db.apis.put(cloneApi(api))
      await useWorkspaceStore().syncInterfaceFromApi(api)
    } catch (e) {
      console.error('Failed to save API to IndexedDB:', e)
      return
    }
    markApiSnapshot(id)
  }

  /** 更新并立即持久化(侧栏重命名、模块批量设置、导入合并等树级操作;编辑器编辑请走 updateApi) */
  async function updateApiNow(id: string, updates: Partial<ApiConfig>): Promise<void> {
    updateApi(id, updates)
    await saveApi(id)
  }

  /** 放弃未保存修改:回滚到上次基线 */
  async function discardApiChanges(id: string): Promise<void> {
    const snap = apiSnapshots[id]
    if (snap && apis.value[id]) {
      apis.value[id] = cloneApi(snap.baseline)
    }
    markApiSnapshot(id)
  }

  /** 页面卸载/转入后台前的兜底:把未落库的编辑写入 IndexedDB 防丢(不改变圆点状态) */
  async function flushDirtyApis(): Promise<void> {
    const dirtyIds = openTabs.value.filter(id => isApiDirty(id))
    if (!dirtyIds.length) return
    try {
      await db.apis.bulkPut(dirtyIds.map(id => apis.value[id]).filter((api): api is ApiConfig => Boolean(api)).map(cloneApi))
    } catch (e) {
      console.error('Failed to flush dirty APIs:', e)
    }
  }

  /**
   * 跨视图同步(CrossViewSyncBridge)用:用 db 内容刷新内存。
   * 编辑只进内存后,直接整体替换会冲掉未落库修改 —— 这里对已打开且 dirty 的请求保留本地版本,
   * db 里没有的本地请求(如新建未保存标签)也保留。
   */
  function mergeApisFromDb(list: ApiConfig[]): void {
    const next: Record<string, ApiConfig> = {}
    for (const api of list) {
      api.auth = normalizeAuthConfig(api.auth)
      const local = apis.value[api.id]
      next[api.id] = local && isApiDirty(api.id) ? local : api
    }
    for (const [id, api] of Object.entries(apis.value)) {
      if (!next[id]) next[id] = api
    }
    apis.value = next
  }

  async function addApi(api: ApiConfig, moduleId?: string | null, parentId: string | null = null): Promise<void> {
    api.auth = normalizeAuthConfig(api.auth)
    apis.value[api.id] = api
    try {
      await plainPut(db.apis, api)
      await useWorkspaceStore().addInterfaceForApi(api, moduleId ?? undefined, parentId)
    } catch (e) {
      console.error('Failed to add API to IndexedDB:', e)
    }
    markApiSnapshot(api.id)
  }

  /** Phase 4.4:Postman v2.1 树形导入 —— 建集合 + 文件夹树 + 请求,集合/文件夹级 auth/变量/脚本落位;onProgress 报已写入条数 */
  async function importPostmanCollectionTree(tree: ImportedPostmanTree, onProgress?: (done: number) => void): Promise<string | null> {
    const workspace = useWorkspaceStore()
    const module = await workspace.ensureModuleForLegacyGroup(tree.name)
    if (!module) return null

    const toCollectionVars = (pairs: Array<{ key: string; value: string; enabled?: boolean }>): CollectionVariable[] =>
      pairs.filter(item => item.key).map(item => ({
        key: item.key,
        initialValue: item.value,
        currentValue: item.value,
        secret: false,
        enabled: item.enabled !== false,
      }))

    await workspace.updateCollectionSettings(module.id, {
      ...(tree.description ? { description: tree.description } : {}),
      ...(tree.auth ? { auth: normalizeAuthConfig(tree.auth) } : {}),
      preRequestScript: tree.preRequestScript,
      postRequestScript: tree.postRequestScript,
      variables: toCollectionVars(tree.variables),
    })

    const folderIdByKey = new Map<string, string>()
    let written = 0
    for (const folder of tree.folders) {
      const parentId = folder.parentKey ? folderIdByKey.get(folder.parentKey) ?? null : null
      const node = await workspace.addFolder(module.id, folder.name, parentId)
      folderIdByKey.set(folder.key, node.id)
      await workspace.updateInterfaceNode(node.id, {
        preRequestScript: folder.preRequestScript,
        postRequestScript: folder.postRequestScript,
        ...(folder.auth ? { auth: normalizeAuthConfig(folder.auth) } : {}),
        ...(folder.variables.some(item => item.key) ? { variables: toCollectionVars(folder.variables) } : {}),
      })
      onProgress?.(++written)
    }

    for (const { parentKey, api } of tree.requests) {
      const parentId = parentKey ? folderIdByKey.get(parentKey) ?? null : null
      await addApi(api, module.id, parentId)
      onProgress?.(++written)
    }
    return module.id
  }

  /** Phase 4.5:恢复自有带版本备份(按 id 合并,secret 值已在导出时剥离) */
  async function restoreCollectionBackup(doc: CollectionExportDocument): Promise<{ collections: number; nodes: number; apis: number; environments: number }> {
    const workspace = useWorkspaceStore()
    await workspace.restoreCollectionBackupData(doc.collections ?? [], doc.nodes ?? [])
    const apiEntries = Object.values(doc.apis ?? {})
    for (const api of apiEntries) {
      apis.value[api.id] = api
      await plainPut(db.apis, api)
    }
    for (const env of doc.environments ?? []) {
      await upsertEnvironment(env)
    }
    return {
      collections: doc.collections?.length ?? 0,
      nodes: doc.nodes?.length ?? 0,
      apis: apiEntries.length,
      environments: doc.environments?.length ?? 0,
    }
  }

  /** Phase 4.4:Postman environment JSON 导入为指定集合的环境 */
  async function importCollectionEnvironment(collectionId: string, name: string, variables: Array<{ key: string; value: string; enabled?: boolean; secret?: boolean }>): Promise<Environment | null> {
    const env: Environment = {
      id: `env:${Date.now().toString(36)}${Math.random().toString(36).slice(2, 6)}`,
      name: name.trim() || '导入环境',
      collectionId,
      variables: variables
        .filter(item => item.key)
        .map(item => ({ key: item.key, value: item.value, enabled: item.enabled !== false, secret: item.secret })),
    }
    await upsertEnvironment(env)
    return env
  }

  function deleteApi(id: string) {
    delete apis.value[id]
    delete apiSnapshots[id]
    if (openTabs.value.includes(id)) closeTabNow(id)
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
    if (!env.collectionId || env.collectionId === 'global') {
      currentEnvId.value = env.id
    }
    await db.environments.put(env)
  }

  async function deleteEnvironment(id: string): Promise<void> {
    const env = environments.value.find(e => e.id === id)
    environments.value = environments.value.filter(e => e.id !== id)
    if (currentEnvId.value === id) {
      currentEnvId.value = environments.value.find(e => !e.collectionId || e.collectionId === 'global')?.id ?? null
    }
    await db.environments.delete(id)
    // 若被删环境是某集合的当前选择,清空该选择
    if (env?.collectionId && env.collectionId !== 'global') {
      const workspace = useWorkspaceStore()
      const collection = workspace.collections.find(item => item.id === env.collectionId)
      if (collection?.selectedEnvId === id) {
        await workspace.updateCollectionSettings(collection.id, { selectedEnvId: null })
      }
    }
  }

  /** 新建集合环境(每个集合独立的环境列表,如 local/test/prod) */
  async function addCollectionEnvironment(collectionId: string, name: string): Promise<Environment> {
    const env: Environment = {
      id: `env:${Date.now().toString(36)}${Math.random().toString(36).slice(2, 6)}`,
      name: name.trim() || '新环境',
      collectionId,
      variables: [],
    }
    await upsertEnvironment(env)
    return env
  }

  /** 切换集合的当前环境 */
  async function selectCollectionEnvironment(collectionId: string, envId: string | null): Promise<void> {
    await useWorkspaceStore().updateCollectionSettings(collectionId, { selectedEnvId: envId })
  }

  function isGlobalEnv(env: Environment): boolean {
    return !env.collectionId || env.collectionId === 'global'
  }

  /**
   * 请求的完整变量解析(Phase 2.2,Postman 优先级):
   * 请求变量 > 脚本运行时变量(发送时另行合并)> 当前集合所选环境 > 集合变量(父→子就近覆盖)> 全局环境变量
   * 统一走 resolveVariableResolutions,与 UI 的「变量来源提示」共享同一份解析结果。
   */
  function getVariableResolutionForApi(apiId: string | null): Record<string, VariableResolution> {
    const workspace = useWorkspaceStore()
    const node = apiId ? workspace.interfaces.find(item => item.apiId === apiId || item.id === apiId) : null
    const collectionId = node ? (node.collectionId ?? node.moduleId) : null
    const collection = collectionId ? workspace.collections.find(item => item.id === collectionId) : null
    return resolveVariableResolutions({
      requestVariables: apiId ? apis.value[apiId]?.requestVariables ?? [] : [],
      folders: workspace.getAncestorFolders(node?.id ?? apiId ?? ''),
      collection,
      environments: environments.value,
      globalEnvId: currentEnvId.value,
    })
  }

  function getEnvVariablesForApi(apiId: string | null): Record<string, string> {
    const resolutions = getVariableResolutionForApi(apiId)
    const vars: Record<string, string> = {}
    for (const [key, resolution] of Object.entries(resolutions)) {
      vars[key] = resolution.value
    }
    return vars
  }

  /** 当前请求的变量解析(getEnvVariablesForApi 的快捷方式) */
  function getEnvVariables(): Record<string, string> {
    return getEnvVariablesForApi(currentApiId.value)
  }

  async function saveSettings(): Promise<void> {
    const entries = Object.entries(settings.value).map(([key, value]) => ({ key, value }))
    await db.settings.bulkPut(entries)
  }

  /** Phase 5.1:主题切换(settings 的唯一真源在本 store,useSettings 只是代理) */
  function setTheme(theme: AppSettings['theme']): void {
    settings.value.theme = theme
    void saveSettings()
  }

  function setAccent(accent: AppSettings['accent']): void {
    settings.value.accent = accent
    void saveSettings()
  }

  /** 兼容旧调用:明暗循环切换(system → light → dark → black) */
  function toggleTheme(): void {
    const themes: AppSettings['theme'][] = ['system', 'light', 'dark', 'black']
    setTheme(themes[(themes.indexOf(settings.value.theme) + 1) % themes.length])
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
    openTabs, openPropertyTabs, activePropertyTabKey, activePropertyTarget, propertyTabDirty, pendingSaveTarget,
    response, loading, environments, currentEnvId,
    history, settings, expandedFolders, scriptLogs, scriptVisualizations, scriptTests, autoCarryCookies,
    requestAbortController,
    init, getCurrentApi, updateApi, updateApiNow, saveApi, discardApiChanges, isApiDirty, flushDirtyApis, mergeApisFromDb,
    addApi, deleteApi,
    openApiInTab, activateTab, closeTab, closeOtherTabs, closeTabsToTheRight, closeAllTabs,
    openPropertiesInTab, activatePropertyTab, closeEditorTab, closeOtherEditorTabs, closeEditorTabsToTheRight, closeAllEditorTabs,
    registerPropertyTabHandler, setPropertyTabDirty, saveActivePropertyTab,
    newRequestTab, isApiUnsaved, persistTabs,
    addHistory, toggleStar, deleteHistoryEntry, clearHistory,
    upsertEnvironment, deleteEnvironment,
    addCollectionEnvironment, selectCollectionEnvironment, isGlobalEnv,
    importPostmanCollectionTree, importCollectionEnvironment, restoreCollectionBackup,
    getEnvVariables, getEnvVariablesForApi, getVariableResolutionForApi, saveSettings, setTheme, setAccent, toggleTheme,
    setRequestAbortController, clearRequestAbortController, cancelCurrentRequest,
  }
})
