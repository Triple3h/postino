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
  /**
   * 'inherit' 表示沿用最近一个显式定义了 Auth 的祖先(集合/文件夹)。
   * 仅新增请求/节点默认使用;存量请求保持 'none' 以免行为突变(Phase 1.3 UI 开放切换)。
   */
  type: 'inherit' | 'none' | 'bearer' | 'basic' | 'apikey' | 'digest' | 'oauth2'
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

export type RequestType = 'rest' | 'sse' | 'ws'

/**
 * 流式合并配置(Phase 3):逐 chunk 从 JSON 载荷提取 dataPath 指向的字段并拼接,
 * 例如 dataPath = "data.content" 或 "choices[0].delta.content"。
 */
export interface StreamMergeConfig {
  mode: 'off' | 'auto' | 'custom'
  /** 只合并指定 event 类型,空 = 全部 */
  eventFilter?: string
  /** JSON 取值路径,支持 a.b.c 与 a[0].b */
  dataPath: string
  /** 片段拼接符,默认 '' */
  separator: string
  /** 终止标记(如 [DONE]),不并入结果 */
  stopMarker?: string
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
  /** 请求类型,缺省 'rest'(Phase 0 存量数据无此字段) */
  requestType?: RequestType
  /** 流式合并规则(SSE/NDJSON) */
  streamMerge?: StreamMergeConfig
  /** WebSocket 子协议 */
  wsProtocols?: string[]
  /** @deprecated Collection 化后废弃,Phase 5 移除 */
  folder: string | null
  createdAt: number
  updatedAt: number
}

export interface EnvVariable {
  key: string
  value: string
  enabled: boolean
  /** Postman 语义的持久默认值;缺省 = 沿用 value(存量数据) */
  initialValue?: string
  /** Secret 变量:UI 掩码显示,导出时剥离取值 */
  secret?: boolean
}

/**
 * Postman 语义的变量:initialValue 是持久化默认值,currentValue 是会话运行值
 * (脚本 pm.environment.set 会改它),secret 变量导出时剥离取值。
 * Phase 2 起环境与集合变量统一使用此结构。
 */
export interface CollectionVariable {
  key: string
  initialValue: string
  currentValue: string
  secret: boolean
  enabled: boolean
  description?: string
}

export interface Environment {
  id: string
  name: string
  variables: EnvVariable[]
  /** 所属集合 id;'global' 表示全局环境;undefined 为迁移前的旧全局环境 */
  collectionId?: string
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
  /** Phase 3.6:流式请求的补充记录(chunks 不入库) */
  requestType?: RequestType
  /** 本次发送使用的流式合并配置 */
  streamMerge?: StreamMergeConfig
  /** 流式合并结果全文 */
  mergedText?: string
  /** 原始流式响应前 N KB 快照 */
  rawPreview?: string
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
  /** FR-2:实际发送的最终 URL(环境变量已替换、params 已拼接、脚本已修改);旧记录缺省回退 url */
  requestUrl?: string
  /**
   * FR-2:最终 fetch 前的请求 Body 快照。
   * json/raw/urlencoded 为实际发送字符串;form 为逐行 key=value(文件字段标注文件名)。
   * 旧记录缺省,回退 requestBody(排除 FormData 占位串)。
   */
  requestBodySnapshot?: string | null
  timestamp: number
  isStreaming?: boolean
  streamType?: 'sse' | 'ndjson'
  chunks?: ResponseStreamChunk[]
  /** 流式合并结果(Phase 3:按 streamMerge 配置逐 chunk 提取拼接) */
  mergedText?: string
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
  /** SSE 规范的 id: 字段 */
  sseId?: string
  json?: unknown
  timestamp: number
}

/** WebSocket 连接状态(Phase 3.5) */
export type WsConnectionState = 'idle' | 'connecting' | 'open' | 'closing' | 'closed' | 'error'

/** WebSocket 双向消息日志条目 */
export interface WsLogEntry {
  id: string
  direction: 'out' | 'in' | 'system'
  /** 文本负载;二进制帧按 UTF-8 解码并置 binary 字节数 */
  data: string
  timestamp: number
  binary?: number
  /** system 条目的补充说明(如关闭码/错误信息) */
  detail?: string
}

export type AppShortcutAction =
  | 'createNewRequest'
  | 'sendCurrentRequest'
  | 'saveCurrentRequest'
  | 'openGlobalSearch'
  | 'toggleTheme'
  | 'formatJsonBody'
  | 'copyCurrentCurl'
  | 'resetRequest'
  | 'cycleMethodNext'
  | 'cycleMethodPrev'
  | 'downloadResponse'
  | 'copyResponse'
  | 'gotoRequests'
  | 'gotoEnvironments'
  | 'gotoHistory'
  | 'gotoSettings'
  | 'showShortcutsHelp'

/** 主题明暗四档:跟随系统 / 亮 / 暗 / 纯黑(Hoppscotch BG_COLOR) */
export type ThemeColorMode = 'system' | 'light' | 'dark' | 'black'

/** 强调色九选(Hoppscotch THEME_COLOR) */
export type AccentColor = 'green' | 'teal' | 'blue' | 'indigo' | 'purple' | 'yellow' | 'orange' | 'red' | 'pink'

export interface AppSettings {
  corsMode: 'cors' | 'proxy' | 'no-cors'
  proxyUrl: string
  theme: ThemeColorMode
  /** 强调色,默认 indigo */
  accent: AccentColor
  /** Sidenav 展开(EXPAND_NAVIGATION) */
  expandNavigation: boolean
  /** 侧栏位于主区左侧(默认 true;false = 右侧) */
  sidebarOnLeft: boolean
  /** 编辑区/响应区排布:上下(默认)或左右 */
  editorLayout: 'vertical' | 'horizontal'
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
  icon?: string
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
}

export interface ModuleTypeConfig {
  mode: 'visual' | 'yaml' | 'readonly'
  description: string
}

export interface ModuleExportConfig {
  format: 'openapi3'
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
  icon?: string
  /** @deprecated 过渡期镜像字段:集合颜色,Phase 1 后由 Collection.color 承载 */
  color?: string
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

/**
 * 集合:顶层组织单元(取代 Category + Module)。
 * 集合级 auth/headers/variables/scripts 会被树内子孙节点继承。
 */
export interface Collection {
  id: string
  name: string
  description?: string
  color?: string
  icon?: string
  order: number
  /** 集合级 Auth(请求 authType 为 inherit 时沿祖先取最近定义) */
  auth: AuthConfig
  headers: KvPair[]
  variables: CollectionVariable[]
  preRequestScript: string
  postRequestScript: string
  /** 当前选中的环境(该集合自己的环境列表) */
  selectedEnvId: string | null
  /** 遗留 Module 能力安置(数据源同步、导出配置等,功能冻结) */
  meta?: CollectionMeta
  createdAt: number
  updatedAt: number
}

export interface CollectionMeta {
  dataSource?: ModuleDataSource | null
  exportConfig?: ModuleExportConfig
  moduleType?: ModuleTypeConfig
  type?: ModuleType
  openapiText?: string
  /** 迁移前的 legacy 归属,仅用于回滚/排查 */
  legacyCategoryId?: string
  legacyGroupId?: string
}

/**
 * 集合树节点:folder 或 request。继承语义:字段缺省 = 继承父级。
 * moduleId 在迁移后与 collectionId 等价(历史数据零 ID 变动)。
 */
export interface CollectionNode {
  id: string
  moduleId: string
  /** 冗余存储的所属集合 id(== moduleId),Dexie 索引用 */
  collectionId?: string
  apiId: string
  nodeType?: 'folder' | 'request'
  parentId?: string | null
  name: string
  method: HttpMethod
  url: string
  preRequestScript?: string
  postRequestScript?: string
  /** folder/request 级脚本开关:默认 true(继承父级并执行自身);false = 只执行自身 */
  scriptsInherit?: boolean
  /** folder/request 级 Auth 覆盖(缺省 = 继承父级) */
  auth?: AuthConfig
  headers?: KvPair[]
  variables?: CollectionVariable[]
  exportConfig?: Partial<ModuleExportConfig>
  order: number
  createdAt: number
  updatedAt: number
}

/** @deprecated 兼容别名,Phase 1 起统一使用 CollectionNode */
export type InterfaceNode = CollectionNode


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

/** 自有备份格式的当前版本号(Phase 0.4),结构变更时递增 */
export const COLLECTION_EXPORT_VERSION = 1

/** 自有备份/导出格式:带版本标记,向后兼容靠 v 字段升级 */
export interface CollectionExportDocument {
  v: number
  exportedAt: number
  collections: Collection[]
  nodes: CollectionNode[]
  environments: Environment[]
  /** 完整备份:api 配置表(nodes[].apiId 指向此处) */
  apis?: Record<string, ApiConfig>
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
