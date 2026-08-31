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
import { Lock } from '@lucide/vue'
import { toast } from 'vue-sonner'
import { createDefaultAuthConfig } from '@/utils/auth'
import { COMMON_HEADER_NAMES } from '@/utils/common-headers'
import { matchInheritedScript, resolveScriptChain } from '@/utils/inheritance'
import { syncPairsToUrl } from '@/utils/url-params'
import type { CollectionNode, KvPair, BodyConfig, AuthConfig as AuthConfigType, CookieItem, PostResponseExtractor } from '@/types'
import type { ScriptSegment } from '@/utils/inheritance'

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

/** 参数表编辑 → 同步重建 URL query(URL ↔ params 双向同步的 params 侧) */
function updateParams(params: KvPair[]) {
  if (isReadonlyModule.value) return
  if (!currentApi.value) return
  const url = syncPairsToUrl(currentApi.value.url, params)
  // url 与 params 一起传,store 不再二次推导;内容无变化时跳过,避免 KvEditor 行被重置丢焦点
  const changed = url !== currentApi.value.url || JSON.stringify(params) !== JSON.stringify(currentApi.value.params ?? [])
  if (!changed) return
  store.updateApi(currentApi.value.id, { params, url })
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
  if (isPreScriptInherited.value) return
  if (currentApi.value) {
    store.updateApi(currentApi.value.id, { preRequestScript: value })
  }
}

function updatePostScript(value: string) {
  if (isPostScriptInherited.value) return
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

// ── 脚本继承识别(每个槽位独立)──
// inherited:请求自身无脚本,编辑器展示父级继承链 → 只读
// locked:   请求脚本与继承链完全一致(历史导入的父级副本)→ 只读 + 移除副本
// mixed:    请求脚本以继承链内容开头且带自身逻辑(烘焙)→ 只读 + 清理重复段
// suspected:父级链无脚本,但同分组请求共享相同脚本(扁平导入烘焙)→ 提升到分组
// info:     父级链有脚本,显示执行来源;请求自身脚本自由编辑
interface ScriptGroupState {
  kind: 'inherited' | 'locked' | 'mixed' | 'suspected' | 'info'
  sourceLabel: string
  /** mixed:继承链拼接文本;suspected:共享脚本内容 */
  chainText?: string
  sharedScript?: string
  sharedCount?: number
}

const scriptChainContext = computed(() => {
  const api = currentApi.value
  const node = api ? workspace.interfaces.find(item => item.apiId === api.id && (item.nodeType ?? 'request') === 'request') : null
  const cid = node ? (node.collectionId ?? node.moduleId) : null
  const collection = cid ? workspace.collections.find(item => item.id === cid) : null
  if (!api || !node || !collection) return null
  return {
    collection,
    node,
    chain: resolveScriptChain(collection, workspace.interfaces as CollectionNode[], node.id),
    ancestorFolders: workspace.getAncestorFolders(node.id),
  }
})

function joinedChainText(segments: ScriptSegment[]): string {
  return segments.map(segment => segment.script.trim()).filter(Boolean).join('\n\n')
}

function groupScriptState(slot: 'pre' | 'post'): ScriptGroupState | null {
  const context = scriptChainContext.value
  if (!context) return null
  const isPre = slot === 'pre'
  const segments = isPre ? context.chain.preScripts : context.chain.postScripts
  const own = ((isPre ? currentApi.value?.preRequestScript : currentApi.value?.postRequestScript) ?? '').trim()

  if (segments.length) {
    const chainText = joinedChainText(segments)
    if (!own) {
      return {
        kind: 'inherited',
        sourceLabel: segments.map(segment => segment.sourceName).join(' → '),
        chainText,
      }
    }
    const matched = matchInheritedScript(segments, own)
    if (matched) {
      return { kind: 'locked', sourceLabel: matched.map(segment => segment.sourceName).join(' → ') }
    }
    if (chainText && (own === chainText || own.startsWith(`${chainText}\n`))) {
      return { kind: 'mixed', sourceLabel: segments.map(segment => segment.sourceName).join(' → '), chainText }
    }
    return { kind: 'info', sourceLabel: segments.map(segment => segment.sourceName).join(' → ') }
  }

  // 链上无脚本:检查同分组兄弟请求是否共享相同脚本(扁平导入把父级脚本烘焙进请求的特征)
  const siblingNodes = workspace.interfaces.filter(item =>
    item.id !== context.node.id
    && item.moduleId === context.node.moduleId
    && (item.nodeType ?? 'request') === 'request'
    && (item.parentId ?? null) === (context.node.parentId ?? null))
  const siblingScripts = siblingNodes
    .map(item => (isPre ? store.apis[item.apiId]?.preRequestScript : store.apis[item.apiId]?.postRequestScript)?.trim() ?? '')
    .filter(Boolean)
  const shared = own || siblingScripts[0] || ''
  if (shared && siblingScripts.length >= 1 && siblingScripts.every(script => script === shared)) {
    const nearestFolder = context.ancestorFolders[context.ancestorFolders.length - 1]
    const targetName = nearestFolder?.name ?? context.collection.name
    return {
      kind: 'suspected',
      sourceLabel: targetName,
      sharedScript: shared,
      sharedCount: siblingScripts.length + (own ? 1 : 0),
    }
  }
  return null
}

const preGroupState = computed(() => groupScriptState('pre'))
const postGroupState = computed(() => groupScriptState('post'))
const readonlyScriptKinds = new Set<ScriptGroupState['kind']>(['inherited', 'locked', 'mixed'])
const isPreScriptInherited = computed(() => isReadonlyModule.value || Boolean(preGroupState.value && readonlyScriptKinds.has(preGroupState.value.kind)))
const isPostScriptInherited = computed(() => isReadonlyModule.value || Boolean(postGroupState.value && readonlyScriptKinds.has(postGroupState.value.kind)))
const preScriptEditorValue = computed(() =>
  preGroupState.value?.kind === 'inherited'
    ? preGroupState.value.chainText ?? ''
    : currentApi.value?.preRequestScript ?? '')
const postScriptEditorValue = computed(() =>
  postGroupState.value?.kind === 'inherited'
    ? postGroupState.value.chainText ?? ''
    : currentApi.value?.postRequestScript ?? '')

/** 继承修复:按状态移除副本 / 清理重复段 / 把共享脚本提升到分组,统一入口 */
async function promoteScriptToParent(slot: 'pre' | 'post') {
  const context = scriptChainContext.value
  const api = currentApi.value
  const state = slot === 'pre' ? preGroupState.value : postGroupState.value
  if (!context || !api || !state) return
  const isPre = slot === 'pre'
  const ownField = isPre ? 'preRequestScript' : 'postRequestScript'
  const own = (isPre ? api.preRequestScript : api.postRequestScript) ?? ''

  try {
    if (state.kind === 'locked') {
      await store.updateApiNow(api.id, { [ownField]: '' })
      toast.success('已移除请求中的继承副本,脚本改由集合/分组继承执行')
      return
    }
    if (state.kind === 'mixed') {
      const remainder = own.trim().slice((state.chainText ?? '').length).trim()
      await store.updateApiNow(api.id, { [ownField]: remainder })
      toast.success('已清理重复的继承段,请求仅保留自身脚本')
      return
    }
    if (state.kind === 'suspected') {
      const scriptText = state.sharedScript ?? ''
      const nearestFolder = context.ancestorFolders[context.ancestorFolders.length - 1]
      if (nearestFolder) {
        await workspace.updateInterfaceNode(nearestFolder.id, { [ownField]: scriptText })
      } else {
        await workspace.updateCollectionSettings(context.collection.id, { [ownField]: scriptText })
      }
      // 清空同分组所有带相同脚本的请求副本(含自身),之后统一走继承链
      const groupNodes = workspace.interfaces.filter(item =>
        item.moduleId === context.node.moduleId
        && (item.nodeType ?? 'request') === 'request'
        && (item.parentId ?? null) === (context.node.parentId ?? null))
      for (const item of groupNodes) {
        const groupScript = (isPre ? store.apis[item.apiId]?.preRequestScript : store.apis[item.apiId]?.postRequestScript) ?? ''
        if (groupScript.trim() === scriptText) {
          await store.updateApiNow(item.apiId, { [ownField]: '' })
        }
      }
      toast.success(`已将脚本提升到「${state.sourceLabel}」,同分组 ${state.sharedCount} 个请求改为继承执行`)
      return
    }
  } catch (error) {
    console.error('promoteScriptToParent failed:', error)
    toast.error('脚本继承修复失败')
  }
}

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
  if (isPreScriptInherited.value || !currentApi.value) return
  const next = [currentApi.value.preRequestScript, code].filter(Boolean).join('\n\n')
  updatePreScript(next)
}

function appendPostSnippet(code: string) {
  if (isPostScriptInherited.value || !currentApi.value) return
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
        <Lock
          v-if="tab.key === 'pre-script' && isPreScriptInherited && !isReadonlyModule"
          class="tab-lock-icon"
          :size="12"
          aria-label="脚本继承自父级，只读"
        />
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
        <div v-if="preGroupState" class="script-inherit-banner" :class="{ 'is-suspected': preGroupState.kind === 'suspected' }">
          <span class="inherit-tag">{{ preGroupState.kind === 'suspected' ? '疑似继承' : '继承' }}</span>
          <span v-if="preGroupState.kind === 'inherited'">当前显示的前置脚本继承自「{{ preGroupState.sourceLabel }}」,不可在请求中编辑;如需修改请前往对应集合/分组。</span>
          <span v-else-if="preGroupState.kind === 'locked'">前置脚本继承自「{{ preGroupState.sourceLabel }}」,如需修改请编辑集合/分组脚本;运行时将按继承链执行。</span>
          <span v-else-if="preGroupState.kind === 'mixed'">前置脚本包含「{{ preGroupState.sourceLabel }}」脚本的重复副本(历史导入数据),运行时已自动去重。</span>
          <span v-else-if="preGroupState.kind === 'suspected'">同分组 {{ preGroupState.sharedCount }} 个请求共享相同的前置脚本(导入时烘焙),建议提升到「{{ preGroupState.sourceLabel }}」统一继承。</span>
          <span v-else>将按继承链执行「{{ preGroupState.sourceLabel }}」的脚本,下方为请求自身脚本。</span>
          <button
            v-if="preGroupState.kind !== 'info' && preGroupState.kind !== 'inherited'"
            class="btn btn-sm inherit-action"
            @click="promoteScriptToParent('pre')"
          >{{ preGroupState.kind === 'locked' ? '移除副本' : preGroupState.kind === 'mixed' ? '清理重复段' : '提升到分组' }}</button>
        </div>
        <div class="script-toolbar">
          <button class="btn btn-sm btn-primary" @click="runCurrentScriptFlow">运行脚本</button>
          <button
            v-for="snippet in scriptSnippets"
            :key="`pre-${snippet.label}`"
            class="btn btn-sm"
            :disabled="isPreScriptInherited"
            @click="appendPreSnippet(snippet.code)"
          >{{ snippet.label }}</button>
        </div>
        <CodeMirrorEditor
          class="script-editor"
          :model-value="preScriptEditorValue"
          language="javascript"
          placeholder="// 前置脚本:在请求发送前执行"
          @update:model-value="updatePreScript"
          :readonly="isPreScriptInherited"
          :class="{ 'inherited-editor': isPreScriptInherited }"
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
          <button :class="{ active: postEditorMode === 'script' }" @click="postEditorMode = 'script'">
            脚本
            <Lock
              v-if="isPostScriptInherited && !isReadonlyModule"
              class="tab-lock-icon"
              :size="12"
              aria-label="脚本继承自父级，只读"
            />
          </button>
        </div>
        <PostResponseActions
          v-if="postEditorMode === 'actions'"
          :model-value="currentApi?.postResponseExtractors || []"
          :readonly="isReadonlyModule"
          :has-folder="hasParentFolder"
          @update:model-value="updatePostResponseExtractors"
        />
        <div v-else class="post-script-editor">
          <div v-if="postGroupState" class="script-inherit-banner" :class="{ 'is-suspected': postGroupState.kind === 'suspected' }">
            <span class="inherit-tag">{{ postGroupState.kind === 'suspected' ? '疑似继承' : '继承' }}</span>
            <span v-if="postGroupState.kind === 'inherited'">当前显示的后置脚本继承自「{{ postGroupState.sourceLabel }}」,不可在请求中编辑;如需修改请前往对应集合/分组。</span>
            <span v-else-if="postGroupState.kind === 'locked'">后置脚本继承自「{{ postGroupState.sourceLabel }}」,如需修改请编辑集合/分组脚本;运行时将按继承链执行。</span>
            <span v-else-if="postGroupState.kind === 'mixed'">后置脚本包含「{{ postGroupState.sourceLabel }}」脚本的重复副本(历史导入数据),运行时已自动去重。</span>
            <span v-else-if="postGroupState.kind === 'suspected'">同分组 {{ postGroupState.sharedCount }} 个请求共享相同的后置脚本(导入时烘焙),建议提升到「{{ postGroupState.sourceLabel }}」统一继承。</span>
            <span v-else>将按继承链执行「{{ postGroupState.sourceLabel }}」的脚本,下方为请求自身脚本。</span>
            <button
              v-if="postGroupState.kind !== 'info' && postGroupState.kind !== 'inherited'"
              class="btn btn-sm inherit-action"
              @click="promoteScriptToParent('post')"
            >{{ postGroupState.kind === 'locked' ? '移除副本' : postGroupState.kind === 'mixed' ? '清理重复段' : '提升到分组' }}</button>
          </div>
          <div class="script-toolbar">
            <button class="btn btn-sm btn-primary" @click="runCurrentScriptFlow">运行脚本</button>
            <button
              v-for="snippet in scriptSnippets"
              :key="`post-${snippet.label}`"
              class="btn btn-sm"
              :disabled="isPostScriptInherited"
              @click="appendPostSnippet(snippet.code)"
            >{{ snippet.label }}</button>
          </div>
          <CodeMirrorEditor
            class="script-editor"
            :model-value="postScriptEditorValue"
            language="javascript"
            placeholder="// 后置脚本:在收到响应后执行"
            @update:model-value="updatePostScript"
            :readonly="isPostScriptInherited"
            :class="{ 'inherited-editor': isPostScriptInherited }"
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
  display: inline-flex;
  align-items: center;
  gap: 4px;
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

.tab-lock-icon {
  flex: 0 0 auto;
  color: var(--secondary-light-color);
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

.script-inherit-banner {
  display: flex;
  align-items: center;
  gap: 8px;
  padding: 6px 10px;
  border: 1px solid var(--divider-color);
  border-radius: var(--radius-md);
  background: var(--primary-light-color);
  color: var(--secondary-color);
  font-size: var(--font-size-tiny);
  line-height: 1.5;
}

.script-inherit-banner .inherit-tag {
  flex-shrink: 0;
  padding: 1px 6px;
  border-radius: 8px;
  background: var(--primary-dark-color);
  color: var(--accent-color);
  font-weight: 700;
}

.script-inherit-banner .inherit-action {
  flex-shrink: 0;
  margin-left: auto;
}

.script-inherit-banner.is-suspected {
  border-style: dashed;
}

.inherited-editor {
  opacity: 0.75;
}

.inherited-editor :deep(.cm-editor) {
  cursor: default;
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
