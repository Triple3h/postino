import { defineStore } from 'pinia'
import { computed, ref } from 'vue'
import { db } from '@/db'
import type { ApiConfig, Category, Group, InterfaceNode, Module as ApiModule, PlannedWorkspaceModel } from '@/types'

export const DEFAULT_CATEGORY_ID = 'category:default'
export const DEFAULT_CATEGORY_NAME = '默认分组'
export const UNGROUPED_MODULE_ID = 'module:ungrouped'
export const UNGROUPED_MODULE_NAME = '未分模块'

export type WorkspaceSelectionType = 'category' | 'module' | 'interface' | null

function stableId(prefix: string, value: string): string {
  return `${prefix}:${encodeURIComponent(value)}`
}

function sortByOrder<T extends { order: number }>(items: T[]): T[] {
  return [...items].sort((a, b) => a.order - b.order)
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
      order: categoryOrder,
      createdAt: now,
      updatedAt: now,
    })
    modules.push({
      id: moduleId,
      categoryId,
      name: UNGROUPED_MODULE_NAME,
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
      order: categories.length,
      createdAt: now,
      updatedAt: now,
    })
    const moduleId = UNGROUPED_MODULE_ID
    modules.push({
      id: moduleId,
      categoryId: DEFAULT_CATEGORY_ID,
      name: UNGROUPED_MODULE_NAME,
      order: 0,
      createdAt: now,
      updatedAt: now,
    })

    ungroupedApis.forEach((api, order) => {
      interfaces.push({
        id: stableId('interface', api.id),
        moduleId,
        apiId: api.id,
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

  async function init(): Promise<void> {
    if (initialized) return
    initialized = true

    const [categoryList, moduleList, interfaceList] = await Promise.all([
      db.categories.orderBy('order').toArray(),
      db.modules.orderBy('order').toArray(),
      db.interfaces.orderBy('order').toArray(),
    ])

    categories.value = categoryList
    modules.value = moduleList
    interfaces.value = interfaceList
  }

  function getModel(): PlannedWorkspaceModel {
    return {
      categories: sortByOrder(categories.value),
      modules: sortByOrder(modules.value),
      interfaces: sortByOrder(interfaces.value),
    }
  }

  async function replaceModel(model: PlannedWorkspaceModel): Promise<void> {
    await db.transaction('rw', db.categories, db.modules, db.interfaces, async () => {
      await Promise.all([
        db.categories.clear(),
        db.modules.clear(),
        db.interfaces.clear(),
      ])
      await Promise.all([
        db.categories.bulkPut(model.categories),
        db.modules.bulkPut(model.modules),
        db.interfaces.bulkPut(model.interfaces),
      ])
    })

    categories.value = sortByOrder(model.categories)
    modules.value = sortByOrder(model.modules)
    interfaces.value = sortByOrder(model.interfaces)
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
      order: 0,
      createdAt: now,
      updatedAt: now,
    }
    await db.categories.put(category)
    categories.value = sortByOrder([...categories.value, category])
    return category
  }

  async function addCategory(name: string): Promise<Category> {
    const trimmedName = name.trim()
    const existing = categories.value.find(category => category.name === trimmedName)
    if (existing) return existing

    const now = Date.now()
    const category: Category = {
      id: stableId('category', trimmedName),
      name: trimmedName,
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
    categories.value = sortByOrder(categories.value.map(category => category.id === id
      ? { ...category, ...updates, updatedAt }
      : category))
  }

  async function addModule(categoryId: string, name: string): Promise<ApiModule> {
    const trimmedName = name.trim()
    const moduleId = stableId('module', `${categoryId}/${trimmedName}`)
    const existing = modules.value.find(module => module.id === moduleId)
    if (existing) return existing

    const category = categories.value.find(item => item.id === categoryId) ?? await ensureDefaultCategory()
    const now = Date.now()
    const module: ApiModule = {
      id: moduleId,
      categoryId: category.id,
      name: trimmedName,
      order: nextOrder(modules.value.filter(item => item.categoryId === category.id)),
      createdAt: now,
      updatedAt: now,
    }
    await db.modules.put(module)
    modules.value = sortByOrder([...modules.value, module])
    return module
  }

  async function updateModule(id: string, updates: Partial<Omit<ApiModule, 'id' | 'createdAt'>>): Promise<void> {
    const updatedAt = Date.now()
    await db.modules.update(id, { ...updates, updatedAt })
    modules.value = sortByOrder(modules.value.map(module => module.id === id
      ? { ...module, ...updates, updatedAt }
      : module))
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
      order: nextOrder(modules.value.filter(item => item.categoryId === DEFAULT_CATEGORY_ID)),
      legacyGroupName: groupName,
      createdAt: now,
      updatedAt: now,
    }
    await db.modules.put(module)
    modules.value = sortByOrder([...modules.value, module])
    return module
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
      order: nextOrder(modules.value.filter(item => item.categoryId === DEFAULT_CATEGORY_ID)),
      createdAt: now,
      updatedAt: now,
    }
    await db.modules.put(module)
    modules.value = sortByOrder([...modules.value, module])
    return module
  }

  async function addInterfaceForApi(api: ApiConfig, moduleId?: string): Promise<InterfaceNode> {
    const targetModule = moduleId
      ? modules.value.find(module => module.id === moduleId) ?? await ensureUngroupedModule()
      : await ensureUngroupedModule()
    const existing = interfaces.value.find(item => item.apiId === api.id)
    const now = Date.now()
    const interfaceNode: InterfaceNode = {
      id: existing?.id ?? stableId('interface', api.id),
      moduleId: targetModule.id,
      apiId: api.id,
      name: api.name,
      method: api.method,
      url: api.url,
      order: existing && existing.moduleId === targetModule.id
        ? existing.order
        : nextOrder(interfaces.value.filter(item => item.moduleId === targetModule.id)),
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

  async function syncInterfaceFromApi(api: ApiConfig): Promise<void> {
    const matches = interfaces.value.filter(item => item.apiId === api.id)
    if (matches.length === 0) {
      await addInterfaceForApi(api)
      return
    }

    const updatedAt = Date.now()
    await Promise.all(matches.map(item => db.interfaces.update(item.id, {
      name: api.name,
      method: api.method,
      url: api.url,
      updatedAt,
    })))
    interfaces.value = interfaces.value.map(item => item.apiId === api.id
      ? { ...item, name: api.name, method: api.method, url: api.url, updatedAt }
      : item)
  }

  async function removeInterfacesForApi(apiId: string): Promise<void> {
    const ids = interfaces.value.filter(item => item.apiId === apiId).map(item => item.id)
    if (ids.length === 0) return
    await db.interfaces.bulkDelete(ids)
    interfaces.value = interfaces.value.filter(item => item.apiId !== apiId)
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
    syncInterfaceFromApi,
    removeInterfacesForApi,
    selectCategory,
    selectModule,
    selectInterface,
    clearSelection,
    deleteModule,
    deleteCategory,
  }
})
