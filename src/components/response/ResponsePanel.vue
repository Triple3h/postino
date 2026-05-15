<script setup lang="ts">
import { ref, computed } from 'vue'
import { useAppStore } from '@/stores/app'

const store = useAppStore()
const activeTab = ref('body')
const bodyMode = ref('pretty')

const responseTabs = [
  { key: 'body', label: 'Body' },
  { key: 'headers', label: 'Headers' },
  { key: 'console', label: '控制台' },
]

const statusClass = computed(() => {
  if (!store.response) return ''
  const s = store.response.status
  if (s >= 200 && s < 300) return 'success'
  if (s >= 300 && s < 400) return 'redirect'
  if (s >= 400 && s < 500) return 'client-error'
  if (s >= 500) return 'server-error'
  if (s === 0) return 'error'
  return ''
})

const durationClass = computed(() => {
  if (!store.response) return ''
  const d = store.response.duration
  if (d > 3000) return 'slow'
  if (d > 1000) return 'medium'
  return 'fast'
})

const formattedBody = computed(() => {
  if (!store.response?.body) return ''
  try {
    const json = JSON.parse(store.response.body)
    return JSON.stringify(json, null, 2)
  } catch {
    return store.response.body
  }
})

const sizeFormatted = computed(() => {
  if (!store.response) return ''
  const s = store.response.size
  if (s > 1024 * 1024) return `${(s / 1024 / 1024).toFixed(1)}MB`
  if (s > 1024) return `${(s / 1024).toFixed(1)}KB`
  return `${s}B`
})

const headerEntries = computed(() => {
  if (!store.response) return []
  return Object.entries(store.response.headers).map(([k, v]) => ({ key: k, value: v }))
})
</script>

<template>
  <div class="response-panel">
    <div v-if="!store.response" class="response-empty">
      发送请求后在此查看响应
    </div>
    <div v-else class="response-content">
      <div class="response-status-bar">
        <span :class="['status-code', statusClass]">
          {{ store.response.status }} {{ store.response.statusText }}
        </span>
        <span :class="['response-meta', durationClass]">{{ store.response.duration }}ms</span>
        <span class="response-meta">{{ sizeFormatted }}</span>
      </div>
      <div class="response-tabs">
        <button
          v-for="tab in responseTabs"
          :key="tab.key"
          :class="['resp-tab-btn', { active: activeTab === tab.key }]"
          @click="activeTab = tab.key"
        >
          {{ tab.label }}
        </button>
      </div>
      <div class="response-body-area">
        <div v-if="activeTab === 'body'" class="resp-body">
          <div class="body-mode-bar">
            <button :class="['mode-btn', { active: bodyMode === 'pretty' }]" @click="bodyMode = 'pretty'">Pretty</button>
            <button :class="['mode-btn', { active: bodyMode === 'raw' }]" @click="bodyMode = 'raw'">Raw</button>
          </div>
          <pre v-if="bodyMode === 'pretty'" class="response-json">{{ formattedBody }}</pre>
          <pre v-if="bodyMode === 'raw'" class="response-raw">{{ store.response.body }}</pre>
        </div>
        <div v-if="activeTab === 'headers'" class="resp-headers">
          <table class="headers-table">
            <thead>
              <tr><th>Key</th><th>Value</th></tr>
            </thead>
            <tbody>
              <tr v-for="h in headerEntries" :key="h.key">
                <td class="header-key">{{ h.key }}</td>
                <td class="header-value">{{ h.value }}</td>
              </tr>
            </tbody>
          </table>
        </div>
        <div v-if="activeTab === 'console'" class="resp-console">
          <div class="console-placeholder">脚本日志（待实现）</div>
        </div>
      </div>
    </div>
  </div>
</template>

<style scoped>
.response-panel {
  height: 300px;
  border-top: 1px solid var(--border);
  display: flex;
  flex-direction: column;
  overflow: hidden;
}

.response-empty {
  display: flex;
  align-items: center;
  justify-content: center;
  flex: 1;
  color: var(--text-tertiary);
}

.response-content {
  display: flex;
  flex-direction: column;
  flex: 1;
  overflow: hidden;
}

.response-status-bar {
  display: flex;
  align-items: center;
  gap: 12px;
  padding: 6px 12px;
  border-bottom: 1px solid var(--divider);
}

.status-code { font-weight: 600; }
.status-code.success { color: var(--success); }
.status-code.redirect { color: var(--info); }
.status-code.client-error { color: var(--warning); }
.status-code.server-error { color: var(--error); }
.status-code.error { color: var(--error); }

.response-meta { color: var(--text-secondary); font-size: var(--font-size-small); }
.response-meta.fast { color: var(--success); }
.response-meta.medium { color: var(--warning); }
.response-meta.slow { color: var(--error); }

.response-tabs {
  display: flex;
  border-bottom: 1px solid var(--divider);
  padding: 0 8px;
}

.resp-tab-btn {
  padding: 4px 10px;
  border: none;
  background: transparent;
  color: var(--text-secondary);
  cursor: pointer;
  font-size: var(--font-size-small);
  border-bottom: 2px solid transparent;
}

.resp-tab-btn.active {
  color: var(--primary);
  border-bottom-color: var(--primary);
}

.response-body-area {
  flex: 1;
  overflow: auto;
}

.resp-body {
  display: flex;
  flex-direction: column;
  height: 100%;
}

.body-mode-bar {
  display: flex;
  gap: 4px;
  padding: 4px 8px;
}

.mode-btn {
  padding: 2px 8px;
  border: none;
  background: transparent;
  color: var(--text-secondary);
  cursor: pointer;
  font-size: var(--font-size-small);
  border-radius: var(--radius-sm);
}

.mode-btn.active {
  background: var(--primary-light);
  color: var(--primary);
}

.response-json,
.response-raw {
  flex: 1;
  padding: 8px;
  font-family: var(--font-code);
  font-size: var(--font-size-code);
  white-space: pre-wrap;
  word-break: break-all;
  overflow: auto;
  background: var(--bg-code);
}

.headers-table {
  width: 100%;
  border-collapse: collapse;
}

.headers-table th {
  text-align: left;
  padding: 4px 8px;
  font-size: var(--font-size-small);
  color: var(--text-secondary);
  border-bottom: 1px solid var(--divider);
}

.headers-table td {
  padding: 4px 8px;
  font-size: var(--font-size-body);
  border-bottom: 1px solid var(--divider);
}

.header-key {
  font-weight: 500;
  color: var(--text-primary);
  width: 30%;
}

.header-value {
  color: var(--text-secondary);
  word-break: break-all;
}

.console-placeholder {
  padding: 20px;
  text-align: center;
  color: var(--text-tertiary);
}
</style>