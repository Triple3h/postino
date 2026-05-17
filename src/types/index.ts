export type HttpMethod = 'GET' | 'POST' | 'PUT' | 'DELETE' | 'PATCH' | 'HEAD' | 'OPTIONS'

export interface KvPair {
  key: string
  value: string
  enabled: boolean
  description?: string
  type?: 'text' | 'file'
  fileName?: string
}

export interface BodyConfig {
  type: 'none' | 'json' | 'form' | 'raw' | 'binary' | 'urlencoded'
  raw: string
  formData: KvPair[]
  urlEncoded: KvPair[]
  binaryFile: string | null
  contentType: string
}

export interface AuthConfig {
  type: 'none' | 'bearer' | 'basic' | 'apikey' | 'digest' | 'oauth2'
  bearerToken: string
  basicUsername: string
  basicPassword: string
  apiKeyName: string
  apiKeyValue: string
  apiKeyIn: 'header' | 'query'
  digestUsername: string
  digestPassword: string
  oauth2GrantType: 'authorization_code' | 'client_credentials' | 'password'
  oauth2AccessTokenUrl: string
  oauth2ClientId: string
  oauth2ClientSecret: string
  oauth2Scope: string
  oauth2Token: string
  oauth2Username: string
  oauth2Password: string
}

export interface CookieItem {
  key: string
  value: string
  enabled: boolean
  description?: string
}

export interface ApiConfig {
  id: string
  name: string
  description?: string
  method: HttpMethod
  url: string
  headers: KvPair[]
  params: KvPair[]
  cookies: CookieItem[]
  body: BodyConfig
  auth: AuthConfig
  requestVariables?: KvPair[]
  preRequestScript: string
  postRequestScript: string
  folder: string | null
  createdAt: number
  updatedAt: number
}

export interface EnvVariable {
  key: string
  value: string
  enabled: boolean
}

export interface Environment {
  id: string
  name: string
  variables: EnvVariable[]
}

export interface HistoryEntry {
  id: string
  apiId: string
  moduleId?: string
  interfaceId?: string
  method: HttpMethod
  url: string
  status: number
  statusText: string
  duration: number
  timestamp: number
  requestHeaders: Record<string, string>
  requestBody: string | null
  responseSize: number
  starred: boolean
}

export interface ResponseData {
  status: number
  statusText: string
  headers: Record<string, string>
  body: string
  bodyEncoding?: 'text' | 'base64'
  contentType?: string
  duration: number
  size: number
  url: string
  method: HttpMethod
  requestHeaders: Record<string, string>
  requestBody: string | null
  timestamp: number
  isStreaming?: boolean
  streamType?: 'sse' | 'ndjson'
  chunks?: ResponseStreamChunk[]
  finalBody?: string
  streamCompleted?: boolean
  cancelled?: boolean
}

export interface ResponseStreamChunk {
  id: string
  type: 'sse' | 'ndjson'
  raw: string
  data: string
  event?: string
  json?: unknown
  timestamp: number
}

export type AppShortcutAction =
  | 'createNewRequest'
  | 'sendCurrentRequest'
  | 'saveCurrentRequest'
  | 'openGlobalSearch'
  | 'toggleTheme'
  | 'toggleRightPanel'
  | 'toggleHistory'
  | 'toggleDocMode'

export interface AppSettings {
  corsMode: 'cors' | 'proxy' | 'no-cors'
  proxyUrl: string
  theme: 'light' | 'dark' | 'system'
  maxHistory: number
  autoSave: boolean
  fontSize: number
  customShortcuts?: Partial<Record<AppShortcutAction, string>>
}

export interface Group {
  name: string
  apiIds: string[]
}

export interface Category {
  id: string
  name: string
  color?: string
  description?: string
  order: number
  createdAt: number
  updatedAt: number
}

export type ModuleType = 'generic' | 'openapi-yaml' | 'readonly'

export interface ModuleVariableValue {
  remote: string
  local: string
  description?: string
  environmentValues?: Record<string, string>
}

export type ModuleVariables = Record<string, ModuleVariableValue>

export interface ModuleStats {
  interfaceCount: number
  docCount: number
  modelCount: number
  testCaseTotal: number
  testCaseCoverage: number
  sceneCaseTotal: number
  sceneCaseCoverage: number
  avgCasePerInterface: number
  uncoveredInterfaceCount: number
}

export interface ModuleTypeConfig {
  mode: 'visual' | 'yaml' | 'readonly'
  description: string
}

export interface ModuleExportConfig {
  format: 'openapi3' | 'markdown' | 'html'
  autoBackup: boolean
  backupTarget?: 'gist' | 'webdav' | 'local'
  backupEndpoint?: string
  backupToken?: string
  backupFileName?: string
  teamRole?: 'owner' | 'editor' | 'viewer'
  conflictStrategy?: 'prompt' | 'overwrite'
  permissions?: {
    editSettings?: boolean
    editVariables?: boolean
    syncDataSource?: boolean
    backup?: boolean
  }
}

export interface ModuleMeta {
  createdAt: number
  updatedAt: number
  version: string
}

export interface ModuleDataSource {
  type: 'swagger' | 'openapi' | 'custom'
  url: string
  syncStrategy: 'manual' | 'auto' | 'webhook'
  fieldMapping: Record<string, string>
  syncIntervalMinutes?: number
  webhookSecret?: string
  lastSyncAt?: number
  nextSyncAt?: number
  lastSyncStatus?: 'success' | 'failed' | 'running'
  lastSyncMessage?: string
  lastSyncSourceUrl?: string
}

export interface Module {
  id: string
  categoryId: string
  name: string
  type?: ModuleType
  description?: string
  stats?: ModuleStats
  variables?: ModuleVariables
  dataSource?: ModuleDataSource | null
  moduleType?: ModuleTypeConfig
  exportConfig?: ModuleExportConfig
  meta?: ModuleMeta
  openapiText?: string
  order: number
  legacyGroupName?: string
  createdAt: number
  updatedAt: number
}

export interface InterfaceNode {
  id: string
  moduleId: string
  apiId: string
  nodeType?: 'folder' | 'request'
  parentId?: string | null
  name: string
  method: HttpMethod
  url: string
  preRequestScript?: string
  postRequestScript?: string
  preScript?: string
  postScript?: string
  exportConfig?: Partial<ModuleExportConfig>
  order: number
  createdAt: number
  updatedAt: number
}


export interface ModuleDocArtifact {
  id: string
  moduleId: string
  interfaceId?: string
  title: string
  format: 'markdown' | 'html' | 'openapi'
  content: string
  createdAt: number
  updatedAt: number
}

export interface ModuleDataModel {
  id: string
  moduleId: string
  name: string
  schema: Record<string, unknown>
  description?: string
  createdAt: number
  updatedAt: number
}

export interface InterfaceTestCase {
  id: string
  moduleId: string
  interfaceId: string
  name: string
  requestOverride?: Partial<ApiConfig>
  expectedStatus?: number
  assertions?: string[]
  lastRunAt?: number
  lastPassed?: boolean
  createdAt: number
  updatedAt: number
}

export interface ModuleScenarioStep {
  id: string
  interfaceId: string
  caseId?: string
  name?: string
  order: number
  enabled?: boolean
  continueOnFailure?: boolean
}

export interface ModuleScenarioCase {
  id: string
  moduleId: string
  name: string
  description?: string
  steps: ModuleScenarioStep[]
  lastRunAt?: number
  lastPassed?: boolean
  lastReport?: {
    total: number
    passed: number
    failed: number
    failures: string[]
  }
  createdAt: number
  updatedAt: number
}

export interface ModuleSyncLog {
  id: string
  moduleId: string
  action: 'auto-sync' | 'manual-sync' | 'webhook-sync'
  status: 'success' | 'error' | 'partial'
  message: string
  createdCount: number
  updatedCount: number
  skippedCount: number
  timestamp: number
}

export interface ModuleAuditLog {
  id: string
  moduleId: string
  action: string
  detail: string
  createdAt: number
}

export interface PlannedWorkspaceModel {
  categories: Category[]
  modules: Module[]
  interfaces: InterfaceNode[]
}

export interface AppState {
  apis: Record<string, ApiConfig>
  groups: Record<string, Group>
  groupOrder: string[]
  currentApiId: string | null
  activeTab: string
  response: ResponseData | null
  loading: boolean
  environments: Environment[]
  currentEnvId: string | null
  history: HistoryEntry[]
  settings: AppSettings
  expandedFolders: string[]
  scriptLogs?: import('@/utils/pre-request').ScriptLog[]
  scriptVisualizations?: import('@/utils/pre-request').ScriptVisualization[]
  scriptTests?: import('@/utils/pre-request').ScriptTestResult[]
}
