<script setup lang="ts">
import { ref, computed, watch, nextTick } from 'vue'
import { Clock3, Copy, Download, FileText, Play, TriangleAlert, Wifi, Zap } from '@lucide/vue'
import { useAppStore } from '@/stores/app'
import { useWorkspaceStore } from '@/stores/workspace'
import CodeMirrorEditor from '@/components/common/CodeMirrorEditor.vue'
import JsonTreeViewer from '@/components/common/JsonTreeViewer.vue'
import { responseBodyToBlob, responseContentType, responseDataUrl, responseFileExtension } from '@/utils/binary-response'
import { generateMarkdownDoc } from '@/utils/export'
import type { HistoryEntry, ResponseData } from '@/types'
import type { ScriptLog, ScriptTestResult, ScriptVisualization } from '@/utils/pre-request'

const store = useAppStore()
const workspace = useWorkspaceStore()
const activeLens = ref('raw')
const bodyMode = ref<'tree' | 'pretty' | 'raw' | 'table' | 'preview' | 'source'>('pretty')
const htmlView = ref<'preview' | 'source'>('preview')
const searchQuery = ref('')
const previousResponse = ref<ResponseData | null>(null)

const isStreaming = computed(() => store.response?.isStreaming === true)
const isCancelled = computed(() => store.response?.cancelled === true)
const chunkCount = computed(() => store.response?.chunks?.length ?? 0)
const streamTypeLabel = computed(() => {
  if (!store.response?.streamType) return ''
  return store.response.streamType === 'sse' ? 'SSE' : 'NDJSON'
})
const recentHistory = computed(() => store.history.slice(0, 5))

// ── Phase 3.4:流式合并结果 + 事件流视图 ──
const hasStreamChunks = computed(() => (store.response?.chunks?.length ?? 0) > 0)
const mergedText = computed(() => store.response?.mergedText ?? '')
const autoScrollMerged = ref(true)
const mergedContainer = ref<HTMLElement | null>(null)

const streamEvents = computed(() => (store.response?.chunks ?? []).map((chunk, index) => ({
  index: index + 1,
  time: formatTimestamp(chunk.timestamp),
  event: chunk.event ?? 'message',
  data: chunk.data,
})))

watch(() => store.response?.mergedText, async () => {
  if (activeLens.value !== 'merged' || !autoScrollMerged.value) return
  await nextTick()
  const el = mergedContainer.value
  if (el) el.scrollTop = el.scrollHeight
})

async function copyMergedText() {
  await navigator.clipboard.writeText(mergedText.value)
}

function cancelRequest() {
  store.cancelCurrentRequest()
}

const statusClass = computed(() => {
  if (!store.response) return ''
  const s = store.response.status
  if (s >= 200 && s < 300) return 'status-success'
  if (s >= 300 && s < 400) return 'status-redirect'
  if (s >= 400 && s < 500) return 'status-client-error'
  if (s >= 500) return 'status-server-error'
  return 'status-missing'
})

function statusColor(status: number): string {
  if (status >= 200 && status < 300) return 'var(--status-success-color)'
  if (status >= 300 && status < 400) return 'var(--status-redirect-color)'
  if (status >= 400 && status < 500) return 'var(--status-critical-error-color)'
  if (status >= 500) return 'var(--status-server-error-color)'
  return 'var(--status-missing-data-color)'
}

const durationClass = computed(() => {
  if (!store.response) return ''
  const d = store.response.duration
  if (d > 3000) return 'slow'
  if (d > 1000) return 'medium'
  return 'fast'
})

const isJsonResponse = computed(() => {
  if (!store.response?.body || store.response.bodyEncoding === 'base64') return false
  try {
    JSON.parse(store.response.body)
    return true
  } catch {
    return false
  }
})

const parsedJson = computed(() => {
  if (!store.response?.body || store.response.bodyEncoding === 'base64') return null
  try {
    return JSON.parse(store.response.body)
  } catch {
    return null
  }
})

const formattedBody = computed(() => {
  if (!store.response?.body) return ''
  if (store.response.bodyEncoding === 'base64') return `[binary ${responseContentType(store.response)} response: ${sizeFormatted.value}]`
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

const actualRequestText = computed(() => {
  if (!store.response) return ''
  return JSON.stringify({
    method: store.response.method,
    url: store.response.url,
    headers: store.response.requestHeaders,
    body: store.response.requestBody,
    sentAt: new Date(store.response.timestamp).toISOString(),
  }, null, 2)
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

const responseContentTypeLabel = computed(() => {
  if (!store.response) return ''
  return responseContentType(store.response) || store.response.headers['Content-Type'] || 'unknown'
})

const consoleLogs = computed(() => store.scriptLogs)
const visualizations = computed(() => store.scriptVisualizations)
const scriptTests = computed(() => store.scriptTests)
const testSummary = computed(() => {
  const total = scriptTests.value.length
  const skipped = scriptTests.value.filter(item => item.skipped).length
  const failed = scriptTests.value.filter(item => !item.passed && !item.skipped).length
  const passed = scriptTests.value.filter(item => item.passed && !item.skipped).length
  return { total, passed, failed, skipped }
})

// ── Lens 体系(FR-1.4):按 Content-Type 动态 + 固定追加 ──
type LensKey = 'json' | 'xml' | 'html' | 'image' | 'raw' | 'headers' | 'request' | 'events' | 'merged' | 'console' | 'tests' | 'visualize' | 'diff'

const contentType = computed(() => store.response ? responseContentType(store.response) : '')
const lowerCt = computed(() => contentType.value.toLowerCase())

const isImageResponse = computed(() => lowerCt.value.includes('image/'))
const isHtmlResponse = computed(() => lowerCt.value.includes('html') || lowerCt.value.includes('svg'))
const isXmlResponse = computed(() => lowerCt.value.includes('xml'))

const bodyLenses = computed<Array<{ key: LensKey; label: string }>>(() => {
  const lenses: Array<{ key: LensKey; label: string }> = []
  if (isJsonResponse.value) lenses.push({ key: 'json', label: 'JSON' })
  if (isXmlResponse.value) lenses.push({ key: 'xml', label: 'XML' })
  if (isHtmlResponse.value) lenses.push({ key: 'html', label: 'HTML' })
  if (isImageResponse.value) lenses.push({ key: 'image', label: 'Image' })
  lenses.push({ key: 'raw', label: 'Raw' })
  return lenses
})

const fixedLenses = computed<Array<{ key: LensKey; label: string; badge?: number }>>(() => {
  const lenses: Array<{ key: LensKey; label: string; badge?: number }> = [
    { key: 'headers', label: 'Headers', badge: headerEntries.value.length },
    { key: 'request', label: '请求头' },
  ]
  if (hasStreamChunks.value) {
    lenses.push({ key: 'events', label: '事件流', badge: chunkCount.value })
    lenses.push({ key: 'merged', label: '合并结果' })
  }
  lenses.push({ key: 'console', label: '控制台', badge: consoleLogs.value.length || undefined })
  if (scriptTests.value.length) lenses.push({ key: 'tests', label: '测试报告', badge: scriptTests.value.length })
  if (visualizations.value.length) lenses.push({ key: 'visualize', label: 'Visualize' })
  lenses.push({ key: 'diff', label: 'Diff' })
  return lenses
})

const availableLensKeys = computed(() => new Set<string>([...bodyLenses.value, ...fixedLenses.value].map(l => l.key)))

watch(() => store.response, (next, prev) => {
  if (prev && prev !== next) previousResponse.value = prev
  if (next) {
    // 默认 lens:按内容类型选第一个 body lens
    if (!availableLensKeys.value.has(activeLens.value) || activeLens.value === 'raw') {
      const first = bodyLenses.value[0]
      if (first) activeLens.value = first.key
    }
    bodyMode.value = isJsonResponse.value ? 'tree' : (isHtmlResponse.value || isImageResponse.value) ? 'preview' : 'pretty'
  }
})

// JSON Table 视图
const jsonTable = computed(() => {
  const data = parsedJson.value
  if (!data) return null
  if (Array.isArray(data)) {
    const rows = data.filter(item => item && typeof item === 'object').slice(0, 100) as Record<string, unknown>[]
    if (rows.length === 0) return null
    const columns = Array.from(new Set(rows.flatMap(row => Object.keys(row)))).slice(0, 30)
    return { columns, rows }
  }
  if (typeof data === 'object') {
    return {
      columns: ['key', 'value'],
      rows: Object.entries(data as Record<string, unknown>).map(([key, value]) => ({ key, value: typeof value === 'object' ? JSON.stringify(value) : value }) as Record<string, unknown>),
    }
  }
  return null
})

const bodySearchCount = computed(() => {
  const query = searchQuery.value.trim().toLowerCase()
  if (!query) return 0
  const body = formattedBody.value.toLowerCase()
  let count = 0
  let index = body.indexOf(query)
  while (index !== -1) {
    count++
    index = body.indexOf(query, index + query.length)
  }
  return count
})

const filteredJsonTable = computed(() => {
  const table = jsonTable.value
  if (!table) return null
  const query = searchQuery.value.trim().toLowerCase()
  if (!query) return table
  return {
    columns: table.columns,
    rows: table.rows.filter(row => table.columns.some(col => formatJsonCell(row, col).toLowerCase().includes(query))),
  }
})

const previewSrcdoc = computed(() => {
  if (!store.response) return ''
  const ct = lowerCt.value
  if (ct.includes('html') || ct.includes('svg')) return store.response.body
  return `<pre>${escapeHtml(store.response.body)}</pre>`
})

const previewDataUrl = computed(() => {
  if (!store.response) return ''
  try {
    return responseDataUrl(store.response)
  } catch {
    return ''
  }
})

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

function formatJsonCell(row: Record<string, unknown>, column: string): string {
  const value = row[column]
  if (value == null) return ''
  return typeof value === 'object' ? JSON.stringify(value) : String(value)
}

const diffRows = computed<DiffRow[]>(() => {
  if (!store.response || !previousResponse.value) return []
  try {
    const before = flattenJson(JSON.parse(previousResponse.value.body))
    const after = flattenJson(JSON.parse(store.response.body))
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
    const beforeLines = previousResponse.value.body.split('\n')
    const afterLines = store.response.body.split('\n')
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
})

function formatTimestamp(ts: number): string {
  const d = new Date(ts)
  const time = [d.getHours(), d.getMinutes(), d.getSeconds()]
    .map(n => String(n).padStart(2, '0'))
    .join(':')
  return `${time}.${String(d.getMilliseconds()).padStart(3, '0')}`
}

function levelClass(level: ScriptLog['level']): string {
  return `log-${level}`
}

function levelLabel(level: ScriptLog['level']): string {
  const labels: Record<ScriptLog['level'], string> = {
    log: 'log',
    info: 'info',
    warn: 'warn',
    error: 'error',
    table: 'table',
  }
  return labels[level]
}

function formatMessage(args: string[]): string {
  return args.join(' ')
}

function historyDisplayPath(entry: HistoryEntry): string {
  const trimmed = entry.url.trim()
  if (!trimmed) return '/'
  const templatePath = trimmed.match(/^\{\{[^}]+\}\}(.*)$/)?.[1]
  if (templatePath !== undefined) return templatePath || '/'
  if (trimmed.startsWith('/')) return trimmed
  try {
    const parsed = new URL(trimmed)
    return `${parsed.pathname || '/'}${parsed.search}`
  } catch {
    return trimmed
  }
}

function relativeHistoryTime(timestamp: number): string {
  const diff = Date.now() - timestamp
  if (diff < 60_000) return '刚刚'
  if (diff < 3_600_000) return `${Math.floor(diff / 60_000)}分钟前`
  if (diff < 86_400_000) return `${Math.floor(diff / 3_600_000)}小时前`
  return `${Math.floor(diff / 86_400_000)}天前`
}

function historyStatusColor(status: number): string {
  return statusColor(status)
}

function loadHistoryEntry(entry: HistoryEntry) {
  const interfaceNode = workspace.interfaces.find(item => item.id === entry.interfaceId || item.apiId === entry.apiId)
  workspace.selectInterface(interfaceNode?.id ?? entry.apiId)
  store.currentApiId = entry.apiId
}

function resendHistoryEntry(entry: HistoryEntry, event: MouseEvent) {
  event.stopPropagation()
  loadHistoryEntry(entry)
  window.setTimeout(() => {
    window.dispatchEvent(new CustomEvent('apifix:send-current-request'))
  }, 0)
}

function escapeHtml(value: string): string {
  return value
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#39;')
}

function visualizationSrcdoc(item: ScriptVisualization): string {
  const data = item.data == null ? '' : `<details><summary>Data</summary><pre>${escapeHtml(JSON.stringify(item.data, null, 2))}</pre></details>`
  return `<!doctype html><html><head><meta charset="utf-8"><style>
    body{font-family:-apple-system,BlinkMacSystemFont,Segoe UI,sans-serif;margin:0;padding:12px;color:#111827;background:#fff;}
    table{width:100%;border-collapse:collapse;font-size:13px;}th,td{border:1px solid #e5e7eb;padding:6px 8px;text-align:left;}th{background:#f9fafb;}
    pre{white-space:pre-wrap;word-break:break-word;background:#f9fafb;border:1px solid #e5e7eb;border-radius:8px;padding:8px;}
</style></head><body>${item.content}${data}</body></html>`
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
  store.scriptTests = []
}

function testStatusLabel(test: ScriptTestResult): string {
  if (test.skipped) return 'SKIP'
  return test.passed ? 'PASS' : 'FAIL'
}

async function copyResponse() {
  if (!store.response) return
  await navigator.clipboard.writeText(store.response.bodyEncoding === 'base64' ? responseDataUrl(store.response) : store.response.body)
}

function saveResponse() {
  if (!store.response) return
  const ct = responseContentType(store.response)
  const extension = responseFileExtension(ct)
  const blob = responseBodyToBlob(store.response)
  const url = URL.createObjectURL(blob)
  const a = document.createElement('a')
  a.href = url
  a.download = `response-${new Date(store.response.timestamp).toISOString().replace(/[:.]/g, '-')}.${extension}`
  a.click()
  URL.revokeObjectURL(url)
}

function fenced(value: string, language = ''): string {
  return `\`\`\`${language}\n${value.replace(/```/g, '`\u200b``')}\n\`\`\``
}

function responseExampleBody(): string {
  if (!store.response) return ''
  if (store.response.bodyEncoding === 'base64') {
    return `[binary ${responseContentType(store.response)} response, ${sizeFormatted.value}]`
  }
  return formattedBody.value || store.response.body
}

function generateResponseMarkdownDoc(): string {
  const response = store.response
  if (!response) return ''
  const api = store.getCurrentApi()
  const lines: string[] = []
  if (api) {
    lines.push(generateMarkdownDoc(api))
  } else {
    lines.push(`## ${response.method} ${response.url}`)
    lines.push('')
    lines.push(`**${response.method}** \`${response.url}\``)
  }

  lines.push('')
  lines.push('### Response Example')
  lines.push('')
  lines.push(`- Status: ${response.status} ${response.statusText}`)
  lines.push(`- Duration: ${response.duration}ms`)
  lines.push(`- Size: ${sizeFormatted.value}`)
  lines.push(`- Content-Type: ${responseContentType(response)}`)
  lines.push('')

  const headerLines = Object.entries(response.headers).map(([key, value]) => `${key}: ${value}`)
  if (headerLines.length > 0) {
    lines.push('#### Response Headers')
    lines.push('')
    lines.push(fenced(headerLines.join('\n'), 'http'))
    lines.push('')
  }

  lines.push('#### Response Body')
  lines.push('')
  lines.push(fenced(responseExampleBody(), responseLanguage.value === 'text' ? '' : responseLanguage.value))
  lines.push('')
  lines.push('#### Actual Request')
  lines.push('')
  lines.push(fenced(actualRequestText.value, 'json'))

  return lines.join('\n')
}

function exportResponseDoc() {
  if (!store.response) return
  const markdown = generateResponseMarkdownDoc()
  const blob = new Blob([markdown], { type: 'text/markdown;charset=utf-8' })
  const url = URL.createObjectURL(blob)
  const a = document.createElement('a')
  a.href = url
  a.download = `api-response-doc-${new Date(store.response.timestamp).toISOString().replace(/[:.]/g, '-')}.md`
  a.click()
  URL.revokeObjectURL(url)
}

// ── FR-1.5:发送失败占位内的发送通道选择 ──
const channelOptions: Array<{ value: 'cors' | 'proxy' | 'no-cors'; label: string; hint: string }> = [
  { value: 'cors', label: '直连(CORS)', hint: '浏览器直连,要求服务端允许跨域' },
  { value: 'proxy', label: '公共代理', hint: '经 corsproxy.io 等公共代理转发' },
  { value: 'no-cors', label: '扩展后台 / 桌面', hint: '扩展 Service Worker 或桌面 shell 直连,无视 CORS' },
]

function setChannel(value: 'cors' | 'proxy' | 'no-cors') {
  store.settings.corsMode = value
  store.saveSettings().catch(err => console.error('Failed to save channel:', err))
}

function isErrorResponse(): boolean {
  const r = store.response
  if (!r) return false
  return r.status === 0 && !isCancelled.value && !isStreaming.value
}

function retrySend() {
  window.dispatchEvent(new CustomEvent('apifix:send-current-request'))
}
</script>

<template>
  <div class="response-panel">
    <!-- Loading -->
    <div v-if="store.loading && !store.response" class="panel-placeholder">
      <span class="spinner"></span>
      <h3>请求发送中</h3>
      <p>正在等待服务器响应…</p>
      <button class="placeholder-action" @click="cancelRequest">取消请求</button>
    </div>

    <!-- FR-1.5:发送失败占位(内嵌发送通道选择) -->
    <div v-else-if="isErrorResponse()" class="panel-placeholder">
      <div class="fail-icon"><TriangleAlert :size="30" /></div>
      <h3>发送失败</h3>
      <p class="fail-message">{{ store.response?.statusText || '网络错误或被 CORS 拦截' }}</p>
      <div class="channel-box">
        <div class="channel-title"><Wifi :size="13" /> 发送通道</div>
        <button
          v-for="opt in channelOptions"
          :key="opt.value"
          class="channel-option"
          :class="{ active: store.settings.corsMode === opt.value }"
          @click="setChannel(opt.value)"
        >
          <strong>{{ opt.label }}</strong>
          <small>{{ opt.hint }}</small>
        </button>
        <input
          v-if="store.settings.corsMode === 'proxy'"
          v-model="store.settings.proxyUrl"
          type="url"
          class="proxy-input"
          placeholder="代理 URL,如 https://corsproxy.io/?"
          @change="store.saveSettings()"
        />
        <button class="placeholder-action" @click="retrySend">重试发送</button>
      </div>
    </div>

    <!-- 已取消且无数据 -->
    <div v-else-if="isCancelled && !store.response?.body" class="panel-placeholder">
      <div class="fail-icon"><TriangleAlert :size="30" /></div>
      <h3>请求已取消</h3>
      <p>请求在发送过程中被手动取消。</p>
    </div>

    <!-- 无响应:最近发送 / 空态 -->
    <div v-else-if="!store.response" class="panel-placeholder">
      <template v-if="recentHistory.length > 0">
        <div class="recent-history">
          <div class="recent-title">
            <span><Clock3 :size="14" /> 最近发送</span>
            <small>点击复用,或按 Ctrl+Enter 发送当前请求</small>
          </div>
          <button
            v-for="entry in recentHistory"
            :key="entry.id"
            class="recent-item"
            @click="loadHistoryEntry(entry)"
          >
            <span class="method-badge" :class="entry.method.toLowerCase()">{{ entry.method }}</span>
            <code>{{ historyDisplayPath(entry) }}</code>
            <span class="recent-status" :style="{ color: historyStatusColor(entry.status) }">{{ entry.status }}</span>
            <span class="recent-duration">{{ entry.duration }}ms</span>
            <span class="recent-time">{{ relativeHistoryTime(entry.timestamp) }}</span>
            <span class="recent-send" title="重发" @click="resendHistoryEntry(entry, $event)"><Play :size="12" /></span>
          </button>
        </div>
      </template>
      <template v-else>
        <div class="empty-orb"><Zap :size="30" /></div>
        <h3>响应预览区</h3>
        <p>发送请求后在此查看响应 Body、Headers 与脚本控制台。</p>
      </template>
    </div>

    <!-- 响应内容:meta 行 + lens 体系 -->
    <div v-else class="response-content">
      <div class="meta-row">
        <span class="status-dot" :style="{ backgroundColor: statusColor(store.response.status) }"></span>
        <strong class="status-code" :style="{ color: statusColor(store.response.status) }">{{ store.response.status }}</strong>
        <span class="status-text">{{ store.response.statusText }}</span>
        <span class="meta-sep">·</span>
        <span :class="['meta-duration', durationClass]">{{ store.response.duration }}ms</span>
        <span class="meta-sep">·</span>
        <span class="meta-size">{{ sizeFormatted }}</span>
        <span v-if="isStreaming" class="stream-indicator">
          <span class="stream-dot"></span>
          {{ streamTypeLabel }} 接收中 · {{ chunkCount }} 事件 · {{ sizeFormatted }}
        </span>
        <span v-else-if="store.response.streamCompleted" class="stream-done">
          {{ streamTypeLabel }} 完成 · {{ chunkCount }} 事件
        </span>
        <span v-else-if="isCancelled" class="stream-done cancelled">已取消</span>
        <div class="meta-actions">
          <button class="meta-action" title="复制响应 (Ctrl+.)" @click="copyResponse"><Copy :size="13" /></button>
          <button class="meta-action" title="下载响应 (Ctrl+J)" @click="saveResponse"><Download :size="13" /></button>
          <button v-if="!isStreaming" class="meta-action" title="生成 Markdown 文档" @click="exportResponseDoc"><FileText :size="13" /></button>
          <button v-if="isStreaming" class="meta-action cancel" @click="cancelRequest">取消</button>
        </div>
      </div>

      <div class="lens-tabs">
        <button
          v-for="lens in bodyLenses"
          :key="lens.key"
          class="lens-tab"
          :class="{ active: activeLens === lens.key }"
          @click="activeLens = lens.key"
        >{{ lens.label }}</button>
        <span class="lens-divider"></span>
        <button
          v-for="lens in fixedLenses"
          :key="lens.key"
          class="lens-tab"
          :class="{ active: activeLens === lens.key }"
          @click="activeLens = lens.key"
        >
          {{ lens.label }}
          <span v-if="lens.badge" class="lens-badge">{{ lens.badge }}</span>
        </button>
      </div>

      <div class="lens-body">
        <!-- JSON lens -->
        <template v-if="activeLens === 'json'">
          <div class="sub-toolbar">
            <button :class="['sub-btn', { active: bodyMode === 'tree' }]" @click="bodyMode = 'tree'">树</button>
            <button :class="['sub-btn', { active: bodyMode === 'pretty' }]" @click="bodyMode = 'pretty'">格式化</button>
            <button :class="['sub-btn', { active: bodyMode === 'raw' }]" @click="bodyMode = 'raw'">原始</button>
            <button v-if="jsonTable" :class="['sub-btn', { active: bodyMode === 'table' }]" @click="bodyMode = 'table'">表格</button>
            <div class="search-bar">
              <input v-model="searchQuery" type="text" placeholder="搜索响应…" />
              <span v-if="searchQuery.trim()" class="search-count">{{ bodyMode === 'table' && filteredJsonTable ? filteredJsonTable.rows.length : bodySearchCount }} 匹配</span>
            </div>
          </div>
          <JsonTreeViewer
            v-if="bodyMode === 'tree' && parsedJson"
            :data="parsedJson"
            :search-query="searchQuery"
            root-name="response"
            class="lens-fill"
          />
          <CodeMirrorEditor
            v-else-if="bodyMode === 'pretty'"
            :model-value="formattedBody"
            :language="responseLanguage"
            :readonly="true"
            class="lens-fill"
          />
          <pre v-else-if="bodyMode === 'raw'" class="lens-raw">{{ store.response.body }}</pre>
          <div v-else-if="bodyMode === 'table' && filteredJsonTable" class="lens-fill lens-table-wrap">
            <table class="lens-table">
              <thead><tr><th v-for="col in filteredJsonTable.columns" :key="col">{{ col }}</th></tr></thead>
              <tbody>
                <tr v-for="(row, ri) in filteredJsonTable.rows" :key="ri">
                  <td v-for="col in filteredJsonTable.columns" :key="col">{{ formatJsonCell(row as Record<string, unknown>, col) }}</td>
                </tr>
              </tbody>
            </table>
          </div>
        </template>

        <!-- Raw lens -->
        <template v-else-if="activeLens === 'raw'">
          <pre class="lens-raw">{{ store.response.body }}</pre>
        </template>

        <!-- XML lens -->
        <template v-else-if="activeLens === 'xml'">
          <CodeMirrorEditor
            :model-value="formattedBody"
            language="xml"
            :readonly="true"
            class="lens-fill"
          />
        </template>

        <!-- HTML lens -->
        <template v-else-if="activeLens === 'html'">
          <div class="sub-toolbar">
            <button :class="['sub-btn', { active: htmlView === 'preview' }]" @click="htmlView = 'preview'">预览</button>
            <button :class="['sub-btn', { active: htmlView === 'source' }]" @click="htmlView = 'source'">源码</button>
          </div>
          <iframe
            v-if="htmlView === 'preview'"
            class="lens-fill preview-frame"
            sandbox=""
            :srcdoc="previewSrcdoc"
            title="HTML 预览"
          ></iframe>
          <CodeMirrorEditor
            v-else
            :model-value="formattedBody"
            language="html"
            :readonly="true"
            class="lens-fill"
          />
        </template>

        <!-- Image lens -->
        <template v-else-if="activeLens === 'image'">
          <div class="image-wrap">
            <img :src="previewDataUrl" alt="response image" />
          </div>
        </template>

        <!-- Headers lens -->
        <template v-else-if="activeLens === 'headers'">
          <table class="kv-table">
            <tbody>
              <tr v-for="h in headerEntries" :key="h.key">
                <td class="kv-key">{{ h.key }}</td>
                <td class="kv-value">{{ h.value }}</td>
              </tr>
            </tbody>
          </table>
          <div v-if="!headerEntries.length" class="lens-empty">无响应 Headers</div>
        </template>

        <!-- 请求头 lens -->
        <template v-else-if="activeLens === 'request'">
          <CodeMirrorEditor
            :model-value="actualRequestText"
            language="json"
            :readonly="true"
            class="lens-fill"
          />
        </template>

        <!-- 事件流 lens -->
        <template v-else-if="activeLens === 'events'">
          <div class="events-list">
            <div v-for="ev in streamEvents" :key="ev.index" class="event-row">
              <span class="ev-index">{{ ev.index }}</span>
              <span class="ev-time">{{ ev.time }}</span>
              <span class="ev-event">{{ ev.event }}</span>
              <pre class="ev-data">{{ ev.data }}</pre>
            </div>
            <div v-if="!streamEvents.length" class="lens-empty">暂无事件</div>
          </div>
        </template>

        <!-- 合并结果 lens -->
        <template v-else-if="activeLens === 'merged'">
          <div class="merged-wrap">
            <div class="merged-bar">
              <label class="auto-scroll"><input v-model="autoScrollMerged" type="checkbox" /> 自动滚动</label>
              <button class="meta-action" @click="copyMergedText"><Copy :size="12" /> 复制</button>
            </div>
            <pre ref="mergedContainer" class="merged-text">{{ mergedText || '尚未合并出内容:请确认请求的流式合并配置,或等待更多数据。' }}</pre>
          </div>
        </template>

        <!-- 控制台 lens -->
        <template v-else-if="activeLens === 'console'">
          <div class="sub-toolbar">
            <span class="console-count">{{ consoleLogs.length }} 条日志</span>
            <button class="sub-btn" :disabled="!consoleLogs.length && !scriptTests.length" @click="clearConsole">清空</button>
          </div>
          <div class="console-list">
            <div v-if="!consoleLogs.length" class="lens-empty">暂无脚本日志(前置/后置脚本中的 console 输出)</div>
            <div
              v-for="(log, index) in consoleLogs"
              :key="index"
              :class="['console-line', levelClass(log.level)]"
            >
              <span class="log-time">{{ formatTimestamp(log.timestamp) }}</span>
              <span class="log-level">{{ levelLabel(log.level) }}</span>
              <template v-if="log.level === 'table' && isTableData(log.args)">
                <table class="lens-table log-table">
                  <thead><tr><th v-for="col in parseTableData(log.args)!.columns" :key="col">{{ col }}</th></tr></thead>
                  <tbody>
                    <tr v-for="(row, ri) in parseTableData(log.args)!.rows" :key="ri">
                      <td v-for="(cell, ci) in row.cells" :key="ci">{{ cell }}</td>
                    </tr>
                  </tbody>
                </table>
              </template>
              <span v-else class="log-msg">{{ formatMessage(log.args) }}</span>
            </div>
          </div>
        </template>

        <!-- 测试报告 lens -->
        <template v-else-if="activeLens === 'tests'">
          <div class="test-summary">
            <div class="test-card"><span>总数</span><strong>{{ testSummary.total }}</strong></div>
            <div class="test-card passed"><span>通过</span><strong>{{ testSummary.passed }}</strong></div>
            <div class="test-card failed"><span>失败</span><strong>{{ testSummary.failed }}</strong></div>
            <div class="test-card skipped"><span>跳过</span><strong>{{ testSummary.skipped }}</strong></div>
          </div>
          <table class="kv-table test-table">
            <tbody>
              <tr v-for="(test, index) in scriptTests" :key="`${test.name}-${index}`" :class="{ failed: !test.passed && !test.skipped, skipped: test.skipped }">
                <td class="test-status">{{ testStatusLabel(test) }}</td>
                <td>{{ test.name }}</td>
                <td class="test-error">{{ test.error || '-' }}</td>
              </tr>
            </tbody>
          </table>
        </template>

        <!-- Visualize lens -->
        <template v-else-if="activeLens === 'visualize'">
          <section v-for="item in visualizations" :key="item.id" class="viz-card">
            <header><strong>{{ item.title }}</strong><span>{{ new Date(item.createdAt).toLocaleTimeString() }}</span></header>
            <iframe class="viz-frame" sandbox="" :srcdoc="visualizationSrcdoc(item)" title="pm.visualizer 输出"></iframe>
          </section>
        </template>

        <!-- Diff lens -->
        <template v-else-if="activeLens === 'diff'">
          <div v-if="!previousResponse" class="lens-empty">暂无上一次响应。连续发送两次请求后可对比差异。</div>
          <div v-else-if="diffRows.length === 0" class="lens-empty">与上一次响应无可见差异。</div>
          <table v-else class="kv-table diff-table">
            <tbody>
              <tr v-for="row in diffRows" :key="row.path" :class="`diff-${row.type}`">
                <td class="diff-type">{{ row.type }}</td>
                <td class="diff-path">{{ row.path }}</td>
                <td>{{ row.before }}</td>
                <td>{{ row.after }}</td>
              </tr>
            </tbody>
          </table>
        </template>
      </div>
    </div>
  </div>
</template>

<style scoped>
.response-panel {
  height: 100%;
  display: flex;
  flex-direction: column;
  overflow: hidden;
  background: var(--primary-color);
}

.panel-placeholder {
  flex: 1;
  display: flex;
  flex-direction: column;
  align-items: center;
  justify-content: center;
  gap: 8px;
  padding: 24px;
  color: var(--secondary-color);
  text-align: center;
  overflow: auto;
}

.panel-placeholder h3 {
  color: var(--secondary-dark-color);
  font-size: 14px;
}

.panel-placeholder p {
  font-size: var(--font-size-body);
  max-width: 420px;
}

.spinner {
  width: 22px;
  height: 22px;
  border: 2px solid var(--divider-dark-color);
  border-top-color: var(--accent-color);
  border-radius: 50%;
  animation: spin 0.8s linear infinite;
}

.fail-icon {
  color: var(--status-critical-error-color);
}

.fail-message {
  color: var(--status-critical-error-color);
  font-family: var(--font-code);
  font-size: var(--font-size-body);
  word-break: break-all;
}

.channel-box {
  display: flex;
  flex-direction: column;
  gap: 6px;
  width: min(360px, 100%);
  margin-top: 8px;
  padding: 12px;
  border: 1px solid var(--divider-dark-color);
  border-radius: var(--radius-md);
  background: var(--primary-light-color);
  text-align: left;
}

.channel-title {
  display: flex;
  align-items: center;
  gap: 5px;
  font-size: var(--font-size-tiny);
  font-weight: 700;
  color: var(--secondary-dark-color);
}

.channel-option {
  display: flex;
  flex-direction: column;
  gap: 1px;
  padding: 7px 10px;
  border: 1px solid var(--divider-dark-color);
  border-radius: var(--radius-sm);
  background: var(--primary-color);
  text-align: left;
  transition: border-color 0.12s ease;
}

.channel-option:hover {
  border-color: var(--accent-color);
}

.channel-option.active {
  border-color: var(--accent-color);
  background: color-mix(in srgb, var(--accent-color) 8%, var(--primary-color));
}

.channel-option strong {
  font-size: var(--font-size-body);
  color: var(--secondary-dark-color);
}

.channel-option small {
  font-size: var(--font-size-tiny);
  color: var(--secondary-color);
}

.proxy-input {
  height: 30px;
  font-size: var(--font-size-tiny);
}

.placeholder-action {
  margin-top: 6px;
  padding: 7px 14px;
  border-radius: var(--radius-sm);
  background: var(--accent-color);
  color: var(--accent-contrast-color);
  font-size: var(--font-size-body);
  font-weight: 600;
}

.placeholder-action:hover {
  background: var(--accent-dark-color);
}

.empty-orb {
  display: grid;
  place-items: center;
  width: 52px;
  height: 52px;
  border-radius: 50%;
  background: color-mix(in srgb, var(--accent-color) 12%, transparent);
  color: var(--accent-color);
}

/* ── meta 行(FR-1.3)── */
.response-content {
  flex: 1;
  display: flex;
  flex-direction: column;
  overflow: hidden;
}

.meta-row {
  display: flex;
  align-items: center;
  gap: 7px;
  min-height: 34px;
  padding: 0 12px;
  border-bottom: 1px solid var(--divider-color);
  font-size: var(--font-size-body);
  flex-shrink: 0;
  overflow-x: auto;
}

.status-dot {
  width: 8px;
  height: 8px;
  border-radius: 50%;
  flex-shrink: 0;
}

.status-code {
  font-family: var(--font-code);
  font-weight: 700;
}

.status-text {
  color: var(--secondary-color);
  max-width: 180px;
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
}

.meta-sep {
  color: var(--secondary-light-color);
}

.meta-duration {
  font-family: var(--font-code);
  color: var(--secondary-color);
}

.meta-duration.fast { color: var(--status-success-color); }
.meta-duration.medium { color: var(--status-redirect-color); }
.meta-duration.slow { color: var(--status-critical-error-color); }

.meta-size {
  font-family: var(--font-code);
  color: var(--secondary-color);
}

.stream-indicator {
  display: inline-flex;
  align-items: center;
  gap: 5px;
  color: var(--accent-color);
  font-size: var(--font-size-tiny);
}

.stream-dot {
  width: 6px;
  height: 6px;
  border-radius: 50%;
  background: var(--status-success-color);
  animation: pulse 1.2s ease infinite;
}

.stream-done {
  color: var(--secondary-color);
  font-size: var(--font-size-tiny);
}

.stream-done.cancelled {
  color: var(--status-critical-error-color);
}

.meta-actions {
  display: flex;
  align-items: center;
  gap: 2px;
  margin-left: auto;
}

.meta-action {
  display: inline-flex;
  align-items: center;
  gap: 4px;
  padding: 4px 6px;
  border-radius: var(--radius-sm);
  color: var(--secondary-color);
  font-size: var(--font-size-tiny);
  white-space: nowrap;
}

.meta-action:hover {
  background: var(--primary-dark-color);
  color: var(--secondary-dark-color);
}

.meta-action.cancel {
  color: var(--status-critical-error-color);
}

/* ── lens tabs ── */
.lens-tabs {
  display: flex;
  align-items: center;
  gap: 2px;
  padding: 0 8px;
  border-bottom: 1px solid var(--divider-color);
  min-height: 32px;
  overflow-x: auto;
  flex-shrink: 0;
}

.lens-tab {
  display: inline-flex;
  align-items: center;
  gap: 4px;
  padding: 7px 9px;
  border: none;
  border-bottom: 2px solid transparent;
  background: transparent;
  color: var(--secondary-color);
  font-size: var(--font-size-body);
  white-space: nowrap;
  transition: color 0.12s ease, border-color 0.12s ease;
}

.lens-tab:hover {
  color: var(--secondary-dark-color);
}

.lens-tab.active {
  color: var(--accent-color);
  border-bottom-color: var(--accent-color);
}

.lens-badge {
  min-width: 16px;
  padding: 0 4px;
  border-radius: 999px;
  background: color-mix(in srgb, var(--accent-color) 16%, transparent);
  color: var(--accent-color);
  font-size: var(--font-size-tiny);
  font-weight: 700;
  text-align: center;
}

.lens-divider {
  width: 1px;
  height: 14px;
  margin: 0 4px;
  background: var(--divider-dark-color);
  flex-shrink: 0;
}

.lens-body {
  flex: 1;
  display: flex;
  flex-direction: column;
  overflow: hidden;
}

.lens-fill {
  flex: 1;
  min-height: 0;
}

.sub-toolbar {
  display: flex;
  align-items: center;
  gap: 4px;
  padding: 4px 10px;
  border-bottom: 1px solid var(--divider-color);
  flex-shrink: 0;
}

.sub-btn {
  padding: 3px 8px;
  border-radius: var(--radius-sm);
  color: var(--secondary-color);
  font-size: var(--font-size-tiny);
}

.sub-btn:hover:not(:disabled) {
  background: var(--primary-dark-color);
  color: var(--secondary-dark-color);
}

.sub-btn.active {
  background: color-mix(in srgb, var(--accent-color) 14%, transparent);
  color: var(--accent-color);
}

.sub-btn:disabled {
  opacity: 0.45;
  cursor: not-allowed;
}

.search-bar {
  display: flex;
  align-items: center;
  gap: 6px;
  margin-left: auto;
}

.search-bar input {
  width: 160px;
  height: 24px;
  padding: 0 8px;
  font-size: var(--font-size-tiny);
}

.search-count {
  color: var(--secondary-light-color);
  font-size: var(--font-size-tiny);
  white-space: nowrap;
}

.lens-raw {
  flex: 1;
  margin: 0;
  padding: 10px 12px;
  overflow: auto;
  font-family: var(--font-code);
  font-size: var(--font-size-body);
  line-height: 1.6;
  white-space: pre-wrap;
  word-break: break-word;
  color: var(--secondary-dark-color);
}

.preview-frame {
  border: none;
  background: #fff;
}

.image-wrap {
  flex: 1;
  overflow: auto;
  display: grid;
  place-items: center;
  padding: 16px;
}

.image-wrap img {
  max-width: 100%;
  max-height: 100%;
  border-radius: var(--radius-sm);
}

.lens-empty {
  padding: 14px;
  color: var(--secondary-light-color);
  font-size: var(--font-size-body);
}

.kv-table {
  width: 100%;
  border-collapse: collapse;
  font-size: var(--font-size-body);
}

.kv-table td {
  padding: 6px 12px;
  border-bottom: 1px solid var(--divider-color);
  vertical-align: top;
  word-break: break-all;
}

.kv-key {
  width: 240px;
  font-family: var(--font-code);
  font-weight: 600;
  color: var(--accent-color);
}

.kv-value {
  font-family: var(--font-code);
  color: var(--secondary-dark-color);
  white-space: pre-wrap;
}

.lens-table-wrap {
  overflow: auto;
}

.lens-table {
  width: 100%;
  border-collapse: collapse;
  font-size: var(--font-size-body);
}

.lens-table th,
.lens-table td {
  padding: 5px 10px;
  border-bottom: 1px solid var(--divider-color);
  text-align: left;
  white-space: nowrap;
  max-width: 320px;
  overflow: hidden;
  text-overflow: ellipsis;
}

.lens-table th {
  position: sticky;
  top: 0;
  background: var(--primary-light-color);
  color: var(--secondary-color);
  font-weight: 600;
}

/* 事件流 */
.events-list {
  flex: 1;
  overflow: auto;
  padding: 6px 10px;
  display: flex;
  flex-direction: column;
  gap: 4px;
}

.event-row {
  display: grid;
  grid-template-columns: 30px 76px 70px minmax(0, 1fr);
  gap: 6px;
  align-items: start;
  padding: 4px 6px;
  border: 1px solid var(--divider-color);
  border-radius: var(--radius-sm);
}

.ev-index,
.ev-time {
  font-family: var(--font-code);
  font-size: var(--font-size-tiny);
  color: var(--secondary-light-color);
  padding-top: 2px;
}

.ev-index {
  text-align: right;
}

.ev-event {
  font-family: var(--font-code);
  font-size: var(--font-size-tiny);
  font-weight: 700;
  color: var(--accent-color);
  padding-top: 2px;
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
}

.ev-data {
  margin: 0;
  font-family: var(--font-code);
  font-size: var(--font-size-tiny);
  color: var(--secondary-dark-color);
  white-space: pre-wrap;
  word-break: break-word;
  max-height: 110px;
  overflow: auto;
}

/* 合并结果 */
.merged-wrap {
  flex: 1;
  display: flex;
  flex-direction: column;
  min-height: 0;
  padding: 6px 10px;
  gap: 4px;
}

.merged-bar {
  display: flex;
  align-items: center;
  justify-content: space-between;
}

.auto-scroll {
  display: inline-flex;
  align-items: center;
  gap: 5px;
  font-size: var(--font-size-tiny);
  color: var(--secondary-color);
  cursor: pointer;
}

.merged-text {
  flex: 1;
  min-height: 0;
  margin: 0;
  padding: 10px 12px;
  overflow: auto;
  border: 1px solid color-mix(in srgb, var(--accent-color) 40%, var(--divider-dark-color));
  border-radius: var(--radius-md);
  background: var(--primary-light-color);
  font-family: var(--font-code);
  font-size: var(--font-size-body);
  line-height: 1.6;
  white-space: pre-wrap;
  word-break: break-word;
  color: var(--secondary-dark-color);
}

/* 控制台 */
.console-count {
  color: var(--secondary-light-color);
  font-size: var(--font-size-tiny);
  margin-right: auto;
}

.console-list {
  flex: 1;
  overflow: auto;
  padding: 4px 10px;
  font-family: var(--font-code);
  font-size: var(--font-size-tiny);
}

.console-line {
  display: flex;
  align-items: baseline;
  gap: 8px;
  padding: 3px 0;
  border-bottom: 1px solid color-mix(in srgb, var(--divider-color) 60%, transparent);
}

.log-time {
  color: var(--secondary-light-color);
  flex-shrink: 0;
}

.log-level {
  font-weight: 700;
  color: var(--accent-color);
  flex-shrink: 0;
  width: 36px;
}

.log-msg {
  color: var(--secondary-dark-color);
  white-space: pre-wrap;
  word-break: break-word;
}

.console-line.log-error .log-level,
.console-line.log-error .log-msg {
  color: var(--status-critical-error-color);
}

.console-line.log-warn .log-level,
.console-line.log-warn .log-msg {
  color: var(--status-redirect-color);
}

.log-table {
  margin: 2px 0;
}

/* 测试报告 */
.test-summary {
  display: grid;
  grid-template-columns: repeat(4, minmax(0, 1fr));
  gap: 8px;
  padding: 10px 12px;
}

.test-card {
  padding: 8px 10px;
  border: 1px solid var(--divider-color);
  border-radius: var(--radius-md);
  text-align: center;
}

.test-card span {
  display: block;
  font-size: var(--font-size-tiny);
  color: var(--secondary-color);
}

.test-card strong {
  font-size: 16px;
  color: var(--secondary-dark-color);
}

.test-card.passed strong { color: var(--status-success-color); }
.test-card.failed strong { color: var(--status-critical-error-color); }
.test-card.skipped strong { color: var(--secondary-light-color); }

.test-table {
  margin: 0 12px 12px;
}

.test-status {
  width: 52px;
  font-family: var(--font-code);
  font-weight: 700;
  color: var(--status-success-color);
}

.test-table tr.failed .test-status { color: var(--status-critical-error-color); }
.test-table tr.skipped .test-status { color: var(--secondary-light-color); }
.test-error { color: var(--status-critical-error-color); }

/* Visualize */
.viz-card {
  margin: 10px 12px;
  border: 1px solid var(--divider-color);
  border-radius: var(--radius-md);
  overflow: hidden;
}

.viz-card header {
  display: flex;
  justify-content: space-between;
  padding: 6px 10px;
  border-bottom: 1px solid var(--divider-color);
  font-size: var(--font-size-tiny);
  color: var(--secondary-color);
}

.viz-frame {
  width: 100%;
  height: 240px;
  border: none;
  background: #fff;
}

/* Diff */
.diff-table {
  margin: 10px 12px;
}

.diff-type {
  width: 60px;
  font-family: var(--font-code);
  text-transform: capitalize;
}

.diff-path {
  width: 220px;
  font-family: var(--font-code);
  color: var(--secondary-color);
}

.diff-added { background: color-mix(in srgb, var(--status-success-color) 8%, transparent); }
.diff-removed { background: color-mix(in srgb, var(--status-critical-error-color) 8%, transparent); }
.diff-changed { background: color-mix(in srgb, var(--status-redirect-color) 8%, transparent); }

/* 最近发送 */
.recent-history {
  width: min(560px, 100%);
  border: 1px solid var(--divider-color);
  border-radius: var(--radius-md);
  background: var(--primary-light-color);
  overflow: hidden;
  text-align: left;
}

.recent-title {
  display: flex;
  align-items: baseline;
  gap: 8px;
  padding: 8px 12px;
  border-bottom: 1px solid var(--divider-color);
  font-weight: 600;
  color: var(--secondary-dark-color);
  font-size: var(--font-size-body);
}

.recent-title small {
  font-weight: 400;
  color: var(--secondary-light-color);
  font-size: var(--font-size-tiny);
}

.recent-item {
  display: flex;
  align-items: center;
  gap: 8px;
  width: 100%;
  padding: 6px 12px;
  font-size: var(--font-size-tiny);
  color: var(--secondary-color);
  border-bottom: 1px solid color-mix(in srgb, var(--divider-color) 60%, transparent);
  text-align: left;
}

.recent-item:hover {
  background: var(--primary-dark-color);
}

.recent-item:last-child {
  border-bottom: none;
}

.recent-item code {
  flex: 1;
  min-width: 0;
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
  font-family: var(--font-code);
  color: var(--secondary-dark-color);
}

.recent-status,
.recent-duration,
.recent-time {
  font-family: var(--font-code);
  flex-shrink: 0;
}

.recent-send {
  display: inline-flex;
  padding: 3px;
  border-radius: var(--radius-sm);
  color: var(--secondary-light-color);
}

.recent-send:hover {
  color: var(--accent-color);
  background: color-mix(in srgb, var(--accent-color) 12%, transparent);
}

@keyframes spin {
  to { transform: rotate(360deg); }
}

@keyframes pulse {
  0%, 100% { opacity: 1; }
  50% { opacity: 0.35; }
}
</style>
