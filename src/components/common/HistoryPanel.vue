<script setup lang="ts">
import { ref, computed } from 'vue'
import { useAppStore } from '@/stores/app'
import { useWorkspaceStore } from '@/stores/workspace'
import { generateCurl } from '@/utils/export'
import { useDialog } from '@/composables/useDialog'
import type { ApiConfig, HistoryEntry, HttpMethod } from '@/types'

const store = useAppStore()
const workspace = useWorkspaceStore()
const dialog = useDialog()
const searchQuery = ref('')
const activeFilter = ref<'all' | 'starred' | 'success' | 'fail'>('all')
const contextMenu = ref<{ x: number; y: number; entry: HistoryEntry } | null>(null)
const toast = ref('')

const filteredHistory = computed(() => {
  let list = store.history

  if (activeFilter.value === 'starred') {
    list = list.filter(h => h.starred)
  } else if (activeFilter.value === 'success') {
    list = list.filter(h => h.status >= 200 && h.status < 400)
  } else if (activeFilter.value === 'fail') {
    list = list.filter(h => h.status === 0 || h.status >= 400)
  }

  if (searchQuery.value.trim()) {
    const q = searchQuery.value.toLowerCase()
    list = list.filter(h => {
      const meta = getHistoryApiMeta(h)
      return h.url.toLowerCase().includes(q) ||
        h.method.toLowerCase().includes(q) ||
        h.status.toString().includes(q) ||
        meta.name.toLowerCase().includes(q) ||
        meta.path.toLowerCase().includes(q)
    })
  }

  return list
})

interface TimeGroup { label: string; entries: HistoryEntry[] }

const groupedHistory = computed<TimeGroup[]>(() => {
  const entries = filteredHistory.value
  if (entries.length === 0) return []

  const now = new Date()
  const today = new Date(now.getFullYear(), now.getMonth(), now.getDate()).getTime()
  const yesterday = today - 86400000
  const week = today - 7 * 86400000

  const groups: TimeGroup[] = [
    { label: '今天', entries: [] },
    { label: '昨天', entries: [] },
    { label: '最近7天', entries: [] },
    { label: '更早', entries: [] },
  ]

  for (const entry of entries) {
    if (entry.timestamp >= today) {
      groups[0].entries.push(entry)
    } else if (entry.timestamp >= yesterday) {
      groups[1].entries.push(entry)
    } else if (entry.timestamp >= week) {
      groups[2].entries.push(entry)
    } else {
      groups[3].entries.push(entry)
    }
  }

  return groups.filter(g => g.entries.length > 0)
})

function statusColor(status: number): string {
  if (status >= 200 && status < 300) return 'success'
  if (status >= 300 && status < 400) return 'redirect'
  if (status >= 400 && status < 500) return 'client-error'
  if (status >= 500) return 'server-error'
  return 'error'
}

function durationColor(duration: number): string {
  if (duration < 1000) return 'fast'
  if (duration < 3000) return 'medium'
  return 'slow'
}

function formatDuration(ms: number): string {
  if (ms < 1000) return `${ms}ms`
  return `${(ms / 1000).toFixed(1)}s`
}

function relativeTime(ts: number): string {
  const diff = Date.now() - ts
  if (diff < 60000) return '刚刚'
  if (diff < 3600000) return `${Math.floor(diff / 60000)}分钟前`
  if (diff < 86400000) return `${Math.floor(diff / 3600000)}小时前`
  const d = new Date(ts)
  const now = new Date()
  if (d.toDateString() === new Date(now.getTime() - 86400000).toDateString()) return '昨天'
  return d.toLocaleDateString()
}

function getHistoryApiMeta(entry: HistoryEntry): { name: string; path: string } {
  const api = store.apis[entry.apiId]
  const interfaceNode = workspace.interfaces.find(item => item.id === entry.interfaceId || item.apiId === entry.apiId)
  const module = workspace.modules.find(item => item.id === (entry.moduleId || interfaceNode?.moduleId))
  const category = module ? workspace.categories.find(item => item.id === module.categoryId) : null
  return {
    name: api?.name ?? interfaceNode?.name ?? '',
    path: [category?.name, module?.name].filter(Boolean).join(' / '),
  }
}

function loadFromHistory(entry: HistoryEntry) {
  const interfaceNode = workspace.interfaces.find(item => item.id === entry.interfaceId || item.apiId === entry.apiId)
  workspace.selectInterface(interfaceNode?.id ?? entry.apiId)
  store.currentApiId = entry.apiId
}

function toggleStar(entry: HistoryEntry, e: MouseEvent) {
  e.stopPropagation()
  store.toggleStar(entry.id)
}

function handleContextMenu(entry: HistoryEntry, e: MouseEvent) {
  e.preventDefault()
  contextMenu.value = { x: e.clientX, y: e.clientY, entry }
}

function closeContextMenu() {
  contextMenu.value = null
}

function deleteEntry() {
  if (!contextMenu.value) return
  store.deleteHistoryEntry(contextMenu.value.entry.id)
  contextMenu.value = null
}

function toggleStarFromMenu() {
  if (!contextMenu.value) return
  store.toggleStar(contextMenu.value.entry.id)
  contextMenu.value = null
}

function buildApiConfigFromHistory(entry: HistoryEntry): ApiConfig {
  const headers: ApiConfig['headers'] = Object.entries(entry.requestHeaders || {}).map(
    ([key, value]) => ({ key, value, enabled: true })
  )
  const bodyType = entry.requestBody ? 'raw' as const : 'none' as const
  return {
    id: entry.apiId,
    name: '',
    method: entry.method as HttpMethod,
    url: entry.url,
    headers,
    params: [],
    cookies: [],
    body: {
      type: bodyType,
      raw: entry.requestBody || '',
      formData: [],
      urlEncoded: [],
      binaryFile: null,
      contentType: '',
    },
    auth: {
      type: 'none',
      bearerToken: '',
      basicUsername: '',
      basicPassword: '',
      apiKeyName: '',
      apiKeyValue: '',
      apiKeyIn: 'header',
    },
    preRequestScript: '',
    postRequestScript: '',
    folder: null,
    createdAt: entry.timestamp,
    updatedAt: entry.timestamp,
  }
}

async function copyCurl() {
  if (!contextMenu.value) return
  const entry = contextMenu.value.entry
  const api = store.apis[entry.apiId]
  const config = api || buildApiConfigFromHistory(entry)
  const envVars = store.getEnvVariables()
  const cmd = generateCurl(config, envVars)
  try {
    await navigator.clipboard.writeText(cmd)
    showToast('已复制')
  } catch {
    showToast('复制失败')
  }
  contextMenu.value = null
}

async function handleClearHistory() {
  const confirmed = await dialog.confirm({
    title: '清空历史记录',
    message: `将删除当前 ${store.history.length} 条历史记录，此操作不可撤销。`,
    confirmText: '清空',
    danger: true,
  })
  if (confirmed) {
    store.clearHistory()
  }
}

function showToast(msg: string) {
  toast.value = msg
  setTimeout(() => { toast.value = '' }, 1500)
}
</script>

<template>
  <div class="history-panel" @click="closeContextMenu">
    <div class="history-header">
      <input v-model="searchQuery" type="text" placeholder="搜索历史..." class="history-search" />
      <div class="filter-bar">
        <button
          v-for="f in ([
            { key: 'all', label: '全部' },
            { key: 'starred', label: '收藏' },
            { key: 'success', label: '成功' },
            { key: 'fail', label: '失败' },
          ] as const)"
          :key="f.key"
          :class="['filter-btn', { active: activeFilter === f.key }]"
          @click="activeFilter = f.key"
        >{{ f.label }}</button>
      </div>
      <button class="btn btn-sm clear-btn" @click="handleClearHistory" v-if="store.history.length > 0">清空</button>
    </div>
    <div class="history-list">
      <template v-for="group in groupedHistory" :key="group.label">
        <div class="time-group-label">{{ group.label }}</div>
        <div
          v-for="entry in group.entries"
          :key="entry.id"
          class="history-item"
          @click="loadFromHistory(entry)"
          @contextmenu="handleContextMenu(entry, $event)"
        >
          <button
            :class="['star-btn', { starred: entry.starred }]"
            @click="toggleStar(entry, $event)"
            title="收藏"
          >{{ entry.starred ? '★' : '☆' }}</button>
          <span :class="['method-badge', entry.method.toLowerCase()]">{{ entry.method }}</span>
          <span
            v-if="getHistoryApiMeta(entry).name"
            class="history-api-name"
            :title="getHistoryApiMeta(entry).path"
          >{{ getHistoryApiMeta(entry).name }}</span>
          <span class="history-url" :title="entry.url">{{ entry.url }}</span>
          <span :class="['history-status', statusColor(entry.status)]">{{ entry.status }}</span>
          <span :class="['history-duration', durationColor(entry.duration)]">{{ formatDuration(entry.duration) }}</span>
          <span class="history-time">{{ relativeTime(entry.timestamp) }}</span>
        </div>
      </template>
      <div v-if="filteredHistory.length === 0" class="history-empty">
        {{ store.history.length === 0 ? '暂无历史记录' : '无匹配结果' }}
      </div>
    </div>
    <div v-if="contextMenu" class="context-menu" :style="{ left: contextMenu.x + 'px', top: contextMenu.y + 'px' }">
      <button class="ctx-item" @click="deleteEntry">删除记录</button>
      <button class="ctx-item" @click="toggleStarFromMenu">{{ contextMenu.entry.starred ? '取消收藏' : '收藏' }}</button>
      <button class="ctx-item" @click="copyCurl">复制 cURL</button>
    </div>
    <Transition name="toast">
      <div v-if="toast" class="toast-msg">{{ toast }}</div>
    </Transition>
  </div>
</template>

<style scoped>
.history-panel {
  display: flex;
  flex-direction: column;
  height: 100%;
  position: relative;
  background: var(--bg-panel);
}

.history-header {
  display: flex;
  flex-direction: column;
  gap: 6px;
  padding: 12px;
  border-bottom: 1px solid var(--divider);
  background:
    linear-gradient(180deg, color-mix(in srgb, var(--primary-light) 40%, var(--bg-panel)), var(--bg-panel));
}

.history-search {
  width: 100%;
  height: 32px;
  font-size: var(--font-size-small);
  border-radius: 999px;
}

.filter-bar {
  display: flex;
  gap: 4px;
}

.filter-btn {
  padding: 4px 9px;
  border: 1px solid var(--border);
  border-radius: 999px;
  background: var(--bg-panel);
  color: var(--text-secondary);
  cursor: pointer;
  font-size: var(--font-size-small);
  font-weight: 700;
  transition: all 0.15s;
}

.filter-btn:hover {
  background: var(--bg-hover);
}

.filter-btn.active {
  background: var(--primary-soft);
  color: var(--primary);
  border-color: var(--primary);
}

.clear-btn {
  align-self: flex-end;
}

.history-list {
  flex: 1;
  overflow-y: auto;
  padding: 4px 0;
}

.time-group-label {
  padding: 6px 12px 2px;
  font-size: var(--font-size-small);
  font-weight: 600;
  color: var(--text-tertiary);
  text-transform: uppercase;
  letter-spacing: 0.5px;
  position: sticky;
  top: 0;
  background: var(--bg-panel);
  z-index: 1;
}

.history-item {
  display: flex;
  align-items: center;
  gap: 6px;
  padding: 8px 12px;
  cursor: pointer;
  font-size: var(--font-size-body);
  border-bottom: 1px solid var(--divider);
  transition: background 0.15s ease, transform 0.15s ease;
}

.history-item:hover {
  background: var(--bg-hover);
  transform: translateX(1px);
}

.star-btn {
  background: none;
  border: none;
  cursor: pointer;
  padding: 0;
  font-size: 14px;
  line-height: 1;
  color: var(--text-tertiary);
  flex-shrink: 0;
  transition: color 0.15s;
}

.star-btn:hover {
  color: var(--warning);
}

.star-btn.starred {
  color: var(--warning);
}

.history-api-name {
  max-width: 140px;
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
  color: var(--text-secondary);
  font-size: var(--font-size-small);
  min-width: 0;
}

.history-url {
  flex: 1;
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
  font-family: var(--font-code);
  font-size: var(--font-size-small);
  min-width: 0;
}

.history-status {
  font-weight: 600;
  font-size: var(--font-size-small);
  min-width: 28px;
  text-align: right;
  flex-shrink: 0;
}

.history-status.success { color: var(--success); }
.history-status.redirect { color: var(--info); }
.history-status.client-error { color: var(--warning); }
.history-status.server-error { color: var(--error); }
.history-status.error { color: var(--error); }

.history-duration {
  font-size: var(--font-size-small);
  min-width: 40px;
  text-align: right;
  flex-shrink: 0;
}

.history-duration.fast { color: var(--success); }
.history-duration.medium { color: var(--warning); }
.history-duration.slow { color: var(--error); }

.history-time {
  color: var(--text-tertiary);
  font-size: var(--font-size-small);
  min-width: 50px;
  text-align: right;
  flex-shrink: 0;
}

.history-empty {
  padding: 20px;
  text-align: center;
  color: var(--text-tertiary);
}

.context-menu {
  position: fixed;
  background: var(--bg-panel);
  border: 1px solid var(--border);
  border-radius: var(--radius-lg);
  box-shadow: var(--shadow-lg);
  z-index: 1000;
  min-width: 120px;
  padding: 4px 0;
  overflow: hidden;
}

.ctx-item {
  display: block;
  width: 100%;
  padding: 6px 12px;
  border: none;
  background: none;
  text-align: left;
  cursor: pointer;
  font-size: var(--font-size-body);
  color: var(--text-primary);
}

.ctx-item:hover {
  background: var(--bg-hover);
}

.toast-msg {
  position: absolute;
  bottom: 16px;
  left: 50%;
  transform: translateX(-50%);
  background: var(--text-primary);
  color: var(--bg-panel);
  padding: 6px 16px;
  border-radius: var(--radius-md);
  font-size: var(--font-size-small);
  pointer-events: none;
  z-index: 1001;
}

.toast-enter-active,
.toast-leave-active {
  transition: opacity 0.2s;
}

.toast-enter-from,
.toast-leave-to {
  opacity: 0;
}
</style>
