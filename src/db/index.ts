import Dexie, { type Table } from 'dexie'
import type { ApiConfig, Environment, HistoryEntry, Group, Category, Module, InterfaceNode, ModuleDocArtifact, ModuleDataModel, InterfaceTestCase, ModuleScenarioCase, ModuleAuditLog } from '@/types'

export class ApiFixDB extends Dexie {
  apis!: Table<ApiConfig, string>
  environments!: Table<Environment, string>
  history!: Table<HistoryEntry, string>
  settings!: Table<{ key: string; value: any }, string>
  groups!: Table<{ name: string; group: Group }, string>
  categories!: Table<Category, string>
  modules!: Table<Module, string>
  interfaces!: Table<InterfaceNode, string>
  moduleDocs!: Table<ModuleDocArtifact, string>
  moduleModels!: Table<ModuleDataModel, string>
  interfaceTestCases!: Table<InterfaceTestCase, string>
  moduleScenarioCases!: Table<ModuleScenarioCase, string>
  moduleAuditLogs!: Table<ModuleAuditLog, string>

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
      moduleDocs: 'id, moduleId, interfaceId, format, updatedAt',
      moduleModels: 'id, moduleId, name, updatedAt',
      interfaceTestCases: 'id, moduleId, interfaceId, lastRunAt, lastPassed, updatedAt',
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
      moduleDocs: 'id, moduleId, interfaceId, format, updatedAt',
      moduleModels: 'id, moduleId, name, updatedAt',
      interfaceTestCases: 'id, moduleId, interfaceId, lastRunAt, lastPassed, updatedAt',
      moduleScenarioCases: 'id, moduleId, lastRunAt, lastPassed, updatedAt',
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
      moduleDocs: 'id, moduleId, interfaceId, format, updatedAt',
      moduleModels: 'id, moduleId, name, updatedAt',
      interfaceTestCases: 'id, moduleId, interfaceId, lastRunAt, lastPassed, updatedAt',
      moduleScenarioCases: 'id, moduleId, lastRunAt, lastPassed, updatedAt',
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
      moduleDocs: 'id, moduleId, interfaceId, format, updatedAt',
      moduleModels: 'id, moduleId, name, updatedAt',
      interfaceTestCases: 'id, moduleId, interfaceId, lastRunAt, lastPassed, updatedAt',
      moduleScenarioCases: 'id, moduleId, lastRunAt, lastPassed, updatedAt',
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
  }
}

export const db = new ApiFixDB()
