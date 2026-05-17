<script setup lang="ts">
import { ref, computed } from 'vue'
import { ArrowLeftRight, Star, X } from '@lucide/vue'
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

// --- Bulk select ---
const bulkMode = ref(false)
const selectedIds = ref<Set<string>>(new Set())

function toggleBulkMode() {
  bulkMode.value = !bulkMode.value
  if (!bulkMode.value) {
    selectedIds.value.clear()
  }
}

function toggleSelectEntry(id: string, e: Event) {
  const checked = (e.target as HTMLInputElement).checked
  e.stopPropagation()
  if (selectedIds.value.has(id)) {
    selectedIds.value.delete(id)
  } else {
    selectedIds.value.add(id)
  }
}

function toggleSelectAll() {
  const allIds = filteredHistory.value.map(h => h.id)
  const allSelected = allIds.every(id => selectedIds.value.has(id))
  if (allSelected) {
    selectedIds.value.clear()
  } else {
    for (const id of allIds) {
      selectedIds.value.add(id)
    }
  }
}

function deleteSelected() {
  const ids = Array.from(selectedIds.value)
  if (ids.length === 0) return
  for (const id of ids) {
    store.deleteHistoryEntry(id)
  }
  selectedIds.value.clear()
  showToast(`已删除 ${ids.length} 条记录`)
}

const isAllSelected = computed(() => {
  const allIds = filteredHistory.value.map(h => h.id)
  return allIds.length > 0 && allIds.every(id => selectedIds.value.has(id))
})

// --- Diff comparison ---
const compareBase = ref<HistoryEntry | null>(null)
const showDiffModal = ref(false)
const diffEntryA = ref<HistoryEntry | null>(null)
const diffEntryB = ref<HistoryEntry | null>(null)

interface DiffRow {
  type: 'added' | 'removed' | 'changed' | 'same'
  path: string
  before: string
  after: string
}

function flattenJson(value: unknown, prefix = '$', out: Record<string, unknown> = {}): Record<string, unknown> {
  if (value && typeof value === 'object') {
    if (Array.isArray(value)) {
      value.forEach((item, index) => flattenJson(item, `${prefix}[${index}]`, out))
    } else {
      for (const [key, child] of Object.entries(value as Record<string, unknown>)) {
        flattenJson(child, `${prefix}.${key}`, out)
      }
    }
  } else {
    out[prefix] = value
  }
  return out
}

function formatDiffValue(value: unknown): string {
  if (value === undefined) return ''
  if (typeof value === 'string') return value
  return JSON.stringify(value)
}

function computeDiff(bodyA: string | null, bodyB: string | null): DiffRow[] {
  const textA = bodyA || ''
  const textB = bodyB || ''
  try {
    const before = flattenJson(JSON.parse(textA))
    const after = flattenJson(JSON.parse(textB))
    const paths = Array.from(new Set([...Object.keys(before), ...Object.keys(after)])).sort()
    return paths.map(path => {
      const hasBefore = Object.prototype.hasOwnProperty.call(before, path)
      const hasAfter = Object.prototype.hasOwnProperty.call(after, path)
      const beforeValue = formatDiffValue(before[path])
      const afterValue = formatDiffValue(after[path])
      const type: DiffRow['type'] = !hasBefore ? 'added' : !hasAfter ? 'removed' : beforeValue !== afterValue ? 'changed' : 'same'
      return { type, path, before: beforeValue, after: afterValue }
    }).filter(row => row.type !== 'same')
  } catch {
    const beforeLines = textA.split('\n')
    const afterLines = textB.split('\n')
    const max = Math.max(beforeLines.length, afterLines.length)
    const rows: DiffRow[] = []
    for (let index = 0; index < max; index++) {
      const before = beforeLines[index]
      const after = afterLines[index]
      if (before === after) continue
      rows.push({
        type: before === undefined ? 'added' : after === undefined ? 'removed' : 'changed',
        path: `line ${index + 1}`,
        before: before ?? '',
        after: after ?? '',
      })
    }
    return rows
  }
}

const diffRows = computed<DiffRow[]>(() => {
  const a = diffEntryA.value
  const b = diffEntryB.value
  if (!a || !b) return []
  return computeDiff(a.requestBody, b.requestBody)
})

const diffMetaRows = computed(() => {
  const a = diffEntryA.value
  const b = diffEntryB.value
  if (!a || !b) return []
  const rows: DiffRow[] = []
  if (a.status !== b.status) {
    rows.push({ type: 'changed', path: 'status', before: String(a.status), after: String(b.status) })
  }
  if (a.duration !== b.duration) {
    rows.push({ type: 'changed', path: 'duration', before: `${a.duration}ms`, after: `${b.duration}ms` })
  }
  if (a.responseSize !== b.responseSize) {
    rows.push({ type: 'changed', path: 'size', before: formatSize(a.responseSize), after: formatSize(b.responseSize) })
  }
  // Header diff
  const headersA = a.requestHeaders || {}
  const headersB = b.requestHeaders || {}
  const allHeaderKeys = Array.from(new Set([...Object.keys(headersA), ...Object.keys(headersB)])).sort()
  for (const key of allHeaderKeys) {
    const hasA = Object.prototype.hasOwnProperty.call(headersA, key)
    const hasB = Object.prototype.hasOwnProperty.call(headersB, key)
    const valA = headersA[key] ?? ''
    const valB = headersB[key] ?? ''
    if (!hasA) {
      rows.push({ type: 'added', path: `header.${key}`, before: '', after: valB })
    } else if (!hasB) {
      rows.push({ type: 'removed', path: `header.${key}`, before: valA, after: '' })
    } else if (valA !== valB) {
      rows.push({ type: 'changed', path: `header.${key}`, before: valA, after: valB })
    }
  }
  return rows
})

function startCompare(entry: HistoryEntry) {
  if (!compareBase.value) {
    compareBase.value = entry
    contextMenu.value = null
    showToast('已选择基准记录，请选择第二条记录进行对比')
    return
  }
  // Second click: open diff
  diffEntryA.value = compareBase.value
  diffEntryB.value = entry
  compareBase.value = null
  showDiffModal.value = true
  contextMenu.value = null
}

function cancelCompare() {
  compareBase.value = null
}

function closeDiffModal() {
  showDiffModal.value = false
  diffEntryA.value = null
  diffEntryB.value = null
}

// --- Re-send from history ---
function resendFromHistory(entry: HistoryEntry) {
  const interfaceNode = workspace.interfaces.find(item => item.id === entry.interfaceId || item.apiId === entry.apiId)
  workspace.selectInterface(interfaceNode?.id ?? entry.apiId)
  store.currentApiId = entry.apiId
  contextMenu.value = null
  // Trigger send after a microtask to allow state to settle
  setTimeout(() => {
    window.dispatchEvent(new CustomEvent('apifix:send-current-request'))
  }, 0)
  showToast('正在重新发送请求...')
}

// --- Existing logic ---
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

function formatSize(bytes: number): string {
  if (bytes > 1024 * 1024) return `${(bytes / 1024 / 1024).toFixed(1)}MB`
  if (bytes > 1024) return `${(bytes / 1024).toFixed(1)}KB`
  return `${bytes}B`
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
  if (bulkMode.value) {
    toggleSelectEntry(entry.id, new MouseEvent('click'))
    return
  }
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
      digestUsername: '',
      digestPassword: '',
      oauth2GrantType: 'authorization_code',
      oauth2AccessTokenUrl: '',
      oauth2ClientId: '',
      oauth2ClientSecret: '',
      oauth2Scope: '',
      oauth2Token: '',
      oauth2Username: '',
      oauth2Password: '',
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

function escapeHtml(value: string): string {
  return value
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#39;')
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
        <button
          :class="['filter-btn', { active: bulkMode }]"
          @click="toggleBulkMode"
        >选择</button>
      </div>
      <div class="header-actions">
        <template v-if="bulkMode && selectedIds.size > 0">
          <button class="btn btn-sm danger-btn" @click="deleteSelected">删除选中 ({{ selectedIds.size }})</button>
        </template>
        <button class="btn btn-sm clear-btn" @click="handleClearHistory" v-if="store.history.length > 0 && !bulkMode">清空</button>
      </div>
      <!-- Compare base indicator -->
      <div v-if="compareBase" class="compare-banner">
        <span>已选择基准: {{ compareBase.method }} {{ compareBase.url }}</span>
        <button class="compare-cancel" @click="cancelCompare">取消</button>
      </div>
    </div>
    <div class="history-list">
      <!-- Bulk select header -->
      <div v-if="bulkMode && filteredHistory.length > 0" class="bulk-header">
        <label class="bulk-checkbox">
          <input type="checkbox" :checked="isAllSelected" @change="toggleSelectAll" />
          <span>全选</span>
        </label>
        <span class="bulk-count">{{ selectedIds.size }} / {{ filteredHistory.length }}</span>
      </div>
      <template v-for="group in groupedHistory" :key="group.label">
        <div class="time-group-label">{{ group.label }}</div>
        <div
          v-for="entry in group.entries"
          :key="entry.id"
          :class="[
            'history-item',
            { 'compare-base': compareBase?.id === entry.id, 'bulk-selected': selectedIds.has(entry.id) },
          ]"
          @click="loadFromHistory(entry)"
          @contextmenu="handleContextMenu(entry, $event)"
        >
          <label v-if="bulkMode" class="entry-checkbox" @click.stop>
            <input type="checkbox" :checked="selectedIds.has(entry.id)" @change="toggleSelectEntry(entry.id, $event)" />
          </label>
          <button
            v-if="!bulkMode"
            :class="['star-btn', { starred: entry.starred }]"
            @click="toggleStar(entry, $event)"
            title="收藏"
          ><Star :size="15" :fill="entry.starred ? 'currentColor' : 'none'" /></button>
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
      <button class="ctx-item" @click="startCompare(contextMenu.entry)">对比</button>
      <button class="ctx-item ctx-item-primary" @click="resendFromHistory(contextMenu.entry)">重新发送</button>
    </div>

    <!-- Diff comparison modal -->
    <div v-if="showDiffModal" class="diff-overlay" @click.self="closeDiffModal">
      <div class="diff-modal">
        <div class="diff-modal-header">
          <h3>历史记录对比</h3>
          <button class="diff-close-btn" @click="closeDiffModal" aria-label="关闭"><X :size="16" /></button>
        </div>
        <div class="diff-summary">
          <div class="diff-entry-card">
            <div class="diff-card-label">基准</div>
            <div class="diff-card-method">{{ diffEntryA?.method }}</div>
            <div class="diff-card-url">{{ diffEntryA?.url }}</div>
            <div class="diff-card-meta">
              <span :class="['history-status', statusColor(diffEntryA?.status ?? 0)]">{{ diffEntryA?.status }}</span>
              <span>{{ formatDuration(diffEntryA?.duration ?? 0) }}</span>
              <span>{{ formatSize(diffEntryA?.responseSize ?? 0) }}</span>
            </div>
          </div>
          <div class="diff-arrow"><ArrowLeftRight :size="22" /></div>
          <div class="diff-entry-card">
            <div class="diff-card-label">对比</div>
            <div class="diff-card-method">{{ diffEntryB?.method }}</div>
            <div class="diff-card-url">{{ diffEntryB?.url }}</div>
            <div class="diff-card-meta">
              <span :class="['history-status', statusColor(diffEntryB?.status ?? 0)]">{{ diffEntryB?.status }}</span>
              <span>{{ formatDuration(diffEntryB?.duration ?? 0) }}</span>
              <span>{{ formatSize(diffEntryB?.responseSize ?? 0) }}</span>
            </div>
          </div>
        </div>
        <div class="diff-body">
          <div v-if="diffMetaRows.length > 0" class="diff-section">
            <div class="diff-section-title">请求元信息</div>
            <table class="diff-table">
              <thead><tr><th>类型</th><th>路径</th><th>基准</th><th>对比</th></tr></thead>
              <tbody>
                <tr v-for="row in diffMetaRows" :key="row.path" :class="`diff-${row.type}`">
                  <td class="diff-type-cell">{{ row.type === 'added' ? '新增' : row.type === 'removed' ? '删除' : '变更' }}</td>
                  <td class="diff-path">{{ row.path }}</td>
                  <td class="diff-value">{{ row.before }}</td>
                  <td class="diff-value">{{ row.after }}</td>
                </tr>
              </tbody>
            </table>
          </div>
          <div class="diff-section">
            <div class="diff-section-title">请求体差异</div>
            <div v-if="diffRows.length === 0" class="diff-empty">请求体无可见差异</div>
            <table v-else class="diff-table">
              <thead><tr><th>类型</th><th>路径</th><th>基准</th><th>对比</th></tr></thead>
              <tbody>
                <tr v-for="row in diffRows" :key="row.path" :class="`diff-${row.type}`">
                  <td class="diff-type-cell">{{ row.type === 'added' ? '新增' : row.type === 'removed' ? '删除' : '变更' }}</td>
                  <td class="diff-path">{{ row.path }}</td>
                  <td class="diff-value">{{ row.before }}</td>
                  <td class="diff-value">{{ row.after }}</td>
                </tr>
              </tbody>
            </table>
          </div>
        </div>
      </div>
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
  flex-wrap: wrap;
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

.header-actions {
  display: flex;
  justify-content: flex-end;
  gap: 6px;
}

.clear-btn {
  align-self: flex-end;
}

.danger-btn {
  background: var(--error);
  color: #fff;
  border-color: var(--error);
}

.danger-btn:hover {
  opacity: 0.9;
}

/* Compare banner */
.compare-banner {
  display: flex;
  align-items: center;
  justify-content: space-between;
  padding: 4px 10px;
  background: color-mix(in srgb, var(--primary) 10%, var(--bg-panel));
  border: 1px solid var(--primary);
  border-radius: var(--radius-md);
  font-size: var(--font-size-small);
  color: var(--primary);
  gap: 8px;
}

.compare-banner span {
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
  flex: 1;
  min-width: 0;
}

.compare-cancel {
  border: none;
  background: none;
  color: var(--text-tertiary);
  cursor: pointer;
  font-size: var(--font-size-small);
  padding: 2px 6px;
  border-radius: var(--radius-sm);
  flex-shrink: 0;
}

.compare-cancel:hover {
  color: var(--error);
  background: var(--bg-hover);
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

.history-item.compare-base {
  border-left: 3px solid var(--primary);
  background: color-mix(in srgb, var(--primary) 6%, var(--bg-panel));
}

.history-item.bulk-selected {
  background: color-mix(in srgb, var(--primary) 8%, var(--bg-panel));
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

/* Bulk select */
.bulk-header {
  display: flex;
  align-items: center;
  justify-content: space-between;
  padding: 6px 12px;
  background: var(--bg-panel-elevated);
  border-bottom: 1px solid var(--divider);
  position: sticky;
  top: 0;
  z-index: 2;
}

.bulk-checkbox {
  display: flex;
  align-items: center;
  gap: 6px;
  cursor: pointer;
  font-size: var(--font-size-small);
  color: var(--text-secondary);
}

.bulk-checkbox input {
  cursor: pointer;
}

.bulk-count {
  font-size: var(--font-size-small);
  color: var(--text-tertiary);
}

.entry-checkbox {
  display: flex;
  align-items: center;
  cursor: pointer;
  flex-shrink: 0;
}

.entry-checkbox input {
  cursor: pointer;
}

/* Context menu */
.context-menu {
  position: fixed;
  background: var(--bg-panel);
  border: 1px solid var(--border);
  border-radius: var(--radius-lg);
  box-shadow: var(--shadow-lg);
  z-index: 1000;
  min-width: 140px;
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

.ctx-item-primary {
  color: var(--primary);
  font-weight: 600;
}

.ctx-item-primary:hover {
  background: var(--primary-soft);
}

/* Diff modal */
.diff-overlay {
  position: fixed;
  inset: 0;
  background: rgba(2, 6, 23, 0.5);
  backdrop-filter: blur(8px);
  display: flex;
  align-items: center;
  justify-content: center;
  z-index: 1003;
}

.diff-modal {
  background: var(--bg-panel);
  border: 1px solid var(--border);
  border-radius: var(--radius-2xl);
  width: 720px;
  max-width: calc(100vw - 28px);
  max-height: 80vh;
  display: flex;
  flex-direction: column;
  box-shadow: var(--shadow-lg);
  overflow: hidden;
}

.diff-modal-header {
  display: flex;
  align-items: center;
  justify-content: space-between;
  padding: 14px 18px;
  border-bottom: 1px solid var(--divider);
}

.diff-modal-header h3 {
  margin: 0;
  font-size: 16px;
  color: var(--text-primary);
}

.diff-close-btn {
  border: none;
  background: none;
  font-size: 20px;
  color: var(--text-tertiary);
  cursor: pointer;
  padding: 2px 8px;
  border-radius: var(--radius-sm);
  line-height: 1;
}

.diff-close-btn:hover {
  color: var(--text-primary);
  background: var(--bg-hover);
}

.diff-summary {
  display: flex;
  align-items: center;
  gap: 12px;
  padding: 14px 18px;
  border-bottom: 1px solid var(--divider);
  background: var(--bg-panel-elevated);
}

.diff-entry-card {
  flex: 1;
  padding: 10px 12px;
  border: 1px solid var(--border);
  border-radius: var(--radius-lg);
  background: var(--bg-panel);
  min-width: 0;
}

.diff-card-label {
  font-size: 11px;
  font-weight: 600;
  color: var(--text-tertiary);
  text-transform: uppercase;
  letter-spacing: 0.5px;
  margin-bottom: 4px;
}

.diff-card-method {
  font-weight: 700;
  font-size: var(--font-size-small);
  color: var(--primary);
}

.diff-card-url {
  font-family: var(--font-code);
  font-size: var(--font-size-small);
  color: var(--text-secondary);
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
  margin: 4px 0;
}

.diff-card-meta {
  display: flex;
  gap: 8px;
  font-size: var(--font-size-small);
  color: var(--text-tertiary);
}

.diff-arrow {
  font-size: 20px;
  color: var(--text-tertiary);
  flex-shrink: 0;
}

.diff-body {
  flex: 1;
  overflow-y: auto;
  padding: 14px 18px;
}

.diff-section {
  margin-bottom: 16px;
}

.diff-section-title {
  font-size: var(--font-size-small);
  font-weight: 700;
  color: var(--text-secondary);
  margin-bottom: 8px;
  text-transform: uppercase;
  letter-spacing: 0.5px;
}

.diff-table {
  width: 100%;
  border-collapse: collapse;
  font-size: var(--font-size-small);
  background: var(--bg-panel);
}

.diff-table th,
.diff-table td {
  border: 1px solid var(--divider);
  padding: 5px 8px;
  text-align: left;
  vertical-align: top;
  max-width: 280px;
  word-break: break-word;
}

.diff-table th {
  position: sticky;
  top: 0;
  z-index: 1;
  background: var(--bg-panel-elevated);
  color: var(--text-secondary);
}

.diff-path {
  font-family: var(--font-code);
  color: var(--text-secondary);
  min-width: 120px;
}

.diff-type-cell {
  font-weight: 600;
  min-width: 40px;
}

.diff-value {
  font-family: var(--font-code);
  font-size: 12px;
}

.diff-added td { background: color-mix(in srgb, var(--success) 10%, var(--bg-panel)); }
.diff-removed td { background: color-mix(in srgb, var(--error) 10%, var(--bg-panel)); }
.diff-changed td { background: color-mix(in srgb, var(--warning) 12%, var(--bg-panel)); }

.diff-empty {
  padding: 16px;
  text-align: center;
  color: var(--text-tertiary);
  font-size: var(--font-size-small);
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
