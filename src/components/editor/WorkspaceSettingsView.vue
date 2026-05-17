<script setup lang="ts">
import { computed, ref, watch } from 'vue'
import { useAppStore } from '@/stores/app'
import { useWorkspaceStore } from '@/stores/workspace'
import { generateMarkdownDoc, generateOpenApiSpec, generateOpenApiYamlSpec } from '@/utils/export'
import { importOpenApi } from '@/utils/openapi-import'
import { getDataSourceIntervalMinutes, syncModuleDataSource } from '@/utils/data-source-sync'
import { sendRequest } from '@/utils/http'
import { db } from '@/db'
import CodeMirrorEditor from '@/components/common/CodeMirrorEditor.vue'
import type { ApiConfig, InterfaceTestCase, KvPair, ModuleDataModel, ModuleDataSource, ModuleDocArtifact, ModuleExportConfig, ModuleAuditLog, ModuleScenarioCase, ModuleStats, ModuleType, ModuleVariables, ResponseData } from '@/types'

const store = useAppStore()
const workspace = useWorkspaceStore()

const categoryName = ref('')
const categoryColor = ref('#6366f1')
const categoryDescription = ref('')
const moduleName = ref('')
const moduleCategoryId = ref('')
const moduleDescription = ref('')
const moduleType = ref<ModuleType>('generic')
const exportFormat = ref<ModuleExportConfig['format']>('openapi3')
const exportAutoBackup = ref(false)
const exportBackupTarget = ref<NonNullable<ModuleExportConfig['backupTarget']>>('local')
const exportBackupEndpoint = ref('')
const exportBackupToken = ref('')
const exportBackupFileName = ref('')
const exportTeamRole = ref<NonNullable<ModuleExportConfig['teamRole']>>('owner')
const exportConflictStrategy = ref<NonNullable<ModuleExportConfig['conflictStrategy']>>('prompt')
const permissionEditSettings = ref(true)
const permissionEditVariables = ref(true)
const permissionSyncDataSource = ref(true)
const permissionBackup = ref(true)
const dataSourceType = ref<ModuleDataSource['type']>('openapi')
const dataSourceUrl = ref('')
const dataSourceSyncStrategy = ref<ModuleDataSource['syncStrategy']>('manual')
const dataSourceSyncIntervalMinutes = ref(60)
const dataSourceWebhookSecret = ref('')
const dataSourceMappingText = ref('operationId=接口名称\nsummary=接口描述\ntags[0]=文件夹分类')
const openapiText = ref('')
const activeModuleTab = ref<'overview' | 'variables' | 'artifacts' | 'settings'>('overview')
const saveMessage = ref('')
const isSyncingDataSource = ref(false)
const dataSourceSyncLog = ref<string[]>([])
const moduleDocs = ref<ModuleDocArtifact[]>([])
const moduleModels = ref<ModuleDataModel[]>([])
const interfaceTestCases = ref<InterfaceTestCase[]>([])
const moduleScenarioCases = ref<ModuleScenarioCase[]>([])
const moduleAuditLogs = ref<ModuleAuditLog[]>([])
const docDraft = ref({ id: '', title: '', interfaceId: '', format: 'markdown' as ModuleDocArtifact['format'], content: '' })
const modelDraft = ref({ id: '', name: '', description: '', schemaText: '{\n  \"type\": \"object\",\n  \"properties\": {}\n}' })
const testCaseDraft = ref({ id: '', interfaceId: '', name: '', expectedStatus: 200, assertionsText: 'status=200' })
const extractorDraft = ref({ variable: '', sourceType: 'json' as 'json' | 'header' | 'body', path: '$.data.token' })
const bulkEditDraft = ref({
  target: 'headers' as 'headers' | 'params',
  operation: 'upsert' as 'upsert' | 'addMissing' | 'replaceExisting' | 'remove',
  key: '',
  value: '',
  enabled: true,
  onlyEnabledRequests: false,
})
const runningCaseId = ref<string | null>(null)
const runningScenarioId = ref<string | null>(null)
let messageTimer: ReturnType<typeof setTimeout> | null = null
let backupInProgress = false

interface BackupConflictField {
  field: string
  remote: string
  local: string
  changed: boolean
  useRemote: boolean
}

type BackupConflictDecision =
  | { action: 'cancel' }
  | { action: 'overwrite' }
  | { action: 'merge'; remoteFields: string[] }

const backupConflictPreview = ref<{
  remoteSummary: string
  localSummary: string
  rows: BackupConflictField[]
  resolve: (decision: BackupConflictDecision) => void
} | null>(null)

interface ScenarioDraftStep {
  caseId: string
  enabled: boolean
  continueOnFailure: boolean
}

function createEmptyScenarioDraft() {
  return { id: '', name: '', description: '', selectedCaseId: '', steps: [] as ScenarioDraftStep[], continueOnFailure: false }
}

const scenarioDraft = ref(createEmptyScenarioDraft())

interface VariableRow {
  key: string
  remote: string
  local: string
  description: string
  environmentValues: Record<string, string>
}

const variableRows = ref<VariableRow[]>([])
const variableImportInput = ref<HTMLInputElement | null>(null)
const variableRenameDraft = ref({ from: '', to: '' })

const moduleTypes: Array<{ value: ModuleType; icon: string; title: string; desc: string }> = [
  { value: 'generic', icon: '🟦', title: '通用 API', desc: '通过可视化表单设计、调试和维护接口。' },
  { value: 'openapi-yaml', icon: '📄', title: 'OpenAPI YAML', desc: '面向已有 Swagger/OpenAPI 文档的 YAML/JSON 编辑模式。' },
  { value: 'readonly', icon: '🔒', title: '只读模式', desc: '禁止手动修改，适合通过导入或同步更新的接口。' },
]

const activeCategory = computed(() => workspace.activeCategory)
const activeModule = computed(() => workspace.activeModule)

const selectedCategoryModuleCount = computed(() => {
  if (!activeCategory.value) return 0
  return workspace.modules.filter(item => item.categoryId === activeCategory.value?.id).length
})

const selectedCategoryInterfaceCount = computed(() => {
  if (!activeCategory.value) return 0
  const moduleIds = workspace.modules
    .filter(item => item.categoryId === activeCategory.value?.id)
    .map(item => item.id)
  return workspace.interfaces.filter(item => moduleIds.includes(item.moduleId) && (item.nodeType ?? 'request') !== 'folder').length
})

const categoryModules = computed(() => {
  if (!activeCategory.value) return []
  return workspace.modules
    .filter(item => item.categoryId === activeCategory.value?.id)
    .sort((a, b) => a.order - b.order)
})

const selectedModuleInterfaceCount = computed(() => {
  if (!activeModule.value) return 0
  return workspace.interfaces.filter(item => item.moduleId === activeModule.value?.id && (item.nodeType ?? 'request') !== 'folder').length
})

const selectedModuleCategoryName = computed(() => {
  const category = workspace.categories.find(item => item.id === activeModule.value?.categoryId)
  return category?.name ?? '未选择分组'
})

const moduleInterfaces = computed(() => {
  if (!activeModule.value) return []
  return workspace.interfaces
    .filter(item => item.moduleId === activeModule.value?.id && (item.nodeType ?? 'request') !== 'folder')
    .sort((a, b) => a.order - b.order)
})

const selectedModuleType = computed(() => moduleTypes.find(item => item.value === moduleType.value) ?? moduleTypes[0])

const openapiPreviewApis = computed(() => {
  if (!openapiText.value.trim()) return []
  return importOpenApi(openapiText.value)
})

const openapiPreviewError = computed(() => {
  const text = openapiText.value.trim()
  if (!text) return ''
  if (openapiPreviewApis.value.length > 0) return ''
  if (!text.startsWith('{')) return '未识别到有效的 OpenAPI/Swagger YAML paths。'
  return '未识别到有效的 OpenAPI/Swagger paths。'
})

const moduleStats = computed(() => {
  const coveredInterfaceIds = new Set(interfaceTestCases.value.map(item => item.interfaceId))
  const scenarioCoveredInterfaceIds = new Set(
    moduleScenarioCases.value.flatMap(scenario => scenario.steps.map(step => step.interfaceId)),
  )
  const interfaceCount = selectedModuleInterfaceCount.value
  const coveredCount = moduleInterfaces.value.filter(item => coveredInterfaceIds.has(item.id)).length
  const scenarioCoveredCount = moduleInterfaces.value.filter(item => scenarioCoveredInterfaceIds.has(item.id)).length
  const caseCoverageNumber = interfaceCount > 0 ? Math.round((coveredCount / interfaceCount) * 100) : 0
  const sceneCoverageNumber = interfaceCount > 0 ? Math.round((scenarioCoveredCount / interfaceCount) * 100) : 0
  const uncoveredInterfaceCount = Math.max(0, interfaceCount - coveredCount)
  return {
    interfaceCount,
    docCount: moduleDocs.value.length,
    modelCount: moduleModels.value.length,
    caseTotal: interfaceTestCases.value.length,
    caseCoverage: `${caseCoverageNumber}%`,
    caseCoverageNumber,
    sceneCaseTotal: moduleScenarioCases.value.length,
    sceneCoverage: `${sceneCoverageNumber}%`,
    sceneCoverageNumber,
    avgCasePerInterface: interfaceCount > 0 ? (interfaceTestCases.value.length / interfaceCount).toFixed(1) : '0.0',
    uncoveredInterfaceCount,
  }
})

const moduleActivityTrend = computed(() => {
  const module = activeModule.value
  if (!module) return []
  const apiIds = new Set(moduleInterfaces.value.map(item => item.apiId))
  const days = Array.from({ length: 7 }, (_, index) => {
    const date = new Date()
    date.setHours(0, 0, 0, 0)
    date.setDate(date.getDate() - (6 - index))
    return {
      start: date.getTime(),
      end: date.getTime() + 86_400_000,
      label: `${date.getMonth() + 1}/${date.getDate()}`,
      count: 0,
      height: 0,
    }
  })
  for (const item of store.history) {
    if (!apiIds.has(item.apiId)) continue
    const day = days.find(entry => item.timestamp >= entry.start && item.timestamp < entry.end)
    if (day) day.count++
  }
  const max = Math.max(1, ...days.map(item => item.count))
  return days.map(item => ({
    ...item,
    height: Math.max(8, Math.round((item.count / max) * 64)),
    peak: item.count > 0 && item.count === max,
    percent: Math.round((item.count / max) * 100),
  }))
})

interface UnresolvedVariableRef {
  ref: string
  interfaces: string[]
}

function normalizeVariableRefKey(ref: string): string {
  return ref.includes(':') ? ref.slice(0, ref.indexOf(':')).trim() : ref.trim()
}

function getUnresolvedVariableRefs(variablesOverride?: ModuleVariables): UnresolvedVariableRef[] {
  const module = activeModule.value
  if (!module) return []
  const moduleKeys = new Set(Object.keys(variablesOverride ?? module.variables ?? {}))
  const env = store.environments.find(item => item.id === store.currentEnvId)
  const envKeys = new Set((env?.variables ?? []).filter(item => item.enabled).map(item => item.key))
  const scopedKeys = new Set(workspace.modules.flatMap(item => Object.keys(item.variables ?? {}).map(key => `${item.name}.${key}`)))
  const missing = new Map<string, UnresolvedVariableRef>()

  function isKnown(ref: string, api?: ApiConfig): boolean {
    const key = normalizeVariableRefKey(ref)
    if (!key || key.startsWith('$')) return true
    if (api?.requestVariables?.some(item => item.enabled && item.key === key)) return true
    if (moduleKeys.has(key) || envKeys.has(key) || scopedKeys.has(key)) return true
    return false
  }

  for (const node of moduleInterfaces.value) {
    const api = store.apis[node.apiId]
    if (!api) continue
    const refs = collectApiTemplateRefs(api)
    for (const ref of refs) {
      if (isKnown(ref, api)) continue
      const key = normalizeVariableRefKey(ref)
      const existing = missing.get(key) ?? { ref: key, interfaces: [] }
      const label = `${api.method} ${api.name || node.name}`
      if (!existing.interfaces.includes(label)) existing.interfaces.push(label)
      missing.set(key, existing)
    }
  }
  return Array.from(missing.values()).sort((a, b) => a.ref.localeCompare(b.ref))
}

const unresolvedVariableRefs = computed(() => getUnresolvedVariableRefs())

function confirmUnresolvedVariableRefs(refs: UnresolvedVariableRef[], action: string): boolean {
  if (refs.length === 0) return true
  const preview = refs.slice(0, 6).map(item => `{{${item.ref}}}：${item.interfaces.slice(0, 2).join('、')}`).join('\n')
  const suffix = refs.length > 6 ? `\n……另有 ${refs.length - 6} 个变量未解析` : ''
  return window.confirm(`保存前变量校验发现 ${refs.length} 个未解析引用：\n${preview}${suffix}\n\n仍要${action}吗？`)
}

watch(activeCategory, (category) => {
  categoryName.value = category?.name ?? ''
  categoryColor.value = category?.color || '#6366f1'
  categoryDescription.value = category?.description ?? ''
  clearMessage()
}, { immediate: true })

watch(activeModule, (module, previousModule) => {
  const moduleChanged = module?.id !== previousModule?.id
  moduleName.value = module?.name ?? ''
  moduleCategoryId.value = module?.categoryId ?? ''
  moduleDescription.value = module?.description ?? ''
  moduleType.value = module?.type ?? 'generic'
  exportFormat.value = module?.exportConfig?.format ?? 'openapi3'
  exportAutoBackup.value = module?.exportConfig?.autoBackup ?? false
  exportBackupTarget.value = module?.exportConfig?.backupTarget ?? 'local'
  exportBackupEndpoint.value = module?.exportConfig?.backupEndpoint ?? ''
  exportBackupToken.value = module?.exportConfig?.backupToken ?? ''
  exportBackupFileName.value = module?.exportConfig?.backupFileName ?? ''
  exportTeamRole.value = module?.exportConfig?.teamRole ?? 'owner'
  exportConflictStrategy.value = module?.exportConfig?.conflictStrategy ?? 'prompt'
  const permissions = module?.exportConfig?.permissions
  const isViewer = (module?.exportConfig?.teamRole ?? 'owner') === 'viewer'
  permissionEditSettings.value = permissions?.editSettings ?? !isViewer
  permissionEditVariables.value = permissions?.editVariables ?? !isViewer
  permissionSyncDataSource.value = permissions?.syncDataSource ?? !isViewer
  permissionBackup.value = permissions?.backup ?? !isViewer
  dataSourceType.value = module?.dataSource?.type ?? 'openapi'
  dataSourceUrl.value = module?.dataSource?.url ?? ''
  dataSourceSyncStrategy.value = module?.dataSource?.syncStrategy ?? 'manual'
  dataSourceSyncIntervalMinutes.value = getDataSourceIntervalMinutes(module?.dataSource)
  dataSourceWebhookSecret.value = module?.dataSource?.webhookSecret ?? ''
  dataSourceMappingText.value = module?.dataSource?.fieldMapping
    ? Object.entries(module.dataSource.fieldMapping).map(([source, target]) => `${source}=${target}`).join('\n')
    : 'operationId=接口名称\nsummary=接口描述\ntags[0]=文件夹分类'
  openapiText.value = module?.openapiText ?? ''
  variableRows.value = moduleVariablesToRows(module?.variables)
  if (moduleChanged) {
    activeModuleTab.value = 'overview'
    resetArtifactDrafts()
    void loadModuleArtifacts(module?.id)
  }
  clearMessage()
}, { immediate: true })

function resetArtifactDrafts() {
  docDraft.value = { id: '', title: '', interfaceId: '', format: 'markdown', content: '' }
  modelDraft.value = { id: '', name: '', description: '', schemaText: '{\n  \"type\": \"object\",\n  \"properties\": {}\n}' }
  testCaseDraft.value = { id: '', interfaceId: '', name: '', expectedStatus: 200, assertionsText: 'status=200' }
  scenarioDraft.value = createEmptyScenarioDraft()
}

async function loadModuleArtifacts(moduleId?: string) {
  if (!moduleId) {
    moduleDocs.value = []
    moduleModels.value = []
    interfaceTestCases.value = []
    moduleScenarioCases.value = []
    moduleAuditLogs.value = []
    return
  }
  const [docs, models, cases, scenarios, auditLogs] = await Promise.all([
    db.moduleDocs.where('moduleId').equals(moduleId).toArray(),
    db.moduleModels.where('moduleId').equals(moduleId).toArray(),
    db.interfaceTestCases.where('moduleId').equals(moduleId).toArray(),
    db.moduleScenarioCases.where('moduleId').equals(moduleId).toArray(),
    db.moduleAuditLogs.where('moduleId').equals(moduleId).toArray(),
  ])
  moduleDocs.value = docs.sort((a, b) => b.updatedAt - a.updatedAt)
  moduleModels.value = models.sort((a, b) => b.updatedAt - a.updatedAt)
  interfaceTestCases.value = cases.sort((a, b) => b.updatedAt - a.updatedAt)
  moduleScenarioCases.value = scenarios.sort((a, b) => b.updatedAt - a.updatedAt)
  moduleAuditLogs.value = auditLogs.sort((a, b) => b.createdAt - a.createdAt).slice(0, 20)
}

async function recordModuleAudit(action: string, detail: string) {
  const module = activeModule.value
  if (!module) return
  const log: ModuleAuditLog = {
    id: `audit:${Date.now().toString(36)}${Math.random().toString(36).slice(2, 8)}`,
    moduleId: module.id,
    action,
    detail,
    createdAt: Date.now(),
  }
  await db.moduleAuditLogs.put(log)
  moduleAuditLogs.value = [log, ...moduleAuditLogs.value].slice(0, 20)
}

function buildModuleStatsSnapshot(): ModuleStats {
  return {
    interfaceCount: moduleStats.value.interfaceCount,
    docCount: moduleStats.value.docCount,
    modelCount: moduleStats.value.modelCount,
    testCaseTotal: moduleStats.value.caseTotal,
    testCaseCoverage: moduleStats.value.caseCoverageNumber,
    sceneCaseTotal: moduleStats.value.sceneCaseTotal,
    sceneCaseCoverage: moduleStats.value.sceneCoverageNumber,
    avgCasePerInterface: Number(moduleStats.value.avgCasePerInterface),
    uncoveredInterfaceCount: moduleStats.value.uncoveredInterfaceCount,
  }
}

async function refreshArtifacts(message?: string) {
  await loadModuleArtifacts(activeModule.value?.id)
  const module = activeModule.value
  if (module) {
    await workspace.updateModule(module.id, { stats: buildModuleStatsSnapshot() })
  }
  if (message) showSaved(message)
}

function clearMessage() {
  if (messageTimer) {
    clearTimeout(messageTimer)
    messageTimer = null
  }
  saveMessage.value = ''
}

function showSaved(message = '已保存') {
  saveMessage.value = message
  if (messageTimer) clearTimeout(messageTimer)
  messageTimer = setTimeout(() => {
    saveMessage.value = ''
    messageTimer = null
  }, 1800)
}

function formatTime(timestamp?: number): string {
  if (!timestamp) return '-'
  return new Date(timestamp).toLocaleString()
}

function moduleVariablesToRows(variables?: ModuleVariables): VariableRow[] {
  return Object.entries(variables ?? {}).map(([key, value]) => ({
    key,
    remote: value.remote ?? '',
    local: value.local ?? '',
    description: value.description ?? '',
    environmentValues: { ...(value.environmentValues ?? {}) },
  }))
}

function rowsToModuleVariables(): ModuleVariables {
  const variables: ModuleVariables = {}
  for (const row of variableRows.value) {
    const key = row.key.trim()
    if (!key) continue
    variables[key] = {
      remote: row.remote,
      local: row.local,
      description: row.description,
      environmentValues: { ...row.environmentValues },
    }
  }
  return variables
}

function parseFieldMapping(text: string): Record<string, string> {
  const mapping: Record<string, string> = {}
  for (const line of text.split('\n')) {
    const trimmed = line.trim()
    if (!trimmed || trimmed.startsWith('#')) continue
    const idx = trimmed.indexOf('=')
    if (idx <= 0) continue
    mapping[trimmed.slice(0, idx).trim()] = trimmed.slice(idx + 1).trim()
  }
  return mapping
}

function collectTemplateRefsFromString(value?: string): string[] {
  if (!value) return []
  return Array.from(value.matchAll(/\{\{([^}]+)\}\}/g)).map(match => match[1].trim()).filter(Boolean)
}

function collectApiTemplateRefs(api: ApiConfig): string[] {
  const fields: string[] = [
    api.url,
    api.auth.bearerToken,
    api.auth.basicUsername,
    api.auth.basicPassword,
    api.auth.apiKeyName,
    api.auth.apiKeyValue,
    api.body.raw,
    ...(api.params ?? []).flatMap(item => [item.key, item.value]),
    ...(api.headers ?? []).flatMap(item => [item.key, item.value]),
    ...(api.cookies ?? []).flatMap(item => [item.key, item.value]),
    ...(api.body.formData ?? []).flatMap(item => [item.key, item.value]),
    ...(api.body.urlEncoded ?? []).flatMap(item => [item.key, item.value]),
    ...(api.requestVariables ?? []).flatMap(item => [item.value]),
  ]
  return Array.from(new Set(fields.flatMap(field => collectTemplateRefsFromString(field))))
}

function escapeRegExp(value: string): string {
  return value.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')
}

function replaceTemplateRefInString(value: string | undefined, from: string, to: string): string {
  if (!value) return value ?? ''
  const pattern = new RegExp(`\\{\\{\\s*${escapeRegExp(from)}(\\s*:[^}]*)?\\s*\\}\\}`, 'g')
  return value.replace(pattern, (_match, suffix = '') => `{{${to}${suffix}}}`)
}

function replaceTemplateRefsInPairs<T extends KvPair>(pairs: T[] | undefined, from: string, to: string): T[] {
  return (pairs ?? []).map(item => ({
    ...item,
    key: replaceTemplateRefInString(item.key, from, to),
    value: replaceTemplateRefInString(item.value, from, to),
  }))
}

function findPairIndex(list: KvPair[], key: string, target: 'headers' | 'params'): number {
  const normalizedKey = key.trim()
  const comparableKey = target === 'headers' ? normalizedKey.toLowerCase() : normalizedKey
  return list.findIndex(item => {
    const itemKey = item.key.trim()
    return target === 'headers' ? itemKey.toLowerCase() === comparableKey : itemKey === comparableKey
  })
}

function getBulkEditAffectedCount(): number {
  const key = bulkEditDraft.value.key.trim()
  if (!key) return 0
  return moduleInterfaces.value.reduce((count, node) => {
    const api = store.apis[node.apiId]
    if (!api) return count
    const pairs = api[bulkEditDraft.value.target] ?? []
    const existingIndex = findPairIndex(pairs, key, bulkEditDraft.value.target)
    if (bulkEditDraft.value.operation === 'addMissing') return count + (existingIndex === -1 ? 1 : 0)
    if (bulkEditDraft.value.operation === 'replaceExisting' || bulkEditDraft.value.operation === 'remove') return count + (existingIndex >= 0 ? 1 : 0)
    return count + 1
  }, 0)
}

const bulkEditAffectedCount = computed(() => getBulkEditAffectedCount())

function applyBulkEditToPairs(pairs: KvPair[], target: 'headers' | 'params'): { next: KvPair[]; changed: boolean } {
  const key = bulkEditDraft.value.key.trim()
  const value = bulkEditDraft.value.value
  const existingIndex = findPairIndex(pairs, key, target)
  const operation = bulkEditDraft.value.operation
  if (operation === 'remove') {
    if (existingIndex === -1) return { next: pairs, changed: false }
    return { next: pairs.filter((_, index) => index !== existingIndex), changed: true }
  }
  if (operation === 'addMissing' && existingIndex >= 0) return { next: pairs, changed: false }
  if (operation === 'replaceExisting' && existingIndex === -1) return { next: pairs, changed: false }

  const nextPair: KvPair = { key, value, enabled: bulkEditDraft.value.enabled }
  if (existingIndex === -1) return { next: [...pairs, nextPair], changed: true }

  const next = pairs.map((item, index) => index === existingIndex ? { ...item, value, enabled: bulkEditDraft.value.enabled } : item)
  const previous = pairs[existingIndex]
  return { next, changed: previous.value !== value || previous.enabled !== bulkEditDraft.value.enabled }
}

async function applyModuleBulkEdit() {
  const module = activeModule.value
  const key = bulkEditDraft.value.key.trim()
  if (!module || !key) return
  const affectedCount = bulkEditAffectedCount.value
  if (affectedCount === 0) {
    showSaved('没有匹配的接口需要批量修改')
    return
  }
  const operationLabel = {
    upsert: '新增/覆盖',
    addMissing: '仅缺失时新增',
    replaceExisting: '仅替换已有',
    remove: '删除',
  }[bulkEditDraft.value.operation]
  const targetLabel = bulkEditDraft.value.target === 'headers' ? 'Header' : 'Query 参数'
  if (!window.confirm(`确认对模块「${module.name}」中的 ${affectedCount} 个接口${operationLabel} ${targetLabel}「${key}」吗？`)) {
    return
  }

  let changedCount = 0
  for (const node of moduleInterfaces.value) {
    const api = store.apis[node.apiId]
    if (!api) continue
    const target = bulkEditDraft.value.target
    const { next, changed } = applyBulkEditToPairs([...(api[target] ?? [])], target)
    if (!changed) continue
    changedCount++
    store.updateApi(api.id, { [target]: next } as Pick<ApiConfig, typeof target>)
  }
  if (changedCount > 0) {
    await recordModuleAudit('批量编辑请求', `${operationLabel}${targetLabel}「${key}」，影响 ${changedCount} 个接口`)
  }
  showSaved(`已批量修改 ${changedCount} 个接口`)
}

function moduleModeFromType(type: ModuleType): 'visual' | 'yaml' | 'readonly' {
  if (type === 'openapi-yaml') return 'yaml'
  if (type === 'readonly') return 'readonly'
  return 'visual'
}

function buildExportConfig(): ModuleExportConfig {
  return {
    format: exportFormat.value,
    autoBackup: exportAutoBackup.value,
    backupTarget: exportBackupTarget.value,
    backupEndpoint: exportBackupEndpoint.value.trim(),
    backupToken: exportBackupToken.value.trim(),
    backupFileName: exportBackupFileName.value.trim(),
    teamRole: exportTeamRole.value,
    conflictStrategy: exportConflictStrategy.value,
    permissions: {
      editSettings: permissionEditSettings.value,
      editVariables: permissionEditVariables.value,
      syncDataSource: permissionSyncDataSource.value,
      backup: permissionBackup.value,
    },
  }
}

type ModulePermissionAction = 'editSettings' | 'editVariables' | 'syncDataSource' | 'backup'

function hasModulePermission(action: ModulePermissionAction, module = activeModule.value): boolean {
  if (!module) return false
  const role = module.exportConfig?.teamRole ?? exportTeamRole.value
  if (role === 'viewer') return false
  const permissions = module.exportConfig?.permissions ?? buildExportConfig().permissions
  return permissions?.[action] !== false
}

function assertModulePermission(action: ModulePermissionAction, label: string): boolean {
  if (hasModulePermission(action)) return true
  showSaved(`当前权限不允许${label}`)
  return false
}

function newArtifactId(prefix: string): string {
  return `${prefix}:${Date.now()}:${Math.random().toString(16).slice(2)}`
}

function buildDataSource(existing?: ModuleDataSource | null): ModuleDataSource | null {
  const url = dataSourceUrl.value.trim()
  if (!url) return null
  return {
    type: dataSourceType.value,
    url,
    syncStrategy: dataSourceSyncStrategy.value,
    fieldMapping: parseFieldMapping(dataSourceMappingText.value),
    syncIntervalMinutes: Math.max(5, Number(dataSourceSyncIntervalMinutes.value) || 60),
    webhookSecret: dataSourceWebhookSecret.value.trim(),
    lastSyncAt: existing?.lastSyncAt,
    nextSyncAt: existing?.nextSyncAt,
    lastSyncStatus: existing?.lastSyncStatus,
    lastSyncMessage: existing?.lastSyncMessage,
    lastSyncSourceUrl: existing?.lastSyncSourceUrl,
  }
}

function setModuleType(nextType: ModuleType) {
  if (nextType === moduleType.value) return
  const needsConfirm = moduleType.value === 'readonly' || nextType === 'readonly' || nextType === 'openapi-yaml'
  if (needsConfirm && !window.confirm('切换模块类型后，部分编辑能力或展示方式可能变化。确认切换？')) {
    return
  }
  moduleType.value = nextType
}

async function saveCategory() {
  const category = activeCategory.value
  if (!category) return
  const name = categoryName.value.trim()
  if (!name) return
  await workspace.updateCategory(category.id, {
    name,
    color: categoryColor.value || '#6366f1',
    description: categoryDescription.value.trim(),
  })
  showSaved('分组设置已保存')
}

async function saveModuleSettings(message = '模块设置已保存') {
  const module = activeModule.value
  if (!module) return
  if (!assertModulePermission('editSettings', '保存模块设置')) return
  const name = moduleName.value.trim()
  if (!name || !moduleCategoryId.value) return
  if (!confirmUnresolvedVariableRefs(getUnresolvedVariableRefs(), '保存模块设置')) return
  const moved = moduleCategoryId.value !== module.categoryId
  await workspace.updateModule(module.id, {
    name,
    categoryId: moduleCategoryId.value,
    type: moduleType.value,
    description: moduleDescription.value.trim(),
    moduleType: { mode: moduleModeFromType(moduleType.value), description: selectedModuleType.value.desc },
    stats: buildModuleStatsSnapshot(),
    exportConfig: buildExportConfig(),
    dataSource: buildDataSource(module.dataSource),
    openapiText: openapiText.value,
    order: moved
      ? workspace.modules.filter(item => item.categoryId === moduleCategoryId.value && item.id !== module.id).length
      : module.order,
  })
  await recordModuleAudit('module.save', `${message}：${name}`)
  workspace.selectModule(module.id)
  if (exportAutoBackup.value && !backupInProgress) {
    await backupModule()
  } else {
    showSaved(message)
  }
}

async function disconnectDataSource() {
  const module = activeModule.value
  if (!module) return
  dataSourceUrl.value = ''
  await workspace.updateModule(module.id, { dataSource: null })
  showSaved('已断开数据源')
}

async function syncDataSourceNow() {
  const module = activeModule.value
  if (!module || isSyncingDataSource.value) return
  if (!assertModulePermission('syncDataSource', '同步数据源')) return
  const dataSource = buildDataSource(module.dataSource)
  if (!dataSource) {
    showSaved('请先填写数据源 URL')
    return
  }

  isSyncingDataSource.value = true
  dataSourceSyncLog.value = []
  try {
    const result = await syncModuleDataSource(module.id, {
      dataSource,
      onLog: line => dataSourceSyncLog.value.push(line),
    })
    openapiText.value = result.text
    await recordModuleAudit('data-source.sync', `同步完成：新增 ${result.created}，更新 ${result.updated}`)
    showSaved(`同步完成：新增 ${result.created}，更新 ${result.updated}`)
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err)
    showSaved(`同步失败：${message}`)
  } finally {
    isSyncingDataSource.value = false
  }
}

async function saveModuleVariables() {
  const module = activeModule.value
  if (!module) return
  if (!assertModulePermission('editVariables', '保存模块变量')) return
  const variables = rowsToModuleVariables()
  if (!confirmUnresolvedVariableRefs(getUnresolvedVariableRefs(variables), '保存变量')) return
  await workspace.updateModule(module.id, { variables })
  await recordModuleAudit('variables.save', `保存 ${Object.keys(variables).length} 个模块变量`)
  if (shouldAutoBackupRemote()) {
    await backupModule('模块变量已保存，已同步远端备份')
  } else {
  showSaved('模块变量已保存')
  }
}

function exportModuleVariables() {
  const module = activeModule.value
  if (!module) return
  const payload = {
    moduleId: module.id,
    moduleName: module.name,
    exportedAt: new Date().toISOString(),
    variables: rowsToModuleVariables(),
  }
  downloadText(`${safeFileName(module.name)}.variables.json`, JSON.stringify(payload, null, 2))
  void recordModuleAudit('variables.export', '导出模块变量 JSON')
  showSaved('模块变量已导出')
}

async function importModuleVariablesText(text: string) {
  const module = activeModule.value
  if (!module) return
  if (!text?.trim()) return
  try {
    const parsed = JSON.parse(text)
    const source = parsed.variables && typeof parsed.variables === 'object' ? parsed.variables : parsed
    const variables: ModuleVariables = {}
    for (const [key, raw] of Object.entries(source)) {
      if (!key.trim()) continue
      if (raw && typeof raw === 'object' && !Array.isArray(raw)) {
        const value = raw as Partial<ModuleVariables[string]>
        variables[key] = {
          remote: String(value.remote ?? ''),
          local: String(value.local ?? ''),
          description: value.description == null ? '' : String(value.description),
          environmentValues: Object.fromEntries(Object.entries(value.environmentValues ?? {}).map(([envId, val]) => [envId, String(val)])),
        }
      } else {
        variables[key] = { remote: String(raw ?? ''), local: '', description: '', environmentValues: {} }
      }
    }
    variableRows.value = moduleVariablesToRows(variables)
    await workspace.updateModule(module.id, { variables })
    await recordModuleAudit('variables.import', `导入 ${Object.keys(variables).length} 个模块变量`)
    if (shouldAutoBackupRemote()) {
      await backupModule(`已导入 ${Object.keys(variables).length} 个模块变量，并同步远端备份`)
      return
    }
    showSaved(`已导入 ${Object.keys(variables).length} 个模块变量`)
  } catch (err) {
    showSaved(`变量导入失败：${err instanceof Error ? err.message : String(err)}`)
  }
}

function importModuleVariables() {
  variableImportInput.value?.click()
}

async function handleModuleVariablesFile(event: Event) {
  const input = event.target as HTMLInputElement
  const file = input.files?.[0]
  input.value = ''
  if (!file) return
  await importModuleVariablesText(await file.text())
}

function addVariableRow() {
  variableRows.value.push({ key: '', remote: '', local: '', description: '', environmentValues: {} })
}

function addMissingVariablesToDraft() {
  const existing = new Set(variableRows.value.map(row => row.key.trim()).filter(Boolean))
  const refs = getUnresolvedVariableRefs(rowsToModuleVariables())
  let added = 0
  for (const item of refs) {
    const key = normalizeVariableRefKey(item.ref)
    if (!key || existing.has(key)) continue
    variableRows.value.push({
      key,
      remote: '',
      local: '',
      description: `由未解析引用 {{${item.ref}}} 批量补齐，影响 ${item.interfaces.length} 个接口`,
      environmentValues: {},
    })
    existing.add(key)
    added++
  }
  showSaved(added > 0 ? `已添加 ${added} 个缺失变量草稿，请补值后保存` : '没有新的缺失变量需要补齐')
}

async function renameVariableAcrossModule() {
  const from = normalizeVariableRefKey(variableRenameDraft.value.from)
  const to = normalizeVariableRefKey(variableRenameDraft.value.to)
  if (!from || !to) {
    showSaved('请填写原变量名和新变量名')
    return
  }
  if (from === to) {
    showSaved('新旧变量名相同，无需迁移')
    return
  }
  if (to.startsWith('$') || to.includes(':')) {
    showSaved('新变量名不能是动态函数或带默认值表达式')
    return
  }

  const refs = moduleInterfaces.value
    .map(node => store.apis[node.apiId])
    .filter((api): api is ApiConfig => Boolean(api) && collectApiTemplateRefs(api).some(ref => normalizeVariableRefKey(ref) === from))
  const rowCount = variableRows.value.filter(row => row.key.trim() === from).length
  if (refs.length === 0 && rowCount === 0) {
    showSaved(`未找到 {{${from}}} 引用或变量草稿`)
    return
  }
  if (!window.confirm(`将 {{${from}}} 改名为 {{${to}}}，影响 ${refs.length} 个接口、${rowCount} 个变量草稿。继续吗？`)) return

  for (const row of variableRows.value) {
    if (row.key.trim() === from) row.key = to
  }

  for (const api of refs) {
    store.updateApi(api.id, {
      url: replaceTemplateRefInString(api.url, from, to),
      params: replaceTemplateRefsInPairs(api.params, from, to),
      headers: replaceTemplateRefsInPairs(api.headers, from, to),
      cookies: replaceTemplateRefsInPairs(api.cookies, from, to),
      auth: {
        ...api.auth,
        bearerToken: replaceTemplateRefInString(api.auth.bearerToken, from, to),
        basicUsername: replaceTemplateRefInString(api.auth.basicUsername, from, to),
        basicPassword: replaceTemplateRefInString(api.auth.basicPassword, from, to),
        apiKeyName: replaceTemplateRefInString(api.auth.apiKeyName, from, to),
        apiKeyValue: replaceTemplateRefInString(api.auth.apiKeyValue, from, to),
      },
      body: {
        ...api.body,
        raw: replaceTemplateRefInString(api.body.raw, from, to),
        formData: replaceTemplateRefsInPairs(api.body.formData, from, to),
        urlEncoded: replaceTemplateRefsInPairs(api.body.urlEncoded, from, to),
      },
      requestVariables: replaceTemplateRefsInPairs(api.requestVariables ?? [], from, to),
    })
  }

  await recordModuleAudit('variables.rename', `变量 {{${from}}} 改名为 {{${to}}}，影响 ${refs.length} 个接口`)
  variableRenameDraft.value = { from: '', to: '' }
  showSaved(`已迁移 ${refs.length} 个接口中的变量引用`)
}

function deleteVariableRow(index: number) {
  variableRows.value.splice(index, 1)
}

function useRemoteAsLocal(index: number) {
  const row = variableRows.value[index]
  if (row) row.local = row.remote
}

function getModuleApis(): ApiConfig[] {
  return moduleInterfaces.value
    .map(item => store.apis[item.apiId])
    .filter((api): api is ApiConfig => Boolean(api))
}

function findModuleInterfaceByMethodUrl(moduleId: string, api: ApiConfig) {
  return workspace.interfaces.find(item => {
    if (item.moduleId !== moduleId || (item.nodeType ?? 'request') === 'folder') return false
    const existingApi = store.apis[item.apiId]
    return existingApi?.method === api.method && existingApi.url === api.url
  }) ?? null
}

async function ensureOpenApiImportFolder(moduleId: string, folderName?: string | null): Promise<string | null> {
  const name = folderName?.trim()
  if (!name) return null
  const existing = workspace.interfaces.find(item =>
    item.moduleId === moduleId &&
    (item.nodeType ?? 'request') === 'folder' &&
    (item.parentId ?? null) === null &&
    item.name === name,
  )
  if (existing) return existing.id
  const folder = await workspace.addFolder(moduleId, name)
  return folder.id
}

function writeModuleOpenApiText(format: 'json' | 'yaml') {
  const module = activeModule.value
  const apis = getModuleApis()
  if (!module || apis.length === 0) {
    showSaved('暂无可生成的接口')
    return
  }
  openapiText.value = format === 'yaml'
    ? generateOpenApiYamlSpec(apis, module.name)
    : generateOpenApiSpec(apis, module.name)
  showSaved(format === 'yaml' ? '已从当前接口生成 YAML' : '已从当前接口生成 JSON')
}

function openModuleCodeGen() {
  const firstInterface = moduleInterfaces.value[0]
  if (!firstInterface) {
    showSaved('暂无可生成代码的接口')
    return
  }
  workspace.selectInterface(firstInterface.id)
  store.currentApiId = firstInterface.apiId
  window.dispatchEvent(new CustomEvent('apifix:open-codegen'))
}

async function syncOpenApiTextToModule() {
  const module = activeModule.value
  if (!module) return
  const importedApis = importOpenApi(openapiText.value)
  if (importedApis.length === 0) {
    showSaved('未识别到可导入的 OpenAPI 接口')
    return
  }

  let created = 0
  let updated = 0
  let skipped = 0
  for (const imported of importedApis) {
    const parentId = await ensureOpenApiImportFolder(module.id, imported.folder)
    const existingNode = findModuleInterfaceByMethodUrl(module.id, imported)
    if (existingNode) {
      const existingApi = store.apis[existingNode.apiId]
      if (!existingApi) {
        skipped++
        continue
      }
      store.updateApi(existingApi.id, {
        name: imported.name,
        headers: imported.headers,
        params: imported.params,
        body: imported.body,
        auth: imported.auth,
        cookies: imported.cookies,
        folder: imported.folder,
      })
      await workspace.updateInterfaceNode(existingNode.id, {
        name: imported.name,
        method: imported.method,
        url: imported.url,
        parentId,
      })
      updated++
      continue
    }

    try {
      await store.addApi(imported, module.id, parentId)
      created++
    } catch {
      skipped++
    }
  }

  await workspace.updateModule(module.id, {
    type: 'openapi-yaml',
    moduleType: { mode: 'yaml', description: selectedModuleType.value.desc },
    openapiText: openapiText.value,
    stats: buildModuleStatsSnapshot(),
  })
  showSaved(`OpenAPI 已同步到模块：新增 ${created}，更新 ${updated}${skipped ? `，跳过 ${skipped}` : ''}`)
}

function safeFileName(name: string): string {
  return (name || 'module').replace(/[\\/:*?"<>|]+/g, '-')
}

function downloadText(filename: string, content: string, type = 'application/json') {
  const blob = new Blob([content], { type })
  const url = URL.createObjectURL(blob)
  const a = document.createElement('a')
  a.href = url
  a.download = filename
  a.click()
  URL.revokeObjectURL(url)
}


function escapeHtml(value: unknown): string {
  return String(value ?? '')
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#39;')
}

function renderPairsTable(title: string, pairs: Array<{ key: string; value: string; enabled: boolean; description?: string }>): string {
  const enabled = pairs.filter(item => item.enabled && item.key)
  if (enabled.length === 0) return ''
  return `<section><h3>${escapeHtml(title)}</h3><table><thead><tr><th>Key</th><th>Value</th><th>Description</th></tr></thead><tbody>${enabled.map(item => `<tr><td><code>${escapeHtml(item.key)}</code></td><td>${escapeHtml(item.value)}</td><td>${escapeHtml(item.description ?? '')}</td></tr>`).join('')}</tbody></table></section>`
}

function renderApiHtml(api: ApiConfig): string {
  const bodyHtml = api.body.type === 'none'
    ? ''
    : `<section><h3>Request Body · ${escapeHtml(api.body.type)}</h3>${api.body.raw ? `<pre>${escapeHtml(api.body.raw)}</pre>` : renderPairsTable(api.body.type === 'form' ? 'Form Data' : 'Urlencoded', api.body.type === 'form' ? api.body.formData : api.body.urlEncoded)}</section>`
  return `<article class="api-card">
    <header><span class="method ${api.method.toLowerCase()}">${api.method}</span><div><h2>${escapeHtml(api.name)}</h2><code>${escapeHtml(api.url)}</code></div></header>
    ${api.description ? `<p class="api-description">${escapeHtml(api.description)}</p>` : ''}
    ${renderPairsTable('Query Parameters', api.params)}
    ${renderPairsTable('Headers', api.headers)}
    ${renderPairsTable('Cookies', api.cookies)}
    ${bodyHtml}
  </article>`
}

function buildModuleHtmlSite(moduleName: string, apis: ApiConfig[]): string {
  const docHtml = moduleDocs.value.length
    ? `<section class="docs"><h2>模块文档</h2>${moduleDocs.value.map(doc => `<article><h3>${escapeHtml(doc.title)}</h3><pre>${escapeHtml(doc.content)}</pre></article>`).join('')}</section>`
    : ''
  return `<!doctype html>
<html lang="zh-CN">
<head>
  <meta charset="utf-8" />
  <meta name="viewport" content="width=device-width, initial-scale=1" />
  <title>${escapeHtml(moduleName)} API Docs</title>
  <style>
    :root { color-scheme: light dark; --bg:#f8fafc; --panel:#fff; --text:#0f172a; --muted:#64748b; --border:#e2e8f0; --primary:#4f46e5; }
    body { margin:0; font-family:-apple-system,BlinkMacSystemFont,"Segoe UI",sans-serif; background:var(--bg); color:var(--text); }
    main { max-width:1080px; margin:0 auto; padding:32px 18px 56px; }
    .hero, .api-card, .docs article { background:var(--panel); border:1px solid var(--border); border-radius:18px; box-shadow:0 12px 30px rgba(15,23,42,.08); }
    .hero { padding:28px; margin-bottom:18px; }
    .hero h1 { margin:0 0 8px; font-size:32px; }
    .hero p { margin:0; color:var(--muted); }
    .api-card { margin:14px 0; overflow:hidden; }
    .api-card > header { display:flex; gap:14px; align-items:flex-start; padding:18px; border-bottom:1px solid var(--border); }
    .api-card h2 { margin:0 0 6px; font-size:20px; }
    code, pre { font-family:"SFMono-Regular",Consolas,monospace; }
    .method { min-width:70px; color:#fff; border-radius:10px; padding:7px 10px; text-align:center; font-weight:800; background:var(--primary); }
    .method.get { background:#16a34a; } .method.post { background:#2563eb; } .method.put { background:#d97706; } .method.delete { background:#dc2626; } .method.patch { background:#7c3aed; }
    section { padding:0 18px 18px; }
    section h3 { margin:16px 0 8px; color:var(--muted); font-size:15px; }
    table { width:100%; border-collapse:collapse; font-size:14px; }
    th,td { border:1px solid var(--border); padding:8px 10px; text-align:left; vertical-align:top; }
    th { background:rgba(148,163,184,.12); }
    pre { margin:0; padding:12px; overflow:auto; white-space:pre-wrap; border:1px solid var(--border); border-radius:12px; background:rgba(148,163,184,.12); }
    .docs { padding:0; margin:18px 0; }
    .docs article { padding:18px; margin:12px 0; }
    @media (prefers-color-scheme: dark) { :root { --bg:#020617; --panel:#0f172a; --text:#e2e8f0; --muted:#94a3b8; --border:#1e293b; } }
  </style>
</head>
<body>
  <main>
    <section class="hero"><h1>${escapeHtml(moduleName)}</h1><p>由 ApiFix Bin Pro 导出的单文件 API 文档站 · ${apis.length} 个接口 · ${new Date().toLocaleString()}</p></section>
    ${docHtml}
    ${apis.map(renderApiHtml).join('\n')}
  </main>
</body>
</html>`
}

function exportModuleHtmlSite() {
  const apis = getModuleApis()
  const module = activeModule.value
  if (!module || apis.length === 0) {
    showSaved('暂无可发布的接口')
    return
  }
  downloadText(`${safeFileName(module.name)}.docs.html`, buildModuleHtmlSite(module.name, apis), 'text/html')
  void recordModuleAudit('docs.export-html', `导出 HTML 文档站：${apis.length} 个接口`)
  showSaved('已导出 HTML 文档站')
}

function buildModuleOpenApiShareSpec() {
  const apis = getModuleApis()
  if (apis.length === 0) return null
  const module = activeModule.value
  const name = module?.name ?? 'module'
  const exportedAt = new Date()
  const spec = JSON.parse(generateOpenApiSpec(apis, name))
  spec['x-apifix-share'] = {
    moduleId: module?.id ?? '',
    moduleName: name,
    exportedAt: exportedAt.toISOString(),
    expiresAt: new Date(exportedAt.getTime() + 7 * 24 * 60 * 60 * 1000).toISOString(),
    ttlDays: 7,
    teamRole: module?.exportConfig?.teamRole ?? exportTeamRole.value,
    permissions: module?.exportConfig?.permissions ?? buildExportConfig().permissions,
    conflictStrategy: module?.exportConfig?.conflictStrategy ?? exportConflictStrategy.value,
    shareMode: 'local-fragment',
  }
  return { spec, name, count: apis.length }
}

function exportModuleOpenApi() {
  const share = buildModuleOpenApiShareSpec()
  if (!share) {
    showSaved('暂无可导出的接口')
    return
  }
  downloadText(`${safeFileName(share.name)}.openapi.json`, JSON.stringify(share.spec, null, 2))
  void recordModuleAudit('openapi.export', `导出 OpenAPI：${share.count} 个接口`)
  showSaved('已导出 OpenAPI')
}

function encodeSharePayload(value: unknown): string {
  const json = JSON.stringify(value)
  const bytes = new TextEncoder().encode(json)
  let binary = ''
  bytes.forEach(byte => { binary += String.fromCharCode(byte) })
  return btoa(binary).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/g, '')
}

async function copyModuleShareLink() {
  const share = buildModuleOpenApiShareSpec()
  if (!share) {
    showSaved('暂无可分享的接口')
    return
  }
  const base = `${window.location.origin}${window.location.pathname}`
  const link = `${base}#apifix-share=${encodeSharePayload(share.spec)}`
  try {
    await navigator.clipboard.writeText(link)
    showSaved('已复制权限分享链接')
  } catch {
    downloadText(`${safeFileName(share.name)}.share-link.txt`, link, 'text/plain')
    showSaved('剪贴板不可用，已下载分享链接')
  }
  void recordModuleAudit('openapi.share-link', `生成权限分享链接：${share.count} 个接口`)
}

function exportModuleMarkdown() {
  const apis = getModuleApis()
  if (apis.length === 0) {
    showSaved('暂无可导出的接口')
    return
  }
  const name = activeModule.value?.name ?? 'module'
  const content = [`# ${name}`, '', ...apis.flatMap(api => [generateMarkdownDoc(api), ''])].join('\n')
  downloadText(`${safeFileName(name)}.md`, content, 'text/markdown')
  void recordModuleAudit('docs.export-markdown', `导出 Markdown：${apis.length} 个接口`)
  showSaved('已导出 Markdown')
}

function exportModuleTestReport() {
  const module = activeModule.value
  if (!module) return
  const lines = [
    `# ${module.name} 测试报告`,
    '',
    `- 导出时间：${new Date().toLocaleString()}`,
    `- 接口数：${moduleStats.value.interfaceCount}`,
    `- 单接口用例：${moduleStats.value.caseTotal}（覆盖率 ${moduleStats.value.caseCoverage}）`,
    `- 场景用例：${moduleStats.value.sceneCaseTotal}（覆盖率 ${moduleStats.value.sceneCoverage}）`,
    '',
    '## 单接口用例',
    '',
  ]

  if (interfaceTestCases.value.length === 0) {
    lines.push('暂无单接口用例。', '')
  } else {
    for (const testCase of interfaceTestCases.value) {
      lines.push(
        `### ${testCase.name}`,
        '',
        `- 接口：${getInterfaceName(testCase.interfaceId)}`,
        `- 期望状态码：${testCase.expectedStatus ?? '-'}`,
        `- 最近结果：${testCase.lastRunAt ? `${testCase.lastPassed ? '通过' : '未通过'}（${formatTime(testCase.lastRunAt)}）` : '未运行'}`,
        `- 断言：${(testCase.assertions ?? []).join('；') || '无'}`,
        '',
      )
    }
  }

  lines.push('## 场景用例', '')
  if (moduleScenarioCases.value.length === 0) {
    lines.push('暂无场景用例。', '')
  } else {
    for (const scenario of moduleScenarioCases.value) {
      lines.push(
        `### ${scenario.name}`,
        '',
        `- 说明：${scenario.description || '-'}`,
        `- 步骤：${getScenarioStepSummary(scenario) || '无'}`,
        `- 最近结果：${scenario.lastRunAt ? `${scenario.lastPassed ? '通过' : '未通过'}（${formatTime(scenario.lastRunAt)}）` : '未运行'}`,
        `- 通过/总数：${scenario.lastReport?.passed ?? 0}/${scenario.lastReport?.total ?? scenario.steps.length}`,
      )
      if (scenario.lastReport?.failures?.length) {
        lines.push('- 失败原因：', ...scenario.lastReport.failures.map(item => `  - ${item}`))
      }
      lines.push('')
    }
  }

  downloadText(`${safeFileName(module.name)}.test-report.md`, lines.join('\n'), 'text/markdown')
  void recordModuleAudit('tests.export-report', '导出模块测试报告')
  showSaved('已导出测试报告')
}

function buildModuleBackupPayload() {
  const module = activeModule.value
  if (!module) return null
  return {
    module: { ...module, exportConfig: buildExportConfig() },
    category: workspace.categories.find(item => item.id === module.categoryId) ?? null,
    interfaces: moduleInterfaces.value,
    apis: getModuleApis(),
    docs: moduleDocs.value,
    models: moduleModels.value,
    testCases: interfaceTestCases.value,
    scenarioCases: moduleScenarioCases.value,
    auditLogs: moduleAuditLogs.value,
    exportedAt: new Date().toISOString(),
    localUpdatedAt: module.meta?.updatedAt ?? module.updatedAt,
    conflict: {
      strategy: exportConflictStrategy.value,
      teamRole: exportTeamRole.value,
    },
    version: 'apifix-backup-v1',
  }
}

function getBackupUpdatedAt(payload: any): number {
  return Number(payload?.localUpdatedAt ?? payload?.module?.meta?.updatedAt ?? payload?.module?.updatedAt ?? 0)
}

function summarizeBackupForConflict(backup: any): string {
  return [
    `更新时间：${formatTime(getBackupUpdatedAt(backup))}`,
    `接口：${backup?.interfaces?.length ?? 0}`,
    `文档：${backup?.docs?.length ?? 0}`,
    `模型：${backup?.models?.length ?? 0}`,
    `单接口用例：${backup?.testCases?.length ?? 0}`,
    `场景用例：${backup?.scenarioCases?.length ?? 0}`,
  ].join('，')
}

function summarizeConflictValue(value: unknown): string {
  if (value == null || value === '') return '—'
  if (Array.isArray(value)) return `${value.length} 项`
  if (typeof value === 'object') return JSON.stringify(value).slice(0, 160)
  return String(value).slice(0, 160)
}

function buildBackupConflictRows(remoteBackup: any, localBackup: any): BackupConflictField[] {
  const paths: Array<[string, (backup: any) => unknown]> = [
    ['模块名称', backup => backup?.module?.name],
    ['模块说明', backup => backup?.module?.description],
    ['模块类型', backup => backup?.module?.type],
    ['接口数量', backup => backup?.interfaces?.length ?? 0],
    ['文档数量', backup => backup?.docs?.length ?? 0],
    ['模型数量', backup => backup?.models?.length ?? 0],
    ['单接口用例数量', backup => backup?.testCases?.length ?? 0],
    ['场景用例数量', backup => backup?.scenarioCases?.length ?? 0],
    ['模块变量', backup => Object.keys(backup?.module?.variables ?? {}).sort()],
    ['导出/权限配置', backup => backup?.module?.exportConfig],
    ['数据源配置', backup => backup?.module?.dataSource],
  ]
  return paths.map(([field, getter]) => {
    const remote = summarizeConflictValue(getter(remoteBackup))
    const local = summarizeConflictValue(getter(localBackup))
    return { field, remote, local, changed: remote !== local, useRemote: false }
  })
}

function requestBackupConflictDecision(remoteBackup: any, localBackup: any): Promise<BackupConflictDecision> {
  return new Promise(resolve => {
    backupConflictPreview.value = {
      remoteSummary: summarizeBackupForConflict(remoteBackup),
      localSummary: summarizeBackupForConflict(localBackup),
      rows: buildBackupConflictRows(remoteBackup, localBackup),
      resolve,
    }
  })
}

function resolveBackupConflictDecision(action: BackupConflictDecision['action']) {
  const preview = backupConflictPreview.value
  if (!preview) return
  const remoteFields = preview.rows
    .filter(row => row.changed && row.useRemote)
    .map(row => row.field)
  preview.resolve(action === 'merge' ? { action, remoteFields } : { action })
  backupConflictPreview.value = null
}

function cloneBackupPayload<T>(payload: T): T {
  if (typeof structuredClone === 'function') return structuredClone(payload)
  return JSON.parse(JSON.stringify(payload)) as T
}

function sanitizeBackupPayloadForRemote<T>(payload: T): T {
  const sanitized = cloneBackupPayload(payload)
  const mutable = sanitized as any
  const variables = mutable?.module?.variables
  if (variables && typeof variables === 'object') {
    for (const value of Object.values(variables) as Array<{ local?: string }>) {
      if (value && typeof value === 'object') value.local = ''
    }
  }
  mutable.remotePrivacy = {
    ...(mutable.remotePrivacy ?? {}),
    localModuleVariableValuesUploaded: false,
    sanitizedAt: new Date().toISOString(),
  }
  return sanitized
}

function shouldAutoBackupRemote(): boolean {
  return exportAutoBackup.value && exportBackupTarget.value !== 'local' && !backupInProgress
}

function mergeBackupPayloadByFields(remoteBackup: any, localBackup: any, remoteFields: string[]): any {
  const merged = cloneBackupPayload(localBackup)
  const useRemote = new Set(remoteFields)

  if (!merged.module) merged.module = {}
  if (useRemote.has('模块名称')) merged.module.name = remoteBackup?.module?.name
  if (useRemote.has('模块说明')) merged.module.description = remoteBackup?.module?.description
  if (useRemote.has('模块类型')) merged.module.type = remoteBackup?.module?.type
  if (useRemote.has('接口数量')) {
    merged.interfaces = cloneBackupPayload(remoteBackup?.interfaces ?? [])
    merged.apis = cloneBackupPayload(remoteBackup?.apis ?? [])
  }
  if (useRemote.has('文档数量')) merged.docs = cloneBackupPayload(remoteBackup?.docs ?? [])
  if (useRemote.has('模型数量')) merged.models = cloneBackupPayload(remoteBackup?.models ?? [])
  if (useRemote.has('单接口用例数量')) merged.testCases = cloneBackupPayload(remoteBackup?.testCases ?? [])
  if (useRemote.has('场景用例数量')) merged.scenarioCases = cloneBackupPayload(remoteBackup?.scenarioCases ?? [])
  if (useRemote.has('模块变量')) merged.module.variables = cloneBackupPayload(remoteBackup?.module?.variables ?? {})
  if (useRemote.has('导出/权限配置')) merged.module.exportConfig = cloneBackupPayload(remoteBackup?.module?.exportConfig ?? {})
  if (useRemote.has('数据源配置')) merged.module.dataSource = cloneBackupPayload(remoteBackup?.module?.dataSource ?? null)

  merged.exportedAt = new Date().toISOString()
  merged.localUpdatedAt = Math.max(Date.now(), getBackupUpdatedAt(localBackup), getBackupUpdatedAt(remoteBackup))
  merged.conflict = {
    ...(merged.conflict ?? {}),
    mergedFromRemoteAt: new Date().toISOString(),
    mergedRemoteFields: remoteFields,
  }
  return merged
}

function parseBackupContent(text: string): any | null {
  try {
    const parsed = JSON.parse(text)
    return parsed?.version === 'apifix-backup-v1' ? parsed : null
  } catch {
    return null
  }
}

async function fetchRemoteGistBackup(endpoint: string, filename: string): Promise<any | null> {
  if (!/\/gists\/[A-Za-z0-9]+$/.test(endpoint)) return null
  const response = await fetch(endpoint, {
    headers: { 'Authorization': `Bearer ${exportBackupToken.value.trim()}` },
  })
  if (!response.ok) return null
  const data = await response.json().catch(() => null)
  const content = data?.files?.[filename]?.content
  return typeof content === 'string' ? parseBackupContent(content) : null
}

async function fetchRemoteWebDavBackup(targetUrl: string, headers: Record<string, string>): Promise<any | null> {
  const response = await fetch(targetUrl, { method: 'GET', headers })
  if (!response.ok) return null
  return parseBackupContent(await response.text())
}

async function resolveBackupPayloadForConflict(remoteBackup: any | null, localBackup: any): Promise<any | null> {
  if (exportTeamRole.value === 'viewer') {
    showSaved('当前团队角色为 Viewer，只允许查看备份，不能写入')
    return null
  }
  if (!remoteBackup || exportConflictStrategy.value === 'overwrite') return localBackup
  const remoteUpdatedAt = getBackupUpdatedAt(remoteBackup)
  const localUpdatedAt = getBackupUpdatedAt(localBackup)
  if (remoteUpdatedAt > localUpdatedAt) {
    const decision = await requestBackupConflictDecision(remoteBackup, localBackup)
    if (decision.action === 'cancel') {
      showSaved(`检测到远端备份较新（${formatTime(remoteUpdatedAt)}），已中止覆盖`)
      return null
    }
    if (decision.action === 'merge') {
      showSaved(decision.remoteFields.length ? '已按字段合并远端备份，准备写回' : '未选择远端字段，将使用本地版本写回')
      return mergeBackupPayloadByFields(remoteBackup, localBackup, decision.remoteFields)
    }
  }
  return localBackup
}

async function backupModule(successMessage?: string) {
  if (backupInProgress) return
  if (!assertModulePermission('backup', '执行备份')) return
  backupInProgress = true
  try {
    const module = activeModule.value
    if (!module) return
  let payload = buildModuleBackupPayload()
  if (!payload) return
  let content = JSON.stringify(payload, null, 2)
  const filename = exportBackupFileName.value.trim() || `${safeFileName(module.name)}.backup.json`

  if (exportBackupTarget.value === 'local') {
    downloadText(filename, content)
    showSaved('已生成模块备份')
    return
  }

  payload = sanitizeBackupPayloadForRemote(payload)
  content = JSON.stringify(payload, null, 2)

  if (exportBackupTarget.value === 'gist') {
    if (!exportBackupToken.value.trim()) {
      showSaved('请先填写 GitHub Token')
      return
    }
    const endpoint = exportBackupEndpoint.value.trim() || 'https://api.github.com/gists'
    const isUpdate = /\/gists\/[A-Za-z0-9]+$/.test(endpoint)
    const resolvedPayload = await resolveBackupPayloadForConflict(isUpdate ? await fetchRemoteGistBackup(endpoint, filename) : null, payload)
    if (!resolvedPayload) return
    payload = resolvedPayload
    content = JSON.stringify(payload, null, 2)
    const response = await fetch(endpoint, {
      method: isUpdate ? 'PATCH' : 'POST',
      headers: {
        'Content-Type': 'application/json',
        'Authorization': `Bearer ${exportBackupToken.value.trim()}`,
      },
      body: JSON.stringify({
        description: `ApiFix Bin backup: ${module.name}`,
        public: false,
        files: { [filename]: { content } },
      }),
    })
    if (!response.ok) {
      showSaved(`Gist 备份失败：${response.status}`)
      return
    }
    const result = await response.json().catch(() => null)
    if (result?.id && !exportBackupEndpoint.value.trim()) {
      exportBackupEndpoint.value = `https://api.github.com/gists/${result.id}`
      await saveModuleSettings('Gist 备份成功，已保存地址')
    } else {
      showSaved(successMessage || 'Gist 备份成功')
    }
    return
  }

  if (!exportBackupEndpoint.value.trim()) {
    showSaved('请先填写 WebDAV 地址')
    return
  }
  const targetUrl = new URL(filename, exportBackupEndpoint.value.trim().endsWith('/') ? exportBackupEndpoint.value.trim() : `${exportBackupEndpoint.value.trim()}/`).toString()
  const headers: Record<string, string> = { 'Content-Type': 'application/json' }
  if (exportBackupToken.value.trim()) headers.Authorization = exportBackupToken.value.trim().startsWith('Basic ') || exportBackupToken.value.trim().startsWith('Bearer ')
    ? exportBackupToken.value.trim()
    : `Bearer ${exportBackupToken.value.trim()}`
  const resolvedPayload = await resolveBackupPayloadForConflict(await fetchRemoteWebDavBackup(targetUrl, headers), payload)
  if (!resolvedPayload) return
  payload = resolvedPayload
  content = JSON.stringify(payload, null, 2)
  const response = await fetch(targetUrl, { method: 'PUT', headers, body: content })
  showSaved(response.ok ? (successMessage || 'WebDAV 备份成功') : `WebDAV 备份失败：${response.status}`)
  } finally {
    backupInProgress = false
  }
}

function openInterface(apiId: string) {
  const interfaceNode = workspace.interfaces.find(item => item.apiId === apiId)
  workspace.selectInterface(interfaceNode?.id ?? apiId)
  store.currentApiId = apiId
}

function getModuleRequestPrefix(moduleId: string, envId: string): string {
  const module = workspace.modules.find(item => item.id === moduleId)
  return module?.variables?.baseUrl?.environmentValues?.[envId] ?? ''
}

async function saveCategoryModulePrefixes() {
  try {
    const inputs = Array.from(document.querySelectorAll('.module-prefix-table .prefix-input')) as HTMLInputElement[]
    const grouped = new Map<string, Record<string, string>>()

    for (const input of inputs) {
      const moduleId = input.dataset.moduleId
      const envId = input.dataset.envId
      if (!moduleId || !envId) continue
      const values = grouped.get(moduleId) ?? {}
      values[envId] = input.value.trim()
      grouped.set(moduleId, values)
    }

    for (const [moduleId, envValues] of grouped.entries()) {
      const module = workspace.modules.find(item => item.id === moduleId)
      if (!module) continue
      const variables: ModuleVariables = { ...(module.variables ?? {}) }
      const baseUrl = variables.baseUrl ?? {
        remote: '',
        local: '',
        description: '该模块在不同环境下的请求前缀',
        environmentValues: {},
      }
      const environmentValues = { ...(baseUrl.environmentValues ?? {}) }
      for (const [envId, value] of Object.entries(envValues)) {
        if (value) {
          environmentValues[envId] = value
        } else {
          delete environmentValues[envId]
        }
      }
      variables.baseUrl = {
        ...baseUrl,
        description: baseUrl.description || '该模块在不同环境下的请求前缀',
        environmentValues,
      }
      await workspace.updateModule(moduleId, { variables })
    }

    showSaved('模块请求前缀已保存')
  } catch (err: any) {
    showSaved('模块请求前缀保存失败')
  }
}

async function saveDocArtifact() {
  const module = activeModule.value
  if (!module) return
  const title = docDraft.value.title.trim()
  if (!title) {
    showSaved('请填写文档标题')
    return
  }
  const now = Date.now()
  const existing = docDraft.value.id ? moduleDocs.value.find(item => item.id === docDraft.value.id) : null
  const doc: ModuleDocArtifact = {
    id: existing?.id ?? newArtifactId('doc'),
    moduleId: module.id,
    interfaceId: docDraft.value.interfaceId || undefined,
    title,
    format: docDraft.value.format,
    content: docDraft.value.content,
    createdAt: existing?.createdAt ?? now,
    updatedAt: now,
  }
  await db.moduleDocs.put(doc)
  docDraft.value = { id: '', title: '', interfaceId: '', format: 'markdown', content: '' }
  await refreshArtifacts('文档已保存')
}

function editDocArtifact(doc: ModuleDocArtifact) {
  docDraft.value = {
    id: doc.id,
    title: doc.title,
    interfaceId: doc.interfaceId ?? '',
    format: doc.format,
    content: doc.content,
  }
  activeModuleTab.value = 'artifacts'
}

async function deleteDocArtifact(id: string) {
  if (!window.confirm('确认删除该文档？')) return
  await db.moduleDocs.delete(id)
  if (docDraft.value.id === id) docDraft.value = { id: '', title: '', interfaceId: '', format: 'markdown', content: '' }
  await refreshArtifacts('文档已删除')
}

async function saveDataModel() {
  const module = activeModule.value
  if (!module) return
  const name = modelDraft.value.name.trim()
  if (!name) {
    showSaved('请填写模型名称')
    return
  }
  let schema: Record<string, unknown>
  try {
    schema = JSON.parse(modelDraft.value.schemaText || '{}')
    if (schema === null || Array.isArray(schema) || typeof schema !== 'object') throw new Error('schema must be object')
  } catch {
    showSaved('Schema 必须是有效 JSON 对象')
    return
  }
  const now = Date.now()
  const existing = modelDraft.value.id ? moduleModels.value.find(item => item.id === modelDraft.value.id) : null
  const model: ModuleDataModel = {
    id: existing?.id ?? newArtifactId('model'),
    moduleId: module.id,
    name,
    description: modelDraft.value.description.trim(),
    schema,
    createdAt: existing?.createdAt ?? now,
    updatedAt: now,
  }
  await db.moduleModels.put(model)
  modelDraft.value = { id: '', name: '', description: '', schemaText: '{\n  \"type\": \"object\",\n  \"properties\": {}\n}' }
  await refreshArtifacts('数据模型已保存')
}

function editDataModel(model: ModuleDataModel) {
  modelDraft.value = {
    id: model.id,
    name: model.name,
    description: model.description ?? '',
    schemaText: JSON.stringify(model.schema ?? {}, null, 2),
  }
  activeModuleTab.value = 'artifacts'
}

async function deleteDataModel(id: string) {
  if (!window.confirm('确认删除该数据模型？')) return
  await db.moduleModels.delete(id)
  if (modelDraft.value.id === id) modelDraft.value = { id: '', name: '', description: '', schemaText: '{\n  \"type\": \"object\",\n  \"properties\": {}\n}' }
  await refreshArtifacts('数据模型已删除')
}

function getInterfaceName(interfaceId?: string): string {
  if (!interfaceId) return '模块级'
  const node = workspace.interfaces.find(item => item.id === interfaceId || item.apiId === interfaceId)
  return node ? `${node.method} ${store.apis[node.apiId]?.name ?? node.name}` : '未知接口'
}

function getCaseAssertionLines(): string[] {
  return testCaseDraft.value.assertionsText
    .split('\n')
    .map(line => line.trim())
    .filter(Boolean)
}

function appendExtractorAssertion() {
  const variable = extractorDraft.value.variable.trim()
  if (!variable) {
    showSaved('请填写要写入的变量名')
    return
  }
  const path = extractorDraft.value.path.trim()
  let source = 'body'
  if (extractorDraft.value.sourceType === 'json') source = path || '$'
  if (extractorDraft.value.sourceType === 'header') source = `header.${path || 'content-type'}`
  const line = `env.${variable}<- ${source}`
  const current = testCaseDraft.value.assertionsText.trim()
  testCaseDraft.value.assertionsText = current ? `${current}\n${line}` : line
  extractorDraft.value.variable = ''
  showSaved(`已添加提取器：${line}`)
}

function getTestCaseName(caseId?: string): string {
  if (!caseId) return '未绑定用例'
  return interfaceTestCases.value.find(item => item.id === caseId)?.name ?? '未知用例'
}

function getScenarioStepSummary(scenario: ModuleScenarioCase): string {
  return scenario.steps
    .sort((a, b) => a.order - b.order)
    .map(step => `${step.enabled === false ? '（跳过）' : ''}${step.name || getTestCaseName(step.caseId) || getInterfaceName(step.interfaceId)}`)
    .join(' → ')
}

function hasScenarioContinueOnFailure(scenario: ModuleScenarioCase): boolean {
  return scenario.steps.some(step => step.enabled !== false && step.continueOnFailure)
}

async function saveInterfaceTestCase() {
  const module = activeModule.value
  if (!module) return
  const name = testCaseDraft.value.name.trim()
  if (!testCaseDraft.value.interfaceId) {
    showSaved('请选择接口')
    return
  }
  if (!name) {
    showSaved('请填写用例名称')
    return
  }
  const now = Date.now()
  const existing = testCaseDraft.value.id ? interfaceTestCases.value.find(item => item.id === testCaseDraft.value.id) : null
  const testCase: InterfaceTestCase = {
    id: existing?.id ?? newArtifactId('case'),
    moduleId: module.id,
    interfaceId: testCaseDraft.value.interfaceId,
    name,
    expectedStatus: Number(testCaseDraft.value.expectedStatus) || undefined,
    assertions: getCaseAssertionLines(),
    lastRunAt: existing?.lastRunAt,
    lastPassed: existing?.lastPassed,
    createdAt: existing?.createdAt ?? now,
    updatedAt: now,
  }
  await db.interfaceTestCases.put(testCase)
  testCaseDraft.value = { id: '', interfaceId: '', name: '', expectedStatus: 200, assertionsText: 'status=200' }
  await refreshArtifacts('测试用例已保存')
}

function editInterfaceTestCase(testCase: InterfaceTestCase) {
  testCaseDraft.value = {
    id: testCase.id,
    interfaceId: testCase.interfaceId,
    name: testCase.name,
    expectedStatus: testCase.expectedStatus ?? 200,
    assertionsText: (testCase.assertions && testCase.assertions.length > 0 ? testCase.assertions : ['status=200']).join('\n'),
  }
  activeModuleTab.value = 'artifacts'
}

async function deleteInterfaceTestCase(id: string) {
  if (!window.confirm('确认删除该测试用例？')) return
  await db.interfaceTestCases.delete(id)
  if (testCaseDraft.value.id === id) testCaseDraft.value = { id: '', interfaceId: '', name: '', expectedStatus: 200, assertionsText: 'status=200' }
  await refreshArtifacts('测试用例已删除')
}

function addScenarioStep() {
  if (!scenarioDraft.value.selectedCaseId) return
  if (!scenarioDraft.value.steps.some(step => step.caseId === scenarioDraft.value.selectedCaseId)) {
    scenarioDraft.value.steps.push({
      caseId: scenarioDraft.value.selectedCaseId,
      enabled: true,
      continueOnFailure: scenarioDraft.value.continueOnFailure,
    })
  }
  scenarioDraft.value.selectedCaseId = ''
}

function removeScenarioStep(index: number) {
  scenarioDraft.value.steps.splice(index, 1)
}

async function saveScenarioCase() {
  const module = activeModule.value
  if (!module) return
  const name = scenarioDraft.value.name.trim()
  if (!name) {
    showSaved('请填写场景用例名称')
    return
  }
  if (scenarioDraft.value.steps.filter(step => step.enabled).length === 0) {
    showSaved('请至少添加一个单接口用例步骤')
    return
  }

  const now = Date.now()
  const existing = scenarioDraft.value.id ? moduleScenarioCases.value.find(item => item.id === scenarioDraft.value.id) : null
  const steps: ModuleScenarioCase['steps'] = []
  scenarioDraft.value.steps.forEach((stepDraft, order) => {
    const testCase = interfaceTestCases.value.find(item => item.id === stepDraft.caseId)
    if (!testCase) return
    steps.push({
      id: `${stepDraft.caseId}:${order}`,
      caseId: stepDraft.caseId,
      interfaceId: testCase.interfaceId,
      name: testCase.name,
      order,
      enabled: stepDraft.enabled,
      continueOnFailure: stepDraft.continueOnFailure,
    })
  })
  if (steps.length === 0) {
    showSaved('场景步骤关联的用例无效')
    return
  }

  const scenario: ModuleScenarioCase = {
    id: existing?.id ?? newArtifactId('scenario'),
    moduleId: module.id,
    name,
    description: scenarioDraft.value.description.trim(),
    steps,
    lastRunAt: existing?.lastRunAt,
    lastPassed: existing?.lastPassed,
    lastReport: existing?.lastReport,
    createdAt: existing?.createdAt ?? now,
    updatedAt: now,
  }
  await db.moduleScenarioCases.put(scenario)
  scenarioDraft.value = createEmptyScenarioDraft()
  await refreshArtifacts('场景用例已保存')
}

function editScenarioCase(scenario: ModuleScenarioCase) {
  const orderedSteps = [...scenario.steps].sort((a, b) => a.order - b.order)
  scenarioDraft.value = {
    id: scenario.id,
    name: scenario.name,
    description: scenario.description ?? '',
    selectedCaseId: '',
    steps: orderedSteps
      .map(step => step.caseId ? ({
        caseId: step.caseId,
        enabled: step.enabled !== false,
        continueOnFailure: Boolean(step.continueOnFailure),
      }) : null)
      .filter((step): step is ScenarioDraftStep => Boolean(step)),
    continueOnFailure: orderedSteps.some(step => step.continueOnFailure),
  }
  activeModuleTab.value = 'artifacts'
}

async function deleteScenarioCase(id: string) {
  if (!window.confirm('确认删除该场景用例？')) return
  await db.moduleScenarioCases.delete(id)
  if (scenarioDraft.value.id === id) scenarioDraft.value = createEmptyScenarioDraft()
  await refreshArtifacts('场景用例已删除')
}

function resolveExtractionSource(source: string, response: ResponseData): string {
  const trimmed = source.trim()
  if (!trimmed || trimmed === 'body') return response.body
  if (trimmed.startsWith('header.')) {
    const headerKey = trimmed.slice('header.'.length).toLowerCase()
    return Object.entries(response.headers).find(([key]) => key.toLowerCase() === headerKey)?.[1] ?? ''
  }
  if (trimmed.startsWith('$.') || trimmed.startsWith('json.')) {
    try {
      const body = JSON.parse(response.body)
      const value = readJsonPath(body, trimmed)
      return value == null ? '' : typeof value === 'string' ? value : JSON.stringify(value)
    } catch {
      return ''
    }
  }
  return trimmed
}

async function applyEnvironmentUpdates(updates: Record<string, string>) {
  const entries = Object.entries(updates).filter(([key]) => key.trim())
  if (entries.length === 0) return
  const env = store.environments.find(item => item.id === store.currentEnvId)
  if (!env) return
  const variables = [...env.variables]
  for (const [key, value] of entries) {
    const existing = variables.find(item => item.key === key)
    if (existing) {
      existing.value = value
      existing.enabled = true
    } else {
      variables.push({ key, value, enabled: true })
    }
  }
  await store.upsertEnvironment({ ...env, variables })
}

function parseJsonPath(path: string): Array<string | number | '*'> {
  const source = path.trim().replace(/^json(?=\.)/, '$')
  const tokens: Array<string | number | '*'> = []
  let i = source.startsWith('$') ? 1 : 0
  while (i < source.length) {
    const char = source[i]
    if (char === '.') {
      i += 1
      if (source[i] === '*') {
        tokens.push('*')
        i += 1
        continue
      }
      let key = ''
      while (i < source.length && !['.', '['].includes(source[i])) key += source[i++]
      if (key) tokens.push(key)
      continue
    }
    if (char === '[') {
      const end = source.indexOf(']', i)
      if (end < 0) break
      const raw = source.slice(i + 1, end).trim()
      if (raw === '*') tokens.push('*')
      else if (/^['"].*['"]$/.test(raw)) tokens.push(raw.slice(1, -1))
      else if (/^-?\d+$/.test(raw)) tokens.push(Number(raw))
      else if (raw) tokens.push(raw)
      i = end + 1
      continue
    }
    let key = ''
    while (i < source.length && !['.', '['].includes(source[i])) key += source[i++]
    if (key) tokens.push(key)
  }
  return tokens
}

function readJsonPath(source: unknown, path: string): unknown {
  const tokens = parseJsonPath(path)
  if (tokens.length === 0) return source
  const visit = (current: unknown, index: number): unknown => {
    if (index >= tokens.length) return current
    const token = tokens[index]
    if (token === '*') {
      const list = Array.isArray(current)
        ? current
        : current && typeof current === 'object'
          ? Object.values(current as Record<string, unknown>)
          : []
      return list.map(item => visit(item, index + 1)).filter(item => item !== undefined)
    }
    if (current == null) return undefined
    if (Array.isArray(current) && typeof token === 'number') return visit(current[token], index + 1)
    if (typeof current === 'object') return visit((current as Record<string, unknown>)[String(token)], index + 1)
    return undefined
  }
  return visit(source, 0)
}

function stripAssertionQuotes(value: string): string {
  const trimmed = value.trim()
  if ((trimmed.startsWith('"') && trimmed.endsWith('"')) || (trimmed.startsWith("'") && trimmed.endsWith("'"))) {
    return trimmed.slice(1, -1)
  }
  return trimmed
}

function stringifyAssertionValue(value: unknown): string {
  if (value === undefined) return ''
  if (value === null) return 'null'
  if (typeof value === 'string') return value
  if (typeof value === 'number' || typeof value === 'boolean') return String(value)
  return JSON.stringify(value)
}

function compareAssertionValue(label: string, actual: unknown, operator: string, expectedRaw = ''): string | null {
  const op = operator.toLowerCase()
  const actualText = stringifyAssertionValue(actual)
  const expected = stripAssertionQuotes(expectedRaw)
  if (op === 'exists') return actual === undefined || actual === null || actualText === '' ? `${label} 不存在` : null
  if (op === 'not exists') return actual === undefined || actual === null || actualText === '' ? null : `${label} 不应存在，实际 ${actualText}`
  if (op === 'includes' || op === 'contains') return actualText.includes(expected) ? null : `${label} 不包含 ${expected}`
  if (op === 'not includes') return !actualText.includes(expected) ? null : `${label} 不应包含 ${expected}`
  if (op === 'matches') {
    try {
      const match = expected.match(/^\/(.*)\/([gimsuy]*)$/)
      const pattern = match ? new RegExp(match[1], match[2]) : new RegExp(expected)
      return pattern.test(actualText) ? null : `${label} 不匹配 ${expected}`
    } catch {
      return `${label} 正则无效：${expected}`
    }
  }
  if (['>', '>=', '<', '<='].includes(op)) {
    const actualNumber = Number(actualText)
    const expectedNumber = Number(expected)
    if (Number.isNaN(actualNumber) || Number.isNaN(expectedNumber)) return `${label} 不能按数字比较`
    const ok = op === '>' ? actualNumber > expectedNumber
      : op === '>=' ? actualNumber >= expectedNumber
        : op === '<' ? actualNumber < expectedNumber
          : actualNumber <= expectedNumber
    return ok ? null : `${label} 期望 ${op} ${expectedNumber}，实际 ${actualNumber}`
  }
  if (op === '!=' || op === '!==') return actualText !== expected ? null : `${label} 不应等于 ${expected}`
  return actualText === expected ? null : `${label} 期望 ${expected}，实际 ${actualText}`
}

function evaluateAssertion(assertion: string, response: ResponseData): string | null {
  const line = assertion.trim()
  if (!line) return null
  if (/^env\.?[\w.-]+\s*(?:=|<-)/i.test(line)) return null
  const statusInMatch = line.match(/^status\s+in\s+(.+)$/i)
  if (statusInMatch) {
    const allowed = statusInMatch[1].split(',').map(item => Number(item.trim())).filter(item => !Number.isNaN(item))
    return allowed.includes(response.status) ? null : `期望 status in ${allowed.join(', ')}，实际 ${response.status}`
  }
  const statusMatch = line.match(/^status\s*(==|=|!=|>=|<=|>|<)\s*(\d+)$/i)
  if (statusMatch) {
    return compareAssertionValue('status', response.status, statusMatch[1], statusMatch[2])
  }

  const bodyEmptyMatch = line.match(/^body\s+is\s+(not\s+)?empty$/i)
  if (bodyEmptyMatch) {
    const empty = response.body.length === 0
    return bodyEmptyMatch[1] ? (!empty ? null : '响应 Body 不应为空') : (empty ? null : '响应 Body 应为空')
  }
  const bodyMatch = line.match(/^body\s+(includes|contains|not includes|matches|==|=|!=)\s+(.+)$/i)
  if (bodyMatch) {
    return compareAssertionValue('响应 Body', response.body, bodyMatch[1], bodyMatch[2])
  }

  const headerMatch = line.match(/^header\s+([^\s]+)\s+(exists|not exists|includes|contains|not includes|matches|==|=|!=)\s*(.*)$/i)
  if (headerMatch) {
    const headerKey = headerMatch[1].toLowerCase()
    const actual = Object.entries(response.headers).find(([key]) => key.toLowerCase() === headerKey)?.[1]
    return compareAssertionValue(`响应 Header ${headerMatch[1]}`, actual, headerMatch[2], headerMatch[3])
  }

  const jsonLengthMatch = line.match(/^((?:json\.)[^\s]+|\$[^\s]*)\s+length\s*(==|=|!=|>=|<=|>|<)\s*(\d+)$/i)
  if (jsonLengthMatch) {
    try {
      const body = JSON.parse(response.body)
      const actual = readJsonPath(body, jsonLengthMatch[1].trim())
      const length = Array.isArray(actual) || typeof actual === 'string' ? actual.length : actual && typeof actual === 'object' ? Object.keys(actual).length : 0
      return compareAssertionValue(`JSON ${jsonLengthMatch[1].trim()} length`, length, jsonLengthMatch[2], jsonLengthMatch[3])
    } catch {
      return '响应 Body 不是有效 JSON'
    }
  }
  const jsonMatch = line.match(/^((?:json\.)[^\s]+|\$[^\s]*)\s+(exists|not exists|includes|contains|not includes|matches|==|=|!=|>=|<=|>|<)\s*(.*)$/i)
  if (jsonMatch) {
    try {
      const body = JSON.parse(response.body)
      const actual = readJsonPath(body, jsonMatch[1].trim())
      return compareAssertionValue(`JSON ${jsonMatch[1].trim()}`, actual, jsonMatch[2], jsonMatch[3])
    } catch {
      return '响应 Body 不是有效 JSON'
    }
  }

  return `未知断言语法：${line}`
}

async function executeInterfaceTestCase(
  testCase: InterfaceTestCase,
  options: { envVars?: Record<string, string>; persistEnvUpdates?: boolean } = {},
): Promise<{ passed: boolean; failures: string[]; envUpdates: Record<string, string> }> {
  const interfaceNode = workspace.interfaces.find(item => item.id === testCase.interfaceId)
  const api = interfaceNode ? store.apis[interfaceNode.apiId] : null
  if (!api) {
    return { passed: false, failures: ['未找到用例关联接口'], envUpdates: {} }
  }

  const requestApi = { ...api, ...(testCase.requestOverride ?? {}) } as ApiConfig
  const response = await sendRequest({
    method: requestApi.method,
    url: requestApi.url,
    headers: requestApi.headers,
    params: requestApi.params,
    cookies: requestApi.cookies,
    autoCarryCookies: store.autoCarryCookies,
    body: requestApi.body,
    auth: requestApi.auth,
    corsMode: store.settings.corsMode,
    proxyUrl: store.settings.proxyUrl,
    envVars: { ...store.getEnvVariables(), ...(options.envVars ?? {}) },
  })
  const failures: string[] = []
  const envUpdates: Record<string, string> = {}
  if (testCase.expectedStatus && response.status !== testCase.expectedStatus) {
    failures.push(`期望状态码 ${testCase.expectedStatus}，实际 ${response.status}`)
  }
  for (const assertion of testCase.assertions ?? []) {
    const extractorMatch = assertion.trim().match(/^env\.?([\w.-]+)\s*(?:=|<-)\s*(.+)$/i)
    if (extractorMatch) {
      envUpdates[extractorMatch[1]] = resolveExtractionSource(extractorMatch[2], response)
      continue
    }
    const failure = evaluateAssertion(assertion, response)
    if (failure) failures.push(failure)
  }
  if (options.persistEnvUpdates !== false) await applyEnvironmentUpdates(envUpdates)
  return { passed: failures.length === 0, failures, envUpdates }
}

async function runInterfaceTestCase(testCase: InterfaceTestCase): Promise<boolean> {
  runningCaseId.value = testCase.id
  try {
    const { passed, failures } = await executeInterfaceTestCase(testCase)
    await db.interfaceTestCases.update(testCase.id, {
      lastRunAt: Date.now(),
      lastPassed: passed,
      updatedAt: Date.now(),
    })
    await refreshArtifacts(passed ? '用例运行通过' : `用例未通过：${failures[0]}`)
    return passed
  } finally {
    runningCaseId.value = null
  }
}

async function runAllInterfaceTestCases() {
  for (const testCase of interfaceTestCases.value) {
    await runInterfaceTestCase(testCase)
  }
}

async function runScenarioCase(scenario: ModuleScenarioCase) {
  runningScenarioId.value = scenario.id
  const failures: string[] = []
  let passedCount = 0
  const scenarioVariables: Record<string, string> = {}
  try {
    const steps = [...scenario.steps].sort((a, b) => a.order - b.order).filter(step => step.enabled !== false)
    if (steps.length === 0) failures.push('场景没有启用的步骤')
    for (const step of steps) {
      const testCase = interfaceTestCases.value.find(item => item.id === step.caseId)
      if (!testCase) {
        failures.push(`${step.name || step.caseId || step.interfaceId}：未找到关联单接口用例`)
        if (!step.continueOnFailure) break
        continue
      }
      runningCaseId.value = testCase.id
      const result = await executeInterfaceTestCase(testCase, {
        envVars: scenarioVariables,
        persistEnvUpdates: false,
      })
      Object.assign(scenarioVariables, result.envUpdates)
      await db.interfaceTestCases.update(testCase.id, {
        lastRunAt: Date.now(),
        lastPassed: result.passed,
        updatedAt: Date.now(),
      })
      if (result.passed) {
        passedCount++
      } else {
        failures.push(`${testCase.name}：${result.failures[0] || '未通过'}`)
        if (!step.continueOnFailure) break
      }
    }
    const report = {
      total: steps.length,
      passed: passedCount,
      failed: failures.length,
      failures,
    }
    const passed = failures.length === 0 && passedCount === steps.length
    await db.moduleScenarioCases.update(scenario.id, {
      lastRunAt: Date.now(),
      lastPassed: passed,
      lastReport: report,
      updatedAt: Date.now(),
    })
    await refreshArtifacts(passed ? '场景用例运行通过' : `场景用例未通过：${failures[0]}`)
  } finally {
    runningCaseId.value = null
    runningScenarioId.value = null
  }
}

async function runAllScenarioCases() {
  for (const scenario of moduleScenarioCases.value) {
    await runScenarioCase(scenario)
  }
}
</script>

<template>
  <div class="workspace-settings">
    <template v-if="activeCategory">
      <header class="settings-header">
        <div>
          <div class="eyebrow">分组设置</div>
          <h2><span class="title-dot" :style="{ backgroundColor: categoryColor }"></span>{{ activeCategory.name }}</h2>
          <p>维护分组基础信息，并查看该分组下的模块。</p>
        </div>
        <button class="btn btn-primary" @click="saveCategory">保存</button>
      </header>

      <section class="settings-card">
        <h3>基础信息</h3>
        <label class="field-row">
          <span>分组名称</span>
          <input v-model="categoryName" type="text" placeholder="输入分组名称" @keydown.enter="saveCategory" />
        </label>
        <label class="field-row">
          <span>颜色标签</span>
          <div class="color-field">
            <input v-model="categoryColor" type="color" />
            <input v-model="categoryColor" type="text" placeholder="#6366f1" />
          </div>
        </label>
        <label class="field-row field-row-top">
          <span>说明</span>
          <textarea v-model="categoryDescription" rows="3" placeholder="补充分组用途、业务边界或维护说明"></textarea>
        </label>
        <div class="meta-grid">
          <div><strong>{{ selectedCategoryModuleCount }}</strong><span>模块数</span></div>
          <div><strong>{{ selectedCategoryInterfaceCount }}</strong><span>接口数</span></div>
          <div><strong>{{ formatTime(activeCategory.updatedAt) }}</strong><span>更新时间</span></div>
        </div>
      </section>

      <section class="settings-card">
        <h3>该分组下的模块</h3>
        <div class="module-list">
          <button
            v-for="module in categoryModules"
            :key="module.id"
            class="module-link"
            @click="workspace.selectModule(module.id)"
          >
            <span>{{ module.name }}</span>
            <small>{{ workspace.interfaces.filter(item => item.moduleId === module.id && (item.nodeType ?? 'request') !== 'folder').length }} 个接口 · {{ moduleTypes.find(item => item.value === (module.type ?? 'generic'))?.title }}</small>
          </button>
          <div v-if="selectedCategoryModuleCount === 0" class="empty-hint">该分组下暂无模块。</div>
        </div>
      </section>

      <section class="settings-card">
        <div class="section-heading-row">
          <div>
            <h3>子模块环境请求前缀</h3>
            <p>为该分组下每个模块配置不同环境的 baseUrl。接口 URL 可写成 <code>/path</code> 自动拼接前缀，也可显式使用 <code>&#123;&#123;baseUrl&#125;&#125;/path</code>。</p>
          </div>
          <button
            v-if="store.environments.length > 0 && categoryModules.length > 0"
            class="btn btn-sm btn-primary"
            @click="saveCategoryModulePrefixes"
          >
            保存请求前缀
          </button>
        </div>

        <div v-if="store.environments.length === 0" class="empty-hint prefix-empty">
          还没有环境。请先在右上角“环境设置”中新建测试、预发或生产环境。
        </div>

        <div v-else-if="categoryModules.length === 0" class="empty-hint prefix-empty">
          该分组下暂无模块，创建模块后即可配置请求前缀。
        </div>

        <div v-else class="module-prefix-table">
          <div class="module-prefix-head" :style="{ gridTemplateColumns: `180px repeat(${store.environments.length}, minmax(190px, 1fr))` }">
            <span>子模块</span>
            <span v-for="env in store.environments" :key="env.id">{{ env.name }}</span>
          </div>
          <div
            v-for="module in categoryModules"
            :key="module.id"
            class="module-prefix-row"
            :style="{ gridTemplateColumns: `180px repeat(${store.environments.length}, minmax(190px, 1fr))` }"
          >
            <div class="module-prefix-name">
              <strong>{{ module.name }}</strong>
              <small>{{ workspace.interfaces.filter(item => item.moduleId === module.id && (item.nodeType ?? 'request') !== 'folder').length }} 个接口</small>
            </div>
            <input
              v-for="env in store.environments"
              :key="env.id"
              type="url"
              :data-module-id="module.id"
              :data-env-id="env.id"
              :value="getModuleRequestPrefix(module.id, env.id)"
              class="prefix-input"
              :placeholder="env.name.includes('生产') ? 'https://api.example.com' : 'https://test-api.example.com'"
            />
          </div>
        </div>
      </section>
    </template>

    <template v-else-if="activeModule">
      <header class="settings-header sticky-header">
        <div>
          <div class="eyebrow">模块主页</div>
          <h2>{{ activeModule.name }}</h2>
          <p>{{ selectedModuleCategoryName }} · {{ selectedModuleType.title }}</p>
        </div>
        <div class="header-actions">
          <button class="btn" @click="exportModuleOpenApi">分享</button>
          <button class="btn" @click="copyModuleShareLink">复制链接</button>
          <button v-if="activeModuleTab === 'variables'" class="btn btn-primary" @click="saveModuleVariables">保存变量</button>
          <button v-else class="btn btn-primary" @click="saveModuleSettings(activeModuleTab === 'settings' ? '模块设置已保存' : '模块概览已保存')">保存</button>
        </div>
      </header>

      <nav class="settings-tabs">
        <button :class="{ active: activeModuleTab === 'overview' }" @click="activeModuleTab = 'overview'">概览</button>
        <button :class="{ active: activeModuleTab === 'variables' }" @click="activeModuleTab = 'variables'">模块变量</button>
        <button :class="{ active: activeModuleTab === 'artifacts' }" @click="activeModuleTab = 'artifacts'">文档/模型/用例</button>
        <button :class="{ active: activeModuleTab === 'settings' }" @click="activeModuleTab = 'settings'">设置</button>
      </nav>

      <template v-if="activeModuleTab === 'overview'">
        <section class="settings-card">
          <h3>📊 统计</h3>
          <div class="stat-grid stat-grid-large">
            <div><strong>{{ moduleStats.interfaceCount }}</strong><span>接口数</span></div>
            <div><strong>{{ moduleStats.docCount }}</strong><span>文档数</span></div>
            <div><strong>{{ moduleStats.modelCount }}</strong><span>数据模型</span></div>
          </div>
        </section>

        <div class="overview-grid">
          <section class="settings-card">
            <div class="section-heading-row">
              <div>
                <h3>📈 近 7 日调试趋势</h3>
                <p>按当前模块接口的历史请求次数生成轻量趋势图。</p>
              </div>
              <button class="btn btn-sm" @click="activeModuleTab = 'artifacts'">生成报告</button>
            </div>
            <div class="trend-chart" aria-label="近 7 日调试趋势">
              <div v-for="item in moduleActivityTrend" :key="item.label" :class="['trend-bar-wrap', { peak: item.peak }]">
                <span class="trend-count">{{ item.count }}</span>
                <div class="trend-bar-track">
                  <div class="trend-bar" :style="{ height: `${item.height}px` }"></div>
                </div>
                <small>{{ item.label }}</small>
                <div class="trend-tooltip">
                  <strong>{{ item.label }}</strong>
                  <span>{{ item.count }} 次调试</span>
                  <span>相对峰值 {{ item.percent }}%</span>
                  <em v-if="item.peak">本周峰值</em>
                </div>
              </div>
            </div>
          </section>
          <section class="settings-card">
            <h3>⚡ 快捷侧栏</h3>
            <p>聚合设计中的分享、文档站和代码生成入口，减少从模块主页跳转成本。</p>
            <div class="module-quick-rail">
              <button class="quick-rail-item" @click="exportModuleMarkdown">
                <strong>导出文档站素材</strong>
                <span>生成当前模块 Markdown 文档</span>
              </button>
              <button class="quick-rail-item" @click="exportModuleHtmlSite">
                <strong>发布 HTML 文档站</strong>
                <span>导出可直接打开的单文件站点</span>
              </button>
              <button class="quick-rail-item" @click="exportModuleOpenApi">
                <strong>分享 OpenAPI</strong>
                <span>导出 JSON 供团队或网关使用</span>
              </button>
              <button class="quick-rail-item" @click="copyModuleShareLink">
                <strong>复制权限链接</strong>
                <span>生成含权限元数据的本地分享链接</span>
              </button>
              <button class="quick-rail-item" @click="activeModuleTab = 'artifacts'">
                <strong>测试报告</strong>
                <span>维护用例并导出报告</span>
              </button>
              <button class="quick-rail-item" @click="openModuleCodeGen">
                <strong>生成代码</strong>
                <span>打开首个接口的代码生成面板</span>
              </button>
            </div>
          </section>
          <section class="settings-card">
            <h3>📋 单接口用例覆盖</h3>
            <div class="stat-grid">
              <div><strong>{{ moduleStats.caseTotal }}</strong><span>用例总数</span></div>
              <div><strong>{{ moduleStats.caseCoverage }}</strong><span>覆盖率</span></div>
              <div><strong>{{ moduleStats.avgCasePerInterface }}</strong><span>平均用例数</span></div>
              <div><strong>{{ moduleStats.uncoveredInterfaceCount }}</strong><span>无覆盖接口</span></div>
            </div>
          </section>
          <section class="settings-card">
            <h3>🔄 场景用例覆盖</h3>
            <div class="stat-grid">
              <div><strong>{{ moduleStats.sceneCaseTotal }}</strong><span>用例总数</span></div>
              <div><strong>{{ moduleStats.sceneCoverage }}</strong><span>覆盖率</span></div>
              <div><strong>{{ moduleStats.uncoveredInterfaceCount }}</strong><span>未覆盖接口</span></div>
              <div><strong>-</strong><span>更多指标</span></div>
            </div>
          </section>
        </div>

        <section class="settings-card">
          <div class="section-heading-row">
            <div>
              <h3>🛠 请求批量编辑</h3>
              <p>对当前模块所有接口批量新增、覆盖或删除 Header / Query 参数，适合统一鉴权头、灰度标记和环境参数迁移。</p>
            </div>
            <button class="btn btn-sm btn-primary" :disabled="!bulkEditDraft.key.trim() || bulkEditAffectedCount === 0" @click="applyModuleBulkEdit">
              应用到 {{ bulkEditAffectedCount }} 个接口
            </button>
          </div>
          <div class="bulk-edit-grid">
            <label class="field-row compact-field">
              <span>目标</span>
              <select v-model="bulkEditDraft.target">
                <option value="headers">Headers</option>
                <option value="params">Query Params</option>
              </select>
            </label>
            <label class="field-row compact-field">
              <span>操作</span>
              <select v-model="bulkEditDraft.operation">
                <option value="upsert">新增或覆盖</option>
                <option value="addMissing">仅缺失时新增</option>
                <option value="replaceExisting">仅替换已有</option>
                <option value="remove">删除匹配项</option>
              </select>
            </label>
            <label class="field-row compact-field">
              <span>Key</span>
              <input v-model="bulkEditDraft.key" type="text" :placeholder="bulkEditDraft.target === 'headers' ? 'X-Trace-Id' : 'tenantId'" />
            </label>
            <label v-if="bulkEditDraft.operation !== 'remove'" class="field-row compact-field">
              <span>Value</span>
              <input v-model="bulkEditDraft.value" type="text" placeholder="{{token}} 或固定值" />
            </label>
            <label v-if="bulkEditDraft.operation !== 'remove'" class="inline-check bulk-edit-enabled">
              <input v-model="bulkEditDraft.enabled" type="checkbox" />
              <span>写入后启用</span>
            </label>
          </div>
          <p class="help-text">
            预览：当前操作将影响 {{ bulkEditAffectedCount }} / {{ moduleInterfaces.length }} 个接口；Header 匹配不区分大小写，Query 参数按 Key 精确匹配。
          </p>
        </section>

        <section class="settings-card">
          <h3>🧩 模块类型</h3>
          <div class="type-card-list">
            <button
              v-for="item in moduleTypes"
              :key="item.value"
              :class="['type-card', { active: moduleType === item.value }]"
              @click="setModuleType(item.value)"
            >
              <span class="type-icon">{{ item.icon }}</span>
              <span><strong>{{ item.title }}</strong><small>{{ item.desc }}</small></span>
            </button>
          </div>
        </section>

        <section v-if="moduleType === 'openapi-yaml'" class="settings-card">
          <h3>📄 OpenAPI YAML / JSON 编辑</h3>
          <p>直接维护 OpenAPI 文本；也可以从当前可视化接口生成 YAML/JSON，或把编辑器中的 OpenAPI 同步回当前模块。</p>
          <div class="quick-actions">
            <button class="btn btn-sm" @click="writeModuleOpenApiText('yaml')">从当前接口生成 YAML</button>
            <button class="btn btn-sm" @click="writeModuleOpenApiText('json')">从当前接口生成 JSON</button>
            <button class="btn btn-sm btn-primary" :disabled="openapiPreviewApis.length === 0" @click="syncOpenApiTextToModule">导入/同步到模块</button>
          </div>
          <div class="openapi-editor">
            <CodeMirrorEditor
              :model-value="openapiText"
              language="yaml"
              placeholder="粘贴 OpenAPI 3.0 / Swagger JSON 或 YAML..."
              @update:model-value="openapiText = $event"
            />
          </div>
          <div class="openapi-preview">
            <span v-if="openapiPreviewApis.length > 0">已识别 {{ openapiPreviewApis.length }} 个接口；可保存文本，也可按 Method + URL 增量同步到当前模块。</span>
            <span v-else-if="openapiPreviewError">{{ openapiPreviewError }}</span>
            <span v-else>暂无 OpenAPI 文本。</span>
          </div>
        </section>

        <div class="overview-grid">
          <section class="settings-card">
            <h3>🔗 绑定数据源</h3>
            <p>绑定 Swagger/OpenAPI/自定义接口来源，手动同步会拉取 OpenAPI JSON 并按 Method + URL 增量更新模块接口。</p>
            <label class="field-row">
              <span>来源类型</span>
              <select v-model="dataSourceType">
                <option value="swagger">Swagger</option>
                <option value="openapi">OpenAPI</option>
                <option value="custom">自定义</option>
              </select>
            </label>
            <label class="field-row">
              <span>URL</span>
              <input v-model="dataSourceUrl" type="url" placeholder="https://api.example.com/openapi.json" />
            </label>
            <label class="field-row">
              <span>同步策略</span>
              <select v-model="dataSourceSyncStrategy">
                <option value="manual">手动同步</option>
                <option value="auto">自动同步</option>
                <option value="webhook">Webhook 推送</option>
              </select>
            </label>
            <label v-if="dataSourceSyncStrategy === 'auto'" class="field-row">
              <span>自动间隔</span>
              <input v-model.number="dataSourceSyncIntervalMinutes" type="number" min="5" step="5" />
            </label>
            <label v-if="dataSourceSyncStrategy === 'webhook'" class="field-row">
              <span>Webhook 密钥</span>
              <input v-model="dataSourceWebhookSecret" type="password" placeholder="外部触发时需传入 secret" />
            </label>
            <label class="field-row field-row-top">
              <span>字段映射</span>
              <textarea v-model="dataSourceMappingText" rows="3" placeholder="operationId=接口名称"></textarea>
            </label>
            <div v-if="activeModule.dataSource" class="sync-status-card">
              <span>状态：{{ activeModule.dataSource.lastSyncStatus === 'failed' ? '失败' : activeModule.dataSource.lastSyncStatus === 'success' ? '成功' : '未同步' }}</span>
              <span v-if="activeModule.dataSource.lastSyncAt">最后同步：{{ formatTime(activeModule.dataSource.lastSyncAt) }}</span>
              <span v-if="activeModule.dataSource.nextSyncAt">下次同步：{{ formatTime(activeModule.dataSource.nextSyncAt) }}</span>
              <span v-if="activeModule.dataSource.lastSyncSourceUrl">来源：{{ activeModule.dataSource.lastSyncSourceUrl }}</span>
              <span v-if="activeModule.dataSource.lastSyncMessage">{{ activeModule.dataSource.lastSyncMessage }}</span>
            </div>
            <div v-if="dataSourceSyncLog.length > 0" class="sync-log">
              <div v-for="(line, index) in dataSourceSyncLog" :key="index">{{ line }}</div>
            </div>
            <div class="quick-actions">
              <button class="btn btn-sm btn-primary" @click="saveModuleSettings('数据源已保存')">保存数据源</button>
              <button class="btn btn-sm" @click="syncDataSourceNow" :disabled="isSyncingDataSource">{{ isSyncingDataSource ? '同步中...' : '立即同步' }}</button>
              <button class="btn btn-sm" @click="disconnectDataSource">断开连接</button>
            </div>
          </section>
          <section class="settings-card muted-card">
            <h3>📦 导出/备份 API 规格</h3>
            <p>配置模块默认导出格式与本地自动备份偏好；云端目标保留为后续接入点。</p>
            <label class="field-row">
              <span>默认格式</span>
              <select v-model="exportFormat">
                <option value="openapi3">OpenAPI 3</option>
                <option value="markdown">Markdown</option>
                <option value="html">HTML</option>
              </select>
            </label>
            <label class="field-row">
              <span>自动备份</span>
              <select v-model="exportAutoBackup">
                <option :value="false">关闭</option>
                <option :value="true">开启</option>
              </select>
            </label>
            <label class="field-row">
              <span>备份目标</span>
              <select v-model="exportBackupTarget">
                <option value="local">本地文件</option>
                <option value="gist">GitHub Gist</option>
                <option value="webdav">WebDAV</option>
              </select>
            </label>
            <label class="field-row">
              <span>文件名</span>
              <input v-model="exportBackupFileName" type="text" placeholder="module.backup.json" />
            </label>
            <label class="field-row">
              <span>团队角色</span>
              <select v-model="exportTeamRole">
                <option value="owner">Owner：可覆盖备份</option>
                <option value="editor">Editor：可写入但检测冲突</option>
                <option value="viewer">Viewer：只读，不允许备份</option>
              </select>
            </label>
            <label class="field-row">
              <span>冲突策略</span>
              <select v-model="exportConflictStrategy">
                <option value="prompt">远端较新时中止并提示</option>
                <option value="overwrite">总是覆盖远端</option>
              </select>
            </label>
            <div class="permission-grid">
              <strong>细粒度权限</strong>
              <label class="inline-check"><input v-model="permissionEditSettings" type="checkbox" />保存模块设置</label>
              <label class="inline-check"><input v-model="permissionEditVariables" type="checkbox" />保存变量</label>
              <label class="inline-check"><input v-model="permissionSyncDataSource" type="checkbox" />同步数据源</label>
              <label class="inline-check"><input v-model="permissionBackup" type="checkbox" />执行备份</label>
            </div>
            <label v-if="exportBackupTarget !== 'local'" class="field-row">
              <span>{{ exportBackupTarget === 'gist' ? 'Gist API' : 'WebDAV URL' }}</span>
              <input v-model="exportBackupEndpoint" type="url" :placeholder="exportBackupTarget === 'gist' ? 'https://api.github.com/gists 或 /gists/{id}' : 'https://dav.example.com/backups/'" />
            </label>
            <label v-if="exportBackupTarget !== 'local'" class="field-row">
              <span>Token</span>
              <input v-model="exportBackupToken" type="password" placeholder="Bearer / Basic / GitHub token" />
            </label>
            <div class="quick-actions">
              <button class="btn btn-sm btn-primary" @click="saveModuleSettings('导出配置已保存')">保存导出配置</button>
              <button class="btn btn-sm" @click="exportModuleOpenApi">导出 OpenAPI</button>
              <button class="btn btn-sm" @click="exportModuleMarkdown">导出 Markdown</button>
              <button class="btn btn-sm" @click="exportModuleHtmlSite">导出 HTML 文档站</button>
              <button class="btn btn-sm" @click="backupModule()">执行备份</button>
            </div>
          </section>
        </div>
      </template>

      <template v-else-if="activeModuleTab === 'variables'">
        <section class="settings-card">
          <div class="section-heading-row">
            <div>
              <h3>模块变量</h3>
              <p>维护当前模块共享/本地覆盖变量，也可批量导入导出 JSON 便于团队迁移。</p>
            </div>
            <div class="quick-actions">
              <button class="btn btn-sm btn-primary" @click="saveModuleVariables">保存变量</button>
              <button class="btn btn-sm" @click="exportModuleVariables">导出变量</button>
              <button class="btn btn-sm" @click="importModuleVariables">导入变量</button>
              <input ref="variableImportInput" type="file" accept="application/json,.json" class="hidden-input" @change="handleModuleVariablesFile" />
            </div>
          </div>
          <div class="variable-table">
            <div class="variable-head">
              <span>变量名</span>
              <span>远程值</span>
              <span>本地值</span>
              <span>说明</span>
              <span></span>
            </div>
            <div v-for="(row, index) in variableRows" :key="index" class="variable-row">
              <input v-model="row.key" type="text" placeholder="baseUrl" />
              <input v-model="row.remote" type="text" placeholder="团队共享值" />
              <div class="local-value-cell">
                <input v-model="row.local" type="text" placeholder="本地覆盖值" />
                <button class="btn btn-icon" title="使用远程值" @click="useRemoteAsLocal(index)">↙</button>
              </div>
              <input v-model="row.description" type="text" placeholder="用途说明" />
              <button class="btn btn-icon danger" title="删除变量" @click="deleteVariableRow(index)">🗑</button>
            </div>
            <button class="add-row-btn" @click="addVariableRow">+ 添加变量</button>
          </div>
          <p class="help-text">远程值用于团队共享，本地值仅当前浏览器生效并优先覆盖远程值。URL、Header、Body 中可通过 <code>&#123;&#123;变量名&#125;&#125;</code> 引用。</p>
          <div class="variable-rename-panel">
            <div>
              <strong>跨接口变量改名</strong>
              <p>批量迁移当前模块接口 URL、Header、Cookie、Params、Body、Auth 和请求变量中的 <code>&#123;&#123;变量&#125;&#125;</code> 引用。</p>
            </div>
            <input v-model="variableRenameDraft.from" type="text" placeholder="旧变量名，如 token" />
            <span>→</span>
            <input v-model="variableRenameDraft.to" type="text" placeholder="新变量名，如 accessToken" />
            <button class="btn btn-sm" @click="renameVariableAcrossModule">迁移引用</button>
          </div>
          <div v-if="unresolvedVariableRefs.length > 0" class="variable-warning-panel">
            <div class="variable-warning-head">
              <strong>发现未解析变量引用</strong>
              <button class="btn btn-sm" @click="addMissingVariablesToDraft">批量补到变量草稿</button>
            </div>
            <div v-for="item in unresolvedVariableRefs" :key="item.ref" class="variable-warning-row">
              <code>{{ item.ref }}</code>
              <span>{{ item.interfaces.slice(0, 3).join('、') }}<template v-if="item.interfaces.length > 3"> 等 {{ item.interfaces.length }} 个接口</template></span>
            </div>
          </div>
          <div v-else class="variable-ok-panel">当前模块接口中的变量引用均可由请求变量、模块变量、环境变量、跨模块变量或动态函数解析。</div>
        </section>
      </template>

      <template v-else-if="activeModuleTab === 'artifacts'">
        <section class="settings-card">
          <div class="section-heading-row">
            <div>
              <h3>📚 模块文档</h3>
              <p>记录模块级或接口级文档，可作为后续文档站、Markdown/HTML/OpenAPI 导出的基础数据。</p>
            </div>
            <button class="btn btn-sm btn-primary" @click="saveDocArtifact">{{ docDraft.id ? '更新文档' : '保存文档' }}</button>
          </div>
          <div class="artifact-editor-grid">
            <label class="field-row">
              <span>标题</span>
              <input v-model="docDraft.title" type="text" placeholder="登录接口说明" />
            </label>
            <label class="field-row">
              <span>关联接口</span>
              <select v-model="docDraft.interfaceId">
                <option value="">模块级文档</option>
                <option v-for="item in moduleInterfaces" :key="item.id" :value="item.id">
                  {{ item.method }} · {{ store.apis[item.apiId]?.name ?? item.name }}
                </option>
              </select>
            </label>
            <label class="field-row">
              <span>格式</span>
              <select v-model="docDraft.format">
                <option value="markdown">Markdown</option>
                <option value="html">HTML</option>
                <option value="openapi">OpenAPI</option>
              </select>
            </label>
          </div>
          <textarea v-model="docDraft.content" class="artifact-textarea" rows="6" placeholder="输入文档内容、说明或示例..."></textarea>
          <div class="artifact-list">
            <div v-for="doc in moduleDocs" :key="doc.id" class="artifact-item">
              <div>
                <strong>{{ doc.title }}</strong>
                <small>{{ getInterfaceName(doc.interfaceId) }} · {{ doc.format }} · {{ formatTime(doc.updatedAt) }}</small>
              </div>
              <div class="artifact-actions">
                <button class="btn btn-sm" @click="editDocArtifact(doc)">编辑</button>
                <button class="btn btn-sm danger" @click="deleteDocArtifact(doc.id)">删除</button>
              </div>
            </div>
            <div v-if="moduleDocs.length === 0" class="empty-hint">暂无模块文档。</div>
          </div>
        </section>

        <section class="settings-card">
          <div class="section-heading-row">
            <div>
              <h3>🧱 数据模型</h3>
              <p>维护模块内可复用 JSON Schema，便于接口响应、请求体和文档生成引用。</p>
            </div>
            <button class="btn btn-sm btn-primary" @click="saveDataModel">{{ modelDraft.id ? '更新模型' : '保存模型' }}</button>
          </div>
          <div class="artifact-editor-grid">
            <label class="field-row">
              <span>模型名</span>
              <input v-model="modelDraft.name" type="text" placeholder="UserProfile" />
            </label>
            <label class="field-row">
              <span>说明</span>
              <input v-model="modelDraft.description" type="text" placeholder="用户资料响应结构" />
            </label>
          </div>
          <textarea v-model="modelDraft.schemaText" class="artifact-textarea code-textarea" rows="8" spellcheck="false"></textarea>
          <div class="artifact-list">
            <div v-for="model in moduleModels" :key="model.id" class="artifact-item">
              <div>
                <strong>{{ model.name }}</strong>
                <small>{{ model.description || '无说明' }} · {{ formatTime(model.updatedAt) }}</small>
              </div>
              <div class="artifact-actions">
                <button class="btn btn-sm" @click="editDataModel(model)">编辑</button>
                <button class="btn btn-sm danger" @click="deleteDataModel(model.id)">删除</button>
              </div>
            </div>
            <div v-if="moduleModels.length === 0" class="empty-hint">暂无数据模型。</div>
          </div>
        </section>

        <section class="settings-card">
          <div class="section-heading-row">
            <div>
              <h3>✅ 单接口测试用例</h3>
              <p>为接口创建断言用例，并可按当前环境变量直接运行。支持 <code>status in 200,201</code>、<code>body not includes error</code>、<code>header content-type includes json</code>、<code>$.data.id exists</code>、<code>$.items length &gt; 0</code>、<code>env.token=$.data.token</code>。</p>
            </div>
            <div class="quick-actions">
              <button class="btn btn-sm btn-primary" @click="saveInterfaceTestCase">{{ testCaseDraft.id ? '更新用例' : '保存用例' }}</button>
              <button class="btn btn-sm" :disabled="runningCaseId !== null || interfaceTestCases.length === 0" @click="runAllInterfaceTestCases">运行全部</button>
            </div>
          </div>
          <div class="artifact-editor-grid">
            <label class="field-row">
              <span>接口</span>
              <select v-model="testCaseDraft.interfaceId">
                <option value="">选择接口</option>
                <option v-for="item in moduleInterfaces" :key="item.id" :value="item.id">
                  {{ item.method }} · {{ store.apis[item.apiId]?.name ?? item.name }}
                </option>
              </select>
            </label>
            <label class="field-row">
              <span>用例名</span>
              <input v-model="testCaseDraft.name" type="text" placeholder="返回 200 且包含 token" />
            </label>
            <label class="field-row">
              <span>状态码</span>
              <input v-model.number="testCaseDraft.expectedStatus" type="number" min="0" step="1" />
            </label>
          </div>
            <textarea v-model="testCaseDraft.assertionsText" class="artifact-textarea code-textarea" rows="5" spellcheck="false" placeholder="status in 200,201&#10;header content-type includes json&#10;$.data.id exists&#10;$.items length > 0"></textarea>
          <div class="extractor-builder">
            <strong>可视化变量提取器</strong>
            <label class="field-row compact-field">
              <span>变量名</span>
              <input v-model="extractorDraft.variable" type="text" placeholder="token" />
            </label>
            <label class="field-row compact-field">
              <span>来源</span>
              <select v-model="extractorDraft.sourceType">
                <option value="json">JSONPath</option>
                <option value="header">Header</option>
                <option value="body">整个 Body</option>
              </select>
            </label>
            <label v-if="extractorDraft.sourceType !== 'body'" class="field-row compact-field">
              <span>{{ extractorDraft.sourceType === 'json' ? 'JSONPath' : 'Header 名' }}</span>
              <input v-model="extractorDraft.path" type="text" :placeholder="extractorDraft.sourceType === 'json' ? '$.data.token' : 'set-cookie'" />
            </label>
            <button class="btn btn-sm" @click="appendExtractorAssertion">添加到断言</button>
          </div>
          <div class="artifact-list">
            <div v-for="testCase in interfaceTestCases" :key="testCase.id" class="artifact-item">
              <div>
                <strong>{{ testCase.name }}</strong>
                <small>
                  {{ getInterfaceName(testCase.interfaceId) }} · 期望 {{ testCase.expectedStatus || '-' }}
                  <template v-if="testCase.lastRunAt"> · {{ testCase.lastPassed ? '通过' : '未通过' }} · {{ formatTime(testCase.lastRunAt) }}</template>
                </small>
              </div>
              <div class="artifact-actions">
                <button class="btn btn-sm" :disabled="runningCaseId === testCase.id" @click="runInterfaceTestCase(testCase)">
                  {{ runningCaseId === testCase.id ? '运行中...' : '运行' }}
                </button>
                <button class="btn btn-sm" @click="editInterfaceTestCase(testCase)">编辑</button>
                <button class="btn btn-sm danger" @click="deleteInterfaceTestCase(testCase.id)">删除</button>
              </div>
            </div>
            <div v-if="interfaceTestCases.length === 0" class="empty-hint">暂无测试用例。</div>
          </div>
        </section>

        <section class="settings-card">
          <div class="section-heading-row">
            <div>
              <h3>🔄 场景用例编排</h3>
              <p>把多个单接口用例串成业务流程，运行后生成通过/失败报告，并回写模块场景覆盖率。</p>
            </div>
            <div class="quick-actions">
              <button class="btn btn-sm btn-primary" @click="saveScenarioCase">{{ scenarioDraft.id ? '更新场景' : '保存场景' }}</button>
              <button class="btn btn-sm" :disabled="runningScenarioId !== null || moduleScenarioCases.length === 0" @click="runAllScenarioCases">运行全部场景</button>
              <button class="btn btn-sm" @click="exportModuleTestReport">导出测试报告</button>
            </div>
          </div>
          <div class="artifact-editor-grid">
            <label class="field-row">
              <span>场景名</span>
              <input v-model="scenarioDraft.name" type="text" placeholder="登录后查询用户资料" />
            </label>
            <label class="field-row">
              <span>说明</span>
              <input v-model="scenarioDraft.description" type="text" placeholder="描述业务链路和期望结果" />
            </label>
            <div class="field-row checkbox-field">
              <span>默认失败策略</span>
              <label class="inline-check">
                <input v-model="scenarioDraft.continueOnFailure" type="checkbox" />
                <span>新步骤默认失败后继续运行后续步骤</span>
              </label>
            </div>
            <label class="field-row">
              <span>添加步骤</span>
              <div class="inline-field">
                <select v-model="scenarioDraft.selectedCaseId">
                  <option value="">选择单接口用例</option>
                  <option v-for="testCase in interfaceTestCases" :key="testCase.id" :value="testCase.id">
                    {{ testCase.name }} · {{ getInterfaceName(testCase.interfaceId) }}
                  </option>
                </select>
                <button class="btn btn-sm" @click="addScenarioStep">添加</button>
              </div>
            </label>
          </div>
          <div class="scenario-steps">
            <div v-for="(step, index) in scenarioDraft.steps" :key="step.caseId + index" class="scenario-step">
              <span>{{ index + 1 }}</span>
              <strong>{{ getTestCaseName(step.caseId) }}</strong>
              <small>{{ getInterfaceName(interfaceTestCases.find(item => item.id === step.caseId)?.interfaceId) }}</small>
              <label class="inline-check step-policy">
                <input v-model="step.enabled" type="checkbox" />
                <span>启用</span>
              </label>
              <label class="inline-check step-policy">
                <input v-model="step.continueOnFailure" type="checkbox" :disabled="!step.enabled" />
                <span>失败继续</span>
              </label>
              <button class="btn btn-sm danger" @click="removeScenarioStep(index)">移除</button>
            </div>
            <div v-if="scenarioDraft.steps.length === 0" class="empty-hint">尚未添加场景步骤，请先创建单接口用例。</div>
          </div>
          <div class="artifact-list">
            <div v-for="scenario in moduleScenarioCases" :key="scenario.id" class="artifact-item">
              <div>
                <strong>{{ scenario.name }}</strong>
                <small>
                  {{ getScenarioStepSummary(scenario) || '无步骤' }}
                  <template v-if="hasScenarioContinueOnFailure(scenario)"> · 失败继续</template>
                  <template v-if="scenario.lastRunAt">
                    · {{ scenario.lastPassed ? '通过' : '未通过' }}
                    · {{ scenario.lastReport?.passed || 0 }}/{{ scenario.lastReport?.total || scenario.steps.length }}
                    · {{ formatTime(scenario.lastRunAt) }}
                  </template>
                </small>
              </div>
              <div class="artifact-actions">
                <button class="btn btn-sm" :disabled="runningScenarioId === scenario.id" @click="runScenarioCase(scenario)">
                  {{ runningScenarioId === scenario.id ? '运行中...' : '运行' }}
                </button>
                <button class="btn btn-sm" @click="editScenarioCase(scenario)">编辑</button>
                <button class="btn btn-sm danger" @click="deleteScenarioCase(scenario.id)">删除</button>
              </div>
            </div>
            <div v-if="moduleScenarioCases.length === 0" class="empty-hint">暂无场景用例。</div>
          </div>
        </section>
      </template>

      <template v-else>
        <section class="settings-card">
          <h3>🧾 审计日志</h3>
          <p>记录当前模块的设置、变量、同步、导出与备份操作，便于团队排查最近变更。</p>
          <div class="audit-log-list">
            <div v-for="log in moduleAuditLogs" :key="log.id" class="audit-log-row">
              <strong>{{ log.action }}</strong>
              <span>{{ log.detail }}</span>
              <small>{{ formatTime(log.createdAt) }}</small>
            </div>
            <div v-if="moduleAuditLogs.length === 0" class="empty-hint">暂无审计日志。</div>
          </div>
        </section>

        <section class="settings-card">
          <h3>基础设置</h3>
          <label class="field-row">
            <span>模块名称</span>
            <input v-model="moduleName" type="text" placeholder="输入模块名称" @keydown.enter="saveModuleSettings()" />
          </label>
          <label class="field-row">
            <span>所属分组</span>
            <select v-model="moduleCategoryId">
              <option v-for="category in workspace.categories" :key="category.id" :value="category.id">
                {{ category.name }}
              </option>
            </select>
          </label>
          <label class="field-row">
            <span>模块类型</span>
            <select v-model="moduleType">
              <option v-for="item in moduleTypes" :key="item.value" :value="item.value">
                {{ item.title }}
              </option>
            </select>
          </label>
          <label class="field-row field-row-top">
            <span>模块说明</span>
            <textarea v-model="moduleDescription" rows="4" placeholder="记录模块用途、接口来源、同步策略或注意事项"></textarea>
          </label>
          <div class="meta-grid">
            <div><strong>{{ selectedModuleInterfaceCount }}</strong><span>接口数</span></div>
            <div><strong>{{ activeModule.legacyGroupName || 'planned' }}</strong><span>来源</span></div>
            <div><strong>{{ formatTime(activeModule.updatedAt) }}</strong><span>更新时间</span></div>
          </div>
        </section>

        <section class="settings-card">
          <h3>模块接口</h3>
          <div class="interface-list">
            <button
              v-for="item in moduleInterfaces"
              :key="item.id"
              class="interface-link"
              @click="openInterface(item.apiId)"
            >
              <span :class="['method-badge', item.method.toLowerCase()]">{{ item.method }}</span>
              <span>{{ store.apis[item.apiId]?.name ?? item.name }}</span>
              <small>{{ store.apis[item.apiId]?.url ?? item.url }}</small>
            </button>
            <div v-if="moduleInterfaces.length === 0" class="empty-hint">该模块下暂无接口。</div>
          </div>
        </section>
      </template>
    </template>

    <div v-else class="settings-empty">
      <div class="empty-icon">⚙️</div>
      <h2>选择分组或模块进行设置</h2>
      <p>点击左侧分组或模块即可进入对应设置页；点击具体接口则回到请求编辑器。</p>
    </div>

    <div v-if="backupConflictPreview" class="modal-overlay" @click.self="resolveBackupConflictDecision('cancel')">
      <div class="modal-content backup-conflict-modal">
        <div class="section-heading-row">
          <div>
            <h3>远端备份较新</h3>
            <p>请先查看字段级冲突预览，可逐字段保留远端值后再写回备份。</p>
          </div>
          <button class="btn btn-sm" @click="resolveBackupConflictDecision('cancel')">关闭</button>
        </div>
        <div class="conflict-summary-grid">
          <div><strong>远端</strong><span>{{ backupConflictPreview.remoteSummary }}</span></div>
          <div><strong>本地</strong><span>{{ backupConflictPreview.localSummary }}</span></div>
        </div>
        <div class="conflict-table">
          <div class="conflict-table-head">
            <strong>字段</strong>
            <strong>远端</strong>
            <strong>本地</strong>
            <strong>合并选择</strong>
          </div>
          <div
            v-for="row in backupConflictPreview.rows"
            :key="row.field"
            :class="['conflict-row', { changed: row.changed }]"
          >
            <span>{{ row.field }}</span>
            <code>{{ row.remote }}</code>
            <code>{{ row.local }}</code>
            <label class="merge-choice">
              <input v-model="row.useRemote" type="checkbox" :disabled="!row.changed" />
              <span>{{ row.useRemote ? '使用远端' : '使用本地' }}</span>
            </label>
          </div>
        </div>
        <div class="quick-actions conflict-actions">
          <button class="btn btn-sm" @click="resolveBackupConflictDecision('cancel')">取消备份，保留远端</button>
          <button class="btn btn-sm" @click="resolveBackupConflictDecision('merge')">按选择合并后写回</button>
          <button class="btn btn-sm btn-primary" @click="resolveBackupConflictDecision('overwrite')">全部使用本地覆盖</button>
        </div>
      </div>
    </div>

    <div v-if="saveMessage" class="save-toast">{{ saveMessage }}</div>
  </div>
</template>

<style scoped>
.workspace-settings {
  flex: 1;
  overflow: auto;
  padding: 24px;
  background:
    radial-gradient(circle at 18% 0%, var(--primary-soft), transparent 30%),
    var(--bg-base);
  position: relative;
}

.settings-header {
  display: flex;
  align-items: flex-start;
  justify-content: space-between;
  gap: 16px;
  margin-bottom: 14px;
}

.sticky-header {
  position: sticky;
  top: 0;
  z-index: 5;
  background: color-mix(in srgb, var(--bg-base) 88%, transparent);
  backdrop-filter: blur(14px);
  padding-bottom: 10px;
  border-bottom: 1px solid var(--divider);
}

.eyebrow {
  color: var(--primary);
  font-size: var(--font-size-small);
  font-weight: 700;
  margin-bottom: 4px;
}

.settings-header h2 {
  display: flex;
  align-items: center;
  gap: 8px;
  font-size: 22px;
  line-height: 1.3;
  margin-bottom: 4px;
}

.title-dot {
  width: 10px;
  height: 10px;
  border-radius: 50%;
  flex-shrink: 0;
}

.settings-header p {
  color: var(--text-secondary);
}

.header-actions {
  display: flex;
  gap: 8px;
}

.settings-tabs {
  display: flex;
  gap: 4px;
  margin: 0 0 14px;
  border-bottom: 1px solid var(--divider);
}

.settings-tabs button {
  border: 1px solid transparent;
  border-bottom: none;
  background: transparent;
  color: var(--text-secondary);
  cursor: pointer;
  padding: 8px 12px;
  border-radius: var(--radius-lg) var(--radius-lg) 0 0;
  font-weight: 700;
}

.settings-tabs button:hover {
  background: var(--bg-hover);
  color: var(--text-primary);
}

.settings-tabs button.active {
  color: var(--primary);
  background: var(--bg-panel);
  border-color: var(--border);
  box-shadow: 0 -2px 0 var(--primary) inset;
  font-weight: 700;
}

.settings-card {
  border: 1px solid var(--border);
  border-radius: var(--radius-xl);
  background: var(--bg-panel);
  padding: 16px;
  margin-bottom: 14px;
  box-shadow: var(--shadow-sm);
}

.settings-card h3 {
  font-size: var(--font-size-title);
  margin-bottom: 12px;
}

.settings-card p {
  color: var(--text-secondary);
  line-height: 1.7;
  margin-bottom: 10px;
}


.sync-log {
  margin: 10px 0;
  padding: 8px 10px;
  border: 1px solid var(--divider);
  border-radius: var(--radius-md);
  background: var(--bg-code);
  color: var(--text-secondary);
  font-family: var(--font-code);
  font-size: var(--font-size-small);
  line-height: 1.6;
}

.sync-status-card {
  display: grid;
  gap: 4px;
  margin: 10px 0;
  padding: 10px 12px;
  border: 1px solid var(--border);
  border-radius: var(--radius-lg);
  background: var(--bg-panel-subtle);
  color: var(--text-secondary);
  font-size: var(--font-size-small);
  line-height: 1.5;
  word-break: break-all;
}

.field-row {
  display: grid;
  grid-template-columns: 96px minmax(0, 1fr);
  gap: 12px;
  align-items: center;
  margin-bottom: 12px;
  color: var(--text-secondary);
}

.field-row-top {
  align-items: start;
}

.field-row input,
.field-row select,
.field-row textarea,
.variable-row input {
  width: 100%;
  min-height: 32px;
}

.field-row textarea {
  resize: vertical;
}

.inline-check {
  display: inline-flex;
  align-items: center;
  gap: 8px;
  color: var(--text-secondary);
  font-size: var(--font-size-small);
}

.inline-check input {
  width: auto;
  min-height: 0;
}

.field-row input:focus,
.field-row select:focus,
.field-row textarea:focus,
.variable-row input:focus {
  border-color: var(--primary);
  box-shadow: var(--focus-ring);
}

.color-field {
  display: grid;
  grid-template-columns: 44px minmax(0, 1fr);
  gap: 8px;
}

.color-field input[type="color"] {
  padding: 2px;
  cursor: pointer;
}

.meta-grid,
.stat-grid {
  display: grid;
  grid-template-columns: repeat(3, minmax(0, 1fr));
  gap: 10px;
  margin-top: 14px;
}

.stat-grid {
  grid-template-columns: repeat(2, minmax(0, 1fr));
  margin-top: 0;
}

.stat-grid-large {
  grid-template-columns: repeat(3, minmax(0, 1fr));
}

.meta-grid div,
.stat-grid div {
  background: linear-gradient(180deg, var(--bg-code), var(--bg-panel));
  border: 1px solid var(--divider);
  border-radius: var(--radius-lg);
  padding: 12px;
  min-width: 0;
}

.meta-grid strong,
.stat-grid strong {
  display: block;
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
  font-size: 18px;
}

.meta-grid span,
.stat-grid span {
  color: var(--text-tertiary);
  font-size: var(--font-size-small);
}

.overview-grid {
  display: grid;
  grid-template-columns: repeat(2, minmax(0, 1fr));
  gap: 14px;
}

.bulk-edit-grid {
  display: grid;
  grid-template-columns: repeat(4, minmax(130px, 1fr)) auto;
  gap: 8px;
  align-items: end;
}

.bulk-edit-grid .field-row {
  margin-bottom: 0;
}

.bulk-edit-enabled {
  min-height: 32px;
  padding-bottom: 6px;
  white-space: nowrap;
}

.type-card-list {
  display: grid;
  grid-template-columns: repeat(3, minmax(0, 1fr));
  gap: 10px;
}

.type-card {
  display: flex;
  gap: 10px;
  align-items: flex-start;
  border: 1px solid var(--border);
  border-radius: var(--radius-xl);
  background: var(--bg-panel);
  color: var(--text-primary);
  padding: 12px;
  cursor: pointer;
  text-align: left;
}

.type-card.active {
  border-color: var(--primary);
  background: var(--primary-soft);
  box-shadow: inset 0 0 0 1px var(--primary-ring);
}

.type-card small {
  display: block;
  margin-top: 4px;
  color: var(--text-secondary);
  line-height: 1.5;
}

.type-icon {
  font-size: 20px;
}

.openapi-editor {
  min-height: 240px;
  border: 1px solid var(--border);
  border-radius: var(--radius-lg);
  overflow: hidden;
}

.openapi-preview {
  margin-top: 10px;
  padding: 8px 10px;
  border: 1px solid var(--divider);
  border-radius: var(--radius-lg);
  background: var(--bg-code);
  color: var(--text-secondary);
  font-size: var(--font-size-small);
}

.quick-actions {
  display: flex;
  flex-wrap: wrap;
  gap: 6px;
}

.hidden-input {
  display: none;
}

.variable-warning-panel,
.variable-ok-panel,
.variable-rename-panel {
  margin-top: 12px;
  padding: 10px 12px;
  border-radius: var(--radius-lg);
  font-size: var(--font-size-small);
  line-height: 1.6;
}

.variable-rename-panel {
  display: grid;
  grid-template-columns: minmax(220px, 1fr) minmax(120px, 180px) auto minmax(120px, 180px) auto;
  gap: 8px;
  align-items: center;
  border: 1px solid var(--border);
  background: var(--bg-panel-elevated);
  color: var(--text-secondary);
}

.variable-rename-panel p {
  margin: 2px 0 0;
  color: var(--text-tertiary);
}

.variable-warning-panel {
  border: 1px solid color-mix(in srgb, var(--warning) 45%, var(--divider));
  background: color-mix(in srgb, var(--warning) 10%, var(--bg-panel));
  color: var(--text-secondary);
}

.variable-warning-head {
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: 8px;
  margin-bottom: 6px;
}

.variable-warning-panel strong {
  color: var(--warning);
}

.variable-warning-row {
  display: grid;
  grid-template-columns: 160px minmax(0, 1fr);
  gap: 8px;
  padding: 3px 0;
}

.variable-warning-row code {
  color: var(--warning);
  word-break: break-all;
}

.variable-ok-panel {
  border: 1px solid color-mix(in srgb, var(--success) 35%, var(--divider));
  background: color-mix(in srgb, var(--success) 8%, var(--bg-panel));
  color: var(--success);
}

.trend-chart {
  display: grid;
  grid-template-columns: repeat(7, minmax(0, 1fr));
  align-items: end;
  gap: 8px;
  min-height: 120px;
  margin-top: 8px;
}

.trend-bar-wrap {
  position: relative;
  display: flex;
  min-width: 0;
  flex-direction: column;
  align-items: center;
  gap: 5px;
  color: var(--text-tertiary);
  font-size: 11px;
}

.trend-count {
  color: var(--text-secondary);
  font-variant-numeric: tabular-nums;
}

.trend-bar-wrap.peak .trend-count {
  color: var(--primary);
  font-weight: 800;
}

.trend-bar-track {
  display: flex;
  width: 100%;
  height: 68px;
  align-items: end;
  justify-content: center;
  border-radius: 999px;
  background: var(--bg-code);
  border: 1px solid var(--divider);
  overflow: hidden;
}

.trend-bar {
  width: 68%;
  min-height: 8px;
  border-radius: 999px 999px 0 0;
  background: linear-gradient(180deg, var(--primary), var(--primary-hover));
  box-shadow: 0 0 16px var(--primary-ring);
}

.trend-bar-wrap.peak .trend-bar {
  background: linear-gradient(180deg, var(--warning), var(--primary));
}

.trend-tooltip {
  position: absolute;
  left: 50%;
  bottom: calc(100% + 8px);
  z-index: 5;
  display: grid;
  min-width: 132px;
  gap: 2px;
  padding: 8px 10px;
  border: 1px solid var(--border);
  border-radius: var(--radius-lg);
  background: var(--bg-panel-elevated);
  box-shadow: var(--shadow-md);
  color: var(--text-secondary);
  opacity: 0;
  pointer-events: none;
  transform: translateX(-50%) translateY(4px);
  transition: opacity 0.16s ease, transform 0.16s ease;
}

.trend-tooltip strong {
  color: var(--text-primary);
}

.trend-tooltip em {
  color: var(--warning);
  font-style: normal;
  font-weight: 700;
}

.trend-bar-wrap:hover .trend-tooltip,
.trend-bar-wrap:focus-within .trend-tooltip {
  opacity: 1;
  transform: translateX(-50%) translateY(0);
}

.module-quick-rail {
  display: grid;
  gap: 8px;
  margin-top: 10px;
}

.quick-rail-item {
  display: flex;
  flex-direction: column;
  gap: 4px;
  width: 100%;
  padding: 12px;
  border: 1px solid var(--divider);
  border-radius: var(--radius-lg);
  background: linear-gradient(135deg, var(--bg-code), var(--bg-panel));
  color: var(--text-primary);
  text-align: left;
  cursor: pointer;
}

.quick-rail-item:hover {
  border-color: var(--primary);
  background: var(--primary-soft);
}

.quick-rail-item span {
  color: var(--text-tertiary);
  font-size: var(--font-size-small);
}

.section-heading-row {
  display: flex;
  justify-content: space-between;
  gap: 12px;
  margin-bottom: 12px;
}

.section-heading-row h3 {
  margin-bottom: 4px;
}

.section-heading-row p {
  margin: 0;
  color: var(--text-secondary);
  line-height: 1.6;
}

.section-heading-row code {
  background: var(--bg-code);
  border-radius: var(--radius-sm);
  color: var(--primary);
  padding: 1px 4px;
}

.module-list,
.interface-list {
  display: flex;
  flex-direction: column;
  gap: 6px;
}

.module-link,
.interface-link {
  display: flex;
  align-items: center;
  gap: 8px;
  border: 1px solid var(--border);
  border-radius: var(--radius-lg);
  background: var(--bg-panel);
  color: var(--text-primary);
  padding: 8px 10px;
  cursor: pointer;
  text-align: left;
}

.module-link:hover,
.interface-link:hover {
  background: var(--bg-hover);
  border-color: var(--border-strong);
}

.module-link span,
.interface-link span:nth-child(2) {
  flex: 1;
  min-width: 0;
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
}

.module-link small,
.interface-link small {
  color: var(--text-tertiary);
  min-width: 0;
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
}

.interface-link small {
  flex: 1.4;
  font-family: var(--font-code);
}

.prefix-empty {
  border: 1px dashed var(--border);
  border-radius: var(--radius-lg);
  background: var(--bg-panel-elevated);
}

.module-prefix-table {
  border: 1px solid var(--border);
  border-radius: var(--radius-lg);
  overflow: auto;
}

.module-prefix-head,
.module-prefix-row {
  display: grid;
  gap: 8px;
  align-items: center;
  min-width: max-content;
  padding: 8px;
}

.module-prefix-head {
  position: sticky;
  top: 0;
  z-index: 1;
  background: var(--bg-sidebar);
  color: var(--text-secondary);
  font-size: var(--font-size-small);
  font-weight: 700;
  border-bottom: 1px solid var(--divider);
}

.module-prefix-row {
  border-bottom: 1px solid var(--divider);
}

.module-prefix-row:last-child {
  border-bottom: none;
}

.module-prefix-name {
  display: flex;
  flex-direction: column;
  gap: 2px;
  min-width: 0;
}

.module-prefix-name strong,
.module-prefix-name small {
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
}

.module-prefix-name small {
  color: var(--text-tertiary);
  font-size: var(--font-size-small);
}

.prefix-input {
  width: 100%;
  min-height: 34px;
  font-family: var(--font-code);
  font-size: var(--font-size-small);
}

.variable-table {
  border: 1px solid var(--border);
  border-radius: var(--radius-md);
  overflow: hidden;
}

.variable-head,
.variable-row {
  display: grid;
  grid-template-columns: 1fr 1.2fr 1.2fr 1.2fr 42px;
  gap: 8px;
  align-items: center;
  padding: 8px;
  border-bottom: 1px solid var(--divider);
}

.variable-head {
  background: var(--bg-sidebar);
  color: var(--text-secondary);
  font-size: var(--font-size-small);
  font-weight: 700;
}

.local-value-cell {
  display: flex;
  gap: 4px;
}

.local-value-cell input {
  flex: 1;
}

.add-row-btn {
  width: 100%;
  border: none;
  background: transparent;
  color: var(--primary);
  padding: 10px;
  cursor: pointer;
  text-align: left;
}

.add-row-btn:hover {
  background: var(--bg-hover);
}

.help-text {
  margin-top: 12px;
  color: var(--text-secondary);
}

.help-text code {
  background: var(--bg-code);
  border-radius: var(--radius-sm);
  padding: 1px 4px;
  color: var(--primary);
}

.artifact-editor-grid {
  display: grid;
  grid-template-columns: repeat(3, minmax(0, 1fr));
  gap: 10px;
  margin-bottom: 10px;
}

.artifact-editor-grid .field-row {
  grid-template-columns: 72px minmax(0, 1fr);
  margin-bottom: 0;
}

.artifact-textarea {
  width: 100%;
  min-height: 120px;
  margin-bottom: 10px;
  resize: vertical;
}

.code-textarea {
  font-family: var(--font-code);
  font-size: var(--font-size-small);
  line-height: 1.6;
}

.artifact-list {
  display: grid;
  gap: 6px;
}

.inline-field {
  display: flex;
  gap: 6px;
  min-width: 0;
}

.inline-field select {
  flex: 1;
  min-width: 0;
}

.extractor-builder {
  display: grid;
  grid-template-columns: auto minmax(120px, 1fr) minmax(120px, 1fr) minmax(160px, 1.4fr) auto;
  align-items: end;
  gap: 8px;
  margin: 10px 0 12px;
  padding: 10px;
  border: 1px dashed var(--border);
  border-radius: var(--radius-lg);
  background: var(--bg-panel-subtle);
}

.extractor-builder strong {
  align-self: center;
  color: var(--text-primary);
  font-size: var(--font-size-small);
  white-space: nowrap;
}

.permission-grid {
  display: grid;
  grid-template-columns: repeat(2, minmax(0, 1fr));
  gap: 8px;
  margin: 8px 0;
  padding: 10px;
  border: 1px dashed var(--border);
  border-radius: var(--radius-lg);
  background: var(--bg-panel-subtle);
}

.permission-grid strong {
  grid-column: 1 / -1;
  color: var(--text-primary);
  font-size: var(--font-size-small);
}

.compact-field {
  gap: 4px;
}

.compact-field span {
  font-size: 11px;
}

.scenario-steps {
  display: grid;
  gap: 6px;
  margin: 0 0 10px;
}

.scenario-step {
  display: grid;
  grid-template-columns: 24px minmax(120px, 1fr) minmax(160px, 1.4fr) auto auto auto;
  gap: 8px;
  align-items: center;
  border: 1px dashed var(--border);
  border-radius: var(--radius-lg);
  background: var(--bg-panel-subtle);
  padding: 8px;
}

.scenario-step > span {
  display: inline-flex;
  align-items: center;
  justify-content: center;
  width: 22px;
  height: 22px;
  border-radius: 999px;
  background: var(--primary-soft);
  color: var(--primary);
  font-weight: 700;
}

.scenario-step small {
  color: var(--text-tertiary);
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
}

.step-policy {
  white-space: nowrap;
}

.artifact-item {
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: 12px;
  border: 1px solid var(--border);
  border-radius: var(--radius-lg);
  background: var(--bg-panel-subtle);
  padding: 9px 10px;
}

.artifact-item strong,
.artifact-item small {
  display: block;
  min-width: 0;
}

.artifact-item small {
  color: var(--text-tertiary);
  font-size: var(--font-size-small);
  margin-top: 2px;
}

.artifact-actions {
  display: flex;
  flex-wrap: wrap;
  justify-content: flex-end;
  gap: 6px;
  flex-shrink: 0;
}

.danger {
  color: var(--error);
}

.empty-hint {
  padding: 10px;
  color: var(--text-tertiary);
  text-align: center;
}

.audit-log-list {
  display: grid;
  gap: 8px;
}

.audit-log-row {
  display: grid;
  grid-template-columns: minmax(120px, 0.8fr) minmax(160px, 1.2fr) auto;
  gap: 8px;
  align-items: center;
  padding: 8px 10px;
  border: 1px solid var(--divider);
  border-radius: var(--radius-lg);
  background: var(--bg-secondary);
  font-size: var(--font-size-small);
}

.audit-log-row span,
.audit-log-row small {
  color: var(--text-secondary);
}

.settings-empty {
  min-height: 100%;
  display: flex;
  flex-direction: column;
  align-items: center;
  justify-content: center;
  text-align: center;
  color: var(--text-secondary);
}

.settings-empty h2 {
  color: var(--text-primary);
  margin-bottom: 8px;
}

.empty-icon {
  font-size: 34px;
  margin-bottom: 12px;
}

.save-toast {
  position: fixed;
  right: 24px;
  bottom: 24px;
  background: var(--success);
  color: #fff;
  padding: 8px 12px;
  border-radius: var(--radius-md);
  box-shadow: 0 8px 24px rgba(0, 0, 0, 0.18);
}

.modal-overlay {
  position: fixed;
  inset: 0;
  z-index: 70;
  display: flex;
  align-items: center;
  justify-content: center;
  padding: 24px;
  background: rgba(15, 23, 42, 0.42);
  backdrop-filter: blur(4px);
}

.modal-content {
  width: min(920px, 100%);
  max-height: min(760px, 90vh);
  overflow: auto;
  border: 1px solid var(--border);
  border-radius: var(--radius-xl);
  background: var(--bg-panel);
  box-shadow: var(--shadow-lg);
  padding: 16px;
}

.backup-conflict-modal {
  display: grid;
  gap: 12px;
}

.conflict-summary-grid {
  display: grid;
  grid-template-columns: repeat(2, minmax(0, 1fr));
  gap: 10px;
}

.conflict-summary-grid div {
  display: grid;
  gap: 4px;
  padding: 10px;
  border: 1px solid var(--divider);
  border-radius: var(--radius-lg);
  background: var(--bg-panel-subtle);
}

.conflict-summary-grid span {
  color: var(--text-secondary);
  font-size: var(--font-size-small);
  line-height: 1.5;
}

.conflict-table {
  overflow: hidden;
  border: 1px solid var(--divider);
  border-radius: var(--radius-lg);
}

.conflict-table-head,
.conflict-row {
  display: grid;
  grid-template-columns: 150px minmax(0, 1fr) minmax(0, 1fr) 120px;
  gap: 8px;
  align-items: center;
  padding: 8px 10px;
  border-bottom: 1px solid var(--divider);
}

.conflict-table-head {
  background: var(--bg-panel-subtle);
  color: var(--text-secondary);
  font-size: var(--font-size-small);
}

.conflict-row:last-child {
  border-bottom: none;
}

.conflict-row.changed {
  background: color-mix(in srgb, var(--warning) 10%, transparent);
}

.conflict-row code {
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
  color: var(--text-secondary);
}

.merge-choice {
  display: inline-flex;
  align-items: center;
  gap: 6px;
  color: var(--text-secondary);
  font-size: var(--font-size-small);
}

.merge-choice input:disabled + span {
  opacity: 0.55;
}

.conflict-actions {
  justify-content: flex-end;
}

@media (max-width: 980px) {
  .overview-grid,
  .type-card-list {
    grid-template-columns: 1fr;
  }

  .variable-head,
  .variable-row,
  .artifact-editor-grid,
  .extractor-builder,
  .bulk-edit-grid,
  .permission-grid {
    grid-template-columns: 1fr;
  }

  .conflict-summary-grid,
  .conflict-table-head,
  .conflict-row {
    grid-template-columns: 1fr;
  }

  .artifact-item {
    align-items: stretch;
    flex-direction: column;
  }

  .scenario-step {
    grid-template-columns: 24px minmax(0, 1fr);
  }

  .artifact-actions {
    justify-content: flex-start;
  }
}
</style>
