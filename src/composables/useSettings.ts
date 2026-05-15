import { ref, watch } from 'vue'
import type { AppSettings } from '@/types'

const SETTINGS_KEY = 'apifix_settings'

const defaultSettings: AppSettings = {
  corsMode: 'cors',
  proxyUrl: 'https://corsproxy.io/?',
  theme: 'light',
  maxHistory: 100,
  autoSave: true,
  fontSize: 13,
}

function loadSettings(): AppSettings {
  try {
    const raw = localStorage.getItem(SETTINGS_KEY)
    return raw ? { ...defaultSettings, ...JSON.parse(raw) } : defaultSettings
  } catch {
    return defaultSettings
  }
}

export function useSettings() {
  const settings = ref<AppSettings>(loadSettings())

  watch(settings, (val) => {
    localStorage.setItem(SETTINGS_KEY, JSON.stringify(val))
    applyTheme(val.theme)
  }, { deep: true })

  function applyTheme(theme: AppSettings['theme']) {
    const root = document.documentElement
    if (theme === 'system') {
      const prefersDark = window.matchMedia('(prefers-color-scheme: dark)').matches
      root.setAttribute('data-theme', prefersDark ? 'dark' : 'light')
    } else {
      root.setAttribute('data-theme', theme)
    }
  }

  function toggleTheme() {
    const themes: AppSettings['theme'][] = ['light', 'dark', 'system']
    const idx = themes.indexOf(settings.value.theme)
    settings.value.theme = themes[(idx + 1) % themes.length]
  }

  // Apply theme on init
  applyTheme(settings.value.theme)

  // Listen for system theme changes
  window.matchMedia('(prefers-color-scheme: dark)').addEventListener('change', () => {
    if (settings.value.theme === 'system') {
      applyTheme('system')
    }
  })

  return { settings, toggleTheme }
}