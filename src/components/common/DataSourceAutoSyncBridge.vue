<script setup lang="ts">
import { onMounted, onUnmounted } from 'vue'
import { useWorkspaceStore } from '@/stores/workspace'
import { isDataSourceSyncDue, syncModuleDataSource } from '@/utils/data-source-sync'

const workspace = useWorkspaceStore()
const inFlight = new Set<string>()
const ownerId = `${Date.now()}:${Math.random().toString(36).slice(2)}`
const LOCK_TTL_MS = 5 * 60_000
let timer: ReturnType<typeof setInterval> | null = null

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

async function syncDueModules(): Promise<void> {
  const dueModules = workspace.modules.filter(module =>
    module.dataSource?.syncStrategy === 'auto' &&
    isDataSourceSyncDue(module.dataSource) &&
    !inFlight.has(module.id),
  )
  for (const module of dueModules) {
    if (!claimLock(module.id)) continue
    inFlight.add(module.id)
    syncModuleDataSource(module.id, {
      onLog: line => console.info(`[ApiFix][DataSource:${module.name}] ${line}`),
    }).catch(err => {
      const message = err instanceof Error ? err.message : String(err)
      console.warn(`[ApiFix][DataSource:${module.name}] 自动同步失败：${message}`)
    }).finally(() => {
      inFlight.delete(module.id)
      releaseLock(module.id)
    })
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
    inFlight.add(module.id)
    syncModuleDataSource(module.id, {
      onLog: line => console.info(`[ApiFix][Webhook:${module.name}] ${line}`),
    }).catch(err => {
      const message = err instanceof Error ? err.message : String(err)
      console.warn(`[ApiFix][Webhook:${module.name}] 同步失败：${message}`)
    }).finally(() => inFlight.delete(module.id))
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
})

onUnmounted(() => {
  if (timer) clearInterval(timer)
  chromeRuntime()?.onMessage?.removeListener(handleRuntimeMessage)
})
</script>

<template></template>
