import Dexie, { type Table } from 'dexie'
import type { ApiConfig, Environment, HistoryEntry, Group } from '@/types'

export class ApiFixDB extends Dexie {
  apis!: Table<ApiConfig, string>
  environments!: Table<Environment, string>
  history!: Table<HistoryEntry, string>
  settings!: Table<{ key: string; value: any }, string>
  groups!: Table<{ name: string; group: Group }, string>

  constructor() {
    super('ApiFixDB')
    this.version(1).stores({
      apis: 'id, name, method, folder, updatedAt',
      environments: 'id, name',
      history: 'id, apiId, method, status, timestamp',
      settings: 'key',
      groups: 'name',
    })
  }
}

export const db = new ApiFixDB()
