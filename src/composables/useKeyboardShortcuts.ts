import { onMounted, onUnmounted } from 'vue'
import { useRouter } from 'vue-router'
import { useAppStore } from '@/stores/app'
import { useWorkspaceStore } from '@/stores/workspace'
import { useSettings } from '@/composables/useSettings'
import { SHORTCUT_ACTIONS, getEffectiveShortcuts, matchesShortcut } from '@/utils/shortcuts'
import { createDefaultAuthConfig } from '@/utils/auth'
import { generateCurl } from '@/utils/export'
import type { ApiConfig, AppShortcutAction, HttpMethod } from '@/types'

/**
 * 声明式快捷键 action handler(FR-8.1):
 * keydown → 匹配注册表 → 执行动作。动作优先通过窗口事件派发给职责组件。
 */
export function useKeyboardShortcuts() {
  const store = useAppStore()
  const workspace = useWorkspaceStore()
  const { toggleTheme } = useSettings()
  const router = useRouter()

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

  function dispatch(name: string, detail?: unknown) {
    window.dispatchEvent(new CustomEvent(name, { detail }))
  }

  function runAction(action: AppShortcutAction) {
    if (action === 'createNewRequest') {
      void createNewRequest()
      return
    }
    if (action === 'sendCurrentRequest') {
      dispatch('apifix:send-current-request')
      return
    }
    if (action === 'saveCurrentRequest') {
      dispatch('apifix:save-request')
      return
    }
    if (action === 'openGlobalSearch') {
      dispatch('apifix:open-spotlight')
      return
    }
    if (action === 'showShortcutsHelp') {
      dispatch('apifix:show-shortcuts')
      return
    }
    if (action === 'resetRequest') {
      dispatch('apifix:reset-request')
      return
    }
    if (action === 'cycleMethodNext' || action === 'cycleMethodPrev') {
      dispatch('apifix:cycle-method', { direction: action === 'cycleMethodNext' ? 1 : -1 })
      return
    }
    if (action === 'downloadResponse') {
      dispatch('apifix:download-response')
      return
    }
    if (action === 'copyResponse') {
      dispatch('apifix:copy-response')
      return
    }
    if (action === 'formatJsonBody') {
      dispatch('apifix:format-json-body')
      return
    }
    if (action === 'copyCurrentCurl') {
      const api = store.getCurrentApi()
      if (api) {
        void navigator.clipboard.writeText(generateCurl(api, store.getEnvVariables()))
      }
      return
    }
    if (action === 'toggleTheme') {
      toggleTheme()
      return
    }
    if (action === 'gotoRequests') {
      void router.push('/')
      return
    }
    if (action === 'gotoEnvironments') {
      void router.push('/')
      dispatch('apifix:goto-sidebar-tab', { tab: 'environments' })
      return
    }
    if (action === 'gotoHistory') {
      void router.push('/')
      dispatch('apifix:goto-sidebar-tab', { tab: 'history' })
      return
    }
    if (action === 'gotoSettings') {
      void router.push('/settings')
    }
  }

  function handleKeydown(e: KeyboardEvent) {
    if (e.defaultPrevented) return
    const target = e.target as HTMLElement | null
    // 文本输入中不响应单键快捷键(如 ?);target 可能是非元素(如 window),需安全探测
    const inEditable = target instanceof HTMLInputElement
      || target instanceof HTMLTextAreaElement
      || target?.isContentEditable === true
      || (target && typeof target.closest === 'function' && Boolean(target.closest('.cm-content')))
    const shortcuts = getEffectiveShortcuts(store.settings.customShortcuts)
    for (const item of SHORTCUT_ACTIONS) {
      if (!matchesShortcut(e, shortcuts[item.action])) continue
      // 无修饰键的快捷键(如 ?)在文本输入中不触发
      const hasModifier = item.defaultShortcut.includes('+')
      if (inEditable && !hasModifier) continue
      e.preventDefault()
      runAction(item.action)
      return
    }
  }

  onMounted(() => window.addEventListener('keydown', handleKeydown))
  onUnmounted(() => window.removeEventListener('keydown', handleKeydown))
}
