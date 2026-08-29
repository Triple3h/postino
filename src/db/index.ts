import Dexie, { type Table } from 'dexie'
import type { ApiConfig, Environment, HistoryEntry, Group, Category, Module, InterfaceNode, Collection, ModuleAuditLog, ModuleSyncLog } from '@/types'
import { upgradeToCollections } from '@/utils/collection-migration'

export class ApiFixDB extends Dexie {
  apis!: Table<ApiConfig, string>
  environments!: Table<Environment, string>
  history!: Table<HistoryEntry, string>
  settings!: Table<{ key: string; value: any }, string>
  groups!: Table<{ name: string; group: Group }, string>
  categories!: Table<Category, string>
  modules!: Table<Module, string>
  interfaces!: Table<InterfaceNode, string>
  /** @deprecated Collection 化过渡期镜像表,Phase 1 后随旧 UI 一并移除 */
  collections!: Table<Collection, string>
  moduleAuditLogs!: Table<ModuleAuditLog, string>
  moduleSyncLogs!: Table<ModuleSyncLog, string>

  constructor() {
    super('ApiFixDB')
    this.version(1).stores({
      apis: 'id, name, method, folder, updatedAt',
      environments: 'id, name',
      history: 'id, apiId, method, status, timestamp',
      settings: 'key',
      groups: 'name',
    })

    this.version(2).stores({
      apis: 'id, name, method, folder, updatedAt',
      environments: 'id, name',
      history: 'id, apiId, method, status, timestamp',
      settings: 'key',
      groups: 'name',
      categories: 'id, name, order, updatedAt',
      modules: 'id, categoryId, name, order, legacyGroupName, updatedAt',
      interfaces: 'id, moduleId, apiId, name, method, order, updatedAt',
    })

    this.version(3).stores({
      apis: 'id, name, method, folder, updatedAt',
      environments: 'id, name',
      history: 'id, apiId, method, status, timestamp',
      settings: 'key',
      groups: 'name',
      categories: 'id, name, order, updatedAt',
      modules: 'id, categoryId, name, order, legacyGroupName, updatedAt',
      interfaces: 'id, moduleId, parentId, nodeType, apiId, name, method, order, updatedAt',
    })


    this.version(4).stores({
      apis: 'id, name, method, folder, updatedAt',
      environments: 'id, name',
      history: 'id, apiId, method, status, timestamp',
      settings: 'key',
      groups: 'name',
      categories: 'id, name, order, updatedAt',
      modules: 'id, categoryId, name, order, legacyGroupName, updatedAt',
      interfaces: 'id, moduleId, parentId, nodeType, apiId, name, method, order, updatedAt',
    })

    this.version(5).stores({
      apis: 'id, name, method, folder, updatedAt',
      environments: 'id, name',
      history: 'id, apiId, method, status, timestamp',
      settings: 'key',
      groups: 'name',
      categories: 'id, name, order, updatedAt',
      modules: 'id, categoryId, name, order, legacyGroupName, updatedAt',
      interfaces: 'id, moduleId, parentId, nodeType, apiId, name, method, order, updatedAt',
    })

    this.version(6).stores({
      apis: 'id, name, method, folder, updatedAt',
      environments: 'id, name',
      history: 'id, apiId, method, status, timestamp',
      settings: 'key',
      groups: 'name',
      categories: 'id, name, order, updatedAt',
      modules: 'id, categoryId, name, order, legacyGroupName, updatedAt',
      interfaces: 'id, moduleId, parentId, nodeType, apiId, name, method, order, updatedAt',
      moduleAuditLogs: 'id, moduleId, action, createdAt',
    })

    this.version(7).stores({
      apis: 'id, name, method, folder, updatedAt',
      environments: 'id, name',
      history: 'id, apiId, moduleId, interfaceId, method, status, timestamp, [moduleId+timestamp], [interfaceId+timestamp]',
      settings: 'key',
      groups: 'name',
      categories: 'id, name, order, updatedAt',
      modules: 'id, categoryId, name, order, legacyGroupName, updatedAt',
      interfaces: 'id, moduleId, parentId, nodeType, apiId, name, method, order, updatedAt',
      moduleAuditLogs: 'id, moduleId, action, createdAt',
    }).upgrade(async tx => {
      const interfaces = await tx.table('interfaces').toArray() as InterfaceNode[]
      const byApiId = new Map(interfaces.map(item => [item.apiId, item]))
      await tx.table('history').toCollection().modify((entry: HistoryEntry) => {
        const node = byApiId.get(entry.apiId)
        if (!node) return
        entry.moduleId = entry.moduleId || node.moduleId
        entry.interfaceId = entry.interfaceId || node.id
      })
    })

    this.version(8).stores({
      apis: 'id, name, method, folder, updatedAt',
      environments: 'id, name',
      history: 'id, apiId, moduleId, interfaceId, method, status, timestamp, [moduleId+timestamp], [interfaceId+timestamp]',
      settings: 'key',
      groups: 'name',
      categories: 'id, name, order, updatedAt',
      modules: 'id, categoryId, name, order, legacyGroupName, updatedAt',
      interfaces: 'id, moduleId, parentId, nodeType, apiId, name, method, order, updatedAt',
      moduleAuditLogs: 'id, moduleId, action, createdAt',
      moduleSyncLogs: 'id, moduleId, timestamp, [moduleId+timestamp]',
    })

    this.version(9).stores({
      apis: 'id, name, method, folder, updatedAt',
      environments: 'id, name',
      history: 'id, apiId, moduleId, interfaceId, method, status, timestamp, [moduleId+timestamp], [interfaceId+timestamp]',
      settings: 'key',
      groups: 'name',
      categories: 'id, name, order, updatedAt',
      modules: 'id, categoryId, name, order, legacyGroupName, updatedAt',
      interfaces: 'id, moduleId, parentId, nodeType, apiId, name, method, order, updatedAt',
      moduleAuditLogs: 'id, moduleId, action, createdAt',
      moduleSyncLogs: 'id, moduleId, timestamp, [moduleId+timestamp]',
    })

    // v10:Collection 化。collections 成为唯一真源;
    // environments/interfaces 增加 collectionId 索引;旧表保留数据以便回滚。
    this.version(10).stores({
      apis: 'id, name, method, folder, updatedAt',
      environments: 'id, name, collectionId',
      history: 'id, apiId, moduleId, interfaceId, method, status, timestamp, [moduleId+timestamp], [interfaceId+timestamp]',
      settings: 'key',
      groups: 'name',
      categories: 'id, name, order, updatedAt',
      modules: 'id, categoryId, name, order, legacyGroupName, updatedAt',
      interfaces: 'id, moduleId, collectionId, parentId, nodeType, apiId, name, method, order, updatedAt',
      moduleAuditLogs: 'id, moduleId, action, createdAt',
      moduleSyncLogs: 'id, moduleId, timestamp, [moduleId+timestamp]',
      collections: 'id, name, order, updatedAt',
    }).upgrade(upgradeToCollections)
  }
}

export const db = new ApiFixDB()
