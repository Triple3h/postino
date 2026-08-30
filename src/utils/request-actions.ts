import { useAppStore } from '@/stores/app'

/**
 * 跨组件复用的请求/界面动作(Spotlight 导航、快捷键共用)。
 * Pinia store 在应用初始化后可直接在组件外使用。
 */

export function generateId(): string {
  return Date.now().toString(36) + Math.random().toString(36).slice(2, 8)
}

/** 新建请求 = 直接开一个新标签(不弹命名框);落点在首次保存时选择 */
export async function createNewRequestAction(): Promise<void> {
  await useAppStore().newRequestTab()
}

const THEME_CYCLE = ['system', 'light', 'dark', 'black'] as const

export function cycleThemeAction(): void {
  const store = useAppStore()
  const idx = THEME_CYCLE.indexOf(store.settings.theme)
  store.setTheme(THEME_CYCLE[(idx + 1) % THEME_CYCLE.length])
}
