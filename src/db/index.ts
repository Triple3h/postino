import Dexie, { type Table } from 'dexie'
import type { ApiConfig, Environment, HistoryEntry, Group, Category, Module, InterfaceNode } from '@/types'

export class ApiFixDB extends Dexie {
  apis!: Table<ApiConfig, string>
  environments!: Table<Environment, string>
  history!: Table<HistoryEntry, string>
  settings!: Table<{ key: string; value: any }, string>
  groups!: Table<{ name: string; group: Group }, string>
  categories!: Table<Category, string>
  modules!: Table<Module, string>
  interfaces!: Table<InterfaceNode, string>

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
  }
}

export const db = new ApiFixDB()
