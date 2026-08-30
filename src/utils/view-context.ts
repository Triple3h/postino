import type { ApiConfig } from '@/types'

export interface ViewOpenContext {
  target?: 'main' | 'sidepanel' | 'popup'
  categoryId?: string | null
  moduleId?: string | null
  apiId?: string | null
  openHistory?: boolean
  timestamp: number
}

const VIEW_CONTEXT_KEY = 'apifix_view_open_context'
const CONTEXT_TTL = 2 * 60 * 1000

function chromeStorage(): any {
  const chromeApi = (globalThis as any).chrome
  return chromeApi?.storage?.local
}

function cleanContext(input: Partial<ViewOpenContext>): ViewOpenContext {
  return {
    target: input.target,
    categoryId: input.categoryId || null,
    moduleId: input.moduleId || null,
    apiId: input.apiId || null,
    openHistory: Boolean(input.openHistory),
    timestamp: input.timestamp || Date.now(),
  }
}

function isFresh(context: ViewOpenContext | null, target?: ViewOpenContext['target']): context is ViewOpenContext {
  if (!context) return false
  if (Date.now() - context.timestamp > CONTEXT_TTL) return false
  if (target && context.target && context.target !== target) return false
  return Boolean(context.apiId || context.moduleId || context.categoryId || context.openHistory)
}

function parseStored(value: string | null): ViewOpenContext | null {
  if (!value) return null
  try {
    return cleanContext(JSON.parse(value))
  } catch {
    return null
  }
}

function contextFromUrl(): ViewOpenContext | null {
  const params = new URLSearchParams(window.location.search)
  if (!params.has('apiId') && !params.has('moduleId') && !params.has('categoryId')) return null
  return cleanContext({
    target: (params.get('target') as ViewOpenContext['target']) || undefined,
    categoryId: params.get('categoryId'),
    moduleId: params.get('moduleId'),
    apiId: params.get('apiId'),
    openHistory: params.get('openHistory') === '1',
    timestamp: Number(params.get('ts')) || Date.now(),
  })
}

export function buildViewContextUrl(baseUrl: string, context: Partial<ViewOpenContext>): string {
  const url = new URL(baseUrl, window.location.href)
  const normalized = cleanContext(context)
  if (normalized.target) url.searchParams.set('target', normalized.target)
  if (normalized.categoryId) url.searchParams.set('categoryId', normalized.categoryId)
  if (normalized.moduleId) url.searchParams.set('moduleId', normalized.moduleId)
  if (normalized.apiId) url.searchParams.set('apiId', normalized.apiId)
  if (normalized.openHistory) url.searchParams.set('openHistory', '1')
  url.searchParams.set('ts', String(normalized.timestamp))
  return url.toString()
}

export function saveViewOpenContext(context: Partial<ViewOpenContext>): ViewOpenContext {
  const normalized = cleanContext(context)
  const serialized = JSON.stringify(normalized)
  localStorage.setItem(VIEW_CONTEXT_KEY, serialized)
  try {
    chromeStorage()?.set?.({ [VIEW_CONTEXT_KEY]: normalized })
  } catch {}
  return normalized
}

export async function readViewOpenContext(target?: ViewOpenContext['target']): Promise<ViewOpenContext | null> {
  const fromUrl = contextFromUrl()
  if (isFresh(fromUrl, target)) return fromUrl

  const local = parseStored(localStorage.getItem(VIEW_CONTEXT_KEY))
  if (isFresh(local, target)) return local

  const storage = chromeStorage()
  if (!storage?.get) return null
  return new Promise(resolve => {
    try {
      storage.get(VIEW_CONTEXT_KEY, (result: Record<string, ViewOpenContext>) => {
        const context = cleanContext(result?.[VIEW_CONTEXT_KEY] || {})
        resolve(isFresh(context, target) ? context : null)
      })
    } catch {
      resolve(null)
    }
  })
}

export function clearViewOpenContext(): void {
  localStorage.removeItem(VIEW_CONTEXT_KEY)
  try {
    chromeStorage()?.remove?.(VIEW_CONTEXT_KEY)
  } catch {}
}

export function applyViewOpenContext(
  context: ViewOpenContext | null,
  store: { apis: Record<string, ApiConfig>; currentApiId: string | null; response: unknown | null; openApiInTab?: (apiId: string) => void },
  workspace: {
    categories: Array<{ id: string }>
    modules: Array<{ id: string; categoryId: string }>
    interfaces: Array<{ id: string; apiId: string; moduleId: string }>
    selectCategory: (id: string) => void
    selectModule: (id: string) => void
    selectInterface: (id: string) => void
  },
): boolean {
  if (!context) return false
  if (context.apiId && store.apis[context.apiId]) {
    const node = workspace.interfaces.find(item => item.apiId === context.apiId)
    workspace.selectInterface(node?.id ?? context.apiId)
    if (typeof store.openApiInTab === 'function') store.openApiInTab(context.apiId)
    else store.currentApiId = context.apiId
    store.response = null
    return true
  }
  if (context.moduleId && workspace.modules.some(item => item.id === context.moduleId)) {
    workspace.selectModule(context.moduleId)
    store.currentApiId = null
    store.response = null
    return true
  }
  if (context.categoryId && workspace.categories.some(item => item.id === context.categoryId)) {
    workspace.selectCategory(context.categoryId)
    store.currentApiId = null
    store.response = null
    return true
  }
  return false
}
