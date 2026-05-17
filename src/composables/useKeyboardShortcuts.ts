import { onMounted, onUnmounted } from 'vue'
import { useAppStore } from '@/stores/app'
import { useWorkspaceStore } from '@/stores/workspace'
import { useSettings } from '@/composables/useSettings'
import { SHORTCUT_ACTIONS, getEffectiveShortcuts, matchesShortcut } from '@/utils/shortcuts'
import { createDefaultAuthConfig } from '@/utils/auth'
import { generateCurl } from '@/utils/export'
import type { ApiConfig, AppShortcutAction, HttpMethod } from '@/types'

export function useKeyboardShortcuts() {
  const store = useAppStore()
  const workspace = useWorkspaceStore()
  const { toggleTheme } = useSettings()


  function generateId(): string {
    return Date.now().toString(36) + Math.random().toString(36).slice(2, 8)
  }

  async function createNewRequest() {
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

  function runAction(action: AppShortcutAction) {
    if (action === 'createNewRequest') {
      void createNewRequest()
      return
    }
    if (action === 'sendCurrentRequest') {
      // Skip send when global search is open to avoid double-dispatch
      if (document.querySelector('.search-overlay')) return
      window.dispatchEvent(new CustomEvent('apifix:send-current-request'))
      return
    }
    if (action === 'saveCurrentRequest') {
      const api = store.getCurrentApi()
      if (api) {
        store.updateApi(api.id, { updatedAt: Date.now() })
      }
      return
    }
    if (action === 'openGlobalSearch') {
      window.dispatchEvent(new CustomEvent('apifix:open-global-search'))
      return
    }
    if (action === 'toggleTheme') {
      toggleTheme()
      return
    }
    if (action === 'toggleRightPanel') {
      window.dispatchEvent(new CustomEvent('apifix:toggle-right-panel'))
      return
    }
    if (action === 'toggleHistory') {
      window.dispatchEvent(new CustomEvent('apifix:toggle-history-panel'))
      return
    }
    if (action === 'formatJsonBody') {
      window.dispatchEvent(new CustomEvent('apifix:format-json-body'))
      return
    }
    if (action === 'copyCurrentCurl') {
      const api = store.getCurrentApi()
      if (api) {
        void navigator.clipboard.writeText(generateCurl(api, store.getEnvVariables()))
      }
    }
  }

  function handleKeydown(e: KeyboardEvent) {
    if (e.defaultPrevented) return
    const shortcuts = getEffectiveShortcuts(store.settings.customShortcuts)
    for (const item of SHORTCUT_ACTIONS) {
      if (!matchesShortcut(e, shortcuts[item.action])) continue
      e.preventDefault()
      runAction(item.action)
      return
    }
  }

  onMounted(() => window.addEventListener('keydown', handleKeydown))
  onUnmounted(() => window.removeEventListener('keydown', handleKeydown))
}
