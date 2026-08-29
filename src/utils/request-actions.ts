import { useAppStore } from '@/stores/app'
import { useWorkspaceStore } from '@/stores/workspace'
import { createDefaultAuthConfig } from '@/utils/auth'
import type { ApiConfig, HttpMethod } from '@/types'

/**
 * 跨组件复用的请求/界面动作(Spotlight 导航、快捷键共用)。
 * Pinia store 在应用初始化后可直接在组件外使用。
 */

export function generateId(): string {
  return Date.now().toString(36) + Math.random().toString(36).slice(2, 8)
}

export async function createNewRequestAction(): Promise<void> {
  const store = useAppStore()
  const workspace = useWorkspaceStore()
  const activeNode = workspace.activeSelectionType === 'interface'
    ? workspace.interfaces.find(item => item.id === workspace.activeSelectionId || item.apiId === workspace.activeSelectionId)
    : null
  const parentId = activeNode && (activeNode.nodeType ?? 'request') === 'folder' ? activeNode.id : null
  const moduleId = parentId
    ? activeNode?.moduleId
    : workspace.activeSelectionType === 'module'
      ? workspace.activeSelectionId
      : activeNode?.moduleId ?? null
  const now = Date.now()
  const api: ApiConfig = {
    id: generateId(),
    name: 'New Request',
    method: 'GET' as HttpMethod,
    url: '',
    headers: [],
    params: [],
    cookies: [],
    body: { type: 'none', raw: '', formData: [], urlEncoded: [], binaryFile: null, contentType: '' },
    auth: createDefaultAuthConfig(),
    preRequestScript: '',
    postRequestScript: '',
    requestVariables: [],
    folder: null,
    createdAt: now,
    updatedAt: now,
  }
  await store.addApi(api, moduleId, parentId)
  const node = workspace.interfaces.find(item => item.apiId === api.id)
  workspace.selectInterface(node?.id ?? api.id)
  store.currentApiId = api.id
  store.response = null
}

const THEME_CYCLE = ['system', 'light', 'dark', 'black'] as const

export function cycleThemeAction(): void {
  const store = useAppStore()
  const idx = THEME_CYCLE.indexOf(store.settings.theme)
  store.setTheme(THEME_CYCLE[(idx + 1) % THEME_CYCLE.length])
}
