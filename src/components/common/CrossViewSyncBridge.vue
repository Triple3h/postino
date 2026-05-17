<script setup lang="ts">
import { onMounted, onUnmounted, ref, watch, computed } from 'vue'
import { db } from '@/db'
import { useAppStore } from '@/stores/app'
import { useWorkspaceStore } from '@/stores/workspace'

const store = useAppStore()
const workspace = useWorkspaceStore()

// ---------------------------------------------------------------------------
// User Identity
// ---------------------------------------------------------------------------

interface UserIdentity {
  id: string
  name: string
  color: string
}

const PLEASANT_COLORS = [
  '#6366f1', '#8b5cf6', '#ec4899', '#f43f5e', '#f97316',
  '#eab308', '#22c55e', '#14b8a6', '#06b6d4', '#3b82f6',
]

function loadOrCreateIdentity(): UserIdentity {
  try {
    const raw = localStorage.getItem('apifix_user_identity')
    if (raw) {
      const parsed = JSON.parse(raw)
      if (parsed?.id && parsed?.name && parsed?.color) return parsed
    }
  } catch { /* ignore */ }
  const id = Math.random().toString(36).slice(2) + Date.now().toString(36)
  const suffix = id.slice(0, 2).toUpperCase()
  const name = `用户-${suffix}`
  const color = PLEASANT_COLORS[Math.floor(Math.random() * PLEASANT_COLORS.length)]
  const identity: UserIdentity = { id, name, color }
  try { localStorage.setItem('apifix_user_identity', JSON.stringify(identity)) } catch { /* ignore */ }
  return identity
}

const userIdentity = loadOrCreateIdentity()

// ---------------------------------------------------------------------------
// Sync Scope Preferences
// ---------------------------------------------------------------------------

interface SyncScopePrefs {
  environment: boolean
  workspace: boolean
  settings: boolean
  api: boolean
}

const DEFAULT_SCOPE_PREFS: SyncScopePrefs = {
  environment: true,
  workspace: true,
  settings: true,
  api: true,
}

function loadScopePrefs(): SyncScopePrefs {
  try {
    const raw = localStorage.getItem('apifix_sync_scope_prefs')
    if (raw) {
      const parsed = JSON.parse(raw)
      return { ...DEFAULT_SCOPE_PREFS, ...parsed }
    }
  } catch { /* ignore */ }
  return { ...DEFAULT_SCOPE_PREFS }
}

function saveScopePrefs(prefs: SyncScopePrefs): void {
  try { localStorage.setItem('apifix_sync_scope_prefs', JSON.stringify(prefs)) } catch { /* ignore */ }
}

const scopePrefs = ref<SyncScopePrefs>(loadScopePrefs())

watch(scopePrefs, (val) => saveScopePrefs(val), { deep: true })

// ---------------------------------------------------------------------------
// Core State
// ---------------------------------------------------------------------------

const senderId = userIdentity.id
const channel = typeof BroadcastChannel !== 'undefined' ? new BroadcastChannel('apifix-state-sync') : null
let debounceTimer: ReturnType<typeof setTimeout> | null = null
let activityDebounceTimer: ReturnType<typeof setTimeout> | null = null
let suppressUntil = 0
let toastTimer: ReturnType<typeof setTimeout> | null = null
let presenceTimer: ReturnType<typeof setInterval> | null = null
const syncToast = ref('')
const remoteActivities = ref<Record<string, EditorActivityMessage & { expiresAt: number; identity?: UserIdentity }>>({})
const lastLocalChangeAt: Record<SyncMessage['scope'], number> = {
  environment: 0,
  workspace: 0,
  settings: 0,
  api: 0,
}

// ---------------------------------------------------------------------------
// Sync Status Indicator
// ---------------------------------------------------------------------------

type SyncStatus = 'connected' | 'conflict' | 'error' | 'syncing'

const syncStatus = ref<SyncStatus>('connected')
const lastSyncTime = ref<number>(Date.now())
const syncStatusMessage = ref('已连接')
let syncStatusResetTimer: ReturnType<typeof setTimeout> | null = null

function setSyncStatus(status: SyncStatus, message: string, duration = 0): void {
  syncStatus.value = status
  syncStatusMessage.value = message
  if (status === 'syncing' || status === 'conflict') {
    lastSyncTime.value = Date.now()
  }
  if (syncStatusResetTimer) clearTimeout(syncStatusResetTimer)
  if (duration > 0) {
    syncStatusResetTimer = setTimeout(() => {
      syncStatus.value = 'connected'
      syncStatusMessage.value = '已连接'
    }, duration)
  }
}

const showSyncTooltip = ref(false)

const syncStatusDotColor = computed(() => {
  switch (syncStatus.value) {
    case 'connected': return '#22c55e'
    case 'conflict': return '#eab308'
    case 'error': return '#ef4444'
    case 'syncing': return '#3b82f6'
  }
})

const formattedLastSyncTime = computed(() => {
  return new Date(lastSyncTime.value).toLocaleTimeString('zh-CN')
})

// ---------------------------------------------------------------------------
// Conflict Resolution
// ---------------------------------------------------------------------------

interface ConflictField {
  key: string
  label: string
  localValue: any
  remoteValue: any
  choice: 'local' | 'remote'
}

interface ConflictInfo {
  scope: SyncMessage['scope']
  fields: ConflictField[]
  visible: boolean
}

const conflictInfo = ref<ConflictInfo>({
  scope: 'environment',
  fields: [],
  visible: false,
})

const remoteIdentity = ref<UserIdentity | null>(null)

function captureLocalSnapshot(scope: SyncMessage['scope']): Record<string, any> {
  if (scope === 'environment') {
    return { environments: JSON.parse(JSON.stringify(store.environments)) }
  }
  if (scope === 'settings') {
    return { settings: JSON.parse(JSON.stringify(store.settings)) }
  }
  if (scope === 'api') {
    return { apis: JSON.parse(JSON.stringify(store.apis)) }
  }
  // workspace
  return {
    categories: JSON.parse(JSON.stringify(workspace.categories)),
    modules: JSON.parse(JSON.stringify(workspace.modules)),
    interfaces: JSON.parse(JSON.stringify(workspace.interfaces)),
  }
}

function buildConflictFields(scope: SyncMessage['scope'], localSnap: Record<string, any>, remoteSnap: Record<string, any>): ConflictField[] {
  const fields: ConflictField[] = []
  const allKeys = new Set([...Object.keys(localSnap), ...Object.keys(remoteSnap)])
  for (const key of allKeys) {
    const localVal = localSnap[key]
    const remoteVal = remoteSnap[key]
    if (JSON.stringify(localVal) === JSON.stringify(remoteVal)) continue
    fields.push({
      key,
      label: scopeFieldLabel(scope, key),
      localValue: localVal,
      remoteValue: remoteVal,
      choice: 'remote',
    })
  }
  return fields
}

function scopeFieldLabel(scope: SyncMessage['scope'], key: string): string {
  const labels: Record<string, string> = {
    environments: '环境变量列表',
    settings: '应用设置',
    apis: '接口配置列表',
    categories: '分类列表',
    modules: '模块列表',
    interfaces: '接口树列表',
  }
  return labels[key] || key
}

function formatConflictValue(value: any): string {
  if (value === undefined) return '(无)'
  if (value === null) return '(空)'
  const str = JSON.stringify(value)
  if (str.length > 120) return str.slice(0, 120) + '...'
  return str
}

async function resolveUseLocal(): Promise<void> {
  markSuppress()
  const scope = conflictInfo.value.scope
  const fields = conflictInfo.value.fields
  for (const field of fields) {
    await applyLocalFieldChoice(scope, field.key, field.localValue)
  }
  conflictInfo.value.visible = false
  setSyncStatus('connected', '已保留本地版本', 3000)
}

async function resolveUseRemote(): Promise<void> {
  await reloadSharedState(conflictInfo.value.scope)
  conflictInfo.value.visible = false
  setSyncStatus('connected', '已使用远端版本', 3000)
}

async function resolvePerField(): Promise<void> {
  const scope = conflictInfo.value.scope
  const fields = conflictInfo.value.fields

  // For per-field resolution, we reload from remote first, then apply local choices
  await reloadSharedState(scope)

  // Apply local choices for fields where user chose "local"
  for (const field of fields) {
    if (field.choice === 'local') {
      await applyLocalFieldChoice(scope, field.key, field.localValue)
    }
  }

  conflictInfo.value.visible = false
  setSyncStatus('connected', '已按选择合并', 3000)
}

async function applyLocalFieldChoice(scope: SyncMessage['scope'], key: string, localValue: any): Promise<void> {
  if (scope === 'environment' && key === 'environments') {
    store.environments = localValue
    await db.environments.clear()
    await db.environments.bulkPut(localValue)
  } else if (scope === 'settings' && key === 'settings') {
    store.settings = { ...store.settings, ...localValue }
    const entries = Object.entries(localValue).map(([k, v]) => ({ key: k, value: v }))
    await db.settings.bulkPut(entries)
  } else if (scope === 'api' && key === 'apis') {
    store.apis = localValue
    await db.apis.clear()
    await db.apis.bulkPut(Object.values(localValue))
  } else if (scope === 'workspace') {
    if (key === 'categories') {
      workspace.categories = localValue
      await db.categories.clear()
      await db.categories.bulkPut(localValue)
    } else if (key === 'modules') {
      workspace.modules = localValue
      await db.modules.clear()
      await db.modules.bulkPut(localValue)
    } else if (key === 'interfaces') {
      workspace.interfaces = localValue
      await db.interfaces.clear()
      await db.interfaces.bulkPut(localValue)
    }
  }
}

function dismissConflict(): void {
  conflictInfo.value.visible = false
  // Default to remote on dismiss
  void reloadSharedState(conflictInfo.value.scope)
  setSyncStatus('connected', '已使用远端版本', 3000)
}

// ---------------------------------------------------------------------------
// Message Types
// ---------------------------------------------------------------------------

interface SyncMessage {
  type: 'APIFIX_STATE_CHANGED'
  senderId: string
  scope: 'environment' | 'workspace' | 'settings' | 'api'
  timestamp: number
  identity?: UserIdentity
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
  identity?: UserIdentity
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
  // Check if this scope is enabled for listening
  if (!scopePrefs.value[message.scope]) return

  const hasLocalOverlap = Date.now() - lastLocalChangeAt[message.scope] < 3000

  if (hasLocalOverlap) {
    setSyncStatus('syncing', `正在检测${scopeLabel(message.scope)}冲突...`, 0)
    void (async () => {
      const localSnap = captureLocalSnapshot(message.scope)
      await reloadSharedState(message.scope)
      const remoteSnap = captureLocalSnapshot(message.scope)
      // Restore local state temporarily for the conflict dialog
      if (message.scope === 'environment') {
        store.environments = localSnap.environments
      } else if (message.scope === 'settings') {
        store.settings = localSnap.settings
      } else if (message.scope === 'api') {
        store.apis = localSnap.apis
      } else if (message.scope === 'workspace') {
        if (localSnap.categories) workspace.categories = localSnap.categories
        if (localSnap.modules) workspace.modules = localSnap.modules
        if (localSnap.interfaces) workspace.interfaces = localSnap.interfaces
      }
      const fields = buildConflictFields(message.scope, localSnap, remoteSnap)
      if (fields.length === 0) {
        showSyncToast(`已同步另一视图的${scopeLabel(message.scope)}更新`)
        setSyncStatus('connected', '已同步', 3000)
        return
      }
      remoteIdentity.value = message.identity || null
      conflictInfo.value = {
        scope: message.scope,
        fields,
        visible: true,
      }
      setSyncStatus('conflict', `检测到${scopeLabel(message.scope)}冲突`, 0)
    })()
  } else {
    setSyncStatus('syncing', `正在同步${scopeLabel(message.scope)}...`, 0)
    void reloadSharedState(message.scope)
      .then(() => {
        showSyncToast(`已同步另一视图的${scopeLabel(message.scope)}更新`)
        setSyncStatus('connected', '已同步', 3000)
      })
      .catch(err => {
        console.warn('[ApiFix] 跨视图同步失败:', err)
        setSyncStatus('error', '同步失败', 5000)
      })
  }
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
    [message.senderId]: { ...message, expiresAt: Date.now() + 9000, identity: message.identity },
  }
  const userName = message.identity?.name || '另一视图'
  showSyncToast(`${userName}正在编辑：${target}${tab}${formatCursor(message.cursor)}`)
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
  // Check if this scope is enabled for broadcasting
  if (!scopePrefs.value[scope]) return
  lastLocalChangeAt[scope] = Date.now()
  if (debounceTimer) clearTimeout(debounceTimer)
  debounceTimer = setTimeout(() => {
    const message: SyncMessage = { type: 'APIFIX_STATE_CHANGED', senderId, scope, timestamp: Date.now(), identity: userIdentity }
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

function publishEditorActivity(detail: Omit<EditorActivityMessage, 'type' | 'senderId' | 'timestamp' | 'identity'>): void {
  if (activityDebounceTimer) clearTimeout(activityDebounceTimer)
  activityDebounceTimer = setTimeout(() => {
    const message: EditorActivityMessage = { type: 'APIFIX_EDITOR_ACTIVITY', senderId, timestamp: Date.now(), identity: userIdentity, ...detail }
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
  const detail = (event as CustomEvent<Omit<EditorActivityMessage, 'type' | 'senderId' | 'timestamp' | 'identity'>>).detail
  if (!detail) return
  publishEditorActivity(detail)
}

// ---------------------------------------------------------------------------
// Scope Toggle UI
// ---------------------------------------------------------------------------

const showScopeSettings = ref(false)

const scopeToggleItems = computed(() => [
  { key: 'environment' as const, label: '环境变量', icon: 'G', enabled: scopePrefs.value.environment },
  { key: 'workspace' as const, label: '模块/接口树', icon: 'W', enabled: scopePrefs.value.workspace },
  { key: 'settings' as const, label: '设置', icon: 'S', enabled: scopePrefs.value.settings },
  { key: 'api' as const, label: '接口配置', icon: 'A', enabled: scopePrefs.value.api },
])

function toggleScope(key: keyof SyncScopePrefs): void {
  scopePrefs.value = { ...scopePrefs.value, [key]: !scopePrefs.value[key] }
}

// ---------------------------------------------------------------------------
// Lifecycle
// ---------------------------------------------------------------------------

onMounted(() => {
  channel?.addEventListener('message', event => handleBridgeMessage(event.data))
  chromeRuntime()?.onMessage?.addListener(onRuntimeMessage)
  window.addEventListener('apifix-editor-activity', onEditorActivityEvent)
  presenceTimer = setInterval(pruneRemoteActivities, 2500)
  setSyncStatus('connected', '已连接')
})

onUnmounted(() => {
  if (debounceTimer) clearTimeout(debounceTimer)
  if (activityDebounceTimer) clearTimeout(activityDebounceTimer)
  if (toastTimer) clearTimeout(toastTimer)
  if (presenceTimer) clearInterval(presenceTimer)
  if (syncStatusResetTimer) clearTimeout(syncStatusResetTimer)
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
  <!-- Sync Toast -->
  <div v-if="syncToast" class="cross-sync-toast">{{ syncToast }}</div>

  <!-- Remote Presence Panel -->
  <div v-if="Object.keys(remoteActivities).length" class="remote-presence-panel">
    <div class="presence-title">协同光标</div>
    <div v-for="item in remoteActivities" :key="item.senderId" class="presence-row">
      <div class="presence-user">
        <span class="presence-avatar" :style="{ background: item.identity?.color || '#6366f1' }">
          {{ (item.identity?.name || '?').slice(-1) }}
        </span>
        <strong>{{ item.identity?.name || '另一视图' }}</strong>
      </div>
      <span class="presence-target">{{ item.apiName || item.apiId || '当前接口' }}</span>
      <span>{{ item.tab || '编辑中' }}{{ formatCursor(item.cursor) }}</span>
      <small v-if="item.cursor?.snippet">"{{ item.cursor.snippet }}"</small>
    </div>
  </div>

  <!-- Sync Status Indicator -->
  <div
    class="sync-status-indicator"
    :style="{ '--dot-color': syncStatusDotColor }"
    @click="showSyncTooltip = !showSyncTooltip"
  >
    <span class="sync-dot" :class="{ pulse: syncStatus === 'syncing' }"></span>
    <div v-if="showSyncTooltip" class="sync-tooltip" @click.stop>
      <div class="sync-tooltip-title">同步状态</div>
      <div class="sync-tooltip-row">
        <span>状态</span>
        <strong :style="{ color: syncStatusDotColor }">{{ syncStatusMessage }}</strong>
      </div>
      <div class="sync-tooltip-row">
        <span>上次同步</span>
        <strong>{{ formattedLastSyncTime }}</strong>
      </div>
      <div class="sync-tooltip-row">
        <span>身份</span>
        <strong>
          <span class="presence-avatar mini" :style="{ background: userIdentity.color }">
            {{ userIdentity.name.slice(-1) }}
          </span>
          {{ userIdentity.name }}
        </strong>
      </div>
      <button class="sync-tooltip-btn" @click="showScopeSettings = !showScopeSettings">
        {{ showScopeSettings ? '收起同步设置' : '同步范围设置' }}
      </button>
      <div v-if="showScopeSettings" class="scope-settings">
        <div v-for="item in scopeToggleItems" :key="item.key" class="scope-toggle-row">
          <label class="scope-toggle">
            <input type="checkbox" :checked="item.enabled" @change="toggleScope(item.key)" />
            <span class="scope-toggle-slider"></span>
          </label>
          <span class="scope-toggle-icon">{{ item.icon }}</span>
          <span>{{ item.label }}</span>
        </div>
      </div>
    </div>
  </div>

  <!-- Conflict Resolution Modal (Teleport to body) -->
  <Teleport to="body">
    <div v-if="conflictInfo.visible" class="conflict-modal-mask" @click.self="dismissConflict">
      <section class="conflict-modal">
        <header class="conflict-modal-header">
          <div>
            <span class="conflict-kicker">冲突检测</span>
            <h2>{{ scopeLabel(conflictInfo.scope) }}同步冲突</h2>
            <p>检测到另一视图同时修改了{{ scopeLabel(conflictInfo.scope) }}，请选择保留哪个版本。</p>
          </div>
          <button class="btn btn-sm" @click="dismissConflict">关闭</button>
        </header>

        <div class="conflict-columns">
          <div class="conflict-column local">
            <div class="conflict-column-header">
              <span class="conflict-column-dot local-dot"></span>
              本地修改
              <span class="conflict-column-user">
                <span class="presence-avatar mini" :style="{ background: userIdentity.color }">
                  {{ userIdentity.name.slice(-1) }}
                </span>
                {{ userIdentity.name }}
              </span>
            </div>
          </div>
          <div class="conflict-column remote">
            <div class="conflict-column-header">
              <span class="conflict-column-dot remote-dot"></span>
              远端修改
              <span class="conflict-column-user">
                <template v-if="remoteIdentity">
                  <span class="presence-avatar mini" :style="{ background: remoteIdentity.color }">
                    {{ remoteIdentity.name.slice(-1) }}
                  </span>
                  {{ remoteIdentity.name }}
                </template>
                <template v-else>另一视图</template>
              </span>
            </div>
          </div>
        </div>

        <div class="conflict-fields">
          <div v-for="(field, idx) in conflictInfo.fields" :key="field.key" class="conflict-field-row">
            <div class="conflict-field-label">{{ field.label }}</div>
            <div class="conflict-field-values">
              <div
                class="conflict-field-value local"
                :class="{ selected: field.choice === 'local' }"
                @click="conflictInfo.fields[idx].choice = 'local'"
              >
                <input
                  type="radio"
                  :name="'conflict-' + field.key"
                  :checked="field.choice === 'local'"
                  @change="conflictInfo.fields[idx].choice = 'local'"
                />
                <span class="conflict-value-text">{{ formatConflictValue(field.localValue) }}</span>
              </div>
              <div
                class="conflict-field-value remote"
                :class="{ selected: field.choice === 'remote' }"
                @click="conflictInfo.fields[idx].choice = 'remote'"
              >
                <input
                  type="radio"
                  :name="'conflict-' + field.key"
                  :checked="field.choice === 'remote'"
                  @change="conflictInfo.fields[idx].choice = 'remote'"
                />
                <span class="conflict-value-text">{{ formatConflictValue(field.remoteValue) }}</span>
              </div>
            </div>
          </div>
        </div>

        <footer class="conflict-actions">
          <button class="btn btn-sm" @click="resolveUseLocal">使用本地版本</button>
          <button class="btn btn-sm" @click="resolveUseRemote">使用远端版本</button>
          <button class="btn btn-primary btn-sm" @click="resolvePerField">逐项选择</button>
        </footer>
      </section>
    </div>
  </Teleport>
</template>

<style scoped>
/* Sync Toast */
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

/* Remote Presence Panel */
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

.presence-user {
  display: flex;
  align-items: center;
  gap: 6px;
}

.presence-avatar {
  display: inline-flex;
  align-items: center;
  justify-content: center;
  width: 20px;
  height: 20px;
  border-radius: 50%;
  color: #fff;
  font-size: 10px;
  font-weight: 700;
  flex-shrink: 0;
}

.presence-avatar.mini {
  width: 16px;
  height: 16px;
  font-size: 9px;
}

.presence-target {
  color: var(--text-primary);
  font-weight: 600;
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

/* Sync Status Indicator */
.sync-status-indicator {
  position: fixed;
  right: 14px;
  bottom: 14px;
  z-index: 1200;
  cursor: pointer;
}

.sync-dot {
  display: block;
  width: 8px;
  height: 8px;
  border-radius: 50%;
  background: var(--dot-color);
  box-shadow: 0 0 6px color-mix(in srgb, var(--dot-color) 40%, transparent);
  transition: background 0.3s, box-shadow 0.3s;
}

.sync-dot.pulse {
  animation: sync-pulse 1s ease-in-out infinite;
}

@keyframes sync-pulse {
  0%, 100% { transform: scale(1); opacity: 1; }
  50% { transform: scale(1.5); opacity: 0.6; }
}

.sync-tooltip {
  position: absolute;
  right: 0;
  bottom: 18px;
  width: min(280px, calc(100vw - 28px));
  padding: 12px;
  border: 1px solid var(--border);
  border-radius: var(--radius-xl);
  background: var(--bg-panel);
  box-shadow: var(--shadow-lg);
  color: var(--text-primary);
  font-size: var(--font-size-small);
}

.sync-tooltip-title {
  font-weight: 800;
  margin-bottom: 8px;
}

.sync-tooltip-row {
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: 8px;
  min-height: 24px;
  color: var(--text-secondary);
}

.sync-tooltip-row strong {
  color: var(--text-primary);
  display: flex;
  align-items: center;
  gap: 4px;
}

.sync-tooltip-btn {
  width: 100%;
  margin-top: 8px;
  padding: 6px 8px;
  border: 1px solid var(--border);
  border-radius: var(--radius-md);
  background: var(--bg-panel);
  color: var(--text-secondary);
  cursor: pointer;
  font-size: var(--font-size-small);
  text-align: center;
}

.sync-tooltip-btn:hover {
  color: var(--primary);
  border-color: var(--primary);
}

/* Scope Settings */
.scope-settings {
  margin-top: 8px;
  padding-top: 8px;
  border-top: 1px solid var(--divider);
  display: grid;
  gap: 6px;
}

.scope-toggle-row {
  display: flex;
  align-items: center;
  gap: 8px;
  min-height: 28px;
}

.scope-toggle-icon {
  display: inline-flex;
  align-items: center;
  justify-content: center;
  width: 20px;
  height: 20px;
  border-radius: 6px;
  background: var(--primary-soft);
  color: var(--primary);
  font-size: 10px;
  font-weight: 800;
}

.scope-toggle {
  position: relative;
  display: inline-block;
  width: 32px;
  height: 18px;
  flex-shrink: 0;
}

.scope-toggle input {
  opacity: 0;
  width: 0;
  height: 0;
}

.scope-toggle-slider {
  position: absolute;
  inset: 0;
  background: var(--border);
  border-radius: 999px;
  cursor: pointer;
  transition: background 0.2s;
}

.scope-toggle-slider::before {
  content: '';
  position: absolute;
  left: 2px;
  top: 2px;
  width: 14px;
  height: 14px;
  border-radius: 50%;
  background: #fff;
  transition: transform 0.2s;
}

.scope-toggle input:checked + .scope-toggle-slider {
  background: var(--primary);
}

.scope-toggle input:checked + .scope-toggle-slider::before {
  transform: translateX(14px);
}

/* Conflict Resolution Modal */
.conflict-modal-mask {
  position: fixed;
  inset: 0;
  z-index: 9999;
  display: flex;
  align-items: center;
  justify-content: center;
  padding: 24px;
  background: rgba(15, 23, 42, 0.52);
  backdrop-filter: blur(8px);
}

.conflict-modal {
  width: min(720px, 100%);
  max-height: min(680px, 88vh);
  overflow: auto;
  border: 1px solid var(--border);
  border-radius: var(--radius-2xl);
  background: var(--bg-panel-elevated);
  box-shadow: var(--shadow-lg);
  padding: 18px;
}

.conflict-modal-header {
  display: flex;
  align-items: flex-start;
  justify-content: space-between;
  gap: 12px;
  padding-bottom: 14px;
  border-bottom: 1px solid var(--divider);
}

.conflict-modal-header h2 {
  margin: 4px 0;
  font-size: 20px;
}

.conflict-modal-header p {
  margin: 0;
  color: var(--text-secondary);
  font-size: var(--font-size-small);
}

.conflict-kicker {
  display: inline-block;
  padding: 2px 8px;
  border-radius: 999px;
  background: #eab308;
  color: #fff;
  font-size: 11px;
  font-weight: 700;
  margin-bottom: 4px;
}

.conflict-columns {
  display: grid;
  grid-template-columns: 1fr 1fr;
  gap: 12px;
  margin: 14px 0;
}

.conflict-column {
  border: 1px solid var(--border);
  border-radius: var(--radius-lg);
  background: var(--bg-panel);
  padding: 10px 12px;
}

.conflict-column-header {
  display: flex;
  align-items: center;
  gap: 6px;
  font-weight: 700;
  font-size: var(--font-size-body);
}

.conflict-column-dot {
  width: 8px;
  height: 8px;
  border-radius: 50%;
  flex-shrink: 0;
}

.local-dot { background: #3b82f6; }
.remote-dot { background: #f97316; }

.conflict-column-user {
  margin-left: auto;
  display: flex;
  align-items: center;
  gap: 4px;
  font-weight: 400;
  font-size: var(--font-size-small);
  color: var(--text-secondary);
}

.conflict-fields {
  display: grid;
  gap: 10px;
  padding: 4px 0 14px;
}

.conflict-field-row {
  border: 1px solid var(--border);
  border-radius: var(--radius-lg);
  background: var(--bg-panel);
  overflow: hidden;
}

.conflict-field-label {
  padding: 8px 12px;
  font-weight: 700;
  font-size: var(--font-size-small);
  border-bottom: 1px solid var(--divider);
  background: color-mix(in srgb, var(--primary) 6%, var(--bg-panel));
}

.conflict-field-values {
  display: grid;
  grid-template-columns: 1fr 1fr;
}

.conflict-field-value {
  display: flex;
  align-items: flex-start;
  gap: 6px;
  padding: 8px 10px;
  cursor: pointer;
  border-right: 1px solid var(--divider);
  transition: background 0.15s;
}

.conflict-field-value:last-child {
  border-right: none;
}

.conflict-field-value:hover {
  background: var(--bg-hover);
}

.conflict-field-value.selected {
  background: color-mix(in srgb, var(--primary) 8%, var(--bg-panel));
}

.conflict-field-value input[type="radio"] {
  margin-top: 2px;
  flex-shrink: 0;
  accent-color: var(--primary);
}

.conflict-value-text {
  font-family: var(--font-code);
  font-size: var(--font-size-small);
  color: var(--text-secondary);
  word-break: break-all;
  line-height: 1.4;
}

.conflict-field-value.selected .conflict-value-text {
  color: var(--text-primary);
}

.conflict-actions {
  display: flex;
  align-items: center;
  justify-content: flex-end;
  gap: 8px;
  padding-top: 14px;
  border-top: 1px solid var(--divider);
}

/* Button styles (matching app conventions) */
.btn {
  display: inline-flex;
  align-items: center;
  justify-content: center;
  gap: 6px;
  padding: 6px 12px;
  border: 1px solid var(--border);
  border-radius: var(--radius-lg);
  background: var(--bg-panel);
  color: var(--text-primary);
  cursor: pointer;
  font-size: var(--font-size-body);
  font-weight: 500;
  transition: all 0.15s;
}

.btn:hover {
  border-color: var(--primary);
  color: var(--primary);
}

.btn-sm {
  padding: 4px 10px;
  font-size: var(--font-size-small);
}

.btn-primary {
  background: var(--primary);
  color: #fff;
  border-color: var(--primary);
}

.btn-primary:hover {
  opacity: 0.9;
  color: #fff;
}
</style>
