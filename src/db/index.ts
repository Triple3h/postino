import Dexie, { type Table } from 'dexie'
import { toRaw } from 'vue'
import type { ApiConfig, Environment, HistoryEntry, Group, Category, Module, InterfaceNode, Collection, ModuleAuditLog, ModuleSyncLog } from '@/types'
import { upgradeToCollections } from '@/utils/collection-migration'

// Vue 响应式 Proxy 无法通过 IndexedDB 的 structured clone(抛 DataCloneError),
// 在表钩子里统一深度转纯对象,覆盖所有写入路径(集合变量、认证、headers 等)。
const CLONE_PRESERVED = new Set(['Date', 'RegExp', 'Blob', 'File', 'FileList', 'ArrayBuffer', 'Map', 'Set'])

function deepPlain<T>(value: T): T {
  const raw = toRaw(value)
  if (raw === null || typeof raw !== 'object') {
    return (typeof raw === 'function' ? undefined : raw) as T
  }
  if (Array.isArray(raw)) return raw.map(item => deepPlain(item)) as unknown as T
  const ctor = (raw as object).constructor
  if (ctor && CLONE_PRESERVED.has(ctor.name)) return raw
  const out: Record<string, unknown> = {}
  for (const [key, item] of Object.entries(raw as Record<string, unknown>)) {
    out[key] = deepPlain(item)
  }
  return out as T
}

function installPlainWriteHooks(database: Dexie) {
  const tableNames = [
    'apis', 'environments', 'history', 'settings', 'groups',
    'categories', 'modules', 'interfaces', 'collections',
    'moduleAuditLogs', 'moduleSyncLogs',
  ]
  for (const name of tableNames) {
    // Dexie 钩子签名泛型较死,此处内聚放宽
    const table = database.table(name) as any
    table.hook('creating', (_primKey: unknown, obj: Record<string, unknown>) => {
      const plain = deepPlain(obj) as Record<string, unknown>
      for (const key of Object.keys(obj)) delete obj[key]
      Object.assign(obj, plain)
    })
    table.hook('updating', (modifications: Record<string, unknown>) => {
      const out: Record<string, unknown> = {}
      let changed = false
      for (const [key, value] of Object.entries(modifications)) {
        const plain = deepPlain(value)
        if (plain !== value) changed = true
        out[key] = plain
      }
      return changed ? out : undefined
    })
  }
}

export class PostinoDB extends Dexie {
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
    super('PostinoDB')
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

export const db = new PostinoDB()
installPlainWriteHooks(db)
