import type { AppShortcutAction } from '@/types'

/**
 * 声明式快捷键注册表(FR-8.1,参考 Hoppscotch helpers/keybindings.ts):
 * 全部快捷键在此声明,动作执行统一走 useKeyboardShortcuts 的 action handler,
 * `?` 帮助面板(ShortcutsPrompt)直接消费本表。
 */
export interface ShortcutActionMeta {
  action: AppShortcutAction
  label: string
  description: string
  defaultShortcut: string
  group: '请求' | '导航' | '界面'
}

export const SHORTCUT_ACTIONS: ShortcutActionMeta[] = [
  { action: 'sendCurrentRequest', label: '发送请求 / 取消', description: '发送当前请求;发送中再按一次取消', defaultShortcut: 'Mod+Enter', group: '请求' },
  { action: 'saveCurrentRequest', label: '保存请求', description: '已保存过的请求直接保存并熄灭未保存圆点;未保存的新请求弹窗命名 + 选落点', defaultShortcut: 'Mod+S', group: '请求' },
  { action: 'createNewRequest', label: '新建请求', description: '直接打开一个新请求标签(保存时再命名)', defaultShortcut: 'Mod+N', group: '请求' },
  { action: 'resetRequest', label: '重置请求', description: '清空响应并重置当前请求参数', defaultShortcut: 'Mod+I', group: '请求' },
  { action: 'cycleMethodNext', label: '切换 Method(下一个)', description: 'Alt+↓ 循环切换 HTTP 方法', defaultShortcut: 'Alt+ArrowDown', group: '请求' },
  { action: 'cycleMethodPrev', label: '切换 Method(上一个)', description: 'Alt+↑ 循环切换 HTTP 方法', defaultShortcut: 'Alt+ArrowUp', group: '请求' },
  { action: 'downloadResponse', label: '下载响应', description: '把当前响应保存为文件', defaultShortcut: 'Mod+J', group: '请求' },
  { action: 'copyResponse', label: '复制响应', description: '复制当前响应体到剪贴板', defaultShortcut: 'Mod+.', group: '请求' },
  { action: 'formatJsonBody', label: '格式化 Body', description: '美化当前 JSON Body', defaultShortcut: 'Mod+Shift+L', group: '请求' },
  { action: 'copyCurrentCurl', label: '复制 cURL', description: '复制当前请求为 cURL 命令', defaultShortcut: 'Mod+Shift+C', group: '请求' },
  { action: 'openGlobalSearch', label: 'Spotlight 搜索', description: '搜索请求、环境、历史与设置项', defaultShortcut: 'Mod+K', group: '导航' },
  { action: 'gotoRequests', label: '跳转:请求', description: '打开请求页', defaultShortcut: 'Alt+R', group: '导航' },
  { action: 'gotoEnvironments', label: '跳转:环境', description: '侧栏切换到环境 tab', defaultShortcut: 'Alt+E', group: '导航' },
  { action: 'gotoHistory', label: '跳转:历史', description: '侧栏切换到历史 tab', defaultShortcut: 'Alt+H', group: '导航' },
  { action: 'gotoSettings', label: '跳转:设置', description: '打开设置页', defaultShortcut: 'Alt+S', group: '导航' },
  { action: 'toggleTheme', label: '切换主题', description: '在 跟随系统/亮色/暗色/纯黑 间循环', defaultShortcut: 'Mod+Shift+T', group: '界面' },
  { action: 'showShortcutsHelp', label: '快捷键帮助', description: '显示快捷键总览(本表)', defaultShortcut: '?', group: '界面' },
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

/** 快捷键展示格式(macOS 显示 ⌘ 等) */
export function formatShortcutForDisplay(shortcut: string, isMac = /mac/i.test(navigator.platform)): string {
  return shortcut
    .split('+')
    .map(token => {
      const lower = token.toLowerCase()
      if (lower === 'mod') return isMac ? '⌘' : 'Ctrl'
      if (lower === 'alt') return isMac ? '⌥' : 'Alt'
      if (lower === 'shift') return isMac ? '⇧' : 'Shift'
      if (lower === 'arrowup') return '↑'
      if (lower === 'arrowdown') return '↓'
      if (lower === 'enter') return '↩'
      if (token === '?') return '?'
      return token.length === 1 ? token.toUpperCase() : token
    })
    .join(isMac ? '' : '+')
}
