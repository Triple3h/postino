const STORAGE_KEYS = {
  DATA: 'apifix_bin_data',
  ENV: 'apifix_env_vars',
  HISTORY: 'apifix_history',
} as const

/** @deprecated Use Dexie (src/db) instead of localStorage */
export function loadFromStorage<T>(key: string, fallback: T): T {
  try {
    const raw = localStorage.getItem(key)
    return raw ? JSON.parse(raw) : fallback
  } catch {
    return fallback
  }
}

/** @deprecated Use Dexie (src/db) instead of localStorage */
export function saveToStorage(key: string, value: unknown): void {
  try {
    localStorage.setItem(key, JSON.stringify(value))
  } catch (e) {
    console.error('Failed to save to localStorage:', e)
  }
}

export function removeFromStorage(key: string): void {
  localStorage.removeItem(key)
}

export interface LegacyData {
  apis?: Record<string, unknown>
  groups?: Record<string, unknown>
  groupOrder?: string[]
}

export function migrateLegacyData(): LegacyData | null {
  const raw = localStorage.getItem(STORAGE_KEYS.DATA)
  if (!raw) return null
  try {
    return JSON.parse(raw)
  } catch {
    return null
  }
}

export function migrateLegacyEnv(): unknown[] {
  const raw = localStorage.getItem(STORAGE_KEYS.ENV)
  if (!raw) return []
  try {
    return JSON.parse(raw)
  } catch {
    return []
  }
}

export function migrateLegacyHistory(): unknown[] {
  const raw = localStorage.getItem(STORAGE_KEYS.HISTORY)
  if (!raw) return []
  try {
    return JSON.parse(raw)
  } catch {
    return []
  }
}

export { STORAGE_KEYS }
