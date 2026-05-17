import { defineStore } from 'pinia'
import { computed, ref } from 'vue'
import { db } from '@/db'
import type { ApiConfig, Category, Group, InterfaceNode, Module as ApiModule, ModuleExportConfig, ModuleStats, ModuleType, PlannedWorkspaceModel } from '@/types'

export const DEFAULT_CATEGORY_ID = 'category:default'
export const DEFAULT_CATEGORY_NAME = '默认分组'
export const DEFAULT_CATEGORY_COLOR = '#6366f1'
export const UNGROUPED_MODULE_ID = 'module:ungrouped'
export const UNGROUPED_MODULE_NAME = '未分模块'

export type WorkspaceSelectionType = 'category' | 'module' | 'interface' | null


const MODEL_VERSION = '1.0.0'

function moduleModeFromType(type?: ModuleType): 'visual' | 'yaml' | 'readonly' {
  if (type === 'openapi-yaml') return 'yaml'
  if (type === 'readonly') return 'readonly'
  return 'visual'
}

function defaultModuleStats(interfaceCount = 0): ModuleStats {
  return {
    interfaceCount,
    docCount: 0,
    modelCount: 0,
    testCaseTotal: 0,
    testCaseCoverage: 0,
    sceneCaseTotal: 0,
    sceneCaseCoverage: 0,
    avgCasePerInterface: 0,
    uncoveredInterfaceCount: interfaceCount,
  }
}

function defaultExportConfig(): ModuleExportConfig {
  return {
    format: 'openapi3',
    autoBackup: false,
    backupTarget: 'local',
    backupEndpoint: '',
    backupToken: '',
    backupFileName: '',
    teamRole: 'owner',
    conflictStrategy: 'prompt',
    permissions: {
      editSettings: true,
      editVariables: true,
      syncDataSource: true,
      backup: true,
    },
  }
}

function normalizeModule(item: ApiModule): ApiModule {
  const type = item.type ?? 'generic'
  const stats = item.stats ?? defaultModuleStats()
  return {
    ...item,
    type,
    stats,
    variables: item.variables ?? {},
    dataSource: item.dataSource ?? null,
    moduleType: item.moduleType ?? {
      mode: moduleModeFromType(type),
      description: type === 'readonly' ? '只读同步模块' : type === 'openapi-yaml' ? 'OpenAPI YAML/JSON 模块' : '可视化 API 模块',
    },
    exportConfig: item.exportConfig ?? defaultExportConfig(),
    meta: item.meta ?? {
      createdAt: item.createdAt,
      updatedAt: item.updatedAt,
      version: MODEL_VERSION,
    },
  }
}

function stableId(prefix: string, value: string): string {
  return `${prefix}:${encodeURIComponent(value)}`
}

function uniqueStableId(prefix: string, value: string, usedIds: Set<string>): string {
  const baseId = stableId(prefix, value)
  if (!usedIds.has(baseId)) return baseId

  let index = 2
  let candidate = stableId(prefix, `${value}-${index}`)
  while (usedIds.has(candidate)) {
    index += 1
    candidate = stableId(prefix, `${value}-${index}`)
  }
  return candidate
}

function sortByOrder<T extends { order: number }>(items: T[]): T[] {
  return [...items].sort((a, b) => a.order - b.order)
}

function uniqueById<T extends { id: string }>(items: T[]): T[] {
  const byId = new Map<string, T>()
  for (const item of items) byId.set(item.id, item)
  return Array.from(byId.values())
}

function nextOrder<T extends { order: number }>(items: T[]): number {
  return items.length === 0 ? 0 : Math.max(...items.map(item => item.order)) + 1
}

function getOrderedGroupNames(groups: Record<string, Group>, groupOrder: string[]): string[] {
  const ordered = groupOrder.filter(name => groups[name])
  const remaining = Object.keys(groups)
    .filter(name => !ordered.includes(name))
    .sort((a, b) => a.localeCompare(b))
  return [...ordered, ...remaining]
}

export function derivePlannedWorkspaceModel(
  apis: Record<string, ApiConfig>,
  groups: Record<string, Group>,
  groupOrder: string[],
): PlannedWorkspaceModel {
  const now = Date.now()
  const categories: Category[] = []

  const modules: ApiModule[] = []
  const interfaces: InterfaceNode[] = []
  const assignedApiIds = new Set<string>()
  const groupNames = getOrderedGroupNames(groups, groupOrder)

  for (const [categoryOrder, groupName] of groupNames.entries()) {
    const group = groups[groupName]
    const categoryId = stableId('category', groupName)
    const moduleId = stableId('module', `${groupName}/${UNGROUPED_MODULE_NAME}`)
    categories.push({
      id: categoryId,
      name: group.name,
      color: DEFAULT_CATEGORY_COLOR,
      order: categoryOrder,
      createdAt: now,
      updatedAt: now,
    })
    modules.push({
      id: moduleId,
      categoryId,
      name: UNGROUPED_MODULE_NAME,
      type: 'generic',
      stats: defaultModuleStats(),
      variables: {},
      dataSource: null,
      moduleType: { mode: 'visual', description: '可视化 API 模块' },
      exportConfig: defaultExportConfig(),
      meta: { createdAt: now, updatedAt: now, version: MODEL_VERSION },
      order: 0,
      legacyGroupName: groupName,
      createdAt: now,
      updatedAt: now,
    })

    group.apiIds.forEach((apiId, order) => {
      const api = apis[apiId]
      if (!api) return
      assignedApiIds.add(apiId)
      interfaces.push({
        id: stableId('interface', apiId),
        moduleId,
        apiId,
        nodeType: 'request',
        parentId: null,
        name: api.name,
        method: api.method,
        url: api.url,
        order,
        createdAt: api.createdAt,
        updatedAt: api.updatedAt,
      })
    })
  }

  const ungroupedApis = Object.values(apis)
    .filter(api => !assignedApiIds.has(api.id))
    .sort((a, b) => a.createdAt - b.createdAt)

  if (ungroupedApis.length > 0) {
    categories.push({
      id: DEFAULT_CATEGORY_ID,
      name: DEFAULT_CATEGORY_NAME,
      color: DEFAULT_CATEGORY_COLOR,
      order: categories.length,
      createdAt: now,
      updatedAt: now,
    })
    const moduleId = UNGROUPED_MODULE_ID
    modules.push({
      id: moduleId,
      categoryId: DEFAULT_CATEGORY_ID,
      name: UNGROUPED_MODULE_NAME,
      type: 'generic',
      stats: defaultModuleStats(),
      variables: {},
      dataSource: null,
      moduleType: { mode: 'visual', description: '可视化 API 模块' },
      exportConfig: defaultExportConfig(),
      meta: { createdAt: now, updatedAt: now, version: MODEL_VERSION },
      order: 0,
      createdAt: now,
      updatedAt: now,
    })

    ungroupedApis.forEach((api, order) => {
      interfaces.push({
        id: stableId('interface', api.id),
        moduleId,
        apiId: api.id,
        nodeType: 'request',
        parentId: null,
        name: api.name,
        method: api.method,
        url: api.url,
        order,
        createdAt: api.createdAt,
        updatedAt: api.updatedAt,
      })
    })
  }

  return {
    categories: categories.length > 0
      ? categories
      : [{
        id: DEFAULT_CATEGORY_ID,
        name: DEFAULT_CATEGORY_NAME,
        color: DEFAULT_CATEGORY_COLOR,
        order: 0,
        createdAt: now,
        updatedAt: now,
        }],
    modules,
    interfaces,
  }
}

export const useWorkspaceStore = defineStore('workspace', () => {
  const categories = ref<Category[]>([])
  const modules = ref<ApiModule[]>([])
  const interfaces = ref<InterfaceNode[]>([])
  const activeSelectionType = ref<WorkspaceSelectionType>(null)
  const activeSelectionId = ref<string | null>(null)

  const activeCategory = computed(() => activeSelectionType.value === 'category'
    ? categories.value.find(category => category.id === activeSelectionId.value) ?? null
    : null)
  const activeModule = computed(() => activeSelectionType.value === 'module'
    ? modules.value.find(module => module.id === activeSelectionId.value) ?? null
    : null)
  const activeInterface = computed(() => activeSelectionType.value === 'interface'
    ? interfaces.value.find(item => item.id === activeSelectionId.value || item.apiId === activeSelectionId.value) ?? null
    : null)

  let initialized = false

  function normalizeInterfaceNode(item: InterfaceNode): InterfaceNode {
    return {
      ...item,
      nodeType: item.nodeType ?? 'request',
      parentId: item.parentId ?? null,
      preScript: item.preScript ?? item.preRequestScript ?? '',
      postScript: item.postScript ?? item.postRequestScript ?? '',
    }
  }

  async function init(): Promise<void> {
    if (initialized) return
    initialized = true

    const [categoryList, moduleList, interfaceList] = await Promise.all([
      db.categories.orderBy('order').toArray(),
      db.modules.orderBy('order').toArray(),
      db.interfaces.orderBy('order').toArray(),
    ])

    categories.value = uniqueById(categoryList)
    modules.value = uniqueById(moduleList.map(normalizeModule))
    interfaces.value = interfaceList.map(normalizeInterfaceNode)
  }

  function getModel(): PlannedWorkspaceModel {
    return {
      categories: sortByOrder(categories.value),
      modules: sortByOrder(modules.value),
      interfaces: sortByOrder(interfaces.value),
    }
  }

  async function replaceModel(model: PlannedWorkspaceModel): Promise<void> {
    const normalizedModules = model.modules.map(normalizeModule)
    const normalizedInterfaces = model.interfaces.map(normalizeInterfaceNode)
    await db.transaction('rw', db.categories, db.modules, db.interfaces, async () => {
      await Promise.all([
        db.categories.clear(),
        db.modules.clear(),
        db.interfaces.clear(),
      ])
      await Promise.all([
        db.categories.bulkPut(model.categories),
        db.modules.bulkPut(normalizedModules),
        db.interfaces.bulkPut(normalizedInterfaces),
      ])
    })

    categories.value = sortByOrder(model.categories)
    modules.value = sortByOrder(normalizedModules)
    interfaces.value = sortByOrder(normalizedInterfaces)
  }

  async function replaceFromLegacyGroups(
    apis: Record<string, ApiConfig>,
    groups: Record<string, Group>,
    groupOrder: string[],
  ): Promise<PlannedWorkspaceModel> {
    const model = derivePlannedWorkspaceModel(apis, groups, groupOrder)
    await replaceModel(model)
    return model
  }

  async function ensureDefaultCategory(): Promise<Category> {
    const existing = categories.value.find(category => category.id === DEFAULT_CATEGORY_ID)
    if (existing) return existing

    const now = Date.now()
    const category: Category = {
      id: DEFAULT_CATEGORY_ID,
      name: DEFAULT_CATEGORY_NAME,
      color: DEFAULT_CATEGORY_COLOR,
      order: 0,
      createdAt: now,
      updatedAt: now,
    }
    await db.categories.put(category)
    categories.value = sortByOrder([...uniqueById(categories.value).filter(item => item.id !== category.id), category])
    return category
  }

  async function addCategory(name: string): Promise<Category> {
    const trimmedName = name.trim()
    const existing = categories.value.find(category => category.name === trimmedName)
    if (existing) return existing

    const now = Date.now()
    const category: Category = {
      id: uniqueStableId('category', trimmedName, new Set(categories.value.map(item => item.id))),
      name: trimmedName,
      color: DEFAULT_CATEGORY_COLOR,
      order: nextOrder(categories.value),
      createdAt: now,
      updatedAt: now,
    }
    await db.categories.put(category)
    categories.value = sortByOrder([...categories.value, category])
    return category
  }

  async function updateCategory(id: string, updates: Partial<Omit<Category, 'id' | 'createdAt'>>): Promise<void> {
    const updatedAt = Date.now()
    await db.categories.update(id, { ...updates, updatedAt })
    categories.value = sortByOrder(uniqueById(categories.value.map(category => category.id === id
      ? { ...category, ...updates, updatedAt }
      : category)))
  }

  async function addModule(categoryId: string, name: string): Promise<ApiModule> {
    const trimmedName = name.trim()
    const existingByName = modules.value.find(module => module.categoryId === categoryId && module.name === trimmedName)
    if (existingByName) return existingByName

    const category = categories.value.find(item => item.id === categoryId) ?? await ensureDefaultCategory()
    const moduleId = uniqueStableId('module', `${category.id}/${trimmedName}`, new Set(modules.value.map(item => item.id)))
    const now = Date.now()
    const module: ApiModule = {
      id: moduleId,
      categoryId: category.id,
      name: trimmedName,
      type: 'generic',
      stats: defaultModuleStats(),
      variables: {},
      dataSource: null,
      moduleType: { mode: 'visual', description: '可视化 API 模块' },
      exportConfig: defaultExportConfig(),
      meta: { createdAt: now, updatedAt: now, version: MODEL_VERSION },
      order: nextOrder(modules.value.filter(item => item.categoryId === category.id)),
      createdAt: now,
      updatedAt: now,
    }
    const normalized = normalizeModule(module)
    await db.modules.put(normalized)
    modules.value = sortByOrder([...uniqueById(modules.value).filter(item => item.id !== normalized.id), normalized])
    return normalized
  }

  async function updateModule(id: string, updates: Partial<Omit<ApiModule, 'id' | 'createdAt'>>): Promise<void> {
    const updatedAt = Date.now()
    const existing = modules.value.find(module => module.id === id)
    const nextUpdates = {
      ...updates,
      updatedAt,
      meta: {
        createdAt: existing?.meta?.createdAt ?? existing?.createdAt ?? updatedAt,
        updatedAt,
        version: existing?.meta?.version ?? MODEL_VERSION,
      },
    }
    await db.modules.update(id, nextUpdates)
    modules.value = sortByOrder(uniqueById(modules.value.map(module => module.id === id
      ? normalizeModule({ ...module, ...nextUpdates })
      : module)))
  }

  async function ensureModuleForLegacyGroup(groupName: string): Promise<ApiModule> {
    await ensureDefaultCategory()

    const moduleId = stableId('module', groupName)
    const existing = modules.value.find(module => module.id === moduleId)
    if (existing) return existing

    const now = Date.now()
    const module: ApiModule = {
      id: moduleId,
      categoryId: DEFAULT_CATEGORY_ID,
      name: groupName,
      type: 'generic',
      stats: defaultModuleStats(),
      variables: {},
      dataSource: null,
      moduleType: { mode: 'visual', description: '可视化 API 模块' },
      exportConfig: defaultExportConfig(),
      meta: { createdAt: now, updatedAt: now, version: MODEL_VERSION },
      order: nextOrder(modules.value.filter(item => item.categoryId === DEFAULT_CATEGORY_ID)),
      legacyGroupName: groupName,
      createdAt: now,
      updatedAt: now,
    }
    const normalized = normalizeModule(module)
    await db.modules.put(normalized)
    modules.value = sortByOrder([...modules.value, normalized])
    return normalized
  }

  async function ensureUngroupedModule(): Promise<ApiModule> {
    await ensureDefaultCategory()

    const existing = modules.value.find(module => module.id === UNGROUPED_MODULE_ID)
    if (existing) return existing

    const now = Date.now()
    const module: ApiModule = {
      id: UNGROUPED_MODULE_ID,
      categoryId: DEFAULT_CATEGORY_ID,
      name: UNGROUPED_MODULE_NAME,
      type: 'generic',
      stats: defaultModuleStats(),
      variables: {},
      dataSource: null,
      moduleType: { mode: 'visual', description: '可视化 API 模块' },
      exportConfig: defaultExportConfig(),
      meta: { createdAt: now, updatedAt: now, version: MODEL_VERSION },
      order: nextOrder(modules.value.filter(item => item.categoryId === DEFAULT_CATEGORY_ID)),
      createdAt: now,
      updatedAt: now,
    }
    const normalized = normalizeModule(module)
    await db.modules.put(normalized)
    modules.value = sortByOrder([...modules.value, normalized])
    return normalized
  }

  async function addInterfaceForApi(api: ApiConfig, moduleId?: string, parentId: string | null = null): Promise<InterfaceNode> {
    const targetModule = moduleId
      ? modules.value.find(module => module.id === moduleId) ?? await ensureUngroupedModule()
      : await ensureUngroupedModule()
    const existing = interfaces.value.find(item => item.apiId === api.id && (item.nodeType ?? 'request') === 'request')
    const now = Date.now()
    const interfaceNode: InterfaceNode = {
      id: existing?.id ?? stableId('interface', api.id),
      moduleId: targetModule.id,
      apiId: api.id,
      nodeType: 'request',
      parentId,
      name: api.name,
      method: api.method,
      url: api.url,
      preRequestScript: api.preRequestScript,
      postRequestScript: api.postRequestScript,
      preScript: api.preRequestScript,
      postScript: api.postRequestScript,
      order: existing && existing.moduleId === targetModule.id && (existing.parentId ?? null) === parentId
        ? existing.order
        : nextOrder(interfaces.value.filter(item => item.moduleId === targetModule.id && (item.parentId ?? null) === parentId)),
      createdAt: existing?.createdAt ?? api.createdAt,
      updatedAt: now,
    }

    await db.interfaces.put(interfaceNode)
    interfaces.value = sortByOrder([
      ...interfaces.value.filter(item => item.id !== interfaceNode.id),
      interfaceNode,
    ])
    return interfaceNode
  }

  async function addFolder(moduleId: string, name: string, parentId: string | null = null): Promise<InterfaceNode> {
    const module = modules.value.find(item => item.id === moduleId) ?? await ensureUngroupedModule()
    const now = Date.now()
    const folder: InterfaceNode = {
      id: stableId('folder', `${module.id}/${parentId ?? 'root'}/${name}/${now}`),
      moduleId: module.id,
      apiId: '',
      nodeType: 'folder',
      parentId,
      name,
      method: 'GET',
      url: '',
      preRequestScript: '',
      postRequestScript: '',
      preScript: '',
      postScript: '',
      order: nextOrder(interfaces.value.filter(item => item.moduleId === module.id && (item.parentId ?? null) === parentId)),
      createdAt: now,
      updatedAt: now,
    }
    await db.interfaces.put(folder)
    interfaces.value = sortByOrder([...interfaces.value, folder])
    return folder
  }

  async function updateInterfaceNode(id: string, updates: Partial<Omit<InterfaceNode, 'id' | 'createdAt'>>): Promise<void> {
    const updatedAt = Date.now()
    await db.interfaces.update(id, { ...updates, updatedAt })
    interfaces.value = sortByOrder(interfaces.value.map(item => item.id === id
      ? normalizeInterfaceNode({ ...item, ...updates, updatedAt })
      : item))
  }

  async function syncInterfaceFromApi(api: ApiConfig): Promise<void> {
    const matches = interfaces.value.filter(item => item.apiId === api.id && (item.nodeType ?? 'request') === 'request')
    if (matches.length === 0) {
      await addInterfaceForApi(api)
      return
    }

    const updatedAt = Date.now()
    await Promise.all(matches.map(item => db.interfaces.update(item.id, {
      name: api.name,
      method: api.method,
      url: api.url,
      preRequestScript: api.preRequestScript,
      postRequestScript: api.postRequestScript,
      preScript: api.preRequestScript,
      postScript: api.postRequestScript,
      updatedAt,
    })))
    interfaces.value = interfaces.value.map(item => item.apiId === api.id && (item.nodeType ?? 'request') === 'request'
      ? { ...item, name: api.name, method: api.method, url: api.url, preRequestScript: api.preRequestScript, postRequestScript: api.postRequestScript, preScript: api.preRequestScript, postScript: api.postRequestScript, updatedAt }
      : item)
  }

  async function removeInterfacesForApi(apiId: string): Promise<void> {
    const ids = interfaces.value.filter(item => item.apiId === apiId).map(item => item.id)
    if (ids.length === 0) return
    await db.interfaces.bulkDelete(ids)
    interfaces.value = interfaces.value.filter(item => item.apiId !== apiId)
  }

  function getDescendantNodes(parentId: string): InterfaceNode[] {
    const result: InterfaceNode[] = []
    const visit = (id: string) => {
      const children = sortByOrder(interfaces.value.filter(item => (item.parentId ?? null) === id))
      for (const child of children) {
        result.push(child)
        if ((child.nodeType ?? 'request') === 'folder') visit(child.id)
      }
    }
    visit(parentId)
    return result
  }

  async function deleteInterfaceSubtree(nodeId: string): Promise<void> {
    const ids = [nodeId, ...getDescendantNodes(nodeId).map(item => item.id)]
    await db.interfaces.bulkDelete(ids)
    interfaces.value = interfaces.value.filter(item => !ids.includes(item.id))
  }

  async function moveInterfaceNode(
    nodeId: string,
    targetModuleId: string,
    targetParentId: string | null,
    targetOrder?: number,
  ): Promise<void> {
    const node = interfaces.value.find(item => item.id === nodeId)
    if (!node) return
    if (targetParentId === nodeId) return

    const descendantIds = new Set(getDescendantNodes(nodeId).map(item => item.id))
    if (targetParentId && descendantIds.has(targetParentId)) return

    const siblings = sortByOrder(interfaces.value.filter(item =>
      item.id !== nodeId &&
      item.moduleId === targetModuleId &&
      (item.parentId ?? null) === targetParentId,
    ))
    const insertAt = Math.max(0, Math.min(targetOrder ?? siblings.length, siblings.length))
    siblings.splice(insertAt, 0, {
      ...node,
      moduleId: targetModuleId,
      parentId: targetParentId,
      order: insertAt,
      updatedAt: Date.now(),
    })

    const updatedAt = Date.now()
    const reordered = siblings.map((item, order) => ({
      ...item,
      moduleId: targetModuleId,
      parentId: targetParentId,
      order,
      updatedAt,
    }))
    const moved = reordered.find(item => item.id === nodeId)
    if (!moved) return

    const descendants = getDescendantNodes(nodeId).map(item => ({
      ...item,
      moduleId: targetModuleId,
      updatedAt,
    }))
    await db.interfaces.bulkPut([...reordered, ...descendants])

    const updatedById = new Map<string, InterfaceNode>()
    for (const item of [...reordered, ...descendants]) updatedById.set(item.id, item)
    interfaces.value = sortByOrder(interfaces.value.map(item => updatedById.get(item.id) ?? item))
  }

  async function moveModule(moduleId: string, targetCategoryId: string, targetOrder?: number): Promise<void> {
    const module = modules.value.find(item => item.id === moduleId)
    if (!module) return
    const siblings = sortByOrder(modules.value.filter(item => item.id !== moduleId && item.categoryId === targetCategoryId))
    const insertAt = Math.max(0, Math.min(targetOrder ?? siblings.length, siblings.length))
    const updatedAt = Date.now()
    siblings.splice(insertAt, 0, { ...module, categoryId: targetCategoryId, order: insertAt, updatedAt })
    const reordered = siblings.map((item, order) => ({ ...item, categoryId: targetCategoryId, order, updatedAt }))
    await db.modules.bulkPut(reordered)
    const updatedById = new Map(reordered.map(item => [item.id, item]))
    modules.value = sortByOrder(modules.value.map(item => updatedById.get(item.id) ?? item))
  }

  function getAncestorFolders(interfaceOrApiId: string): InterfaceNode[] {
    const node = interfaces.value.find(item => item.id === interfaceOrApiId || item.apiId === interfaceOrApiId)
    if (!node) return []
    const folders: InterfaceNode[] = []
    let parentId = node.parentId ?? null
    const guard = new Set<string>()
    while (parentId && !guard.has(parentId)) {
      guard.add(parentId)
      const parent = interfaces.value.find(item => item.id === parentId)
      if (!parent) break
      if ((parent.nodeType ?? 'request') === 'folder') folders.unshift(parent)
      parentId = parent.parentId ?? null
    }
    return folders
  }

  function selectCategory(categoryId: string): void {
    activeSelectionType.value = 'category'
    activeSelectionId.value = categoryId
  }

  function selectModule(moduleId: string): void {
    activeSelectionType.value = 'module'
    activeSelectionId.value = moduleId
  }

  function selectInterface(interfaceOrApiId: string): void {
    activeSelectionType.value = 'interface'
    activeSelectionId.value = interfaceOrApiId
  }

  function clearSelection(): void {
    activeSelectionType.value = null
    activeSelectionId.value = null
  }

  async function duplicateModule(moduleId: string): Promise<ApiModule | null> {
    const source = modules.value.find(item => item.id === moduleId)
    if (!source) return null

    const now = Date.now()
    const newModuleId = `module:${now}:${Math.random().toString(36).slice(2)}`
    const newName = `${source.name} (副本)`

    const newModule: ApiModule = {
      ...source,
      id: newModuleId,
      name: newName,
      stats: defaultModuleStats(),
      meta: { createdAt: now, updatedAt: now, version: MODEL_VERSION },
      order: nextOrder(modules.value.filter(item => item.categoryId === source.categoryId)),
      createdAt: now,
      updatedAt: now,
    }
    const normalized = normalizeModule(newModule)

    // Collect all interface nodes belonging to the source module
    const sourceInterfaces = interfaces.value.filter(item => item.moduleId === moduleId)
    const parentIdMapping = new Map<string, string>()
    const newApiConfigs: ApiConfig[] = []

    // Build new interface nodes, preserving folder structure via parentId mapping
    const newInterfaceNodes: InterfaceNode[] = []
    for (const sourceNode of sourceInterfaces) {
      const newNodeId = `interface:${now}:${Math.random().toString(36).slice(2)}`
      parentIdMapping.set(sourceNode.id, newNodeId)

      let newApiId = sourceNode.apiId
      // For request nodes, create a copy of the ApiConfig
      if ((sourceNode.nodeType ?? 'request') === 'request' && sourceNode.apiId) {
        const sourceApi = await db.apis.get(sourceNode.apiId)
        if (sourceApi) {
          const copiedApiId = `api:${now}:${Math.random().toString(36).slice(2)}`
          const copiedApi: ApiConfig = {
            ...sourceApi,
            id: copiedApiId,
            name: sourceNode.name === sourceApi.name ? `${sourceApi.name} (副本)` : sourceApi.name,
            createdAt: now,
            updatedAt: now,
          }
          newApiConfigs.push(copiedApi)
          newApiId = copiedApiId
        }
      }

      newInterfaceNodes.push({
        ...sourceNode,
        id: newNodeId,
        moduleId: newModuleId,
        apiId: newApiId,
        parentId: sourceNode.parentId ? (parentIdMapping.get(sourceNode.parentId) ?? null) : null,
        createdAt: now,
        updatedAt: now,
      })
    }

    // Persist everything in a transaction
    await db.transaction('rw', db.modules, db.interfaces, db.apis, async () => {
      await db.modules.put(normalized)
      if (newApiConfigs.length > 0) {
        await db.apis.bulkPut(newApiConfigs)
      }
      await db.interfaces.bulkPut(newInterfaceNodes)
    })

    // Update reactive state
    modules.value = sortByOrder([...modules.value, normalized])
    interfaces.value = sortByOrder([...interfaces.value, ...newInterfaceNodes])

    // Select the new module
    selectModule(newModuleId)

    return normalized
  }

  async function duplicateInterface(interfaceOrApiId: string): Promise<InterfaceNode | null> {
    const sourceNode = interfaces.value.find(
      item => item.id === interfaceOrApiId || item.apiId === interfaceOrApiId,
    )
    if (!sourceNode || (sourceNode.nodeType ?? 'request') !== 'request') return null

    const now = Date.now()
    const newNodeId = `interface:${now}:${Math.random().toString(36).slice(2)}`
    const newApiId = `api:${now}:${Math.random().toString(36).slice(2)}`

    // Copy the ApiConfig
    const sourceApi = await db.apis.get(sourceNode.apiId)
    if (!sourceApi) return null

    const copiedApi: ApiConfig = {
      ...sourceApi,
      id: newApiId,
      name: `${sourceApi.name} (副本)`,
      createdAt: now,
      updatedAt: now,
    }

    const newNode: InterfaceNode = {
      ...sourceNode,
      id: newNodeId,
      apiId: newApiId,
      name: `${sourceNode.name} (副本)`,
      order: nextOrder(interfaces.value.filter(
        item => item.moduleId === sourceNode.moduleId && (item.parentId ?? null) === (sourceNode.parentId ?? null),
      )),
      createdAt: now,
      updatedAt: now,
    }

    await db.transaction('rw', db.interfaces, db.apis, async () => {
      await db.apis.put(copiedApi)
      await db.interfaces.put(newNode)
    })

    interfaces.value = sortByOrder([...interfaces.value, newNode])

    // Select the new interface
    selectInterface(newNodeId)

    return newNode
  }

  async function deleteModule(moduleId: string): Promise<void> {
    await db.transaction('rw', db.modules, db.interfaces, async () => {
      await db.modules.delete(moduleId)
      await db.interfaces.where('moduleId').equals(moduleId).delete()
    })
    modules.value = modules.value.filter(module => module.id !== moduleId)
    interfaces.value = interfaces.value.filter(item => item.moduleId !== moduleId)
  }

  async function deleteCategory(categoryId: string): Promise<void> {
    const moduleIds = modules.value
      .filter(module => module.categoryId === categoryId)
      .map(module => module.id)

    await db.transaction('rw', db.categories, db.modules, db.interfaces, async () => {
      await db.categories.delete(categoryId)
      await db.modules.where('categoryId').equals(categoryId).delete()
      await Promise.all(moduleIds.map(moduleId => db.interfaces.where('moduleId').equals(moduleId).delete()))
    })

    categories.value = categories.value.filter(category => category.id !== categoryId)
    modules.value = modules.value.filter(module => module.categoryId !== categoryId)
    interfaces.value = interfaces.value.filter(item => !moduleIds.includes(item.moduleId))
  }

  return {
    categories,
    modules,
    interfaces,
    activeSelectionType,
    activeSelectionId,
    activeCategory,
    activeModule,
    activeInterface,
    init,
    getModel,
    replaceModel,
    replaceFromLegacyGroups,
    ensureDefaultCategory,
    addCategory,
    updateCategory,
    addModule,
    updateModule,
    ensureModuleForLegacyGroup,
    ensureUngroupedModule,
    addInterfaceForApi,
    addFolder,
    updateInterfaceNode,
    syncInterfaceFromApi,
    removeInterfacesForApi,
    getDescendantNodes,
    deleteInterfaceSubtree,
    moveInterfaceNode,
    moveModule,
    getAncestorFolders,
    selectCategory,
    selectModule,
    selectInterface,
    clearSelection,
    deleteModule,
    deleteCategory,
    duplicateModule,
    duplicateInterface,
  }
})
