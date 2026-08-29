import { computed, watch } from 'vue'
import type { AppSettings } from '@/types'
import { useAppStore } from '@/stores/app'

/**
 * Phase 5.1:settings 唯一真源是 app store(持久化到 db.settings)。
 * 本 composable 只是代理:主题应用 + 一个仅用于防启动闪烁的 theme boot cache。
 * 旧 localStorage 'apifix_settings' 已废弃,启动时顺手清掉。
 */
const LEGACY_SETTINGS_KEY = 'apifix_settings'
const THEME_BOOT_KEY = 'apifix_theme_boot'

export function useSettings() {
  const store = useAppStore()
  const settings = computed<AppSettings>(() => store.settings)

  function applyTheme(theme: AppSettings['theme']) {
    const root = document.documentElement
    if (theme === 'system') {
      const prefersDark = window.matchMedia('(prefers-color-scheme: dark)').matches
      root.setAttribute('data-theme', prefersDark ? 'dark' : 'light')
    } else {
      root.setAttribute('data-theme', theme)
    }
  }

  // 启动先用 boot cache 防闪烁;store 从 db 加载完成后 watch 会自动纠正
  try {
    const bootTheme = localStorage.getItem(THEME_BOOT_KEY)
    applyTheme(bootTheme === 'dark' || bootTheme === 'light' ? bootTheme : settings.value.theme)
    localStorage.removeItem(LEGACY_SETTINGS_KEY)
  } catch {
    applyTheme(settings.value.theme)
  }

  watch(() => settings.value.theme, (theme) => {
    applyTheme(theme)
    try { localStorage.setItem(THEME_BOOT_KEY, theme) } catch { /* 隐私模式等场景忽略 */ }
  })

  function toggleTheme() {
    store.toggleTheme()
  }

  // Listen for system theme changes
  window.matchMedia('(prefers-color-scheme: dark)').addEventListener('change', () => {
    if (settings.value.theme === 'system') {
      applyTheme('system')
    }
  })

  return { settings, toggleTheme }
}
