import Dexie from 'dexie'
import type { ApiConfig, ModuleDataSource, ModuleSyncLog } from '@/types'
import { sendRequest as httpSendRequest } from '@/utils/http'
import { importOpenApi, importOpenApiSpec, listOpenApiOperationMetadata, parseOpenApiSpec, type OpenApiOperationMetadata } from '@/utils/openapi-import'
import { useAppStore } from '@/stores/app'
import { useWorkspaceStore } from '@/stores/workspace'
import { createDefaultAuthConfig } from '@/utils/auth'
import { db } from '@/db'

export const DEFAULT_DATA_SOURCE_SYNC_INTERVAL_MINUTES = 60

export interface DataSourceSyncResult {
  moduleId: string
  sourceUrl: string
  text: string
  importedCount: number
  created: number
  updated: number
  skipped: number
  startedAt: number
  finishedAt: number
  message: string
}

export interface DataSourceSyncOptions {
  dataSource?: ModuleDataSource | null
  onLog?: (line: string) => void
  saveWhenEmpty?: boolean
  syncAction?: ModuleSyncLog['action']
}

type DataSourceMappedField = 'name' | 'description' | 'folder'

function log(options: DataSourceSyncOptions | undefined, line: string): void {
  options?.onLog?.(line)
}

function now(): number {
  return Date.now()
}

function normalizeMappedField(target: string): DataSourceMappedField | null {
  const normalized = target.trim().toLowerCase().replace(/\s+/g, '')
  if (['接口名称', '名称', 'name', 'apiname', 'api.name', 'interface.name'].includes(normalized)) return 'name'
  if (['接口描述', '描述', 'description', 'apidescription', 'api.description', 'interface.description'].includes(normalized)) return 'description'
  if (['文件夹分类', '文件夹', '分类', 'folder', 'foldername', 'category', 'tag'].includes(normalized)) return 'folder'
  return null
}

function stringifyMappingValue(value: unknown): string {
  if (value === null || value === undefined) return ''
  if (Array.isArray(value)) return value.map(stringifyMappingValue).filter(Boolean).join(', ')
  if (typeof value === 'object') return JSON.stringify(value)
  return String(value)
}

function getMetadataField(meta: OpenApiOperationMetadata | undefined, source: string): string {
  if (!meta) return ''
  const key = source.trim()
  const tagIndex = key.match(/^tags\[(\d+)\]$/i)
  if (tagIndex) return stringifyMappingValue(meta.tags?.[Number(tagIndex[1])])
  return stringifyMappingValue((meta as unknown as Record<string, unknown>)[key])
}

function getOpenApiMetadataByImport(
  text: string,
  apis: ApiConfig[],
): Array<OpenApiOperationMetadata | undefined> {
  const spec = parseOpenApiSpec(text)
  if (!spec) return []
  const metadata = listOpenApiOperationMetadata(spec)
  return apis.map((api, index) =>
    metadata.find(item => item.method === api.method && item.url === api.url)
    ?? metadata.find(item => item.method === api.method && api.url.endsWith(item.url))
    ?? metadata[index],
  )
}

function applyDataSourceFieldMapping(
  apis: ApiConfig[],
  metadata: Array<OpenApiOperationMetadata | undefined>,
  fieldMapping?: Record<string, string>,
): ApiConfig[] {
  const mappings = Object.entries(fieldMapping ?? {})
    .map(([source, target]) => ({ source, target: normalizeMappedField(target) }))
    .filter((item): item is { source: string; target: DataSourceMappedField } => Boolean(item.target))

  if (mappings.length === 0) return apis

  return apis.map((api, index) => {
    const next: ApiConfig = { ...api }
    const meta = metadata[index]
    for (const mapping of mappings) {
      const value = getMetadataField(meta, mapping.source).trim()
      if (!value) continue
      if (mapping.target === 'name') next.name = value
      if (mapping.target === 'description') next.description = value
      if (mapping.target === 'folder') next.folder = value
    }
    return next
  })
}

export function getDataSourceIntervalMinutes(dataSource?: ModuleDataSource | null): number {
  const value = dataSource?.syncIntervalMinutes
  return typeof value === 'number' && Number.isFinite(value) && value > 0
    ? value
    : DEFAULT_DATA_SOURCE_SYNC_INTERVAL_MINUTES
}

export function getNextDataSourceSyncAt(dataSource?: ModuleDataSource | null): number | null {
  if (!dataSource || dataSource.syncStrategy !== 'auto') return null
  const anchor = dataSource.lastSyncAt ?? 0
  return anchor + getDataSourceIntervalMinutes(dataSource) * 60_000
}

export function isDataSourceSyncDue(dataSource?: ModuleDataSource | null, at = now()): boolean {
  const next = getNextDataSourceSyncAt(dataSource)
  return next !== null && next <= at
}

export async function writeModuleSyncLog(log: Omit<ModuleSyncLog, 'id'>): Promise<void> {
  try {
    const id = `${Date.now()}-${Math.random().toString(36).slice(2, 8)}`
    await db.moduleSyncLogs.put({ ...log, id })
  } catch (err) {
    console.warn('[Postino][SyncLog] 写入同步日志失败:', err)
  }
}

export async function getModuleSyncLogs(moduleId: string, limit = 10): Promise<ModuleSyncLog[]> {
  try {
    return await db.moduleSyncLogs
      .where('[moduleId+timestamp]')
      .between([moduleId, Dexie.minKey], [moduleId, Dexie.maxKey])
      .reverse()
      .limit(limit)
      .toArray()
  } catch {
    return []
  }
}

export async function clearModuleSyncLogs(moduleId: string): Promise<void> {
  try {
    await db.moduleSyncLogs.where('moduleId').equals(moduleId).delete()
  } catch (err) {
    console.warn('[Postino][SyncLog] 清除同步日志失败:', err)
  }
}

async function fetchDataSourceText(url: string): Promise<string> {
  const store = useAppStore()
  const response = await httpSendRequest({
    method: 'GET',
    url,
    headers: [],
    params: [],
    cookies: [],
    autoCarryCookies: false,
    body: { type: 'none', raw: '', formData: [], urlEncoded: [], binaryFile: null, contentType: '' },
    auth: createDefaultAuthConfig(),
    corsMode: store.settings.corsMode,
    proxyUrl: store.settings.proxyUrl,
    envVars: store.getEnvVariables(),
  })
  if (response.status < 200 || response.status >= 300) throw new Error(`${response.status} ${response.statusText}`)
  return response.body
}

function toAbsoluteSpecUrl(candidate: string, sourceUrl: string): string | null {
  try {
    return new URL(candidate, sourceUrl).toString()
  } catch {
    return null
  }
}

export function extractOpenApiCandidateUrls(html: string, sourceUrl: string): string[] {
  const candidates = new Set<string>()
  const patterns = [
    /\burl\s*:\s*["']([^"']+)["']/g,
    /\burl\s*=\s*["']([^"']+)["']/g,
    /\bconfigUrl\s*:\s*["']([^"']+)["']/g,
    /\bconfigUrl\s*=\s*["']([^"']+)["']/g,
    /["']([^"']*(?:openapi|swagger|api-docs)[^"']*\.(?:json|ya?ml)(?:\?[^"']*)?)["']/gi,
  ]
  for (const pattern of patterns) {
    let match: RegExpExecArray | null
    while ((match = pattern.exec(html))) {
      const absolute = toAbsoluteSpecUrl(match[1], sourceUrl)
      if (absolute) candidates.add(absolute)
    }
  }
  return [...candidates]
}

function findExternalRefs(value: unknown, refs = new Set<string>()): Set<string> {
  if (!value || typeof value !== 'object') return refs
  if (Array.isArray(value)) {
    value.forEach(item => findExternalRefs(item, refs))
    return refs
  }
  for (const [key, nested] of Object.entries(value as Record<string, unknown>)) {
    if (key === '$ref' && typeof nested === 'string' && !nested.startsWith('#/')) {
      refs.add(nested)
    } else {
      findExternalRefs(nested, refs)
    }
  }
  return refs
}

function ensureSchemaContainer(target: any): Record<string, unknown> {
  if (!target.components) target.components = {}
  if (!target.components.schemas) target.components.schemas = {}
  return target.components.schemas
}

function mergeExternalSpec(target: any, external: any): void {
  if (!target.components) target.components = {}
  if (!target.definitions) target.definitions = {}
  if (external.components?.schemas) {
    target.components.schemas = { ...(target.components.schemas ?? {}), ...external.components.schemas }
  }
  if (external.components?.parameters) {
    target.components.parameters = { ...(target.components.parameters ?? {}), ...external.components.parameters }
  }
  if (external.components?.requestBodies) {
    target.components.requestBodies = { ...(target.components.requestBodies ?? {}), ...external.components.requestBodies }
  }
  if (external.definitions) {
    target.definitions = { ...(target.definitions ?? {}), ...external.definitions }
  }
  if (external.parameters) {
    target.parameters = { ...(target.parameters ?? {}), ...external.parameters }
  }
}

function pointerFromHash(ref: string): string {
  const hashIndex = ref.indexOf('#')
  if (hashIndex < 0) return ''
  const hash = ref.slice(hashIndex)
  return hash === '#' ? '' : hash.replace(/^#/, '')
}

function hasOpenApiContainers(external: any): boolean {
  return Boolean(
    external?.openapi ||
    external?.swagger ||
    external?.components ||
    external?.definitions ||
    external?.parameters,
  )
}

function externalSchemaName(ref: string, absolute: string, target: any): string {
  const schemas = ensureSchemaContainer(target)
  let base = 'ExternalSchema'
  try {
    const parsed = new URL(absolute)
    base = decodeURIComponent(parsed.pathname.split('/').filter(Boolean).pop() || base)
  } catch {
    base = ref.split('#')[0].split('/').filter(Boolean).pop() || base
  }
  base = base.replace(/\.(json|ya?ml)$/i, '').replace(/[^A-Za-z0-9_]+/g, '_').replace(/^_+|_+$/g, '') || 'ExternalSchema'
  if (/^[0-9]/.test(base)) base = `Schema_${base}`

  let candidate = base
  let suffix = 2
  while (schemas[candidate]) {
    candidate = `${base}_${suffix++}`
  }
  return candidate
}

function localRefForMergedExternal(target: any, external: any, ref: string, absolute: string): string | null {
  const pointer = pointerFromHash(ref)
  if (hasOpenApiContainers(external)) {
    mergeExternalSpec(target, external)
    if (pointer.startsWith('/components/') || pointer.startsWith('/definitions/') || pointer.startsWith('/parameters/')) {
      return `#${pointer}`
    }
  }

  const schemas = ensureSchemaContainer(target)
  const name = externalSchemaName(ref, absolute, target)
  schemas[name] = external
  return `#/components/schemas/${name}${pointer}`
}

function rewriteExternalRefs(value: unknown, refMap: Map<string, string>): void {
  if (!value || typeof value !== 'object') return
  if (Array.isArray(value)) {
    value.forEach(item => rewriteExternalRefs(item, refMap))
    return
  }
  const obj = value as Record<string, unknown>
  if (typeof obj.$ref === 'string' && !obj.$ref.startsWith('#/')) {
    const rewritten = refMap.get(obj.$ref) ?? refMap.get(obj.$ref.split('#')[0])
    if (rewritten) obj.$ref = rewritten
  }
  Object.values(obj).forEach(item => rewriteExternalRefs(item, refMap))
}

async function resolveExternalOpenApiRefs(text: string, sourceUrl: string, options?: Pick<DataSourceSyncOptions, 'onLog'>): Promise<{ text: string; apis: ApiConfig[] }> {
  const spec = parseOpenApiSpec(text)
  if (!spec) return { text, apis: [] }
  const refMap = new Map<string, string>()
  const processed = new Set<string>()
  let queue = [...findExternalRefs(spec)].filter(Boolean).map(ref => ({ ref, baseUrl: sourceUrl }))
  if (queue.length === 0) return { text, apis: importOpenApiSpec(spec) }

  log(options, `发现 ${queue.length} 个外部 $ref，尝试递归合并 OpenAPI 组件与 JSON Schema。`)
  while (queue.length > 0 && processed.size < 24) {
    const item = queue.shift()
    if (!item?.ref) continue
    const { ref, baseUrl } = item
    const processedKey = `${baseUrl}::${ref}`
    if (processed.has(processedKey)) continue
    processed.add(processedKey)
    const docRef = ref.split('#')[0]
    const absolute = toAbsoluteSpecUrl(docRef, baseUrl)
    if (!absolute) continue
    try {
      log(options, `拉取外部 $ref：${absolute}`)
      const externalText = await fetchDataSourceText(absolute)
      const externalSpec = parseOpenApiSpec(externalText)
      if (externalSpec) {
        const localRef = localRefForMergedExternal(spec as any, externalSpec as any, ref, absolute)
        if (localRef) {
          refMap.set(ref, localRef)
          if (!ref.includes('#')) refMap.set(docRef, localRef)
        }
        const nestedRefs = [...findExternalRefs(externalSpec)].filter(item => !processed.has(item))
        queue = [...queue, ...nestedRefs.map(nestedRef => ({ ref: nestedRef, baseUrl: absolute }))]
      }
    } catch {
      log(options, `外部 $ref 拉取失败：${absolute}`)
    }
  }
  rewriteExternalRefs(spec, refMap)
  return { text: JSON.stringify(spec, null, 2), apis: importOpenApiSpec(spec) }
}

export async function resolveOpenApiTextFromDataSource(
  url: string,
  options?: Pick<DataSourceSyncOptions, 'onLog'>,
): Promise<{ text: string; sourceUrl: string; apis: ApiConfig[] }> {
  const text = await fetchDataSourceText(url)
  let resolved = await resolveExternalOpenApiRefs(text, url, options)
  let apis = resolved.apis.length > 0 ? resolved.apis : importOpenApi(text)
  if (apis.length > 0) return { text: resolved.text || text, sourceUrl: url, apis }

  const candidates = extractOpenApiCandidateUrls(text, url)
  if (candidates.length > 0) log(options, `从页面发现 ${candidates.length} 个规格候选地址。`)
  for (const candidate of candidates) {
    try {
      log(options, `尝试规格地址：${candidate}`)
      const candidateText = await fetchDataSourceText(candidate)
      resolved = await resolveExternalOpenApiRefs(candidateText, candidate, options)
      apis = resolved.apis.length > 0 ? resolved.apis : importOpenApi(candidateText)
      if (apis.length > 0) return { text: resolved.text || candidateText, sourceUrl: candidate, apis }
    } catch {
      log(options, `候选地址失败：${candidate}`)
    }
  }
  return { text, sourceUrl: url, apis: [] }
}

async function ensureImportFolder(moduleId: string, name: string): Promise<string | null> {
  const workspace = useWorkspaceStore()
  const folderName = name.trim()
  if (!folderName) return null
  const existing = workspace.interfaces.find(item =>
    item.moduleId === moduleId &&
    (item.nodeType ?? 'request') === 'folder' &&
    (item.parentId ?? null) === null &&
    item.name === folderName,
  )
  if (existing) return existing.id
  const folder = await workspace.addFolder(moduleId, folderName)
  return folder.id
}

function findModuleApiByMethodUrl(moduleId: string, api: ApiConfig): ApiConfig | null {
  const workspace = useWorkspaceStore()
  const store = useAppStore()
  const apiIds = workspace.interfaces
    .filter(item => item.moduleId === moduleId && (item.nodeType ?? 'request') !== 'folder')
    .map(item => item.apiId)
  return apiIds.map(id => store.apis[id]).find(item => item?.method === api.method && item?.url === api.url) ?? null
}

function syncSuccessDataSource(dataSource: ModuleDataSource, result: DataSourceSyncResult): ModuleDataSource {
  return {
    ...dataSource,
    lastSyncAt: result.finishedAt,
    lastSyncStatus: 'success',
    lastSyncMessage: result.message,
    lastSyncSourceUrl: result.sourceUrl,
    nextSyncAt: dataSource.syncStrategy === 'auto'
      ? result.finishedAt + getDataSourceIntervalMinutes(dataSource) * 60_000
      : undefined,
  }
}

function syncFailureDataSource(dataSource: ModuleDataSource, message: string): ModuleDataSource {
  const finishedAt = now()
  return {
    ...dataSource,
    lastSyncAt: finishedAt,
    lastSyncStatus: 'failed',
    lastSyncMessage: message,
    nextSyncAt: dataSource.syncStrategy === 'auto'
      ? finishedAt + Math.min(getDataSourceIntervalMinutes(dataSource), 15) * 60_000
      : undefined,
  }
}

export async function syncModuleDataSource(
  moduleId: string,
  options: DataSourceSyncOptions = {},
): Promise<DataSourceSyncResult> {
  const workspace = useWorkspaceStore()
  const store = useAppStore()
  const module = workspace.modules.find(item => item.id === moduleId)
  const dataSource = options.dataSource ?? module?.dataSource ?? null
  if (!module) throw new Error('模块不存在')
  if (!dataSource?.url) throw new Error('请先填写数据源 URL')

  const startedAt = now()
  log(options, `开始同步：${dataSource.url}`)

  try {
    const { text, sourceUrl, apis: resolvedApis } = await resolveOpenApiTextFromDataSource(dataSource.url, options)
    const importedApis = applyDataSourceFieldMapping(
      resolvedApis,
      getOpenApiMetadataByImport(text, resolvedApis),
      dataSource.fieldMapping,
    )
    if (importedApis.length === 0) {
      const finishedAt = now()
      const result: DataSourceSyncResult = {
        moduleId,
        sourceUrl,
        text,
        importedCount: 0,
        created: 0,
        updated: 0,
        skipped: 0,
        startedAt,
        finishedAt,
        message: '未识别到 OpenAPI/Swagger paths；已保存原始文本。',
      }
      const nextDataSource = syncSuccessDataSource(dataSource, result)
      if (options.saveWhenEmpty !== false) {
        await workspace.updateModule(moduleId, { dataSource: nextDataSource, openapiText: text })
      } else {
        await workspace.updateModule(moduleId, { dataSource: nextDataSource })
      }
      await writeModuleSyncLog({
        moduleId,
        action: options.syncAction ?? 'manual-sync',
        status: 'partial',
        message: result.message,
        createdCount: 0,
        updatedCount: 0,
        skippedCount: 0,
        timestamp: finishedAt,
      })
      log(options, result.message)
      return result
    }

    let created = 0
    let updated = 0
    let skipped = 0
    for (const imported of importedApis) {
      const existing = findModuleApiByMethodUrl(moduleId, imported)
      if (existing) {
        void store.updateApiNow(existing.id, {
          name: imported.name,
          description: imported.description,
          headers: imported.headers,
          params: imported.params,
          body: imported.body,
          auth: imported.auth,
          cookies: imported.cookies,
          preRequestScript: existing.preRequestScript,
          postRequestScript: existing.postRequestScript,
          folder: imported.folder,
        })
        const interfaceNode = workspace.interfaces.find(item =>
          item.moduleId === moduleId &&
          item.apiId === existing.id &&
          (item.nodeType ?? 'request') === 'request',
        )
        if (interfaceNode) {
          const parentId = imported.folder ? await ensureImportFolder(moduleId, imported.folder) : null
          if ((interfaceNode.parentId ?? null) !== parentId) {
            await workspace.updateInterfaceNode(interfaceNode.id, { parentId })
          }
        }
        updated++
        continue
      }
      try {
        const parentId = imported.folder ? await ensureImportFolder(moduleId, imported.folder) : null
        await store.addApi(imported, moduleId, parentId)
        created++
      } catch {
        skipped++
      }
    }

    const finishedAt = now()
    const result: DataSourceSyncResult = {
      moduleId,
      sourceUrl,
      text,
      importedCount: importedApis.length,
      created,
      updated,
      skipped,
      startedAt,
      finishedAt,
      message: `同步完成：来源 ${sourceUrl}，新增 ${created} 个，更新 ${updated} 个${skipped ? `，跳过 ${skipped} 个` : ''}。`,
    }
    await workspace.updateModule(moduleId, {
      dataSource: syncSuccessDataSource(dataSource, result),
      openapiText: text,
    })
    await writeModuleSyncLog({
      moduleId,
      action: options.syncAction ?? 'manual-sync',
      status: skipped > 0 && created === 0 && updated === 0 ? 'partial' : 'success',
      message: result.message,
      createdCount: created,
      updatedCount: updated,
      skippedCount: skipped,
      timestamp: finishedAt,
    })
    log(options, result.message)
    return result
  } catch (err) {
    const finishedAt = now()
    const message = err instanceof Error ? err.message : String(err)
    await workspace.updateModule(moduleId, { dataSource: syncFailureDataSource(dataSource, message) })
    await writeModuleSyncLog({
      moduleId,
      action: options.syncAction ?? 'manual-sync',
      status: 'error',
      message: `同步失败：${message}`,
      createdCount: 0,
      updatedCount: 0,
      skippedCount: 0,
      timestamp: finishedAt,
    })
    log(options, `同步失败：${message}`)
    throw err
  }
}
