import { defineStore } from 'pinia'
import { ref } from 'vue'
import { db } from '@/db'
import type { ApiConfig, Category, Group, InterfaceNode, Module as ApiModule, PlannedWorkspaceModel } from '@/types'

export const DEFAULT_CATEGORY_ID = 'category:default'
export const DEFAULT_CATEGORY_NAME = 'Default'
export const UNGROUPED_MODULE_ID = 'module:ungrouped'
export const UNGROUPED_MODULE_NAME = 'Ungrouped'

function stableId(prefix: string, value: string): string {
  return `${prefix}:${encodeURIComponent(value)}`
}

function sortByOrder<T extends { order: number }>(items: T[]): T[] {
  return [...items].sort((a, b) => a.order - b.order)
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
  const categories: Category[] = [{
    id: DEFAULT_CATEGORY_ID,
    name: DEFAULT_CATEGORY_NAME,
    order: 0,
    createdAt: now,
    updatedAt: now,
  }]

  const modules: ApiModule[] = []
  const interfaces: InterfaceNode[] = []
  const assignedApiIds = new Set<string>()
  const groupNames = getOrderedGroupNames(groups, groupOrder)

  for (const [moduleOrder, groupName] of groupNames.entries()) {
    const group = groups[groupName]
    const moduleId = stableId('module', groupName)
    modules.push({
      id: moduleId,
      categoryId: DEFAULT_CATEGORY_ID,
      name: group.name,
      order: moduleOrder,
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
    const moduleId = UNGROUPED_MODULE_ID
    modules.push({
      id: moduleId,
      categoryId: DEFAULT_CATEGORY_ID,
      name: UNGROUPED_MODULE_NAME,
      order: modules.length,
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
    categories,
    modules,
    interfaces,
  }
}

export const useWorkspaceStore = defineStore('workspace', () => {
  const categories = ref<Category[]>([])
  const modules = ref<ApiModule[]>([])
  const interfaces = ref<InterfaceNode[]>([])
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

  return {
    categories,
    modules,
    interfaces,
    init,
    getModel,
    replaceModel,
    replaceFromLegacyGroups,
  }
})
