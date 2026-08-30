import { computed, watch } from 'vue'
import type { AccentColor, AppSettings, ThemeColorMode } from '@/types'
import { useAppStore } from '@/stores/app'

/**
 * Phase 5.1:settings 唯一真源是 app store(持久化到 db.settings)。
 * 本 composable 只是代理:主题应用 + 一个仅用于防启动闪烁的 theme boot cache。
 * 主题模型对齐 Hoppscotch modules/theming.ts:
 *   - 明暗:documentElement class(light / black;dark 为默认态)
 *   - 强调色:documentElement data-accent 属性
 */
const LEGACY_SETTINGS_KEY = 'postino_settings'
const THEME_BOOT_KEY = 'postino_theme_boot'

export const ACCENT_COLORS: AccentColor[] = ['green', 'teal', 'blue', 'indigo', 'purple', 'yellow', 'orange', 'red', 'pink']
export const THEME_COLOR_MODES: ThemeColorMode[] = ['system', 'light', 'dark', 'black']

function applyColorMode(mode: ThemeColorMode) {
  const root = document.documentElement
  const resolved = mode === 'system'
    ? (window.matchMedia('(prefers-color-scheme: dark)').matches ? 'dark' : 'light')
    : mode
  root.classList.toggle('light', resolved === 'light')
  root.classList.toggle('black', resolved === 'black')
}

function applyAccent(accent: AccentColor) {
  document.documentElement.setAttribute('data-accent', accent)
}

export function useSettings() {
  const store = useAppStore()
  const settings = computed<AppSettings>(() => store.settings)

  // 启动先用 boot cache 防闪烁;store 从 db 加载完成后 watch 会自动纠正
  try {
    const boot = JSON.parse(localStorage.getItem(THEME_BOOT_KEY) || 'null') as { theme?: ThemeColorMode; accent?: AccentColor } | null
    applyColorMode(boot?.theme ?? settings.value.theme)
    applyAccent(boot?.accent ?? settings.value.accent)
    localStorage.removeItem(LEGACY_SETTINGS_KEY)
  } catch {
    applyColorMode(settings.value.theme)
    applyAccent(settings.value.accent)
  }

  watch(() => settings.value.theme, (theme) => {
    applyColorMode(theme)
    persistBootCache()
  })

  watch(() => settings.value.accent, (accent) => {
    applyAccent(accent)
    persistBootCache()
  })

  function persistBootCache() {
    try {
      localStorage.setItem(THEME_BOOT_KEY, JSON.stringify({ theme: settings.value.theme, accent: settings.value.accent }))
    } catch { /* 隐私模式等场景忽略 */ }
  }

  /** 循环切换明暗四档:system → light → dark → black */
  function toggleTheme() {
    store.setTheme(THEME_COLOR_MODES[(THEME_COLOR_MODES.indexOf(settings.value.theme) + 1) % THEME_COLOR_MODES.length])
  }

  function setAccent(accent: AccentColor) {
    store.setAccent(accent)
  }

  // Listen for system theme changes
  window.matchMedia('(prefers-color-scheme: dark)').addEventListener('change', () => {
    if (settings.value.theme === 'system') {
      applyColorMode('system')
    }
  })

  return { settings, toggleTheme, setAccent }
}
