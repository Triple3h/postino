import type { AppShortcutAction } from '@/types'

export interface ShortcutActionMeta {
  action: AppShortcutAction
  label: string
  description: string
  defaultShortcut: string
}

export const SHORTCUT_ACTIONS: ShortcutActionMeta[] = [
  { action: 'createNewRequest', label: '新建请求', description: '在当前模块或文件夹中新建请求', defaultShortcut: 'Mod+N' },
  { action: 'sendCurrentRequest', label: '发送当前请求', description: '在编辑器中发送当前接口', defaultShortcut: 'Mod+Enter' },
  { action: 'saveCurrentRequest', label: '保存当前请求', description: '保存当前接口的更新时间', defaultShortcut: 'Mod+S' },
  { action: 'openGlobalSearch', label: '全局搜索', description: '打开接口/变量/历史搜索', defaultShortcut: 'Mod+K' },
  { action: 'toggleTheme', label: '切换主题', description: '在浅色、深色、跟随系统之间切换', defaultShortcut: 'Mod+Shift+T' },
  { action: 'toggleRightPanel', label: '显示/隐藏右栏', description: '切换全屏页右侧信息面板', defaultShortcut: 'Mod+Shift+R' },
  { action: 'toggleHistory', label: '显示/隐藏历史', description: '切换历史记录面板', defaultShortcut: 'Mod+Shift+H' },
  { action: 'toggleDocMode', label: '文档/编辑视图', description: '切换当前模块只读文档视图', defaultShortcut: 'Mod+Shift+D' },
  { action: 'formatJsonBody', label: '格式化 JSON', description: '美化当前 Body JSON 内容', defaultShortcut: 'Mod+B' },
  { action: 'copyCurrentCurl', label: '复制 cURL', description: '复制当前请求为 cURL', defaultShortcut: 'Mod+Shift+C' },
]

export const DEFAULT_SHORTCUTS: Record<AppShortcutAction, string> = SHORTCUT_ACTIONS.reduce((acc, item) => {
  acc[item.action] = item.defaultShortcut
  return acc
}, {} as Record<AppShortcutAction, string>)

const MODIFIER_KEYS = new Set(['Control', 'Meta', 'Shift', 'Alt'])

function normalizeKey(key: string): string {
  if (key === ' ') return 'Space'
  if (key === 'Esc') return 'Escape'
  if (key.length === 1) return key.toUpperCase()
  return key
}

function keyTokenMatches(eventKey: string, shortcutKey: string): boolean {
  return normalizeKey(eventKey).toLowerCase() === normalizeKey(shortcutKey).toLowerCase()
}

export function getEffectiveShortcuts(customShortcuts?: Partial<Record<AppShortcutAction, string>>): Record<AppShortcutAction, string> {
  return { ...DEFAULT_SHORTCUTS, ...(customShortcuts ?? {}) }
}

export function eventToShortcut(event: KeyboardEvent): string {
  if (MODIFIER_KEYS.has(event.key)) return ''
  const parts: string[] = []
  if (event.ctrlKey || event.metaKey) parts.push('Mod')
  if (event.altKey) parts.push('Alt')
  if (event.shiftKey) parts.push('Shift')
  parts.push(normalizeKey(event.key))
  return parts.join('+')
}

export function matchesShortcut(event: KeyboardEvent, shortcut: string | undefined): boolean {
  if (!shortcut) return false
  const tokens = shortcut.split('+').map(token => token.trim()).filter(Boolean)
  const key = tokens.pop()
  if (!key) return false

  const wantsMod = tokens.some(token => token.toLowerCase() === 'mod')
  const wantsCtrl = tokens.some(token => token.toLowerCase() === 'ctrl' || token.toLowerCase() === 'control')
  const wantsMeta = tokens.some(token => token.toLowerCase() === 'meta' || token.toLowerCase() === 'cmd' || token.toLowerCase() === 'command')
  const wantsAlt = tokens.some(token => token.toLowerCase() === 'alt' || token.toLowerCase() === 'option')
  const wantsShift = tokens.some(token => token.toLowerCase() === 'shift')

  if (!keyTokenMatches(event.key, key)) return false
  if (wantsMod) {
    if (!event.ctrlKey && !event.metaKey) return false
  } else {
    if (event.ctrlKey !== wantsCtrl) return false
    if (event.metaKey !== wantsMeta) return false
  }
  return event.altKey === wantsAlt && event.shiftKey === wantsShift
}
