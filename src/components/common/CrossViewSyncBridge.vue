<script setup lang="ts">
import { onMounted, onUnmounted, ref, watch } from 'vue'
import { db } from '@/db'
import { useAppStore } from '@/stores/app'
import { useWorkspaceStore } from '@/stores/workspace'

const store = useAppStore()
const workspace = useWorkspaceStore()
const senderId = `${Date.now()}:${Math.random().toString(36).slice(2)}`
const channel = typeof BroadcastChannel !== 'undefined' ? new BroadcastChannel('apifix-state-sync') : null
let debounceTimer: ReturnType<typeof setTimeout> | null = null
let activityDebounceTimer: ReturnType<typeof setTimeout> | null = null
let suppressUntil = 0
let toastTimer: ReturnType<typeof setTimeout> | null = null
let presenceTimer: ReturnType<typeof setInterval> | null = null
const syncToast = ref('')
const remoteActivities = ref<Record<string, EditorActivityMessage & { expiresAt: number }>>({})
const lastLocalChangeAt: Record<SyncMessage['scope'], number> = {
  environment: 0,
  workspace: 0,
  settings: 0,
  api: 0,
}

interface SyncMessage {
  type: 'APIFIX_STATE_CHANGED'
  senderId: string
  scope: 'environment' | 'workspace' | 'settings' | 'api'
  timestamp: number
}

interface EditorCursorDetail {
  field?: string
  start?: number
  end?: number
  line?: number
  column?: number
  snippet?: string
}

interface EditorActivityMessage {
  type: 'APIFIX_EDITOR_ACTIVITY'
  senderId: string
  apiId?: string
  apiName?: string
  tab?: string
  cursor?: EditorCursorDetail
  timestamp: number
}

type BridgeMessage = SyncMessage | EditorActivityMessage

function chromeRuntime(): any {
  return typeof chrome !== 'undefined' ? chrome.runtime : undefined
}

function scopeLabel(scope: SyncMessage['scope']): string {
  const labels: Record<SyncMessage['scope'], string> = {
    environment: '环境变量',
    workspace: '模块/接口树',
    settings: '设置',
    api: '接口配置',
  }
  return labels[scope]
}

function showSyncToast(message: string): void {
  syncToast.value = message
  if (toastTimer) clearTimeout(toastTimer)
  toastTimer = setTimeout(() => { syncToast.value = '' }, 2600)
}

function shouldSuppress(): boolean {
  return Date.now() < suppressUntil
}

function markSuppress(): void {
  suppressUntil = Date.now() + 800
}

async function reloadSharedState(scope: SyncMessage['scope']): Promise<void> {
  markSuppress()
  if (scope === 'environment') {
    const envList = await db.environments.toArray()
    store.environments = envList
    if (store.currentEnvId && !envList.some(item => item.id === store.currentEnvId)) {
      store.currentEnvId = envList[0]?.id ?? null
    }
    return
  }
  if (scope === 'settings') {
    const settingsList = await db.settings.toArray()
    const nextSettings: Record<string, any> = {}
    for (const item of settingsList) nextSettings[item.key] = item.value
    store.settings = { ...store.settings, ...nextSettings }
    return
  }
  if (scope === 'api') {
    const apiList = await db.apis.toArray()
    store.apis = Object.fromEntries(apiList.map(api => [api.id, api]))
    return
  }
  const [categoryList, moduleList, interfaceList] = await Promise.all([
    db.categories.orderBy('order').toArray(),
    db.modules.orderBy('order').toArray(),
    db.interfaces.orderBy('order').toArray(),
  ])
  workspace.categories = categoryList
  workspace.modules = moduleList
  workspace.interfaces = interfaceList.map(item => ({
    ...item,
    nodeType: item.nodeType ?? 'request',
    parentId: item.parentId ?? null,
    preScript: item.preScript ?? item.preRequestScript ?? '',
    postScript: item.postScript ?? item.postRequestScript ?? '',
  }))
}

function handleSyncMessage(message: SyncMessage): void {
  if (!message || message.type !== 'APIFIX_STATE_CHANGED' || message.senderId === senderId) return
  const hasLocalOverlap = Date.now() - lastLocalChangeAt[message.scope] < 3000
  void reloadSharedState(message.scope)
    .then(() => {
      showSyncToast(hasLocalOverlap
        ? `检测到另一视图同时修改${scopeLabel(message.scope)}，已按最新本地存储刷新`
        : `已同步另一视图的${scopeLabel(message.scope)}更新`)
    })
    .catch(err => console.warn('[ApiFix] 跨视图同步失败:', err))
}

function formatCursor(cursor?: EditorCursorDetail): string {
  if (!cursor) return ''
  if (cursor.line && cursor.column) return ` · ${cursor.field || '字段'} ${cursor.line}:${cursor.column}`
  if (typeof cursor.start === 'number') {
    const range = typeof cursor.end === 'number' && cursor.end !== cursor.start ? `${cursor.start}-${cursor.end}` : `${cursor.start}`
    return ` · ${cursor.field || '字段'} @${range}`
  }
  return cursor.field ? ` · ${cursor.field}` : ''
}

function pruneRemoteActivities(): void {
  const now = Date.now()
  const next = Object.fromEntries(Object.entries(remoteActivities.value).filter(([, item]) => item.expiresAt > now))
  if (Object.keys(next).length !== Object.keys(remoteActivities.value).length) remoteActivities.value = next
}

function handleEditorActivity(message: EditorActivityMessage): void {
  if (!message || message.type !== 'APIFIX_EDITOR_ACTIVITY' || message.senderId === senderId) return
  const target = message.apiName || message.apiId || '当前接口'
  const tab = message.tab ? ` / ${message.tab}` : ''
  remoteActivities.value = {
    ...remoteActivities.value,
    [message.senderId]: { ...message, expiresAt: Date.now() + 9000 },
  }
  showSyncToast(`另一视图正在编辑：${target}${tab}${formatCursor(message.cursor)}`)
}

function handleBridgeMessage(message: BridgeMessage): void {
  if (message?.type === 'APIFIX_STATE_CHANGED') {
    handleSyncMessage(message)
  } else if (message?.type === 'APIFIX_EDITOR_ACTIVITY') {
    handleEditorActivity(message)
  }
}

function publish(scope: SyncMessage['scope']): void {
  if (shouldSuppress()) return
  lastLocalChangeAt[scope] = Date.now()
  if (debounceTimer) clearTimeout(debounceTimer)
  debounceTimer = setTimeout(() => {
    const message: SyncMessage = { type: 'APIFIX_STATE_CHANGED', senderId, scope, timestamp: Date.now() }
    channel?.postMessage(message)
    const runtime = chromeRuntime()
    if (runtime?.sendMessage) {
      try {
        const result = runtime.sendMessage(message)
        if (result?.catch) result.catch(() => {})
      } catch {}
    }
  }, 120)
}

function publishEditorActivity(detail: Omit<EditorActivityMessage, 'type' | 'senderId' | 'timestamp'>): void {
  if (activityDebounceTimer) clearTimeout(activityDebounceTimer)
  activityDebounceTimer = setTimeout(() => {
    const message: EditorActivityMessage = { type: 'APIFIX_EDITOR_ACTIVITY', senderId, timestamp: Date.now(), ...detail }
    channel?.postMessage(message)
    const runtime = chromeRuntime()
    if (runtime?.sendMessage) {
      try {
        const result = runtime.sendMessage(message)
        if (result?.catch) result.catch(() => {})
      } catch {}
    }
  }, 250)
}

const stopEnvironmentWatch = watch(() => store.environments, () => publish('environment'), { deep: true })
const stopWorkspaceWatch = watch(() => [workspace.categories, workspace.modules, workspace.interfaces], () => publish('workspace'), { deep: true })
const stopSettingsWatch = watch(() => store.settings, () => publish('settings'), { deep: true })
const stopApiWatch = watch(() => store.apis, () => publish('api'), { deep: true })

function onRuntimeMessage(message: BridgeMessage) {
  handleBridgeMessage(message)
}

function onEditorActivityEvent(event: Event) {
  const detail = (event as CustomEvent<Omit<EditorActivityMessage, 'type' | 'senderId' | 'timestamp'>>).detail
  if (!detail) return
  publishEditorActivity(detail)
}

onMounted(() => {
  channel?.addEventListener('message', event => handleBridgeMessage(event.data))
  chromeRuntime()?.onMessage?.addListener(onRuntimeMessage)
  window.addEventListener('apifix-editor-activity', onEditorActivityEvent)
  presenceTimer = setInterval(pruneRemoteActivities, 2500)
})

onUnmounted(() => {
  if (debounceTimer) clearTimeout(debounceTimer)
  if (activityDebounceTimer) clearTimeout(activityDebounceTimer)
  if (toastTimer) clearTimeout(toastTimer)
  if (presenceTimer) clearInterval(presenceTimer)
  stopEnvironmentWatch()
  stopWorkspaceWatch()
  stopSettingsWatch()
  stopApiWatch()
  channel?.close()
  chromeRuntime()?.onMessage?.removeListener(onRuntimeMessage)
  window.removeEventListener('apifix-editor-activity', onEditorActivityEvent)
})
</script>

<template>
  <div v-if="syncToast" class="cross-sync-toast">{{ syncToast }}</div>
  <div v-if="Object.keys(remoteActivities).length" class="remote-presence-panel">
    <div class="presence-title">协同光标</div>
    <div v-for="item in remoteActivities" :key="item.senderId" class="presence-row">
      <strong>{{ item.apiName || item.apiId || '当前接口' }}</strong>
      <span>{{ item.tab || '编辑中' }}{{ formatCursor(item.cursor) }}</span>
      <small v-if="item.cursor?.snippet">“{{ item.cursor.snippet }}”</small>
    </div>
  </div>
</template>

<style scoped>
.cross-sync-toast {
  position: fixed;
  right: 18px;
  bottom: 68px;
  z-index: 1190;
  max-width: min(420px, calc(100vw - 36px));
  padding: 10px 12px;
  border: 1px solid var(--border);
  border-radius: var(--radius-xl);
  background: var(--bg-panel);
  color: var(--text-primary);
  box-shadow: var(--shadow-lg);
  font-size: var(--font-size-body);
}

.remote-presence-panel {
  position: fixed;
  right: 18px;
  bottom: 118px;
  z-index: 1189;
  width: min(360px, calc(100vw - 36px));
  padding: 10px;
  border: 1px solid var(--border);
  border-radius: var(--radius-xl);
  background: color-mix(in srgb, var(--bg-panel) 96%, transparent);
  color: var(--text-primary);
  box-shadow: var(--shadow-lg);
  backdrop-filter: blur(10px);
}

.presence-title {
  font-size: var(--font-size-small);
  font-weight: 800;
  color: var(--text-secondary);
  margin-bottom: 6px;
}

.presence-row {
  display: flex;
  flex-direction: column;
  gap: 2px;
  padding: 6px 0;
  border-top: 1px solid var(--divider);
  font-size: var(--font-size-small);
}

.presence-row:first-of-type {
  border-top: none;
}

.presence-row span,
.presence-row small {
  color: var(--text-secondary);
}

.presence-row small {
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
}

</style>
