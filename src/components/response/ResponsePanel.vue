<script setup lang="ts">
import { ref, computed, watch } from 'vue'
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
const activeTab = ref('body')
const bodyMode = ref('tree')
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

function cancelRequest() {
  store.cancelCurrentRequest()
}

const responseTabs = [
  { key: 'body', label: 'Body' },
  { key: 'headers', label: 'Headers' },
  { key: 'cookies', label: 'Cookie' },
  { key: 'console', label: '控制台' },
  { key: 'tests', label: '测试报告' },
  { key: 'visualize', label: 'Visualize' },
  { key: 'diff', label: 'Diff' },
  { key: 'actual', label: '实际请求' },
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

const cookieEntries = computed(() => {
  if (!store.response) return []
  const setCookie = store.response.headers['set-cookie'] || store.response.headers['Set-Cookie'] || ''
  if (!setCookie) return []
  return setCookie.split(/,(?=\s*[^;,=]+=[^;,]+)/).map(cookie => {
    const [pair, ...attrs] = cookie.split(';')
    const eqIdx = pair.indexOf('=')
    return {
      key: eqIdx > -1 ? pair.slice(0, eqIdx).trim() : pair.trim(),
      value: eqIdx > -1 ? pair.slice(eqIdx + 1).trim() : '',
      attrs: attrs.map(item => item.trim()).filter(Boolean).join('; '),
    }
  })
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

function isJsonResponseData(response: ResponseData): boolean {
  if (!response.body || response.bodyEncoding === 'base64') return false
  try {
    JSON.parse(response.body)
    return true
  } catch {
    return false
  }
}

function preferredBodyMode(response: ResponseData): typeof bodyMode.value {
  const ct = responseContentType(response).toLowerCase()
  if (isJsonResponseData(response)) return 'tree'
  if (ct.includes('html') || ct.includes('image/') || ct.includes('pdf') || ct.includes('svg')) return 'preview'
  return 'pretty'
}

watch(() => store.response, (next, prev) => {
  if (prev && prev !== next) previousResponse.value = prev
  if (next) {
    bodyMode.value = preferredBodyMode(next)
  }
})

const contentType = computed(() => store.response ? responseContentType(store.response) : '')

const isPreviewable = computed(() => {
  const ct = contentType.value.toLowerCase()
  return ct.includes('html') || ct.includes('image/') || ct.includes('pdf') || ct.includes('svg')
})

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
  const ct = contentType.value.toLowerCase()
  if (ct.includes('html') || ct.includes('svg')) return store.response.body
  return `<pre>${escapeHtml(store.response.body)}</pre>`
})

const previewDataUrl = computed(() => {
  if (!store.response) return ''
  const ct = contentType.value || 'text/plain'
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

function historyStatusClass(status: number): string {
  if (status >= 200 && status < 300) return 'success'
  if (status >= 300 && status < 400) return 'redirect'
  if (status >= 400 && status < 500) return 'client-error'
  if (status >= 500 || status === 0) return 'server-error'
  return ''
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

function testReportMarkdown(): string {
  if (scriptTests.value.length === 0) return ''
  const { total, passed, failed, skipped } = testSummary.value
  return [
    '#### Script Test Report',
    '',
    `- Total: ${total}`,
    `- Passed: ${passed}`,
    `- Failed: ${failed}`,
    `- Skipped: ${skipped}`,
    '',
    '| Result | Test | Error |',
    '|---|---|---|',
    ...scriptTests.value.map(test => `| ${testStatusLabel(test)} | ${test.name.replace(/\|/g, '\\|')} | ${(test.error || '').replace(/\|/g, '\\|')} |`),
    '',
  ].join('\n')
}

function testReportHtml(): string {
  if (scriptTests.value.length === 0) return '<p>无脚本测试结果</p>'
  return `<div class="grid">
        <div class="metric"><span>Total Tests</span><strong>${testSummary.value.total}</strong></div>
        <div class="metric"><span>Passed</span><strong>${testSummary.value.passed}</strong></div>
        <div class="metric"><span>Failed</span><strong>${testSummary.value.failed}</strong></div>
        <div class="metric"><span>Skipped</span><strong>${testSummary.value.skipped}</strong></div>
      </div>
      <table><tbody>${scriptTests.value.map(test => `<tr><th>${escapeHtml(testStatusLabel(test))}</th><td>${escapeHtml(test.name)}${test.error ? `<br><small>${escapeHtml(test.error)}</small>` : ''}</td></tr>`).join('')}</tbody></table>`
}

async function copyResponse() {
  if (!store.response) return
  await navigator.clipboard.writeText(store.response.bodyEncoding === 'base64' ? responseDataUrl(store.response) : store.response.body)
}

function saveResponse() {
  if (!store.response) return
  const contentType = responseContentType(store.response)
  const extension = responseFileExtension(contentType)
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
  const tests = testReportMarkdown()
  if (tests) {
    lines.push('')
    lines.push(tests)
  }

  return lines.join('\n')
}

function generateResponseHtmlReport(): string {
  const response = store.response
  if (!response) return ''
  const api = store.getCurrentApi()
  const headers = Object.entries(response.headers)
    .map(([key, value]) => `<tr><th>${escapeHtml(key)}</th><td>${escapeHtml(value)}</td></tr>`)
    .join('')
  const body = escapeHtml(responseExampleBody())
  const request = escapeHtml(actualRequestText.value)
  const statusTone = response.status >= 200 && response.status < 300 ? '#16a34a' : response.status >= 400 ? '#dc2626' : '#f59e0b'
  return `<!doctype html>
<html lang="zh-CN">
<head>
  <meta charset="utf-8" />
  <meta name="viewport" content="width=device-width, initial-scale=1" />
  <title>ApiFix Response Report</title>
  <style>
    :root{color-scheme:light dark;--bg:#f8fafc;--panel:#fff;--text:#0f172a;--muted:#64748b;--border:#e2e8f0;--code:#0f172a}
    @media (prefers-color-scheme:dark){:root{--bg:#0f172a;--panel:#111827;--text:#e5e7eb;--muted:#94a3b8;--border:#334155;--code:#020617}}
    body{margin:0;padding:32px;font-family:-apple-system,BlinkMacSystemFont,"Segoe UI",sans-serif;background:var(--bg);color:var(--text)}
    main{max-width:1080px;margin:auto;display:grid;gap:18px}
    section,header{border:1px solid var(--border);border-radius:18px;background:var(--panel);box-shadow:0 12px 30px rgba(15,23,42,.08);padding:20px}
    .kicker{color:var(--muted);font-size:12px;text-transform:uppercase;letter-spacing:.12em}
    h1{margin:.2em 0;font-size:28px} h2{margin:0 0 12px;font-size:18px}
    .status{display:inline-flex;align-items:center;gap:8px;border-radius:999px;background:${statusTone}22;color:${statusTone};font-weight:800;padding:8px 12px}
    .grid{display:grid;grid-template-columns:repeat(auto-fit,minmax(180px,1fr));gap:10px;margin-top:14px}.metric{border:1px solid var(--border);border-radius:14px;padding:12px}.metric span{display:block;color:var(--muted);font-size:12px}.metric strong{font-size:16px}
    table{width:100%;border-collapse:collapse;font-size:13px}th,td{border-top:1px solid var(--border);padding:9px;text-align:left;vertical-align:top}th{width:220px;color:var(--muted)}
    pre{margin:0;white-space:pre-wrap;word-break:break-word;border-radius:14px;background:var(--code);color:#e5e7eb;padding:16px;overflow:auto;font:12px/1.6 ui-monospace,SFMono-Regular,Menlo,monospace}
  </style>
</head>
<body>
  <main>
    <header>
      <div class="kicker">ApiFix Response Report</div>
      <h1>${escapeHtml(api?.name || `${response.method} ${response.url}`)}</h1>
      <p><strong>${escapeHtml(response.method)}</strong> <code>${escapeHtml(response.url)}</code></p>
      <span class="status">${response.status} ${escapeHtml(response.statusText)}</span>
      <div class="grid">
        <div class="metric"><span>Duration</span><strong>${response.duration}ms</strong></div>
        <div class="metric"><span>Size</span><strong>${escapeHtml(sizeFormatted.value)}</strong></div>
        <div class="metric"><span>Content-Type</span><strong>${escapeHtml(responseContentType(response))}</strong></div>
        <div class="metric"><span>Generated</span><strong>${escapeHtml(new Date().toLocaleString())}</strong></div>
      </div>
    </header>
    <section><h2>Response Headers</h2><table><tbody>${headers || '<tr><td>无 Headers</td></tr>'}</tbody></table></section>
    <section><h2>Script Test Report</h2>${testReportHtml()}</section>
    <section><h2>Response Body</h2><pre>${body}</pre></section>
    <section><h2>Actual Request</h2><pre>${request}</pre></section>
  </main>
</body>
</html>`
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

function exportResponseHtmlReport() {
  if (!store.response) return
  const html = generateResponseHtmlReport()
  const blob = new Blob([html], { type: 'text/html;charset=utf-8' })
  const url = URL.createObjectURL(blob)
  const a = document.createElement('a')
  a.href = url
  a.download = `api-response-report-${new Date(store.response.timestamp).toISOString().replace(/[:.]/g, '-')}.html`
  a.click()
  URL.revokeObjectURL(url)
}
</script>

<template>
  <div class="response-panel">
    <!-- Loading state with cancel button -->
    <div v-if="store.loading && !store.response" class="response-empty response-loading">
      <span class="response-spinner"></span>
      <h3>请求发送中</h3>
      <p>正在等待服务器响应，稍后会自动展示状态、耗时和响应体。</p>
      <button class="cancel-request-btn" @click="cancelRequest">取消请求</button>
    </div>
    <!-- Streaming state: response arrived but still receiving chunks -->
    <div v-else-if="store.loading && store.response && isStreaming" class="response-content">
      <div class="response-status-bar">
        <span :class="['status-code', statusClass]">
          {{ store.response.status }} {{ store.response.statusText }}
        </span>
        <span :class="['response-meta', durationClass]">{{ store.response.duration }}ms</span>
        <span class="response-meta">{{ sizeFormatted }}</span>
        <span class="streaming-indicator">
          <span class="streaming-dot"></span>
          {{ streamTypeLabel }} 流式接收中... ({{ chunkCount }} 个数据块)
        </span>
        <div class="response-actions">
          <button class="cancel-request-btn-inline" @click="cancelRequest">取消请求</button>
        </div>
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
            <span class="streaming-chunk-badge">{{ chunkCount }} chunks</span>
          </div>
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
        <div v-if="activeTab === 'cookies'" class="resp-headers">
          <table v-if="cookieEntries.length > 0" class="headers-table">
            <thead>
              <tr><th>Name</th><th>Value</th><th>Attrs</th></tr>
            </thead>
            <tbody>
              <tr v-for="c in cookieEntries" :key="c.key">
                <td class="header-key">{{ c.key }}</td>
                <td class="header-value">{{ c.value }}</td>
                <td class="header-value">{{ c.attrs }}</td>
              </tr>
            </tbody>
          </table>
          <div v-else class="console-empty">响应未暴露 Set-Cookie Header，或当前浏览器环境不可读取。</div>
        </div>
        <div v-if="activeTab === 'actual'" class="resp-body">
          <CodeMirrorEditor
            :model-value="actualRequestText"
            language="json"
            :readonly="true"
            class="response-cm-pretty"
          />
        </div>
      </div>
    </div>
    <!-- Cancelled state with partial data: show response content with cancelled banner -->
    <div v-else-if="isCancelled && store.response?.body" class="response-content">
      <div class="response-status-bar">
        <span class="status-code cancelled-status">
          {{ store.response.status || 0 }} 请求已取消
        </span>
        <span :class="['response-meta', durationClass]">{{ store.response.duration }}ms</span>
        <span class="response-meta">{{ sizeFormatted }}</span>
        <span class="stream-completed-badge cancelled-badge">
          已取消 (已接收 {{ chunkCount }} 个数据块)
        </span>
        <div class="response-actions">
          <button class="resp-action-btn" @click="copyResponse">复制响应</button>
          <button class="resp-action-btn" @click="saveResponse">⬇ 保存</button>
        </div>
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
        <div v-if="activeTab === 'actual'" class="resp-body">
          <CodeMirrorEditor
            :model-value="actualRequestText"
            language="json"
            :readonly="true"
            class="response-cm-pretty"
          />
        </div>
      </div>
    </div>
    <!-- Cancelled state with no data -->
    <div v-else-if="isCancelled" class="response-empty response-cancelled">
      <div class="cancelled-icon">&#9888;</div>
      <h3>请求已取消</h3>
      <p>请求在发送过程中被手动取消。</p>
    </div>
    <div v-else-if="!store.response" class="response-empty">
      <template v-if="recentHistory.length > 0">
        <div class="recent-history-panel">
          <div class="recent-history-title">
            <span>🕐 最近发送</span>
            <small>点击复用，或按 Ctrl+Enter 发送当前请求</small>
          </div>
          <button
            v-for="entry in recentHistory"
            :key="entry.id"
            class="recent-history-item"
            @click="loadHistoryEntry(entry)"
          >
            <span :class="['method-badge', entry.method.toLowerCase()]">{{ entry.method }}</span>
            <code>{{ historyDisplayPath(entry) }}</code>
            <span :class="['recent-status', historyStatusClass(entry.status)]">{{ entry.status }}</span>
            <span class="recent-duration">{{ entry.duration }}ms</span>
            <span class="recent-time">{{ relativeHistoryTime(entry.timestamp) }}</span>
            <span class="recent-send" @click="resendHistoryEntry(entry, $event)">▶</span>
          </button>
        </div>
      </template>
      <template v-else>
        <div class="empty-orb">↯</div>
        <h3>响应预览区</h3>
        <p>发送请求后在此查看 Body、Headers 与脚本 Console。</p>
      </template>
    </div>
    <div v-else class="response-content">
      <div class="response-status-bar">
        <span :class="['status-code', statusClass]">
          {{ store.response.status }} {{ store.response.statusText }}
        </span>
        <span :class="['response-meta', durationClass]">{{ store.response.duration }}ms</span>
        <span class="response-meta">{{ sizeFormatted }}</span>
        <span v-if="store.response.streamCompleted" class="stream-completed-badge">
          {{ streamTypeLabel }} 流式接收完成 ({{ chunkCount }} 个数据块)
        </span>
        <span v-else class="response-meta content-type-meta" :title="responseContentTypeLabel">
          响应头: {{ responseContentTypeLabel }}
        </span>
        <div class="response-actions">
          <button class="resp-action-btn" @click="copyResponse">复制响应</button>
          <button class="resp-action-btn" @click="saveResponse">⬇ 保存</button>
          <button class="resp-action-btn" @click="exportResponseDoc">生成文档</button>
          <button class="resp-action-btn" @click="exportResponseHtmlReport">HTML 报告</button>
        </div>
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
            <button v-if="jsonTable" :class="['mode-btn', { active: bodyMode === 'table' }]" @click="bodyMode = 'table'">Table</button>
            <button v-if="isPreviewable" :class="['mode-btn', { active: bodyMode === 'preview' }]" @click="bodyMode = 'preview'">Preview</button>
            <div class="search-bar">
              <input
                v-model="searchQuery"
                type="text"
                class="search-input"
                placeholder="搜索响应 Body..."
              />
              <span v-if="searchQuery.trim()" class="search-count">{{ bodyMode === 'table' && filteredJsonTable ? filteredJsonTable.rows.length : bodySearchCount }} 匹配</span>
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
          <div v-if="bodyMode === 'table' && filteredJsonTable" class="response-table-wrap">
            <table class="json-table">
              <thead><tr><th v-for="col in filteredJsonTable.columns" :key="col">{{ col }}</th></tr></thead>
              <tbody>
                <tr v-for="(row, ri) in filteredJsonTable.rows" :key="ri">
                  <td v-for="col in filteredJsonTable.columns" :key="col">{{ formatJsonCell(row as Record<string, unknown>, col) }}</td>
                </tr>
              </tbody>
            </table>
          </div>
          <div v-if="bodyMode === 'preview'" class="response-preview">
            <iframe
              v-if="contentType.toLowerCase().includes('html') || contentType.toLowerCase().includes('svg')"
              class="preview-frame"
              sandbox=""
              :srcdoc="previewSrcdoc"
              title="response preview"
            ></iframe>
            <img v-else-if="contentType.toLowerCase().includes('image/')" :src="previewDataUrl" alt="response preview" class="preview-image" />
            <iframe v-else-if="contentType.toLowerCase().includes('pdf')" class="preview-frame" :src="previewDataUrl" title="pdf preview"></iframe>
            <pre v-else class="response-raw">{{ store.response.body }}</pre>
          </div>
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
        <div v-if="activeTab === 'cookies'" class="resp-headers">
          <table v-if="cookieEntries.length > 0" class="headers-table">
            <thead>
              <tr><th>Name</th><th>Value</th><th>Attrs</th></tr>
            </thead>
            <tbody>
              <tr v-for="c in cookieEntries" :key="c.key">
                <td class="header-key">{{ c.key }}</td>
                <td class="header-value">{{ c.value }}</td>
                <td class="header-value">{{ c.attrs }}</td>
              </tr>
            </tbody>
          </table>
          <div v-else class="console-empty">响应未暴露 Set-Cookie Header，或当前浏览器环境不可读取。</div>
        </div>
        <div v-if="activeTab === 'console'" class="resp-console">
          <div class="console-toolbar">
            <span class="console-count">{{ consoleLogs.length }} 条日志</span>
            <button class="console-clear-btn" @click="clearConsole" :disabled="consoleLogs.length === 0 && scriptTests.length === 0">清空</button>
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
        <div v-if="activeTab === 'tests'" class="resp-tests">
          <div v-if="scriptTests.length === 0" class="console-empty">暂无脚本测试结果。可在后置脚本中调用 pm.test(...) 生成结构化测试报告。</div>
          <template v-else>
            <div class="test-summary-grid">
              <div class="test-summary-card"><span>总数</span><strong>{{ testSummary.total }}</strong></div>
              <div class="test-summary-card passed"><span>通过</span><strong>{{ testSummary.passed }}</strong></div>
              <div class="test-summary-card failed"><span>失败</span><strong>{{ testSummary.failed }}</strong></div>
              <div class="test-summary-card skipped"><span>跳过</span><strong>{{ testSummary.skipped }}</strong></div>
            </div>
            <table class="test-table">
              <thead><tr><th>结果</th><th>测试项</th><th>错误</th></tr></thead>
              <tbody>
                <tr v-for="(test, index) in scriptTests" :key="`${test.name}-${index}`" :class="{ failed: !test.passed && !test.skipped, skipped: test.skipped }">
                  <td><span class="test-status">{{ testStatusLabel(test) }}</span></td>
                  <td>{{ test.name }}</td>
                  <td>{{ test.error || '-' }}</td>
                </tr>
              </tbody>
            </table>
          </template>
        </div>
        <div v-if="activeTab === 'visualize'" class="resp-visualize">
          <div v-if="visualizations.length === 0" class="console-empty">暂无 pm.visualizer 输出。可在后置脚本中调用 pm.visualizer.template(...) 或 pm.visualizer.table(...).</div>
          <div v-else class="visualization-list">
            <section v-for="item in visualizations" :key="item.id" class="visualization-card">
              <header>
                <strong>{{ item.title }}</strong>
                <span>{{ new Date(item.createdAt).toLocaleTimeString() }}</span>
              </header>
              <iframe
                class="visualization-frame"
                sandbox=""
                :srcdoc="visualizationSrcdoc(item)"
                title="pm.visualizer output"
              ></iframe>
            </section>
          </div>
        </div>
        <div v-if="activeTab === 'diff'" class="resp-diff">
          <div v-if="!previousResponse" class="console-empty">暂无上一次响应。连续发送两次请求后可对比响应差异。</div>
          <div v-else-if="diffRows.length === 0" class="console-empty">上一次响应与当前响应无可见差异。</div>
          <table v-else class="diff-table">
            <thead><tr><th>类型</th><th>路径/行</th><th>上次</th><th>本次</th></tr></thead>
            <tbody>
              <tr v-for="row in diffRows" :key="row.path" :class="`diff-${row.type}`">
                <td>{{ row.type }}</td>
                <td class="diff-path">{{ row.path }}</td>
                <td>{{ row.before }}</td>
                <td>{{ row.after }}</td>
              </tr>
            </tbody>
          </table>
        </div>
        <div v-if="activeTab === 'actual'" class="resp-body">
          <CodeMirrorEditor
            :model-value="actualRequestText"
            language="json"
            :readonly="true"
            class="response-cm-pretty"
          />
        </div>
      </div>
    </div>
  </div>
</template>

<style scoped>
.response-panel {
  height: 320px;
  min-height: 180px;
  max-height: min(70vh, 640px);
  resize: vertical;
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

.recent-history-panel {
  width: min(760px, calc(100% - 32px));
  display: grid;
  gap: 8px;
  padding: 14px;
  border: 1px solid var(--border);
  border-radius: var(--radius-xl);
  background: color-mix(in srgb, var(--bg-panel) 88%, transparent);
  box-shadow: var(--shadow-sm);
  text-align: left;
}

.recent-history-title {
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: 12px;
  color: var(--text-primary);
  font-weight: 800;
}

.recent-history-title small {
  color: var(--text-tertiary);
  font-weight: 500;
}

.recent-history-item {
  display: grid;
  grid-template-columns: auto minmax(0, 1fr) auto auto auto auto;
  align-items: center;
  gap: 8px;
  min-height: 34px;
  padding: 6px 8px;
  border: 1px solid transparent;
  border-radius: var(--radius-lg);
  background: var(--bg-panel-elevated);
  color: var(--text-primary);
  cursor: pointer;
  text-align: left;
}

.recent-history-item:hover {
  border-color: var(--primary);
  background: var(--bg-hover);
}

.recent-history-item code {
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
  font-family: var(--font-code);
}

.recent-status,
.recent-duration,
.recent-time {
  font-size: var(--font-size-small);
  font-weight: 750;
  white-space: nowrap;
}

.recent-status.success { color: var(--success); }
.recent-status.redirect { color: var(--info); }
.recent-status.client-error { color: var(--warning); }
.recent-status.server-error { color: var(--error); }

.recent-duration,
.recent-time {
  color: var(--text-tertiary);
}

.recent-send {
  display: inline-grid;
  place-items: center;
  width: 24px;
  height: 24px;
  border-radius: 999px;
  color: var(--primary);
  background: var(--primary-soft);
  font-size: 11px;
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

/* Cancel request button (in loading empty state) */
.cancel-request-btn {
  margin-top: 8px;
  padding: 6px 18px;
  border: 1px solid var(--error);
  border-radius: var(--radius-lg);
  background: transparent;
  color: var(--error);
  cursor: pointer;
  font-size: var(--font-size-small);
  font-weight: 700;
  transition: background 0.15s ease, color 0.15s ease;
}

.cancel-request-btn:hover {
  background: var(--error);
  color: #fff;
}

/* Cancel request button (inline in status bar during streaming) */
.cancel-request-btn-inline {
  padding: 3px 10px;
  border: 1px solid var(--error);
  border-radius: var(--radius-lg);
  background: transparent;
  color: var(--error);
  cursor: pointer;
  font-size: var(--font-size-small);
  font-weight: 700;
  transition: background 0.15s ease, color 0.15s ease;
}

.cancel-request-btn-inline:hover {
  background: var(--error);
  color: #fff;
}

/* Streaming indicator in status bar */
.streaming-indicator {
  display: inline-flex;
  align-items: center;
  gap: 6px;
  color: var(--info);
  font-size: var(--font-size-small);
  font-weight: 700;
  padding: 3px 10px;
  border-radius: 999px;
  background: color-mix(in srgb, var(--info) 10%, var(--bg-panel));
}

.streaming-dot {
  width: 7px;
  height: 7px;
  border-radius: 50%;
  background: var(--info);
  animation: pulse-dot 1.2s ease-in-out infinite;
}

@keyframes pulse-dot {
  0%, 100% { opacity: 1; transform: scale(1); }
  50% { opacity: 0.4; transform: scale(0.7); }
}

/* Stream completed badge in status bar */
.stream-completed-badge {
  display: inline-flex;
  align-items: center;
  gap: 4px;
  color: var(--success);
  font-size: var(--font-size-small);
  font-weight: 700;
  padding: 3px 10px;
  border-radius: 999px;
  background: color-mix(in srgb, var(--success) 10%, var(--bg-panel));
}

/* Chunk count badge in body mode bar */
.streaming-chunk-badge {
  margin-left: auto;
  font-size: 11px;
  color: var(--info);
  font-weight: 600;
  padding: 2px 8px;
  border-radius: 999px;
  background: color-mix(in srgb, var(--info) 10%, var(--bg-panel));
}

/* Cancelled state */
.response-cancelled {
  display: flex;
  flex-direction: column;
  gap: 8px;
  align-items: center;
  justify-content: center;
  flex: 1;
  text-align: center;
  color: var(--text-secondary);
  background:
    radial-gradient(circle at 50% 35%, color-mix(in srgb, var(--warning) 12%, transparent), transparent 36%),
    var(--bg-code);
}

.cancelled-icon {
  font-size: 32px;
  color: var(--warning);
}

.response-cancelled h3 {
  color: var(--text-primary);
  font-size: 15px;
}

.response-cancelled p {
  max-width: 360px;
  color: var(--text-tertiary);
  line-height: 1.6;
}

/* Cancelled status badge in status bar */
.cancelled-status {
  color: var(--warning) !important;
}

.cancelled-badge {
  color: var(--warning) !important;
  background: color-mix(in srgb, var(--warning) 10%, var(--bg-panel)) !important;
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

.content-type-meta {
  max-width: 220px;
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
}

.response-actions {
  margin-left: auto;
  display: flex;
  gap: 6px;
}

.resp-action-btn {
  border: 1px solid var(--border);
  border-radius: var(--radius-lg);
  background: var(--bg-panel);
  color: var(--text-secondary);
  cursor: pointer;
  padding: 3px 8px;
  font-size: var(--font-size-small);
}

.resp-action-btn:hover {
  color: var(--text-primary);
  border-color: var(--primary);
}

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

.search-count {
  color: var(--text-tertiary);
  font-size: var(--font-size-small);
  white-space: nowrap;
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


.response-table-wrap,
.response-preview,
.resp-diff {
  flex: 1;
  overflow: auto;
  background: var(--bg-code);
}

.json-table,
.diff-table {
  width: 100%;
  border-collapse: collapse;
  font-size: var(--font-size-small);
  background: var(--bg-panel);
}

.json-table th,
.json-table td,
.diff-table th,
.diff-table td {
  border: 1px solid var(--divider);
  padding: 5px 8px;
  text-align: left;
  vertical-align: top;
  max-width: 320px;
  word-break: break-word;
}

.json-table th,
.diff-table th {
  position: sticky;
  top: 0;
  z-index: 1;
  background: var(--bg-panel-elevated);
  color: var(--text-secondary);
}

.preview-frame {
  width: 100%;
  min-height: 100%;
  border: 0;
  background: #fff;
}

.preview-image {
  max-width: 100%;
  display: block;
  margin: 12px auto;
}

.diff-path {
  font-family: var(--font-code);
  color: var(--text-secondary);
  min-width: 140px;
}

.diff-added td { background: color-mix(in srgb, var(--success) 10%, var(--bg-panel)); }
.diff-removed td { background: color-mix(in srgb, var(--error) 10%, var(--bg-panel)); }
.diff-changed td { background: color-mix(in srgb, var(--warning) 12%, var(--bg-panel)); }

/* Test report styles */
.resp-tests {
  flex: 1;
  overflow: auto;
  background: var(--bg-code);
  padding: 10px;
}

.test-summary-grid {
  display: grid;
  grid-template-columns: repeat(4, minmax(80px, 1fr));
  gap: 8px;
  margin-bottom: 10px;
}

.test-summary-card {
  border: 1px solid var(--border);
  border-radius: var(--radius-lg);
  background: var(--bg-panel);
  padding: 8px 10px;
}

.test-summary-card span {
  display: block;
  color: var(--text-tertiary);
  font-size: var(--font-size-small);
}

.test-summary-card strong {
  color: var(--text-primary);
  font-size: 18px;
}

.test-summary-card.passed strong { color: var(--success); }
.test-summary-card.failed strong { color: var(--error); }
.test-summary-card.skipped strong { color: var(--warning); }

.test-table {
  width: 100%;
  border-collapse: collapse;
  border-radius: var(--radius-lg);
  overflow: hidden;
  background: var(--bg-panel);
  font-size: var(--font-size-small);
}

.test-table th,
.test-table td {
  border: 1px solid var(--divider);
  padding: 7px 8px;
  text-align: left;
  vertical-align: top;
}

.test-table th {
  background: var(--bg-panel-elevated);
  color: var(--text-secondary);
}

.test-table tr.failed td {
  background: color-mix(in srgb, var(--error) 9%, var(--bg-panel));
}

.test-table tr.skipped td {
  background: color-mix(in srgb, var(--warning) 8%, var(--bg-panel));
}

.test-status {
  font-weight: 800;
  letter-spacing: 0.03em;
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
  min-width: 88px;
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


.resp-visualize {
  height: 100%;
  overflow: auto;
  background: var(--bg-code);
}

.visualization-list {
  display: flex;
  flex-direction: column;
  gap: 10px;
  padding: 10px;
}

.visualization-card {
  border: 1px solid var(--border);
  border-radius: var(--radius-lg);
  background: var(--bg-panel);
  overflow: hidden;
  box-shadow: var(--shadow-sm);
}

.visualization-card header {
  display: flex;
  justify-content: space-between;
  align-items: center;
  padding: 7px 10px;
  border-bottom: 1px solid var(--divider);
  color: var(--text-primary);
  font-size: var(--font-size-small);
}

.visualization-card header span {
  color: var(--text-tertiary);
  font-weight: 500;
}

.visualization-frame {
  width: 100%;
  min-height: 220px;
  border: 0;
  background: #fff;
}

@keyframes spin {
  to { transform: rotate(360deg); }
}
</style>
