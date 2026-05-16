<script setup lang="ts">
import { ref, computed } from 'vue'
import { useAppStore } from '@/stores/app'
import CodeMirrorEditor from '@/components/common/CodeMirrorEditor.vue'
import JsonTreeViewer from '@/components/common/JsonTreeViewer.vue'
import type { ScriptLog } from '@/utils/pre-request'

const store = useAppStore()
const activeTab = ref('body')
const bodyMode = ref('tree')
const searchQuery = ref('')

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

const isJsonResponse = computed(() => {
  if (!store.response?.body) return false
  try {
    JSON.parse(store.response.body)
    return true
  } catch {
    return false
  }
})

const parsedJson = computed(() => {
  if (!store.response?.body) return null
  try {
    return JSON.parse(store.response.body)
  } catch {
    return null
  }
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

const responseLanguage = computed(() => {
  if (!store.response) return 'text'
  const ct = store.response.headers['content-type'] || ''
  if (ct.includes('json')) return 'json'
  if (ct.includes('xml')) return 'xml'
  if (ct.includes('html')) return 'html'
  if (ct.includes('javascript')) return 'javascript'
  if (ct.includes('yaml')) return 'yaml'
  return 'text'
})

const consoleLogs = computed(() => store.scriptLogs)

function formatTimestamp(ts: number): string {
  const d = new Date(ts)
  return [d.getHours(), d.getMinutes(), d.getSeconds()]
    .map(n => String(n).padStart(2, '0'))
    .join(':')
}

function levelClass(level: ScriptLog['level']): string {
  return `log-${level}`
}

function levelLabel(level: ScriptLog['level']): string {
  const labels: Record<ScriptLog['level'], string> = {
    log: 'LOG',
    info: 'INFO',
    warn: 'WARN',
    error: 'ERR',
    table: 'TBL',
  }
  return labels[level]
}

function formatMessage(args: string[]): string {
  return args.join(' ')
}

function isTableData(args: string[]): boolean {
  if (args.length === 0) return false
  try {
    const parsed = JSON.parse(args[0])
    return Array.isArray(parsed) && parsed.length > 0 && typeof parsed[0] === 'object'
  } catch {
    return false
  }
}

interface TableRow {
  cells: string[]
}

function parseTableData(args: string[]): { columns: string[]; rows: TableRow[] } | null {
  try {
    const parsed = JSON.parse(args[0])
    if (!Array.isArray(parsed) || parsed.length === 0 || typeof parsed[0] !== 'object') return null
    const columns = Object.keys(parsed[0])
    const rows = parsed.map((item: any) => ({
      cells: columns.map(col => String(item[col] ?? ''))
    }))
    return { columns, rows }
  } catch {
    return null
  }
}

function clearConsole() {
  store.scriptLogs = []
}
</script>

<template>
  <div class="response-panel">
    <div v-if="store.loading && !store.response" class="response-empty response-loading">
      <span class="response-spinner"></span>
      <h3>请求发送中</h3>
      <p>正在等待服务器响应，稍后会自动展示状态、耗时和响应体。</p>
    </div>
    <div v-else-if="!store.response" class="response-empty">
      <div class="empty-orb">↯</div>
      <h3>响应预览区</h3>
      <p>发送请求后在此查看 Body、Headers 与脚本 Console。</p>
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
            <button
              v-if="isJsonResponse"
              :class="['mode-btn', { active: bodyMode === 'tree' }]"
              @click="bodyMode = 'tree'"
            >Tree</button>
            <button :class="['mode-btn', { active: bodyMode === 'pretty' }]" @click="bodyMode = 'pretty'">Pretty</button>
            <button :class="['mode-btn', { active: bodyMode === 'raw' }]" @click="bodyMode = 'raw'">Raw</button>
            <div v-if="bodyMode === 'tree' && isJsonResponse" class="search-bar">
              <input
                v-model="searchQuery"
                type="text"
                class="search-input"
                placeholder="Search keys/values..."
              />
            </div>
          </div>
          <JsonTreeViewer
            v-if="bodyMode === 'tree' && isJsonResponse && parsedJson"
            :data="parsedJson"
            :search-query="searchQuery"
            root-name="response"
            class="response-tree"
          />
          <CodeMirrorEditor
            v-if="bodyMode === 'pretty'"
            :model-value="formattedBody"
            :language="responseLanguage"
            :readonly="true"
            class="response-cm-pretty"
          />
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
          <div class="console-toolbar">
            <span class="console-count">{{ consoleLogs.length }} 条日志</span>
            <button class="console-clear-btn" @click="clearConsole" :disabled="consoleLogs.length === 0">清空</button>
          </div>
          <div class="console-output">
            <div v-if="consoleLogs.length === 0" class="console-empty">暂无脚本日志</div>
            <div
              v-for="(log, index) in consoleLogs"
              :key="index"
              :class="['console-line', levelClass(log.level)]"
            >
              <span class="log-timestamp">{{ formatTimestamp(log.timestamp) }}</span>
              <span :class="['log-level', levelClass(log.level)]">{{ levelLabel(log.level) }}</span>
              <template v-if="log.level === 'table' && isTableData(log.args)">
                <div class="log-table-wrap">
                  <table class="log-table">
                    <thead>
                      <tr>
                        <th v-for="col in parseTableData(log.args)!.columns" :key="col">{{ col }}</th>
                      </tr>
                    </thead>
                    <tbody>
                      <tr v-for="(row, ri) in parseTableData(log.args)!.rows" :key="ri">
                        <td v-for="(cell, ci) in row.cells" :key="ci">{{ cell }}</td>
                      </tr>
                    </tbody>
                  </table>
                </div>
              </template>
              <template v-else>
                <span class="log-message">{{ formatMessage(log.args) }}</span>
              </template>
            </div>
          </div>
        </div>
      </div>
    </div>
  </div>
</template>

<style scoped>
.response-panel {
  height: 320px;
  border-top: 1px solid var(--border);
  display: flex;
  flex-direction: column;
  overflow: hidden;
  background: var(--bg-panel);
}

.response-empty {
  display: flex;
  flex-direction: column;
  gap: 8px;
  align-items: center;
  justify-content: center;
  flex: 1;
  text-align: center;
  color: var(--text-secondary);
  background:
    radial-gradient(circle at 50% 35%, var(--primary-soft), transparent 36%),
    var(--bg-code);
}

.response-empty h3 {
  color: var(--text-primary);
  font-size: 15px;
}

.response-empty p {
  max-width: 360px;
  color: var(--text-tertiary);
  line-height: 1.6;
}

.empty-orb,
.response-spinner {
  display: inline-flex;
  align-items: center;
  justify-content: center;
  width: 42px;
  height: 42px;
  border-radius: 16px;
  background: linear-gradient(135deg, var(--primary), var(--accent));
  color: #fff;
  font-weight: 900;
  box-shadow: 0 14px 26px rgba(79, 70, 229, 0.22);
}

.response-spinner {
  border: 3px solid var(--primary-light);
  border-top-color: var(--primary);
  background: var(--bg-panel);
  animation: spin 0.9s linear infinite;
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
  padding: 8px 12px;
  border-bottom: 1px solid var(--divider);
  background: linear-gradient(90deg, var(--bg-panel-elevated), var(--bg-panel));
}

.status-code {
  font-weight: 850;
  padding: 3px 9px;
  border-radius: 999px;
  background: var(--bg-code);
}
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
  padding: 6px 8px 0;
  background: var(--bg-panel-elevated);
}

.resp-tab-btn {
  padding: 6px 11px;
  border: 1px solid transparent;
  border-bottom: none;
  background: transparent;
  color: var(--text-secondary);
  cursor: pointer;
  font-size: var(--font-size-small);
  font-weight: 700;
  border-radius: var(--radius-md) var(--radius-md) 0 0;
}

.resp-tab-btn:hover {
  color: var(--text-primary);
  background: var(--bg-hover);
}

.resp-tab-btn.active {
  color: var(--primary);
  background: var(--bg-panel);
  border-color: var(--border);
  box-shadow: 0 -2px 0 var(--primary) inset;
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
  align-items: center;
  gap: 4px;
  padding: 7px 8px;
  border-bottom: 1px solid var(--divider);
}

.mode-btn {
  padding: 4px 9px;
  border: 1px solid transparent;
  background: var(--bg-panel);
  color: var(--text-secondary);
  cursor: pointer;
  font-size: var(--font-size-small);
  font-weight: 700;
  border-radius: 999px;
}

.mode-btn.active {
  background: var(--primary-soft);
  color: var(--primary);
  border-color: var(--primary);
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

.response-tree {
  flex: 1;
  overflow: auto;
  background: var(--bg-code);
}

.search-bar {
  margin-left: auto;
  display: flex;
  align-items: center;
}

.search-input {
  padding: 2px 8px;
  border: 1px solid var(--border);
  border-radius: var(--radius-sm);
  background: var(--bg-base);
  color: var(--text-primary);
  font-size: var(--font-size-small);
  font-family: var(--font-ui);
  outline: none;
  width: 180px;
}

.search-input:focus {
  border-color: var(--primary);
}

.search-input::placeholder {
  color: var(--text-tertiary);
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

/* Console styles */
.resp-console {
  display: flex;
  flex-direction: column;
  height: 100%;
  overflow: hidden;
}

.console-toolbar {
  display: flex;
  align-items: center;
  justify-content: space-between;
  padding: 4px 8px;
  border-bottom: 1px solid var(--divider);
  flex-shrink: 0;
}

.console-count {
  font-size: var(--font-size-small);
  color: var(--text-secondary);
}

.console-clear-btn {
  padding: 2px 8px;
  border: 1px solid var(--border);
  border-radius: var(--radius-sm);
  background: transparent;
  color: var(--text-secondary);
  cursor: pointer;
  font-size: var(--font-size-small);
}

.console-clear-btn:disabled {
  opacity: 0.4;
  cursor: default;
}

.console-output {
  flex: 1;
  overflow: auto;
  font-family: var(--font-code);
  font-size: var(--font-size-code);
  background: var(--bg-code);
  padding: 4px 0;
}

.console-empty {
  padding: 20px;
  text-align: center;
  color: var(--text-tertiary);
}

.console-line {
  display: flex;
  align-items: flex-start;
  gap: 8px;
  padding: 2px 8px;
  line-height: 1.5;
}

.console-line:hover {
  background: rgba(128, 128, 128, 0.08);
}

.log-timestamp {
  color: var(--text-tertiary);
  font-size: 11px;
  flex-shrink: 0;
  padding-top: 1px;
}

.log-level {
  font-size: 10px;
  font-weight: 600;
  flex-shrink: 0;
  padding: 1px 4px;
  border-radius: 2px;
  letter-spacing: 0.5px;
}

.log-level.log-log { color: #5c9eff; background: rgba(92, 158, 255, 0.1); }
.log-level.log-info { color: #4caf50; background: rgba(76, 175, 80, 0.1); }
.log-level.log-warn { color: #ff9800; background: rgba(255, 152, 0, 0.1); }
.log-level.log-error { color: #f44336; background: rgba(244, 67, 54, 0.1); }
.log-level.log-table { color: #00bcd4; background: rgba(0, 188, 212, 0.1); }

.log-message {
  color: var(--text-primary);
  word-break: break-all;
  white-space: pre-wrap;
}

.console-line.log-error .log-message { color: #f44336; }
.console-line.log-warn .log-message { color: #ff9800; }

.log-table-wrap {
  flex: 1;
  overflow-x: auto;
}

.log-table {
  border-collapse: collapse;
  font-size: 11px;
  margin: 2px 0;
}

.log-table th {
  text-align: left;
  padding: 2px 8px;
  color: var(--text-secondary);
  border-bottom: 1px solid var(--divider);
  font-weight: 500;
}

.log-table td {
  padding: 2px 8px;
  color: var(--text-primary);
  border-bottom: 1px solid var(--divider);
}

@keyframes spin {
  to { transform: rotate(360deg); }
}
</style>
