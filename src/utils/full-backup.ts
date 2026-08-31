import { db } from '@/db'
import type {
  ApiConfig,
  Category,
  Collection,
  Environment,
  Group,
  HistoryEntry,
  InterfaceNode,
  Module,
  ModuleAuditLog,
  ModuleSyncLog,
} from '@/types'

export const FULL_BACKUP_FORMAT = 'postino-full-backup'
export const FULL_BACKUP_VERSION = 1

interface FullBackupTables {
  apis: ApiConfig[]
  environments: Environment[]
  history: HistoryEntry[]
  settings: Array<{ key: string; value: unknown }>
  groups: Array<{ name: string; group: Group }>
  categories: Category[]
  modules: Module[]
  interfaces: InterfaceNode[]
  collections: Collection[]
  moduleAuditLogs: ModuleAuditLog[]
  moduleSyncLogs: ModuleSyncLog[]
}

export interface FullBackupDocument {
  format: typeof FULL_BACKUP_FORMAT
  version: typeof FULL_BACKUP_VERSION
  exportedAt: number
  databaseVersion: number
  tables: FullBackupTables
}

export interface FullBackupStats {
  apis: number
  collections: number
  folders: number
  environments: number
  history: number
  settings: number
  auditLogs: number
  totalRows: number
}

const TABLE_KEYS: Array<keyof FullBackupTables> = [
  'apis',
  'environments',
  'history',
  'settings',
  'groups',
  'categories',
  'modules',
  'interfaces',
  'collections',
  'moduleAuditLogs',
  'moduleSyncLogs',
]

function isRecord(value: unknown): value is Record<string, unknown> {
  return value !== null && typeof value === 'object' && !Array.isArray(value)
}

export function parseFullBackup(content: string): FullBackupDocument {
  let parsed: unknown
  try {
    parsed = JSON.parse(content)
  } catch {
    throw new Error('备份文件不是有效的 JSON')
  }

  if (!isRecord(parsed) || parsed.format !== FULL_BACKUP_FORMAT) {
    throw new Error('这不是 Postino 完整备份文件')
  }
  if (typeof parsed.version !== 'number' || !Number.isInteger(parsed.version)) {
    throw new Error('备份文件缺少有效的格式版本')
  }
  if (parsed.version > FULL_BACKUP_VERSION) {
    throw new Error(`备份格式 v${parsed.version} 高于当前支持的 v${FULL_BACKUP_VERSION}，请先升级 Postino`)
  }
  if (parsed.version < 1) {
    throw new Error(`不支持的备份格式版本：v${parsed.version}`)
  }
  if (typeof parsed.exportedAt !== 'number' || !Number.isFinite(parsed.exportedAt)) {
    throw new Error('备份文件缺少有效的导出时间')
  }
  if (!isRecord(parsed.tables)) {
    throw new Error('备份文件缺少数据表')
  }
  for (const key of TABLE_KEYS) {
    if (!Array.isArray(parsed.tables[key])) {
      throw new Error(`备份文件中的数据表 ${key} 无效`)
    }
  }

  return parsed as unknown as FullBackupDocument
}

export function getFullBackupStats(backup: FullBackupDocument): FullBackupStats {
  const requestNodes = backup.tables.interfaces.filter(item => (item.nodeType ?? 'request') === 'request').length
  const folders = backup.tables.interfaces.length - requestNodes
  const totalRows = TABLE_KEYS.reduce((total, key) => total + backup.tables[key].length, 0)
  return {
    apis: backup.tables.apis.length,
    collections: backup.tables.collections.length || backup.tables.modules.length,
    folders,
    environments: backup.tables.environments.length,
    history: backup.tables.history.length,
    settings: backup.tables.settings.length,
    auditLogs: backup.tables.moduleAuditLogs.length + backup.tables.moduleSyncLogs.length,
    totalRows,
  }
}

export async function createFullBackup(): Promise<FullBackupDocument> {
  const tables = await db.transaction('r', db.tables, async (): Promise<FullBackupTables> => ({
    apis: await db.apis.toArray(),
    environments: await db.environments.toArray(),
    history: await db.history.toArray(),
    settings: await db.settings.toArray(),
    groups: await db.groups.toArray(),
    categories: await db.categories.toArray(),
    modules: await db.modules.toArray(),
    interfaces: await db.interfaces.toArray(),
    collections: await db.collections.toArray(),
    moduleAuditLogs: await db.moduleAuditLogs.toArray(),
    moduleSyncLogs: await db.moduleSyncLogs.toArray(),
  }))

  return {
    format: FULL_BACKUP_FORMAT,
    version: FULL_BACKUP_VERSION,
    exportedAt: Date.now(),
    databaseVersion: db.verno,
    tables,
  }
}

export function serializeFullBackup(backup: FullBackupDocument): string {
  return JSON.stringify(backup, null, 2)
}

export async function restoreFullBackup(backup: FullBackupDocument): Promise<void> {
  // 预览文档放入 Vue ref 后会被深度代理；Dexie 的 bulkPut 在 hooks 前就会
  // structured-clone 顶层对象，因此必须在数据层边界重新转为纯 JSON 数据。
  const data = JSON.parse(JSON.stringify(backup.tables)) as FullBackupTables
  await db.transaction('rw', db.tables, async () => {
    await Promise.all(db.tables.map(table => table.clear()))
    const write = async (tableName: string, operation: () => Promise<unknown>) => {
      try {
        await operation()
      } catch (cause) {
        const error = new Error(`恢复数据表 ${tableName} 失败`) as Error & { cause?: unknown }
        error.cause = cause
        throw error
      }
    }
    await write('apis', () => db.apis.bulkPut(data.apis))
    await write('environments', () => db.environments.bulkPut(data.environments))
    await write('history', () => db.history.bulkPut(data.history))
    await write('settings', () => db.settings.bulkPut(data.settings))
    await write('groups', () => db.groups.bulkPut(data.groups))
    await write('categories', () => db.categories.bulkPut(data.categories))
    await write('modules', () => db.modules.bulkPut(data.modules))
    await write('interfaces', () => db.interfaces.bulkPut(data.interfaces))
    await write('collections', () => db.collections.bulkPut(data.collections))
    await write('moduleAuditLogs', () => db.moduleAuditLogs.bulkPut(data.moduleAuditLogs))
    await write('moduleSyncLogs', () => db.moduleSyncLogs.bulkPut(data.moduleSyncLogs))
  })
}

export async function clearWorkspaceData(): Promise<void> {
  await db.transaction(
    'rw',
    [db.apis, db.groups, db.categories, db.modules, db.interfaces, db.collections, db.moduleAuditLogs, db.moduleSyncLogs, db.settings],
    async () => {
      await Promise.all([
        db.apis.clear(),
        db.groups.clear(),
        db.categories.clear(),
        db.modules.clear(),
        db.interfaces.clear(),
        db.collections.clear(),
        db.moduleAuditLogs.clear(),
        db.moduleSyncLogs.clear(),
        db.settings.bulkDelete(['groupOrder', 'openTabIds', 'activeTabId']),
      ])
    },
  )
}

export async function resetAllData(): Promise<void> {
  await db.transaction('rw', db.tables, async () => {
    await Promise.all(db.tables.map(table => table.clear()))
  })
}
