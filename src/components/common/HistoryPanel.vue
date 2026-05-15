<script setup lang="ts">
import { ref, computed } from 'vue'
import { useAppStore } from '@/stores/app'
import type { HttpMethod } from '@/types'

const store = useAppStore()
const searchQuery = ref('')

const filteredHistory = computed(() => {
  if (!searchQuery.value.trim()) return store.history
  const q = searchQuery.value.toLowerCase()
  return store.history.filter(h =>
    h.url.toLowerCase().includes(q) ||
    h.method.toLowerCase().includes(q) ||
    h.status.toString().includes(q)
  )
})

function statusClass(status: number): string {
  if (status >= 200 && status < 300) return 'success'
  if (status >= 300 && status < 400) return 'redirect'
  if (status >= 400 && status < 500) return 'client-error'
  if (status >= 500) return 'server-error'
  return 'error'
}

function formatTime(ts: number): string {
  const d = new Date(ts)
  const now = new Date()
  const isToday = d.toDateString() === now.toDateString()
  if (isToday) return d.toLocaleTimeString()
  return d.toLocaleDateString() + ' ' + d.toLocaleTimeString()
}

function clearHistory() {
  if (confirm('确定要清空历史记录吗？')) {
    store.history = []
  }
}

function loadFromHistory(apiId: string) {
  store.currentApiId = apiId
}
</script>

<template>
  <div class="history-panel">
    <div class="history-header">
      <input v-model="searchQuery" type="text" placeholder="搜索历史..." class="history-search" />
      <button class="btn btn-sm" @click="clearHistory" v-if="store.history.length > 0">清空</button>
    </div>
    <div class="history-list">
      <div
        v-for="entry in filteredHistory"
        :key="entry.id"
        class="history-item"
        @click="loadFromHistory(entry.apiId)"
      >
        <span :class="['method-badge', entry.method.toLowerCase()]">{{ entry.method }}</span>
        <span class="history-url">{{ entry.url }}</span>
        <span :class="['history-status', statusClass(entry.status)]">{{ entry.status }}</span>
        <span class="history-duration">{{ entry.duration }}ms</span>
        <span class="history-time">{{ formatTime(entry.timestamp) }}</span>
      </div>
      <div v-if="filteredHistory.length === 0" class="history-empty">
        暂无历史记录
      </div>
    </div>
  </div>
</template>

<style scoped>
.history-panel {
  display: flex;
  flex-direction: column;
  height: 100%;
}

.history-header {
  display: flex;
  gap: 4px;
  padding: 8px;
  border-bottom: 1px solid var(--divider);
}

.history-search {
  flex: 1;
  height: 28px;
  font-size: var(--font-size-small);
}

.history-list {
  flex: 1;
  overflow-y: auto;
  padding: 4px 0;
}

.history-item {
  display: flex;
  align-items: center;
  gap: 6px;
  padding: 6px 12px;
  cursor: pointer;
  font-size: var(--font-size-body);
  border-bottom: 1px solid var(--divider);
}

.history-item:hover {
  background: var(--bg-hover);
}

.history-url {
  flex: 1;
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
  font-family: var(--font-code);
  font-size: var(--font-size-small);
}

.history-status {
  font-weight: 600;
  font-size: var(--font-size-small);
  min-width: 30px;
  text-align: right;
}

.history-status.success { color: var(--success); }
.history-status.redirect { color: var(--info); }
.history-status.client-error { color: var(--warning); }
.history-status.server-error { color: var(--error); }
.history-status.error { color: var(--error); }

.history-duration {
  color: var(--text-secondary);
  font-size: var(--font-size-small);
  min-width: 50px;
  text-align: right;
}

.history-time {
  color: var(--text-tertiary);
  font-size: var(--font-size-small);
  min-width: 80px;
  text-align: right;
}

.history-empty {
  padding: 20px;
  text-align: center;
  color: var(--text-tertiary);
}
</style>