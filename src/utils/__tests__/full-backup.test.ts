import { describe, expect, it } from 'vitest'
import {
  FULL_BACKUP_FORMAT,
  FULL_BACKUP_VERSION,
  getFullBackupStats,
  parseFullBackup,
  serializeFullBackup,
  type FullBackupDocument,
} from '../full-backup'

function makeBackup(): FullBackupDocument {
  return {
    format: FULL_BACKUP_FORMAT,
    version: FULL_BACKUP_VERSION,
    exportedAt: 1_700_000_000_000,
    databaseVersion: 10,
    tables: {
      apis: [{ id: 'api:1' } as never],
      environments: [{ id: 'env:1' } as never],
      history: [{ id: 'history:1' } as never],
      settings: [{ key: 'theme', value: 'dark' }],
      groups: [],
      categories: [],
      modules: [{ id: 'module:1' } as never],
      interfaces: [
        { id: 'folder:1', nodeType: 'folder' } as never,
        { id: 'request:1', nodeType: 'request' } as never,
      ],
      collections: [{ id: 'collection:1' } as never],
      moduleAuditLogs: [{ id: 'audit:1' } as never],
      moduleSyncLogs: [{ id: 'sync:1' } as never],
    },
  }
}

describe('full backup format', () => {
  it('round-trips a versioned backup document', () => {
    const source = makeBackup()
    expect(parseFullBackup(serializeFullBackup(source))).toEqual(source)
  })

  it('summarizes the data shown in restore preview', () => {
    expect(getFullBackupStats(makeBackup())).toEqual({
      apis: 1,
      collections: 1,
      folders: 1,
      environments: 1,
      history: 1,
      settings: 1,
      auditLogs: 2,
      totalRows: 10,
    })
  })

  it('rejects unrelated and future backup files', () => {
    expect(() => parseFullBackup('{}')).toThrow('完整备份')
    expect(() => parseFullBackup(JSON.stringify({
      ...makeBackup(),
      version: FULL_BACKUP_VERSION + 1,
    }))).toThrow('请先升级 Postino')
  })

  it('rejects a backup with a missing table', () => {
    const source = makeBackup()
    const { history: _history, ...tables } = source.tables
    const backup = { ...source, tables }
    expect(() => parseFullBackup(JSON.stringify(backup))).toThrow('history')
  })
})
