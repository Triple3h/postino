<script setup lang="ts">
import { onMounted, onUnmounted, ref, computed } from 'vue'
import { useWorkspaceStore } from '@/stores/workspace'
import { isDataSourceSyncDue, syncModuleDataSource, type DataSourceSyncResult } from '@/utils/data-source-sync'
import type { ModuleSyncLog } from '@/types'

const workspace = useWorkspaceStore()
const inFlight = new Set<string>()
const ownerId = `${Date.now()}:${Math.random().toString(36).slice(2)}`
const LOCK_TTL_MS = 5 * 60_000
let timer: ReturnType<typeof setInterval> | null = null

// --- Retry state ---
const MAX_RETRIES = 3
const RETRY_DELAY_MS = 30_000
const retryCountByModule = new Map<string, number>()
const retryTimers = new Map<string, ReturnType<typeof setTimeout>>()

// --- Toast state ---
interface ToastEntry {
  id: number
  type: 'syncing' | 'success' | 'error'
  moduleName: string
  message: string
  createdAt: number
  dismissAt: number
  moduleId?: string
  retryCount?: number
}

let toastIdCounter = 0
const toasts = ref<ToastEntry[]>([])
let toastCleanupTimer: ReturnType<typeof setInterval> | null = null

function addToast(
  type: ToastEntry['type'],
  moduleName: string,
  message: string,
  moduleId?: string,
  retryCount?: number,
): void {
  const id = ++toastIdCounter
  const now = Date.now()
  const dismissAt = type === 'error' ? now + 10_000 : now + 5_000
  toasts.value.push({ id, type, moduleName, message, createdAt: now, dismissAt, moduleId, retryCount })
}

function removeToast(id: number): void {
  toasts.value = toasts.value.filter(t => t.id !== id)
}

function pruneToasts(): void {
  const now = Date.now()
  toasts.value = toasts.value.filter(t => t.dismissAt > now)
}

// --- Sync status indicator ---
type SyncStatus = 'idle' | 'syncing' | 'success' | 'error'

interface SyncStatusEntry {
  status: SyncStatus
  moduleName: string
  updatedAt: number
  errorMessage?: string
}

const syncStatusMap = ref<Map<string, SyncStatusEntry>>(new Map())

const latestSyncStatus = computed<SyncStatusEntry | null>(() => {
  let latest: SyncStatusEntry | null = null
  for (const entry of syncStatusMap.value.values()) {
    if (!latest || entry.updatedAt > latest.updatedAt) {
      latest = entry
    }
  }
  return latest
})

function setSyncStatus(moduleId: string, status: SyncStatus, moduleName: string, errorMessage?: string): void {
  syncStatusMap.value.set(moduleId, {
    status,
    moduleName,
    updatedAt: Date.now(),
    errorMessage,
  })
}

// --- Lock management (unchanged) ---

function chromeRuntime(): any {
  return typeof chrome !== 'undefined' ? chrome.runtime : undefined
}

function lockKey(moduleId: string): string {
  return `apifix_datasource_sync_lock:${moduleId}`
}

function claimLock(moduleId: string): boolean {
  try {
    const key = lockKey(moduleId)
    const raw = localStorage.getItem(key)
    if (raw) {
      const lock = JSON.parse(raw) as { owner?: string; at?: number }
      if (lock.at && Date.now() - lock.at < LOCK_TTL_MS && lock.owner !== ownerId) return false
    }
    localStorage.setItem(key, JSON.stringify({ owner: ownerId, at: Date.now() }))
    const current = JSON.parse(localStorage.getItem(key) || '{}') as { owner?: string }
    return current.owner === ownerId
  } catch {
    return true
  }
}

function releaseLock(moduleId: string): void {
  try {
    const key = lockKey(moduleId)
    const lock = JSON.parse(localStorage.getItem(key) || '{}') as { owner?: string }
    if (lock.owner === ownerId) localStorage.removeItem(key)
  } catch {}
}

// --- Sync with toast notifications and retry ---

async function doSyncModule(moduleId: string, moduleName: string, syncAction: ModuleSyncLog['action'] = 'auto-sync'): Promise<void> {
  setSyncStatus(moduleId, 'syncing', moduleName)
  addToast('syncing', moduleName, `正在同步 ${moduleName}...`, moduleId)

  try {
    const result = await syncModuleDataSource(moduleId, {
      syncAction,
      onLog: line => console.info(`[ApiFix][DataSource:${moduleName}] ${line}`),
    })

    setSyncStatus(moduleId, 'success', moduleName)
    retryCountByModule.delete(moduleId)
    addToast('success', moduleName, `同步完成: +${result.created} 新增, +${result.updated} 更新`, moduleId)
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err)
    setSyncStatus(moduleId, 'error', moduleName, message)

    const currentRetries = retryCountByModule.get(moduleId) ?? 0
    const nextRetry = currentRetries + 1
    retryCountByModule.set(moduleId, nextRetry)

    if (nextRetry <= MAX_RETRIES) {
      addToast('error', moduleName, `同步失败: ${message}（第 ${nextRetry}/${MAX_RETRIES} 次重试）`, moduleId, nextRetry)
      scheduleRetry(moduleId, moduleName)
    } else {
      addToast('error', moduleName, `同步失败: ${message}（已达最大重试次数，等待下次定时同步）`, moduleId, nextRetry)
      retryCountByModule.delete(moduleId)
    }
  } finally {
    inFlight.delete(moduleId)
    releaseLock(moduleId)
  }
}

function scheduleRetry(moduleId: string, moduleName: string): void {
  // Clear any existing retry timer for this module
  const existingTimer = retryTimers.get(moduleId)
  if (existingTimer) clearTimeout(existingTimer)

  const timer = setTimeout(() => {
    retryTimers.delete(moduleId)
    const module = workspace.modules.find(m => m.id === moduleId)
    if (!module?.dataSource?.url || inFlight.has(moduleId)) return
    if (!claimLock(moduleId)) return
    inFlight.add(moduleId)
    void doSyncModule(moduleId, moduleName)
  }, RETRY_DELAY_MS)

  retryTimers.set(moduleId, timer)
}

function retryModuleSync(moduleId: string): void {
  const module = workspace.modules.find(m => m.id === moduleId)
  if (!module?.dataSource?.url || inFlight.has(moduleId)) return
  if (!claimLock(moduleId)) return

  // Reset retry count on manual retry
  retryCountByModule.delete(moduleId)
  const existingTimer = retryTimers.get(moduleId)
  if (existingTimer) {
    clearTimeout(existingTimer)
    retryTimers.delete(moduleId)
  }

  inFlight.add(moduleId)
  void doSyncModule(moduleId, module.name)
}

async function syncDueModules(): Promise<void> {
  const dueModules = workspace.modules.filter(module =>
    module.dataSource?.syncStrategy === 'auto' &&
    isDataSourceSyncDue(module.dataSource) &&
    !inFlight.has(module.id),
  )
  for (const module of dueModules) {
    if (!claimLock(module.id)) continue
    inFlight.add(module.id)
    void doSyncModule(module.id, module.name)
  }
}

function canTriggerWebhook(module: any, secret?: string): boolean {
  const expectedSecret = module.dataSource?.webhookSecret?.trim()
  if (!expectedSecret) return true
  return secret === expectedSecret
}

async function syncModuleByWebhook(moduleId?: string, secret?: string): Promise<void> {
  const targets = moduleId
    ? workspace.modules.filter(module => module.id === moduleId)
    : workspace.modules.filter(module => module.dataSource?.syncStrategy === 'webhook')
  for (const module of targets) {
    if (!module.dataSource?.url || inFlight.has(module.id)) continue
    if (!canTriggerWebhook(module, secret)) {
      console.warn(`[ApiFix][Webhook:${module.name}] 触发密钥不匹配，已拒绝同步。`)
      continue
    }
    if (!claimLock(module.id)) continue
    inFlight.add(module.id)
    void doSyncModule(module.id, module.name, 'webhook-sync')
  }
}

function handleRuntimeMessage(message: any) {
  if (message?.type === 'APIFIX_TRIGGER_DATASOURCE_SYNC') {
    void syncModuleByWebhook(message.moduleId, message.secret)
  }
}

onMounted(() => {
  void syncDueModules()
  timer = setInterval(() => void syncDueModules(), 60_000)
  chromeRuntime()?.onMessage?.addListener(handleRuntimeMessage)
  toastCleanupTimer = setInterval(pruneToasts, 2000)
})

onUnmounted(() => {
  if (timer) clearInterval(timer)
  if (toastCleanupTimer) clearInterval(toastCleanupTimer)
  chromeRuntime()?.onMessage?.removeListener(handleRuntimeMessage)
  for (const t of retryTimers.values()) clearTimeout(t)
  retryTimers.clear()
})
</script>

<template>
  <!-- Sync status indicator -->
  <div v-if="latestSyncStatus" class="sync-status-indicator" :class="latestSyncStatus.status">
    <!-- Syncing: spinning icon -->
    <svg v-if="latestSyncStatus.status === 'syncing'" class="sync-icon sync-spinning" viewBox="0 0 16 16" width="14" height="14" fill="currentColor">
      <path d="M8 1.5a6.5 6.5 0 1 0 6.5 6.5.75.75 0 0 1 1.5 0 8 8 0 1 1-8-8 .75.75 0 0 1 0 1.5Z"/>
    </svg>
    <!-- Success: checkmark -->
    <svg v-else-if="latestSyncStatus.status === 'success'" class="sync-icon sync-success" viewBox="0 0 16 16" width="14" height="14" fill="currentColor">
      <path d="M13.78 4.22a.75.75 0 0 1 0 1.06l-7.25 7.25a.75.75 0 0 1-1.06 0L2.22 9.28a.75.75 0 0 1 1.06-1.06L6 10.94l6.72-6.72a.75.75 0 0 1 1.06 0Z"/>
    </svg>
    <!-- Error: X mark -->
    <svg v-else-if="latestSyncStatus.status === 'error'" class="sync-icon sync-error" viewBox="0 0 16 16" width="14" height="14" fill="currentColor">
      <path d="M3.72 3.72a.75.75 0 0 1 1.06 0L8 6.94l3.22-3.22a.75.75 0 1 1 1.06 1.06L9.06 8l3.22 3.22a.75.75 0 1 1-1.06 1.06L8 9.06l-3.22 3.22a.75.75 0 0 1-1.06-1.06L6.94 8 3.72 4.78a.75.75 0 0 1 0-1.06Z"/>
    </svg>
    <span class="sync-status-label">{{ latestSyncStatus.moduleName }}</span>
  </div>

  <!-- Toast notifications -->
  <div class="sync-toast-container">
    <TransitionGroup name="sync-toast">
      <div
        v-for="toast in toasts"
        :key="toast.id"
        class="sync-toast"
        :class="[`sync-toast-${toast.type}`]"
      >
        <div class="sync-toast-content">
          <span class="sync-toast-message">{{ toast.message }}</span>
          <button
            v-if="toast.type === 'error' && toast.moduleId"
            class="sync-toast-retry"
            @click="retryModuleSync(toast.moduleId!); removeToast(toast.id)"
          >重试</button>
        </div>
        <button class="sync-toast-dismiss" @click="removeToast(toast.id)" aria-label="关闭">&times;</button>
      </div>
    </TransitionGroup>
  </div>
</template>

<style scoped>
/* --- Sync status indicator --- */
.sync-status-indicator {
  position: fixed;
  left: 16px;
  bottom: 16px;
  z-index: 1100;
  display: flex;
  align-items: center;
  gap: 6px;
  padding: 6px 10px;
  border: 1px solid var(--border);
  border-radius: 8px;
  background: var(--bg-panel);
  box-shadow: var(--shadow-sm);
  font-size: 12px;
  color: var(--text-secondary);
  transition: opacity 0.2s;
}

.sync-status-indicator.syncing {
  border-color: #3b82f6;
}

.sync-status-indicator.success {
  border-color: #10b981;
}

.sync-status-indicator.error {
  border-color: #ef4444;
}

.sync-icon {
  flex-shrink: 0;
}

.sync-spinning {
  color: #3b82f6;
  animation: sync-rotate 1s linear infinite;
}

@keyframes sync-rotate {
  to { transform: rotate(360deg); }
}

.sync-success {
  color: #10b981;
}

.sync-error {
  color: #ef4444;
}

.sync-status-label {
  max-width: 120px;
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
}

/* --- Toast container --- */
.sync-toast-container {
  position: fixed;
  right: 18px;
  bottom: 18px;
  z-index: 1200;
  display: flex;
  flex-direction: column-reverse;
  gap: 8px;
  max-width: min(400px, calc(100vw - 36px));
  pointer-events: none;
}

/* --- Toast item --- */
.sync-toast {
  display: flex;
  align-items: flex-start;
  gap: 8px;
  padding: 10px 12px;
  border: 1px solid var(--border);
  border-radius: var(--radius-xl);
  background: var(--bg-panel);
  color: var(--text-primary);
  box-shadow: var(--shadow-lg);
  font-size: 13px;
  pointer-events: auto;
}

.sync-toast-syncing {
  border-left: 3px solid #3b82f6;
}

.sync-toast-success {
  border-left: 3px solid #10b981;
}

.sync-toast-error {
  border-left: 3px solid #ef4444;
}

.sync-toast-content {
  flex: 1;
  display: flex;
  align-items: center;
  gap: 8px;
  min-width: 0;
}

.sync-toast-message {
  flex: 1;
  min-width: 0;
  overflow: hidden;
  text-overflow: ellipsis;
}

.sync-toast-retry {
  flex-shrink: 0;
  padding: 2px 10px;
  border: 1px solid #f59e0b;
  border-radius: 6px;
  background: #f59e0b;
  color: #fff;
  font-size: 12px;
  font-weight: 600;
  cursor: pointer;
  transition: background 0.15s;
}

.sync-toast-retry:hover {
  background: #d97706;
}

.sync-toast-dismiss {
  flex-shrink: 0;
  display: flex;
  align-items: center;
  justify-content: center;
  width: 20px;
  height: 20px;
  border: none;
  border-radius: 4px;
  background: transparent;
  color: var(--text-secondary);
  font-size: 14px;
  cursor: pointer;
  transition: background 0.12s;
}

.sync-toast-dismiss:hover {
  background: var(--bg-hover);
}

/* --- Toast transition --- */
.sync-toast-enter-active {
  transition: all 0.25s ease-out;
}

.sync-toast-leave-active {
  transition: all 0.2s ease-in;
}

.sync-toast-enter-from {
  opacity: 0;
  transform: translateX(20px);
}

.sync-toast-leave-to {
  opacity: 0;
  transform: translateX(20px);
}

.sync-toast-move {
  transition: transform 0.25s ease;
}
</style>
