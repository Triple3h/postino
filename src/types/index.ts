export type HttpMethod = 'GET' | 'POST' | 'PUT' | 'DELETE' | 'PATCH' | 'HEAD' | 'OPTIONS'

export interface KvPair {
  key: string
  value: string
  enabled: boolean
  description?: string
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
  type: 'none' | 'bearer' | 'basic' | 'apikey'
  bearerToken: string
  basicUsername: string
  basicPassword: string
  apiKeyName: string
  apiKeyValue: string
  apiKeyIn: 'header' | 'query'
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
  method: HttpMethod
  url: string
  headers: KvPair[]
  params: KvPair[]
  cookies: CookieItem[]
  body: BodyConfig
  auth: AuthConfig
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
  duration: number
  size: number
  url: string
  method: HttpMethod
  requestHeaders: Record<string, string>
  requestBody: string | null
  timestamp: number
}

export interface AppSettings {
  corsMode: 'cors' | 'proxy' | 'no-cors'
  proxyUrl: string
  theme: 'light' | 'dark' | 'system'
  maxHistory: number
  autoSave: boolean
  fontSize: number
}

export interface Group {
  name: string
  apiIds: string[]
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
}
