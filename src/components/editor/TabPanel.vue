<script setup lang="ts">
import { ref, computed, watch, onMounted, onUnmounted } from 'vue'
import { ChevronDown } from '@lucide/vue'
import { useAppStore } from '@/stores/app'
import { useWorkspaceStore } from '@/stores/workspace'
import KvEditor from '@/components/common/KvEditor.vue'
import BodyEditor from '@/components/editor/BodyEditor.vue'
import AuthConfig from '@/components/editor/AuthConfig.vue'
import CookieConfig from '@/components/editor/CookieConfig.vue'
import CodeMirrorEditor from '@/components/common/CodeMirrorEditor.vue'
import { createDefaultAuthConfig } from '@/utils/auth'
import type { KvPair, BodyConfig, AuthConfig as AuthConfigType, CookieItem } from '@/types'

const store = useAppStore()
const workspace = useWorkspaceStore()
const activeTab = ref('params')
const tabPanelRef = ref<HTMLElement | null>(null)
const showScriptMenu = ref(false)
const showAdvancedMenu = ref(false)

const currentApi = computed(() => store.getCurrentApi())
const currentModule = computed(() => {
  const interfaceNode = workspace.interfaces.find(item => item.apiId === store.currentApiId)
  return interfaceNode ? workspace.modules.find(item => item.id === interfaceNode.moduleId) ?? null : null
})
const isReadonlyModule = computed(() => currentModule.value?.type === 'readonly')

const tabs = [
  { key: 'params', label: 'Params' },
  { key: 'body', label: 'Body' },
  { key: 'headers', label: 'Headers' },
  { key: 'auth', label: 'Auth' },
  { key: 'cookies', label: 'Cookies' },
  { key: 'variables', label: '请求变量' },
  { key: 'pre-script', label: '前置脚本' },
  { key: 'post-script', label: '后置脚本' },
]
const primaryTabs = tabs.filter(tab => ['params', 'body', 'headers', 'auth'].includes(tab.key))
const scriptTabs = tabs.filter(tab => ['pre-script', 'post-script'].includes(tab.key))
const advancedTabs = tabs.filter(tab => ['cookies', 'variables'].includes(tab.key))

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
  showScriptMenu.value = false
  showAdvancedMenu.value = false
}

function isInGroup(group: Array<{ key: string; label: string }>): boolean {
  return group.some(tab => tab.key === activeTab.value)
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
  window.dispatchEvent(new CustomEvent('apifix-editor-activity', {
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

onMounted(() => document.addEventListener('selectionchange', handleSelectionActivity))
onUnmounted(() => document.removeEventListener('selectionchange', handleSelectionActivity))

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

function resetPreScript() {
  if (isReadonlyModule.value || !currentApi.value) return
  if (!currentApi.value.preRequestScript || window.confirm('确认清空当前前置脚本？')) {
    updatePreScript('')
  }
}

function resetPostScript() {
  if (isReadonlyModule.value || !currentApi.value) return
  if (!currentApi.value.postRequestScript || window.confirm('确认清空当前后置脚本？')) {
    updatePostScript('')
  }
}

function runCurrentScriptFlow() {
  window.dispatchEvent(new CustomEvent('apifix:send-current-request'))
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
        v-for="tab in primaryTabs"
        :key="tab.key"
        :class="['tab-btn', { active: activeTab === tab.key }]"
        @click="selectTab(tab.key)"
      >
        {{ tab.label }}
      </button>
      <div class="tab-menu-wrap">
        <button :class="['tab-btn', { active: isInGroup(scriptTabs) }]" @click="showScriptMenu = !showScriptMenu; showAdvancedMenu = false">
          脚本 <ChevronDown :size="14" />
        </button>
        <div v-if="showScriptMenu" class="tab-dropdown">
          <button
            v-for="tab in scriptTabs"
            :key="tab.key"
            :class="['tab-menu-item', { active: activeTab === tab.key }]"
            @click="selectTab(tab.key)"
          >{{ tab.label }}</button>
        </div>
      </div>
      <div class="tab-menu-wrap">
        <button :class="['tab-btn', { active: isInGroup(advancedTabs) }]" @click="showAdvancedMenu = !showAdvancedMenu; showScriptMenu = false">
          高级 <ChevronDown :size="14" />
        </button>
        <div v-if="showAdvancedMenu" class="tab-dropdown">
          <button
            v-for="tab in advancedTabs"
            :key="tab.key"
            :class="['tab-menu-item', { active: activeTab === tab.key }]"
            @click="selectTab(tab.key)"
          >{{ tab.label }}</button>
        </div>
      </div>
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
      <div v-if="activeTab === 'headers'" class="tab-inner">
        <KvEditor
          :model-value="currentApi?.headers || []"
          @update:model-value="updateHeaders"
          key-placeholder="Header 名"
          value-placeholder="值"
          show-description
          :readonly="isReadonlyModule"
        />
      </div>
      <div v-if="activeTab === 'cookies'" class="tab-inner">
        <CookieConfig
          :model-value="currentApi?.cookies || []"
          :auto-carry="store.autoCarryCookies"
          @update:model-value="updateCookies"
          @update:auto-carry="updateAutoCarryCookies"
          :readonly="isReadonlyModule"
        />
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
          <span>仅当前接口生效，优先级高于模块本地/远程值和全局环境变量，可在 URL、Header、Body、脚本中用 <code>&#123;&#123;变量名&#125;&#125;</code> 引用。</span>
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
          <button class="btn btn-sm" :disabled="isReadonlyModule || !currentApi?.preRequestScript" @click="resetPreScript">重置</button>
          <button
            v-for="snippet in scriptSnippets"
            :key="`pre-${snippet.label}`"
            class="btn btn-sm"
            :disabled="isReadonlyModule"
            @click="appendPreSnippet(snippet.code)"
          >{{ snippet.label }}</button>
        </div>
        <CodeMirrorEditor
          :model-value="currentApi?.preRequestScript || ''"
          language="javascript"
          placeholder="// 前置脚本：在请求发送前执行"
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
        <div class="script-toolbar">
          <button class="btn btn-sm btn-primary" @click="runCurrentScriptFlow">运行脚本</button>
          <button class="btn btn-sm" :disabled="isReadonlyModule || !currentApi?.postRequestScript" @click="resetPostScript">重置</button>
          <button
            v-for="snippet in scriptSnippets"
            :key="`post-${snippet.label}`"
            class="btn btn-sm"
            :disabled="isReadonlyModule"
            @click="appendPostSnippet(snippet.code)"
          >{{ snippet.label }}</button>
        </div>
        <CodeMirrorEditor
          :model-value="currentApi?.postRequestScript || ''"
          language="javascript"
          placeholder="// 后置脚本：在收到响应后执行"
          @update:model-value="updatePostScript"
          :readonly="isReadonlyModule"
        />
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
  background: var(--bg-panel);
}

.tab-header {
  display: flex;
  gap: 4px;
  border-bottom: 1px solid var(--border);
  padding: 8px 12px 0;
  background: var(--bg-panel-elevated);
  overflow: visible;
}

.tab-btn {
  padding: 8px 12px;
  border: none;
  background: transparent;
  color: var(--text-secondary);
  cursor: pointer;
  font-size: var(--font-size-body);
  font-weight: 650;
  border: 1px solid transparent;
  border-bottom: none;
  border-radius: var(--radius-lg) var(--radius-lg) 0 0;
  transition: all 0.15s;
}

.tab-btn:hover {
  color: var(--text-primary);
  background: var(--bg-hover);
}

.tab-btn.active {
  color: var(--primary);
  background: var(--bg-panel);
  border-color: var(--border);
  box-shadow: 0 -2px 0 var(--primary) inset;
}

.tab-menu-wrap {
  position: relative;
}

.tab-dropdown {
  position: absolute;
  top: calc(100% + 4px);
  left: 0;
  z-index: 40;
  min-width: 132px;
  padding: 5px;
  border: 1px solid var(--border);
  border-radius: var(--radius-lg);
  background: var(--bg-panel);
  box-shadow: var(--shadow-lg);
}

.tab-menu-item {
  display: block;
  width: 100%;
  padding: 7px 9px;
  border-radius: var(--radius-md);
  background: transparent;
  color: var(--text-secondary);
  cursor: pointer;
  text-align: left;
  font-size: var(--font-size-small);
  font-weight: 700;
}

.tab-menu-item:hover,
.tab-menu-item.active {
  color: var(--primary);
  background: var(--primary-soft);
}

.tab-content {
  flex: 1;
  overflow: auto;
}

.tab-inner {
  padding: 12px;
  height: 100%;
}

.script-tab-inner {
  min-height: 200px;
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
  padding: 10px 12px;
  border: 1px solid var(--divider);
  border-radius: var(--radius-lg);
  background: var(--bg-code);
  color: var(--text-secondary);
  font-size: var(--font-size-small);
  line-height: 1.6;
}

.request-vars-hint strong {
  color: var(--text-primary);
}

.request-vars-hint code {
  color: var(--primary);
}

.script-toolbar {
  display: flex;
  flex-wrap: wrap;
  align-items: center;
  gap: 6px;
  margin-bottom: 8px;
}

.script-log-panel {
  margin-top: 10px;
  border: 1px solid var(--divider);
  border-radius: var(--radius-lg);
  background: var(--bg-code);
  overflow: hidden;
  font-family: var(--font-code);
  font-size: var(--font-size-code);
}

.script-log-panel strong {
  display: block;
  padding: 7px 9px;
  border-bottom: 1px solid var(--divider);
  background: var(--bg-panel-elevated);
  color: var(--text-primary);
  font-family: var(--font-ui);
  font-size: var(--font-size-small);
}

.script-log-empty {
  padding: 10px;
  color: var(--text-tertiary);
  font-family: var(--font-ui);
}

.script-log-line {
  display: grid;
  grid-template-columns: 102px 46px minmax(0, 1fr);
  gap: 7px;
  padding: 4px 9px;
  border-bottom: 1px solid color-mix(in srgb, var(--divider) 55%, transparent);
  color: var(--text-secondary);
}

.script-log-line:last-child {
  border-bottom: none;
}

.script-log-line em {
  font-style: normal;
  font-weight: 800;
  color: var(--primary);
}

.script-log-line code {
  color: var(--text-primary);
  white-space: pre-wrap;
  word-break: break-word;
}

.script-log-line.log-error em,
.script-log-line.log-error code {
  color: var(--error);
}

.script-log-line.log-warn em,
.script-log-line.log-warn code {
  color: var(--warning);
}


</style>
