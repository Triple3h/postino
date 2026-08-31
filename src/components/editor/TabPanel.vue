<script setup lang="ts">
import { ref, computed, watch, onMounted, onUnmounted } from 'vue'
import { useAppStore } from '@/stores/app'
import { useWorkspaceStore } from '@/stores/workspace'
import KvEditor from '@/components/common/KvEditor.vue'
import BodyEditor from '@/components/editor/BodyEditor.vue'
import AuthConfig from '@/components/editor/AuthConfig.vue'
import CookieConfig from '@/components/editor/CookieConfig.vue'
import CodeMirrorEditor from '@/components/common/CodeMirrorEditor.vue'
import PostResponseActions from '@/components/editor/PostResponseActions.vue'
import { createDefaultAuthConfig } from '@/utils/auth'
import { COMMON_HEADER_NAMES } from '@/utils/common-headers'
import type { KvPair, BodyConfig, AuthConfig as AuthConfigType, CookieItem, PostResponseExtractor } from '@/types'

const store = useAppStore()
const workspace = useWorkspaceStore()
const activeTab = ref('params')
const postEditorMode = ref<'actions' | 'script'>('actions')
const tabPanelRef = ref<HTMLElement | null>(null)

const currentApi = computed(() => store.getCurrentApi())
const currentModule = computed(() => {
  const interfaceNode = workspace.interfaces.find(item => item.apiId === store.currentApiId)
  return interfaceNode ? workspace.modules.find(item => item.id === interfaceNode.moduleId) ?? null : null
})
const isReadonlyModule = computed(() => currentModule.value?.type === 'readonly')

/** FR-1.2:七个编辑 tab(变量 tab = 请求级变量) */
const tabs = [
  { key: 'params', label: '参数' },
  { key: 'body', label: 'Body' },
  { key: 'headers', label: 'Headers' },
  { key: 'auth', label: 'Auth' },
  { key: 'pre-script', label: '前置脚本' },
  { key: 'post-script', label: '后置操作' },
  { key: 'variables', label: '变量' },
]

/** 常用请求头预设(Headers tab 一键插入;同名 key 忽略大小写覆盖) */
const commonHeaders = [
  { key: 'Content-Type', value: 'application/json' },
  { key: 'Accept', value: 'application/json' },
  { key: 'Authorization', label: 'Bearer <token>' },
  { key: 'User-Agent', label: '自定义 UA' },
  { key: 'X-Requested-With', value: 'XMLHttpRequest' },
  { key: 'Accept-Language', value: 'zh-CN,zh;q=0.9' },
  { key: 'Cache-Control', value: 'no-cache' },
  { key: 'Origin', label: '跨域来源' },
  { key: 'Referer', label: '引用页' },
  { key: 'Cookie', label: '会话 Cookie' },
  { key: 'X-Request-Id', label: '链路追踪 ID' },
  { key: 'If-None-Match', label: 'ETag 缓存校验' },
]

function updateParams(params: KvPair[]) {
  if (isReadonlyModule.value) return
  if (currentApi.value) store.updateApi(currentApi.value.id, { params })
}

function updateHeaders(headers: KvPair[]) {
  if (isReadonlyModule.value) return
  if (currentApi.value) store.updateApi(currentApi.value.id, { headers })
}

function updateBody(body: BodyConfig) {
  if (isReadonlyModule.value) return
  if (currentApi.value) store.updateApi(currentApi.value.id, { body })
}

function updateAuth(auth: AuthConfigType) {
  if (isReadonlyModule.value) return
  if (currentApi.value) store.updateApi(currentApi.value.id, { auth })
}

function updatePreScript(value: string) {
  if (isReadonlyModule.value) return
  if (currentApi.value) {
    store.updateApi(currentApi.value.id, { preRequestScript: value })
  }
}

function updatePostScript(value: string) {
  if (isReadonlyModule.value) return
  if (currentApi.value) {
    store.updateApi(currentApi.value.id, { postRequestScript: value })
  }
}

function updatePostResponseExtractors(postResponseExtractors: PostResponseExtractor[]) {
  if (isReadonlyModule.value) return
  if (currentApi.value) store.updateApi(currentApi.value.id, { postResponseExtractors })
}

const hasParentFolder = computed(() => workspace.getAncestorFolders(currentApi.value?.id ?? '').length > 0)

function updateCookies(cookies: CookieItem[]) {
  if (isReadonlyModule.value) return
  if (currentApi.value) store.updateApi(currentApi.value.id, { cookies })
}

function updateRequestVariables(requestVariables: KvPair[]) {
  if (isReadonlyModule.value) return
  if (currentApi.value) store.updateApi(currentApi.value.id, { requestVariables })
}

function updateAutoCarryCookies(value: boolean) {
  store.autoCarryCookies = value
}

const scriptSnippets = [
  { label: '设置 Header', code: 'pm.request.headers.set("Authorization", `Bearer ${pm.environment.get("token")}`)' },
  { label: '保存变量', code: 'pm.environment.set("token", pm.response?.json()?.token || "")' },
  { label: '断言状态', code: 'pm.test("状态码为 200", () => pm.expect(pm.response.code).to.equal(200))' },
  { label: '发送请求', code: 'const res = await pm.sendRequest("{{baseUrl}}/health")\nconsole.log(res.code, res.text())' },
]

const recentScriptLogs = computed(() => store.scriptLogs.slice(-8))

interface EditorCursorDetail {
  field?: string
  start?: number
  end?: number
  line?: number
  column?: number
  snippet?: string
}

function activeTabLabel(): string {
  return tabs.find(tab => tab.key === activeTab.value)?.label || activeTab.value
}

function selectTab(key: string) {
  activeTab.value = key
}

interface ExtractResponseVariableDetail {
  path?: string
  variableName?: string
}

function handleExtractResponseVariable(event: Event) {
  if (!currentApi.value || isReadonlyModule.value) return
  const detail = (event as CustomEvent<ExtractResponseVariableDetail>).detail
  const jsonPath = detail?.path?.trim()
  if (!jsonPath) return

  const existing = currentApi.value.postResponseExtractors ?? []
  if (!existing.some(rule => rule.jsonPath === jsonPath && rule.extractMode === 'jsonpath')) {
    updatePostResponseExtractors([...existing, {
      id: `extract:${Date.now().toString(36)}${Math.random().toString(36).slice(2, 6)}`,
      enabled: true,
      variableName: detail.variableName?.trim() || 'value',
      variableScope: 'collection',
      source: 'response-json',
      extractMode: 'jsonpath',
      jsonPath,
      unwrapArray: false,
    }])
  }
  activeTab.value = 'post-script'
  postEditorMode.value = 'actions'
}

function selectionSnippet(text: string, start: number, end: number): string {
  const from = Math.max(0, Math.min(start, end) - 12)
  const to = Math.min(text.length, Math.max(start, end) + 12)
  return text.slice(from, to).replace(/\s+/g, ' ').trim()
}

function cursorLineColumn(text: string, position: number): { line: number; column: number } {
  const before = text.slice(0, Math.max(0, position))
  const lines = before.split(/\r?\n/)
  return { line: lines.length, column: lines[lines.length - 1].length + 1 }
}

function textBeforeRange(container: Node, range: Range): string {
  const preRange = range.cloneRange()
  preRange.selectNodeContents(container)
  preRange.setEnd(range.startContainer, range.startOffset)
  return preRange.toString()
}

function closestElement(node: Node | null): Element | null {
  return node instanceof Element ? node : node?.parentElement ?? null
}

function fieldLabelFromElement(element: Element | null): string {
  if (!element) return activeTabLabel()
  const input = element instanceof HTMLInputElement || element instanceof HTMLTextAreaElement ? element : null
  const placeholder = input?.placeholder?.trim()
  if (placeholder) return placeholder
  const kvCol = element.closest('.kv-col')
  if (kvCol?.classList.contains('kv-col-key')) return `${activeTabLabel()} Key`
  if (kvCol?.classList.contains('kv-col-value')) return `${activeTabLabel()} Value`
  if (kvCol?.classList.contains('kv-col-desc')) return `${activeTabLabel()} 描述`
  if (element.closest('.cm-editor')) return `${activeTabLabel()} 编辑器`
  if (element.closest('.body-type-bar')) return 'Body 类型'
  return activeTabLabel()
}

function readInputCursor(element: HTMLInputElement | HTMLTextAreaElement): EditorCursorDetail {
  const start = element.selectionStart ?? 0
  const end = element.selectionEnd ?? start
  const lc = cursorLineColumn(element.value || '', start)
  return {
    field: fieldLabelFromElement(element),
    start,
    end,
    line: lc.line,
    column: lc.column,
    snippet: selectionSnippet(element.value || '', start, end),
  }
}

function readContentEditableCursor(root: HTMLElement, activeElement: Element | null): EditorCursorDetail | null {
  const selection = window.getSelection()
  if (!selection || selection.rangeCount === 0) return null
  const range = selection.getRangeAt(0)
  if (!root.contains(range.startContainer)) return null
  const editable = closestElement(range.startContainer)?.closest('.cm-content, [contenteditable="true"]') as HTMLElement | null
  const container = editable || root
  const start = textBeforeRange(container, range).length
  const endRange = range.cloneRange()
  endRange.collapse(false)
  const end = textBeforeRange(container, endRange).length
  const text = container.textContent || ''
  const lc = cursorLineColumn(text, start)
  return {
    field: fieldLabelFromElement(activeElement || editable),
    start,
    end,
    line: lc.line,
    column: lc.column,
    snippet: selectionSnippet(text, start, end),
  }
}

function currentCursorDetail(): EditorCursorDetail | undefined {
  const root = tabPanelRef.value
  if (!root) return undefined
  const active = document.activeElement
  if (active instanceof HTMLInputElement || active instanceof HTMLTextAreaElement) {
    if (!root.contains(active)) return undefined
    return readInputCursor(active)
  }
  if (active && root.contains(active)) {
    return readContentEditableCursor(root, active) ?? { field: fieldLabelFromElement(active) }
  }
  const selection = window.getSelection()
  if (selection?.rangeCount) {
    const range = selection.getRangeAt(0)
    if (root.contains(range.startContainer)) return readContentEditableCursor(root, closestElement(range.startContainer)) ?? undefined
  }
  return undefined
}

function publishEditorActivity(includeCursor = true) {
  if (!currentApi.value) return
  window.dispatchEvent(new CustomEvent('postino-editor-activity', {
    detail: {
      apiId: currentApi.value.id,
      apiName: currentApi.value.name,
      tab: activeTabLabel(),
      cursor: includeCursor ? currentCursorDetail() : undefined,
    },
  }))
}

function handleSelectionActivity() {
  publishEditorActivity(true)
}

watch([activeTab, currentApi], () => publishEditorActivity(false))

onMounted(() => {
  document.addEventListener('selectionchange', handleSelectionActivity)
  window.addEventListener('postino:extract-response-variable', handleExtractResponseVariable)
})
onUnmounted(() => {
  document.removeEventListener('selectionchange', handleSelectionActivity)
  window.removeEventListener('postino:extract-response-variable', handleExtractResponseVariable)
})

function appendPreSnippet(code: string) {
  if (isReadonlyModule.value || !currentApi.value) return
  const next = [currentApi.value.preRequestScript, code].filter(Boolean).join('\n\n')
  updatePreScript(next)
}

function appendPostSnippet(code: string) {
  if (isReadonlyModule.value || !currentApi.value) return
  const next = [currentApi.value.postRequestScript, code].filter(Boolean).join('\n\n')
  updatePostScript(next)
}

function runCurrentScriptFlow() {
  window.dispatchEvent(new CustomEvent('postino:send-current-request'))
}

function formatLogTime(ts: number): string {
  const d = new Date(ts)
  const time = [d.getHours(), d.getMinutes(), d.getSeconds()]
    .map(n => String(n).padStart(2, '0'))
    .join(':')
  return `${time}.${String(d.getMilliseconds()).padStart(3, '0')}`
}
</script>

<template>
  <div ref="tabPanelRef" class="tab-panel" @focusin="handleSelectionActivity" @pointerdown="handleSelectionActivity" @keyup="handleSelectionActivity" @mouseup="handleSelectionActivity" @input="handleSelectionActivity">
    <div class="tab-header">
      <button
        v-for="tab in tabs"
        :key="tab.key"
        :class="['tab-btn', { active: activeTab === tab.key }]"
        @click="selectTab(tab.key)"
      >
        {{ tab.label }}
      </button>
      <!-- FR-6:环境选择器已迁至 AppHeader 右上角(Hoppscotch 式全局入口) -->
    </div>
    <div class="tab-content">
      <div v-if="activeTab === 'params'" class="tab-inner">
        <KvEditor
          :model-value="currentApi?.params || []"
          @update:model-value="updateParams"
          key-placeholder="参数名"
          value-placeholder="值"
          show-description
          :readonly="isReadonlyModule"
        />
      </div>
      <div v-if="activeTab === 'body'" class="tab-inner">
        <BodyEditor
          :model-value="currentApi?.body || { type: 'none', raw: '', formData: [], urlEncoded: [], binaryFile: null, contentType: '' }"
          :method="currentApi?.method || 'GET'"
          @update:model-value="updateBody"
          :readonly="isReadonlyModule"
        />
      </div>
      <div v-if="activeTab === 'headers'" class="tab-inner headers-inner">
        <div class="headers-section">
          <div class="section-label">Headers</div>
          <KvEditor
            :model-value="currentApi?.headers || []"
            @update:model-value="updateHeaders"
            key-placeholder="Header 名"
            value-placeholder="值"
            show-description
            :readonly="isReadonlyModule"
            :presets="commonHeaders"
            presets-title="常用请求头"
            :key-suggestions="COMMON_HEADER_NAMES"
          />
        </div>
        <details class="cookies-section">
          <summary class="section-label">Cookies <small>({{ currentApi?.cookies?.length || 0 }})</small></summary>
          <CookieConfig
            :model-value="currentApi?.cookies || []"
            :auto-carry="store.autoCarryCookies"
            @update:model-value="updateCookies"
            @update:auto-carry="updateAutoCarryCookies"
            :readonly="isReadonlyModule"
          />
        </details>
      </div>
      <div v-if="activeTab === 'auth'" class="tab-inner">
        <AuthConfig
          :model-value="currentApi?.auth || createDefaultAuthConfig()"
          @update:model-value="updateAuth"
          :readonly="isReadonlyModule"
        />
      </div>
      <div v-if="activeTab === 'variables'" class="tab-inner request-vars-tab">
        <div class="request-vars-hint">
          <strong>请求级临时变量</strong>
          <span>仅当前接口生效,优先级高于集合变量和全局环境变量,可在 URL、Header、Body、脚本中用 <code>&#123;&#123;变量名&#125;&#125;</code> 引用。</span>
        </div>
        <KvEditor
          :model-value="currentApi?.requestVariables || []"
          @update:model-value="updateRequestVariables"
          key-placeholder="变量名"
          value-placeholder="当前接口值"
          show-description
          :readonly="isReadonlyModule"
        />
      </div>
      <div v-if="activeTab === 'pre-script'" class="tab-inner script-tab-inner">
        <div class="script-toolbar">
          <button class="btn btn-sm btn-primary" @click="runCurrentScriptFlow">运行脚本</button>
          <button
            v-for="snippet in scriptSnippets"
            :key="`pre-${snippet.label}`"
            class="btn btn-sm"
            :disabled="isReadonlyModule"
            @click="appendPreSnippet(snippet.code)"
          >{{ snippet.label }}</button>
        </div>
        <CodeMirrorEditor
          class="script-editor"
          :model-value="currentApi?.preRequestScript || ''"
          language="javascript"
          placeholder="// 前置脚本:在请求发送前执行"
          @update:model-value="updatePreScript"
          :readonly="isReadonlyModule"
        />
        <div class="script-log-panel">
          <strong>脚本日志</strong>
          <div v-if="recentScriptLogs.length === 0" class="script-log-empty">发送请求后显示 console / pm.test / pm.sendRequest 日志。</div>
          <div v-for="(log, index) in recentScriptLogs" :key="index" :class="['script-log-line', `log-${log.level}`]">
            <span>{{ formatLogTime(log.timestamp) }}</span>
            <em>{{ log.level }}</em>
            <code>{{ log.args.join(' ') }}</code>
          </div>
        </div>
      </div>
      <div v-if="activeTab === 'post-script'" class="tab-inner script-tab-inner">
        <div class="post-mode-tabs">
          <button :class="{ active: postEditorMode === 'actions' }" @click="postEditorMode = 'actions'">
            提取变量 <small>{{ currentApi?.postResponseExtractors?.length || 0 }}</small>
          </button>
          <button :class="{ active: postEditorMode === 'script' }" @click="postEditorMode = 'script'">脚本</button>
        </div>
        <PostResponseActions
          v-if="postEditorMode === 'actions'"
          :model-value="currentApi?.postResponseExtractors || []"
          :readonly="isReadonlyModule"
          :has-folder="hasParentFolder"
          @update:model-value="updatePostResponseExtractors"
        />
        <div v-else class="post-script-editor">
          <div class="script-toolbar">
            <button class="btn btn-sm btn-primary" @click="runCurrentScriptFlow">运行脚本</button>
            <button
              v-for="snippet in scriptSnippets"
              :key="`post-${snippet.label}`"
              class="btn btn-sm"
              :disabled="isReadonlyModule"
              @click="appendPostSnippet(snippet.code)"
            >{{ snippet.label }}</button>
          </div>
          <CodeMirrorEditor
            class="script-editor"
            :model-value="currentApi?.postRequestScript || ''"
            language="javascript"
            placeholder="// 后置脚本:在收到响应后执行"
            @update:model-value="updatePostScript"
            :readonly="isReadonlyModule"
          />
        </div>
        <div class="script-log-panel">
          <strong>脚本日志</strong>
          <div v-if="recentScriptLogs.length === 0" class="script-log-empty">发送请求后显示 console / pm.test / pm.visualizer 日志。</div>
          <div v-for="(log, index) in recentScriptLogs" :key="index" :class="['script-log-line', `log-${log.level}`]">
            <span>{{ formatLogTime(log.timestamp) }}</span>
            <em>{{ log.level }}</em>
            <code>{{ log.args.join(' ') }}</code>
          </div>
        </div>
      </div>
    </div>
  </div>
</template>

<style scoped>
.tab-panel {
  display: flex;
  flex-direction: column;
  overflow: hidden;
  background: var(--primary-color);
}

.tab-header {
  display: flex;
  align-items: center;
  gap: 2px;
  border-bottom: 1px solid var(--divider-color);
  padding: 0 8px;
  min-height: 34px;
}

.tab-btn {
  padding: 8px 10px;
  border: none;
  background: transparent;
  color: var(--secondary-color);
  cursor: pointer;
  font-size: var(--font-size-body);
  font-weight: 500;
  border-bottom: 2px solid transparent;
  transition: color 0.12s ease, border-color 0.12s ease;
}

.tab-btn:hover {
  color: var(--secondary-dark-color);
}

.tab-btn.active {
  color: var(--accent-color);
  border-bottom-color: var(--accent-color);
}

.tab-content {
  flex: 1;
  overflow: auto;
}

.tab-inner {
  padding: 10px 12px;
  height: 100%;
}

.headers-inner {
  display: flex;
  flex-direction: column;
  gap: 10px;
}

/* KvEditor 根元素的 height:100% 在 auto 高度的父容器里会被循环解析,
   导致「+ 添加参数」按钮溢出压到 Cookies 折叠条上;这两处改为内容自适应 */
.headers-inner > .headers-section > :deep(.kv-editor),
.request-vars-tab.request-vars-tab > :deep(.kv-editor) {
  height: auto;
}

.section-label {
  font-size: var(--font-size-tiny);
  font-weight: 700;
  color: var(--secondary-color);
  margin-bottom: 6px;
}

.cookies-section summary {
  cursor: pointer;
  list-style: none;
}

.cookies-section summary::before {
  content: '▸ ';
  color: var(--secondary-light-color);
}

.cookies-section[open] summary::before {
  content: '▾ ';
}

.request-vars-tab {
  display: flex;
  flex-direction: column;
  gap: 10px;
}

.request-vars-hint {
  display: flex;
  flex-direction: column;
  gap: 4px;
  padding: 8px 10px;
  border: 1px solid var(--divider-color);
  border-radius: var(--radius-md);
  background: var(--primary-light-color);
  color: var(--secondary-color);
  font-size: var(--font-size-tiny);
  line-height: 1.6;
}

.request-vars-hint strong {
  color: var(--secondary-dark-color);
}

.request-vars-hint code {
  color: var(--accent-color);
}

.script-tab-inner {
  display: flex;
  flex-direction: column;
  gap: 8px;
  min-height: 220px;
}

.script-editor {
  flex: 1;
  min-height: 140px;
}

.script-toolbar {
  display: flex;
  flex-wrap: wrap;
  align-items: center;
  gap: 6px;
}

.post-mode-tabs {
  display: flex;
  align-items: center;
  gap: 2px;
  border-bottom: 1px solid var(--divider-color);
}

.post-mode-tabs button {
  padding: 5px 9px;
  color: var(--secondary-color);
  font-size: var(--font-size-tiny);
  border-bottom: 2px solid transparent;
}

.post-mode-tabs button.active {
  color: var(--accent-color);
  border-bottom-color: var(--accent-color);
}

.post-mode-tabs small {
  margin-left: 3px;
  padding: 0 4px;
  border-radius: 8px;
  background: var(--primary-dark-color);
}

.post-script-editor {
  flex: 1;
  min-height: 140px;
  display: flex;
  flex-direction: column;
  gap: 8px;
}

.script-log-panel {
  border: 1px solid var(--divider-color);
  border-radius: var(--radius-md);
  background: var(--primary-light-color);
  font-family: var(--font-code);
  font-size: var(--font-size-tiny);
  max-height: 140px;
  overflow-y: auto;
}

.script-log-panel strong {
  display: block;
  position: sticky;
  top: 0;
  padding: 5px 8px;
  border-bottom: 1px solid var(--divider-color);
  background: var(--primary-dark-color);
  color: var(--secondary-dark-color);
  font-family: var(--font-ui);
  font-size: var(--font-size-tiny);
}

.script-log-empty {
  padding: 8px;
  color: var(--secondary-light-color);
  font-family: var(--font-ui);
}

.script-log-line {
  display: grid;
  grid-template-columns: 90px 40px minmax(0, 1fr);
  gap: 6px;
  padding: 3px 8px;
  color: var(--secondary-color);
}

.script-log-line em {
  font-style: normal;
  font-weight: 700;
  color: var(--accent-color);
}

.script-log-line code {
  color: var(--secondary-dark-color);
  white-space: pre-wrap;
  word-break: break-word;
}

.script-log-line.log-error em,
.script-log-line.log-error code {
  color: var(--status-critical-error-color);
}

.script-log-line.log-warn em,
.script-log-line.log-warn code {
  color: var(--status-redirect-color);
}
</style>
