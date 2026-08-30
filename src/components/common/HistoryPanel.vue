<script setup lang="ts">
import { computed, ref } from 'vue'
import { Star, Trash2, Zap } from '@lucide/vue'
import { useAppStore } from '@/stores/app'
import { useWorkspaceStore } from '@/stores/workspace'
import { useDialog } from '@/composables/useDialog'
import { openContextMenu } from '@/composables/useContextMenu'
import { toast } from 'vue-sonner'
import type { HistoryEntry } from '@/types'

/**
 * 历史面板(FR-4.1/4.2,参考 Hoppscotch history/index.vue + rest/Card.vue):
 * 分组切换 时间(默认)/域名;状态筛选 全部/成功/失败;文本过滤;
 * 分组标题 hover 出分组删除;卡片 = method 色块 + URL + 相对时间,
 * 右键菜单(恢复/复制 URL/删除),流式徽章悬停显示合并文本。
 */
const store = useAppStore()
const workspace = useWorkspaceStore()
const dialog = useDialog()

const searchQuery = ref('')
const groupMode = ref<'time' | 'domain'>('time')
const statusFilter = ref<'all' | 'success' | 'fail'>('all')
const starredOnly = ref(false)

const filteredHistory = computed(() => {
  let list = store.history
  if (starredOnly.value) list = list.filter(h => h.starred)
  if (statusFilter.value === 'success') list = list.filter(h => h.status >= 200 && h.status < 400)
  else if (statusFilter.value === 'fail') list = list.filter(h => h.status === 0 || h.status >= 400)
  if (searchQuery.value.trim()) {
    const q = searchQuery.value.toLowerCase()
    list = list.filter(h =>
      h.url.toLowerCase().includes(q)
      || h.method.toLowerCase().includes(q)
      || h.status.toString().includes(q))
  }
  return list
})

interface HistoryGroup { key: string; label: string; entries: HistoryEntry[] }

const groupedHistory = computed<HistoryGroup[]>(() => {
  const entries = filteredHistory.value
  if (!entries.length) return []

  if (groupMode.value === 'domain') {
    const byDomain = new Map<string, HistoryEntry[]>()
    for (const entry of entries) {
      const domain = domainOf(entry)
      if (!byDomain.has(domain)) byDomain.set(domain, [])
      byDomain.get(domain)!.push(entry)
    }
    return [...byDomain.entries()]
      .sort((a, b) => a[0].localeCompare(b[0]))
      .map(([domain, items]) => ({ key: `domain:${domain}`, label: domain, entries: items }))
  }

  const now = new Date()
  const today = new Date(now.getFullYear(), now.getMonth(), now.getDate()).getTime()
  const yesterday = today - 86_400_000
  const week = today - 7 * 86_400_000
  const groups: HistoryGroup[] = [
    { key: 'today', label: '今天', entries: [] },
    { key: 'yesterday', label: '昨天', entries: [] },
    { key: 'week', label: '最近7天', entries: [] },
    { key: 'earlier', label: '更早', entries: [] },
  ]
  for (const entry of entries) {
    if (entry.timestamp >= today) groups[0].entries.push(entry)
    else if (entry.timestamp >= yesterday) groups[1].entries.push(entry)
    else if (entry.timestamp >= week) groups[2].entries.push(entry)
    else groups[3].entries.push(entry)
  }
  return groups.filter(g => g.entries.length > 0)
})

function domainOf(entry: HistoryEntry): string {
  const trimmed = entry.url.trim()
  try {
    if (/^[a-z][a-z\d+.-]*:\/\//i.test(trimmed)) return new URL(trimmed).host || '(其他)'
  } catch { /* fallthrough */ }
  return '(其他)'
}

async function deleteGroup(group: HistoryGroup) {
  const ok = await dialog.confirm({
    title: '删除分组记录',
    message: `确认删除「${group.label}」分组的 ${group.entries.length} 条记录?此操作不可撤销。`,
    confirmText: '删除',
    danger: true,
  })
  if (!ok) return
  for (const entry of group.entries) store.deleteHistoryEntry(entry.id)
  toast.success(`已删除 ${group.entries.length} 条记录`)
}

async function clearAll() {
  const ok = await dialog.confirm({
    title: '清空历史记录',
    message: `将删除当前 ${store.history.length} 条历史记录,此操作不可撤销。`,
    confirmText: '清空',
    danger: true,
  })
  if (ok) {
    store.clearHistory()
    toast.success('历史已清空')
  }
}

// ── 卡片 ──
function statusColor(status: number): string {
  if (status >= 200 && status < 300) return 'var(--status-success-color)'
  if (status >= 300 && status < 400) return 'var(--status-redirect-color)'
  if (status >= 400 && status < 500) return 'var(--status-critical-error-color)'
  if (status >= 500) return 'var(--status-server-error-color)'
  return 'var(--status-missing-data-color)'
}

function methodColor(method: string): string {
  const colors: Record<string, string> = {
    GET: 'var(--method-get-color)',
    POST: 'var(--method-post-color)',
    PUT: 'var(--method-put-color)',
    DELETE: 'var(--method-delete-color)',
    PATCH: 'var(--method-patch-color)',
    HEAD: 'var(--method-head-color)',
    OPTIONS: 'var(--method-options-color)',
  }
  return colors[method?.toUpperCase()] || 'var(--method-default-color)'
}

function relativeTime(ts: number): string {
  const diff = Date.now() - ts
  if (diff < 60_000) return '刚刚'
  if (diff < 3_600_000) return `${Math.floor(diff / 60_000)}分钟前`
  if (diff < 86_400_000) return `${Math.floor(diff / 3_600_000)}小时前`
  const d = new Date(ts)
  if (d.toDateString() === new Date(Date.now() - 86_400_000).toDateString()) return '昨天'
  return d.toLocaleDateString()
}

function displayUrl(entry: HistoryEntry): string {
  const trimmed = entry.url.trim()
  if (!trimmed) return '/'
  try {
    if (/^[a-z][a-z\d+.-]*:\/\//i.test(trimmed)) {
      const parsed = new URL(trimmed)
      return `${parsed.host}${parsed.pathname === '/' ? '' : parsed.pathname}${parsed.search}`
    }
  } catch { /* fallthrough */ }
  return trimmed
}

function restoreEntry(entry: HistoryEntry) {
  const interfaceNode = workspace.interfaces.find(item => item.id === entry.interfaceId || item.apiId === entry.apiId)
  workspace.selectInterface(interfaceNode?.id ?? entry.apiId)
  store.openApiInTab(entry.apiId)
}

function entryMenu(event: MouseEvent, entry: HistoryEntry) {
  openContextMenu(event, [
    { key: 'restore', label: '恢复请求', handler: () => restoreEntry(entry) },
    { key: 'copy-url', label: '复制 URL', handler: () => { void navigator.clipboard.writeText(entry.url); toast.success('已复制 URL') } },
    { key: 'star', label: entry.starred ? '取消收藏' : '收藏', handler: () => store.toggleStar(entry.id) },
    { key: 'delete', label: '删除', danger: true, separatorBefore: true, handler: () => store.deleteHistoryEntry(entry.id) },
  ])
}
</script>

<template>
  <div class="history-panel">
    <!-- 工具栏(FR-4.1) -->
    <div class="history-toolbar">
      <input v-model="searchQuery" type="text" class="history-search" placeholder="过滤 URL、方法、状态…" spellcheck="false" />
      <div class="filter-row">
        <div class="segment">
          <button :class="{ active: groupMode === 'time' }" @click="groupMode = 'time'">时间</button>
          <button :class="{ active: groupMode === 'domain' }" @click="groupMode = 'domain'">域名</button>
        </div>
        <div class="segment">
          <button :class="{ active: statusFilter === 'all' }" @click="statusFilter = 'all'">全部</button>
          <button :class="{ active: statusFilter === 'success' }" @click="statusFilter = 'success'">成功</button>
          <button :class="{ active: statusFilter === 'fail' }" @click="statusFilter = 'fail'">失败</button>
        </div>
        <button :class="['star-toggle', { active: starredOnly }]" title="仅看收藏" @click="starredOnly = !starredOnly">
          <Star :size="13" />
        </button>
      </div>
      <button class="clear-all" @click="clearAll"><Trash2 :size="12" /> 清空全部</button>
    </div>

    <!-- 分组列表 -->
    <div class="history-list">
      <div v-for="group in groupedHistory" :key="group.key" class="history-group">
        <div class="group-header">
          <span class="group-label">{{ group.label }}</span>
          <span class="group-count">{{ group.entries.length }}</span>
          <button class="group-delete" title="删除该分组" @click="deleteGroup(group)"><Trash2 :size="12" /></button>
        </div>
        <div
          v-for="entry in group.entries"
          :key="entry.id"
          class="history-card"
          @click="restoreEntry(entry)"
          @contextmenu="entryMenu($event, entry)"
        >
          <span
            class="method-block"
            :style="{ color: methodColor(entry.method), backgroundColor: `color-mix(in srgb, ${methodColor(entry.method)} 12%, transparent)` }"
            :title="`${entry.method} · ${entry.duration}ms · ${entry.status} ${entry.statusText}`"
          >{{ entry.method.slice(0, 4) }}</span>
          <div class="card-main">
            <div class="card-url" :title="entry.url">{{ displayUrl(entry) }}</div>
            <div class="card-meta">
              <span class="card-status" :style="{ color: statusColor(entry.status) }">{{ entry.status }}</span>
              <span>·</span>
              <span>{{ entry.duration }}ms</span>
              <span>·</span>
              <span>{{ relativeTime(entry.timestamp) }}</span>
              <span v-if="entry.mergedText" class="stream-badge" :title="entry.mergedText">
                <Zap :size="10" /> 流式
              </span>
              <button class="star-btn" :class="{ on: entry.starred }" title="收藏" @click.stop="store.toggleStar(entry.id)">
                <Star :size="12" />
              </button>
            </div>
          </div>
        </div>
      </div>

      <div v-if="!groupedHistory.length" class="history-empty">
        <p>{{ store.history.length ? '没有匹配的记录' : '暂无历史记录' }}</p>
      </div>
    </div>
  </div>
</template>

<style scoped>
.history-panel {
  flex: 1;
  min-height: 0;
  display: flex;
  flex-direction: column;
  overflow: hidden;
}

.history-toolbar {
  display: flex;
  flex-direction: column;
  gap: 6px;
  padding: 8px;
  border-bottom: 1px solid var(--divider-color);
  flex-shrink: 0;
}

.history-search {
  height: 28px;
  font-size: var(--font-size-body);
}

.filter-row {
  display: flex;
  align-items: center;
  gap: 6px;
}

.segment {
  display: inline-flex;
  border: 1px solid var(--divider-dark-color);
  border-radius: var(--radius-md);
  overflow: hidden;
}

.segment button {
  padding: 3px 8px;
  background: transparent;
  color: var(--secondary-color);
  font-size: var(--font-size-tiny);
  border-right: 1px solid var(--divider-dark-color);
}

.segment button:last-child {
  border-right: none;
}

.segment button:hover {
  background: var(--primary-dark-color);
}

.segment button.active {
  background: color-mix(in srgb, var(--accent-color) 14%, transparent);
  color: var(--accent-color);
}

.star-toggle {
  display: inline-flex;
  align-items: center;
  justify-content: center;
  width: 26px;
  height: 24px;
  margin-left: auto;
  border: 1px solid var(--divider-dark-color);
  border-radius: var(--radius-md);
  color: var(--secondary-color);
}

.star-toggle.active {
  color: var(--status-redirect-color);
  border-color: var(--status-redirect-color);
}

.clear-all {
  display: inline-flex;
  align-items: center;
  gap: 4px;
  align-self: flex-start;
  padding: 3px 8px;
  border-radius: var(--radius-sm);
  color: var(--secondary-light-color);
  font-size: var(--font-size-tiny);
}

.clear-all:hover {
  background: color-mix(in srgb, var(--status-critical-error-color) 10%, transparent);
  color: var(--status-critical-error-color);
}

.history-list {
  flex: 1;
  min-height: 0;
  overflow-y: auto;
  padding: 6px;
}

.history-group {
  margin-bottom: 10px;
}

.group-header {
  display: flex;
  align-items: center;
  gap: 6px;
  padding: 4px 6px;
  color: var(--secondary-color);
  font-size: var(--font-size-tiny);
  font-weight: 700;
}

.group-header:hover .group-delete {
  display: inline-flex;
}

.group-count {
  color: var(--secondary-light-color);
  font-weight: 400;
}

.group-delete {
  display: none;
  align-items: center;
  margin-left: auto;
  padding: 2px 5px;
  border-radius: var(--radius-sm);
  color: var(--secondary-light-color);
}

.group-delete:hover {
  color: var(--status-critical-error-color);
  background: color-mix(in srgb, var(--status-critical-error-color) 10%, transparent);
}

.history-card {
  display: flex;
  align-items: center;
  gap: 8px;
  padding: 5px 6px;
  border-radius: var(--radius-md);
  cursor: pointer;
}

.history-card:hover {
  background: var(--primary-dark-color);
}

.method-block {
  display: inline-grid;
  place-items: center;
  min-width: 40px;
  height: 26px;
  padding: 0 5px;
  border-radius: var(--radius-sm);
  font-family: var(--font-code);
  font-size: var(--font-size-tiny);
  font-weight: 700;
  flex-shrink: 0;
}

.card-main {
  flex: 1;
  min-width: 0;
}

.card-url {
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
  font-family: var(--font-code);
  font-size: var(--font-size-tiny);
  color: var(--secondary-dark-color);
}

.card-meta {
  display: flex;
  align-items: center;
  gap: 4px;
  margin-top: 1px;
  color: var(--secondary-light-color);
  font-size: var(--font-size-tiny);
}

.card-status {
  font-family: var(--font-code);
  font-weight: 600;
}

.stream-badge {
  display: inline-flex;
  align-items: center;
  gap: 2px;
  padding: 0 5px;
  border-radius: 999px;
  background: color-mix(in srgb, var(--accent-color) 14%, transparent);
  color: var(--accent-color);
  cursor: help;
}

.star-btn {
  display: inline-flex;
  margin-left: auto;
  padding: 2px;
  border-radius: var(--radius-sm);
  color: var(--secondary-light-color);
  opacity: 0;
}

.history-card:hover .star-btn {
  opacity: 1;
}

.star-btn.on {
  opacity: 1;
  color: var(--status-redirect-color);
}

.history-empty {
  padding: 32px 12px;
  text-align: center;
  color: var(--secondary-light-color);
  font-size: var(--font-size-body);
}
</style>
