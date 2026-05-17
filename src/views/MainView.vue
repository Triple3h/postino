<script setup lang="ts">
import { computed, onMounted, onUnmounted, ref } from 'vue'
import { Bookmark, Clipboard, Globe2, Monitor, Moon, Puzzle, Settings, Sun } from '@lucide/vue'
import { useAppStore } from '@/stores/app'
import { useWorkspaceStore } from '@/stores/workspace'
import Sidebar from '@/components/sidebar/Sidebar.vue'
import EditorView from '@/components/editor/EditorView.vue'
import GlobalSearch from '@/components/common/GlobalSearch.vue'
import HistoryPanel from '@/components/common/HistoryPanel.vue'
import MigrationDialog from '@/components/common/MigrationDialog.vue'
import { useSettings } from '@/composables/useSettings'
import { useKeyboardShortcuts } from '@/composables/useKeyboardShortcuts'
import { applyViewOpenContext, clearViewOpenContext, readViewOpenContext } from '@/utils/view-context'
import { DEFAULT_SHORTCUTS, SHORTCUT_ACTIONS, eventToShortcut, getEffectiveShortcuts } from '@/utils/shortcuts'
import { importCurl, importHar, importPostman } from '@/utils/import'
import { importOpenApi } from '@/utils/openapi-import'
import type { ApiConfig, AppShortcutAction, KvPair } from '@/types'

const store = useAppStore()
const workspace = useWorkspaceStore()
const { settings, toggleTheme } = useSettings()
useKeyboardShortcuts()

const showHistory = ref(false)
const showRightPanel = ref(false)
const showWorkspaceControls = ref(true)
const rightPanelWidth = ref(300)
const resizingRightPanel = ref(false)
const showDocMode = ref(false)
const showShortcutSettings = ref(false)
const dragImportDepth = ref(0)
const dragImportMessage = ref('')
const inspectorToast = ref('')
const lastEditableTarget = ref<HTMLElement | null>(null)
let inspectorToastTimer: ReturnType<typeof setTimeout> | null = null
const shortcutDrafts = ref<Partial<Record<AppShortcutAction, string>>>({})
const shortcutRows = SHORTCUT_ACTIONS

const currentEnv = computed(() => store.environments.find(item => item.id === store.currentEnvId) ?? null)
const currentApi = computed(() => store.getCurrentApi())
const currentInterface = computed(() => workspace.interfaces.find(item => item.apiId === store.currentApiId) ?? null)
const currentModule = computed(() => currentInterface.value ? workspace.modules.find(item => item.id === currentInterface.value?.moduleId) ?? null : null)
const currentModuleApis = computed<ApiConfig[]>(() => {
  if (!currentModule.value) return []
  return workspace.interfaces
    .filter(item => item.moduleId === currentModule.value?.id && (item.nodeType ?? 'request') !== 'folder' && item.apiId)
    .sort((a, b) => a.order - b.order)
    .map(item => store.apis[item.apiId])
    .filter((api): api is ApiConfig => Boolean(api))
})
const dynamicValues = ['{{$timestamp}}', '{{$isoTimestamp}}', '{{$guid}}', '{{$randomInt}}', '{{$randomEmail}}']

function formatTime(timestamp?: number): string {
  return timestamp ? new Date(timestamp).toLocaleString() : '-'
}

function showInspectorToast(message: string) {
  inspectorToast.value = message
  if (inspectorToastTimer) clearTimeout(inspectorToastTimer)
  inspectorToastTimer = window.setTimeout(() => {
    inspectorToast.value = ''
    inspectorToastTimer = null
  }, 1600)
}

function rememberEditableTarget(event: FocusEvent) {
  const target = event.target
  if (!(target instanceof HTMLElement)) return
  if (target instanceof HTMLInputElement || target instanceof HTMLTextAreaElement || target.isContentEditable || target.closest('.cm-content')) {
    lastEditableTarget.value = target
  }
}

function insertIntoInput(target: HTMLInputElement | HTMLTextAreaElement, value: string): boolean {
  const start = target.selectionStart ?? target.value.length
  const end = target.selectionEnd ?? start
  target.value = `${target.value.slice(0, start)}${value}${target.value.slice(end)}`
  const next = start + value.length
  target.setSelectionRange(next, next)
  target.dispatchEvent(new Event('input', { bubbles: true }))
  target.focus()
  return true
}

function insertIntoEditable(target: HTMLElement, value: string): boolean {
  const editable = target.isContentEditable ? target : target.closest<HTMLElement>('.cm-content, [contenteditable="true"]')
  if (!editable) return false
  editable.focus()
  return document.execCommand('insertText', false, value)
}

async function insertOrCopyText(value: string) {
  const target = lastEditableTarget.value
  let inserted = false
  if (target?.isConnected) {
    if (target instanceof HTMLInputElement || target instanceof HTMLTextAreaElement) {
      inserted = insertIntoInput(target, value)
    } else {
      inserted = insertIntoEditable(target, value)
    }
  }
  await navigator.clipboard.writeText(value).catch(() => undefined)
  showInspectorToast(inserted ? '已插入到当前输入，并复制到剪贴板' : '已复制到剪贴板')
}


function enabledPairs(items: KvPair[] = []): KvPair[] {
  return items.filter(item => item.enabled && item.key)
}

function methodClass(method: string): string {
  return method.toLowerCase()
}

function formatBodyLabel(api: ApiConfig): string {
  if (api.body.type === 'none') return '无请求体'
  if (api.body.type === 'json') return 'JSON'
  if (api.body.type === 'urlencoded') return 'x-www-form-urlencoded'
  if (api.body.type === 'form') return 'form-data'
  if (api.body.type === 'binary') return 'binary'
  return api.body.contentType || 'raw'
}

function openShortcutSettings() {
  shortcutDrafts.value = getEffectiveShortcuts(store.settings.customShortcuts)
  showShortcutSettings.value = true
}

function saveNetworkSettings() {
  store.saveSettings().catch(err => console.error('Failed to save network settings:', err))
}

function shortcutValue(action: AppShortcutAction): string {
  return shortcutDrafts.value[action] || DEFAULT_SHORTCUTS[action]
}

function recordShortcut(action: AppShortcutAction, event: KeyboardEvent) {
  event.preventDefault()
  event.stopPropagation()
  const shortcut = eventToShortcut(event)
  if (!shortcut) return
  shortcutDrafts.value = { ...shortcutDrafts.value, [action]: shortcut }
}

function resetShortcut(action: AppShortcutAction) {
  shortcutDrafts.value = { ...shortcutDrafts.value, [action]: DEFAULT_SHORTCUTS[action] }
}

function resetAllShortcuts() {
  shortcutDrafts.value = { ...DEFAULT_SHORTCUTS }
}

async function saveShortcutSettings() {
  store.settings.customShortcuts = { ...getEffectiveShortcuts(shortcutDrafts.value) }
  await store.saveSettings()
  showShortcutSettings.value = false
}


function clampRightPanelWidth(width: number): number {
  return Math.max(0, Math.min(400, Math.round(width)))
}

function startRightPanelResize(event: MouseEvent) {
  event.preventDefault()
  resizingRightPanel.value = true
}

function handleRightPanelResize(event: MouseEvent) {
  if (!resizingRightPanel.value) return
  const width = window.innerWidth - event.clientX - 10
  rightPanelWidth.value = clampRightPanelWidth(width)
  showRightPanel.value = rightPanelWidth.value > 0
}

function stopRightPanelResize() {
  resizingRightPanel.value = false
}

function toggleRightPanel() {
  showRightPanel.value = !showRightPanel.value
  if (showRightPanel.value && rightPanelWidth.value === 0) rightPanelWidth.value = 300
}

function openWorkspaceSettingsPanel() {
  showRightPanel.value = true
  if (rightPanelWidth.value === 0) rightPanelWidth.value = 300
  showWorkspaceControls.value = true
}

function toggleWorkspaceControls() {
  if (!showRightPanel.value) {
    showRightPanel.value = true
    if (rightPanelWidth.value === 0) rightPanelWidth.value = 300
    showWorkspaceControls.value = true
    return
  }
  showWorkspaceControls.value = !showWorkspaceControls.value
}

function toggleHistoryPanel() {
  showHistory.value = !showHistory.value
}

function openCodeGenPanel() {
  window.dispatchEvent(new CustomEvent('apifix:open-codegen'))
}


function detectImportType(fileName: string, content: string): 'curl' | 'postman' | 'openapi' | 'har' | null {
  const lowerName = fileName.toLowerCase()
  const trimmed = content.trim()
  if (!trimmed) return null
  if (lowerName.endsWith('.har')) return 'har'
  if (lowerName.endsWith('.yaml') || lowerName.endsWith('.yml')) return 'openapi'
  if (lowerName.endsWith('.curl') || /^curl\s+/i.test(trimmed)) return 'curl'
  if (lowerName.endsWith('.json') || trimmed.startsWith('{') || trimmed.startsWith('[')) {
    try {
      const parsed = JSON.parse(trimmed)
      if (parsed?.log?.entries) return 'har'
      if (parsed?.openapi || parsed?.swagger || parsed?.paths) return 'openapi'
      if (parsed?.info?.schema || parsed?.item) return 'postman'
    } catch {
      return null
    }
  }
  if (/^\s*(openapi|swagger|paths|info):/m.test(content)) return 'openapi'
  return null
}

function parseImportedApis(fileName: string, content: string): ApiConfig[] {
  const type = detectImportType(fileName, content)
  if (type === 'curl') {
    const api = importCurl(content)
    return api ? [api] : []
  }
  if (type === 'postman') return importPostman(content)
  if (type === 'openapi') return importOpenApi(content)
  if (type === 'har') return importHar(content)
  return []
}

async function addImportedApis(apis: ApiConfig[]): Promise<void> {
  for (const api of apis) {
    if (api.folder) {
      const module = await workspace.ensureModuleForLegacyGroup(api.folder)
      await store.addApi(api, module.id)
    } else {
      await store.addApi(api, currentModule.value?.id ?? null)
    }
  }
  if (apis.length > 0) {
    const first = apis[0]
    const node = workspace.interfaces.find(item => item.apiId === first.id)
    workspace.selectInterface(node?.id ?? first.id)
    store.currentApiId = first.id
    store.response = null
  }
}

async function importDroppedFiles(files: FileList | File[]): Promise<void> {
  const fileArray = Array.from(files).filter(file => file.size > 0)
  if (fileArray.length === 0) return
  let imported = 0
  const failed: string[] = []
  for (const file of fileArray) {
    try {
      const content = await file.text()
      const apis = parseImportedApis(file.name, content)
      if (apis.length === 0) {
        failed.push(file.name)
        continue
      }
      await addImportedApis(apis)
      imported += apis.length
    } catch {
      failed.push(file.name)
    }
  }
  dragImportMessage.value = failed.length
    ? `已导入 ${imported} 个接口，${failed.length} 个文件未识别：${failed.slice(0, 3).join('、')}`
    : `已从拖拽文件导入 ${imported} 个接口`
  window.setTimeout(() => { dragImportMessage.value = '' }, 3000)
}

function hasDroppedFiles(event: DragEvent): boolean {
  return Array.from(event.dataTransfer?.types || []).includes('Files')
}

function handleWindowDragEnter(event: DragEvent) {
  if (!hasDroppedFiles(event)) return
  event.preventDefault()
  dragImportDepth.value += 1
}

function handleWindowDragOver(event: DragEvent) {
  if (!hasDroppedFiles(event)) return
  event.preventDefault()
  if (event.dataTransfer) event.dataTransfer.dropEffect = 'copy'
}

function handleWindowDragLeave(event: DragEvent) {
  if (!hasDroppedFiles(event)) return
  event.preventDefault()
  dragImportDepth.value = Math.max(0, dragImportDepth.value - 1)
}

function handleWindowDrop(event: DragEvent) {
  if (!hasDroppedFiles(event)) return
  event.preventDefault()
  dragImportDepth.value = 0
  const files = event.dataTransfer?.files
  if (files?.length) void importDroppedFiles(files)
}

function toggleDocMode() {
  showDocMode.value = !showDocMode.value
}

async function restoreOpenContext() {
  const context = await readViewOpenContext('main')
  if (context?.openHistory) showHistory.value = true
  if (applyViewOpenContext(context, store, workspace)) clearViewOpenContext()
  else if (context?.openHistory) clearViewOpenContext()
}

onMounted(() => {
  void restoreOpenContext()
  window.addEventListener('mousemove', handleRightPanelResize)
  window.addEventListener('mouseup', stopRightPanelResize)
  window.addEventListener('dragenter', handleWindowDragEnter)
  window.addEventListener('dragover', handleWindowDragOver)
  window.addEventListener('dragleave', handleWindowDragLeave)
  window.addEventListener('drop', handleWindowDrop)
  window.addEventListener('apifix:toggle-right-panel', toggleRightPanel)
  window.addEventListener('apifix:toggle-workspace-controls', toggleWorkspaceControls)
  window.addEventListener('apifix:open-workspace-settings', openWorkspaceSettingsPanel)
  window.addEventListener('apifix:toggle-history-panel', toggleHistoryPanel)
  window.addEventListener('apifix:toggle-doc-mode', toggleDocMode)
  document.addEventListener('focusin', rememberEditableTarget)
})
onUnmounted(() => {
  window.removeEventListener('mousemove', handleRightPanelResize)
  window.removeEventListener('mouseup', stopRightPanelResize)
  window.removeEventListener('dragenter', handleWindowDragEnter)
  window.removeEventListener('dragover', handleWindowDragOver)
  window.removeEventListener('dragleave', handleWindowDragLeave)
  window.removeEventListener('drop', handleWindowDrop)
  window.removeEventListener('apifix:toggle-right-panel', toggleRightPanel)
  window.removeEventListener('apifix:toggle-workspace-controls', toggleWorkspaceControls)
  window.removeEventListener('apifix:open-workspace-settings', openWorkspaceSettingsPanel)
  window.removeEventListener('apifix:toggle-history-panel', toggleHistoryPanel)
  window.removeEventListener('apifix:toggle-doc-mode', toggleDocMode)
  document.removeEventListener('focusin', rememberEditableTarget)
  if (inspectorToastTimer) clearTimeout(inspectorToastTimer)
})
</script>

<template>
  <div class="main-layout">
    <Sidebar />
    <div class="main-content">
      <div class="content-area">
        <EditorView v-if="!showDocMode" />
        <section v-else class="doc-mode-view">
          <header class="doc-mode-header">
            <div>
              <span class="doc-kicker">Documentation Mode</span>
              <h2>{{ currentModule?.name || '请选择模块' }}</h2>
              <p>只读聚合当前模块接口，适合全屏页快速浏览、评审与复制字段。</p>
            </div>
            <span class="doc-count">{{ currentModuleApis.length }} APIs</span>
          </header>
          <div v-if="currentModuleApis.length === 0" class="doc-empty">当前模块暂无接口。</div>
          <article v-for="api in currentModuleApis" :key="api.id" class="doc-api-card">
            <div class="doc-api-title">
              <span :class="['doc-method', methodClass(api.method)]">{{ api.method }}</span>
              <div>
                <h3>{{ api.name }}</h3>
                <code>{{ api.url }}</code>
              </div>
            </div>
            <div class="doc-section-grid">
              <section v-if="enabledPairs(api.params).length" class="doc-section">
                <h4>Query Parameters</h4>
                <table>
                  <tbody><tr v-for="item in enabledPairs(api.params)" :key="item.key"><th>{{ item.key }}</th><td>{{ item.value }}</td></tr></tbody>
                </table>
              </section>
              <section v-if="enabledPairs(api.headers).length" class="doc-section">
                <h4>Headers</h4>
                <table>
                  <tbody><tr v-for="item in enabledPairs(api.headers)" :key="item.key"><th>{{ item.key }}</th><td>{{ item.value }}</td></tr></tbody>
                </table>
              </section>
              <section class="doc-section">
                <h4>Request Body</h4>
                <p class="doc-body-label">{{ formatBodyLabel(api) }}</p>
                <pre v-if="api.body.raw">{{ api.body.raw }}</pre>
                <table v-else-if="api.body.type === 'form' && enabledPairs(api.body.formData).length">
                  <tbody><tr v-for="item in enabledPairs(api.body.formData)" :key="item.key"><th>{{ item.key }}</th><td>{{ item.value }}</td></tr></tbody>
                </table>
                <table v-else-if="api.body.type === 'urlencoded' && enabledPairs(api.body.urlEncoded).length">
                  <tbody><tr v-for="item in enabledPairs(api.body.urlEncoded)" :key="item.key"><th>{{ item.key }}</th><td>{{ item.value }}</td></tr></tbody>
                </table>
              </section>
            </div>
          </article>
        </section>
        <HistoryPanel v-if="showHistory" class="history-sidebar" />
        <Transition name="inspector-mask">
          <button v-if="showRightPanel" class="inspector-scrim" aria-label="关闭工具抽屉" @click="showRightPanel = false"></button>
        </Transition>
        <Transition name="inspector-drawer">
        <aside v-if="showRightPanel" class="right-inspector" aria-label="上下文工具抽屉">
          <header class="inspector-drawer-header">
            <div>
              <strong>上下文工具</strong>
              <small>模块、环境、动态值与快捷操作</small>
            </div>
            <button class="btn btn-sm" @click="showRightPanel = false">关闭</button>
          </header>
          <section v-if="showWorkspaceControls" class="inspector-card workspace-controls-card">
            <h3><Settings :size="16" /> 工作台设置</h3>
            <div class="inspector-actions-grid">
              <button class="btn btn-sm" @click="showDocMode = !showDocMode" :class="{ active: showDocMode }">
                {{ showDocMode ? '编辑视图' : '文档视图' }}
              </button>
              <button class="btn btn-sm" @click="showHistory = !showHistory" :class="{ active: showHistory }">
                {{ showHistory ? '收起历史' : '历史记录' }}
              </button>
              <button class="btn btn-sm" @click="openShortcutSettings">快捷键</button>
              <button class="btn btn-sm theme-btn" @click="toggleTheme">
                <Sun v-if="settings.theme === 'dark'" :size="14" />
                <Moon v-else-if="settings.theme === 'light'" :size="14" />
                <Monitor v-else :size="14" />
                {{ settings.theme === 'dark' ? 'Light' : settings.theme === 'light' ? 'Dark' : 'System' }}
              </button>
            </div>
            <label class="inspector-field">
              <span>网络模式</span>
              <select v-model="store.settings.corsMode" class="inspector-select compact" @change="saveNetworkSettings">
                <option value="cors">CORS</option>
                <option value="proxy">代理</option>
                <option value="no-cors">No-CORS</option>
              </select>
            </label>
            <input
              v-if="store.settings.corsMode === 'proxy'"
              v-model="store.settings.proxyUrl"
              class="inspector-input"
              type="url"
              placeholder="代理 URL"
              title="代理 URL，会拼接目标请求地址"
              @change="saveNetworkSettings"
              @blur="saveNetworkSettings"
            />
            <button class="btn btn-sm inspector-full-btn" @click="showRightPanel = false" title="Ctrl+Shift+R">隐藏右侧面板</button>
          </section>
          <section class="inspector-card">
            <h3><Puzzle :size="16" /> 模块设置</h3>
            <div class="inspector-line"><span>模块</span><strong>{{ currentModule?.name || '未选择' }}</strong></div>
            <div class="inspector-line"><span>类型</span><strong>{{ currentModule?.moduleType?.mode || currentModule?.type || '-' }}</strong></div>
            <div class="inspector-line"><span>数据源</span><strong>{{ currentModule?.dataSource?.url ? '已绑定' : '未绑定' }}</strong></div>
          </section>
          <section class="inspector-card">
            <h3><Globe2 :size="16" /> 当前环境</h3>
            <select v-model="store.currentEnvId" class="inspector-select">
              <option v-if="store.environments.length === 0" :value="null">无环境</option>
              <option v-for="env in store.environments" :key="env.id" :value="env.id">{{ env.name }}</option>
            </select>
            <div v-if="currentEnv?.variables.length" class="env-var-mini-list">
              <button v-for="v in currentEnv.variables.filter(item => item.enabled)" :key="v.key" class="env-var-mini" @click="insertOrCopyText('{{' + v.key + '}}')">
                <span>{{ v.key }}</span><code>{{ v.value }}</code>
              </button>
            </div>
            <p v-else class="inspector-empty">暂无启用变量。</p>
          </section>
          <section class="inspector-card">
            <h3><Clipboard :size="16" /> 动态值</h3>
            <button v-for="item in dynamicValues" :key="item" class="dynamic-token" @click="insertOrCopyText(item)">{{ item }}</button>
          </section>
          <section class="inspector-card">
            <h3><Bookmark :size="16" /> 快捷操作</h3>
            <div class="inspector-actions-grid">
              <button class="btn btn-sm" @click="openCodeGenPanel">生成代码</button>
              <button class="btn btn-sm" @click="toggleHistoryPanel">历史记录</button>
              <button class="btn btn-sm" @click="showDocMode = !showDocMode">{{ showDocMode ? '编辑视图' : '文档视图' }}</button>
              <button class="btn btn-sm" @click="openShortcutSettings">快捷键</button>
            </div>
          </section>
          <details class="inspector-card inspector-details">
            <summary>更多接口信息</summary>
            <div class="inspector-line"><span>ID</span><code>{{ currentApi?.id || '-' }}</code></div>
            <div class="inspector-line"><span>创建</span><strong>{{ formatTime(currentApi?.createdAt) }}</strong></div>
            <div class="inspector-line"><span>修改</span><strong>{{ formatTime(currentApi?.updatedAt) }}</strong></div>
          </details>
          <div v-if="inspectorToast" class="inspector-toast">{{ inspectorToast }}</div>
        </aside>
        </Transition>
      </div>
    </div>
    <GlobalSearch />
    <MigrationDialog />
    <div v-if="dragImportDepth > 0" class="file-drop-overlay">
      <div class="file-drop-card">
        <strong>拖拽导入接口文件</strong>
        <span>支持 cURL、Postman Collection、OpenAPI/Swagger JSON/YAML、HAR</span>
      </div>
    </div>
    <div v-if="dragImportMessage" class="file-import-toast">{{ dragImportMessage }}</div>
    <div v-if="showShortcutSettings" class="shortcut-modal-mask" @click.self="showShortcutSettings = false">
      <section class="shortcut-modal">
        <header class="shortcut-modal-header">
          <div>
            <span class="doc-kicker">Keyboard Shortcuts</span>
            <h2>自定义快捷键</h2>
            <p>点击输入框后按下新的组合键，设置会写入本地 IndexedDB 并跨视图同步。</p>
          </div>
          <button class="btn btn-sm" @click="showShortcutSettings = false">关闭</button>
        </header>
        <div class="shortcut-list">
          <div v-for="row in shortcutRows" :key="row.action" class="shortcut-row">
            <div class="shortcut-meta">
              <strong>{{ row.label }}</strong>
              <small>{{ row.description }}</small>
            </div>
            <input
              class="shortcut-input"
              readonly
              :value="shortcutValue(row.action)"
              title="聚焦后按新的快捷键"
              @keydown="recordShortcut(row.action, $event)"
            />
            <button class="btn btn-sm" @click="resetShortcut(row.action)">默认</button>
          </div>
        </div>
        <footer class="shortcut-actions">
          <button class="btn btn-sm" @click="resetAllShortcuts">全部恢复默认</button>
          <button class="btn btn-primary btn-sm" @click="saveShortcutSettings">保存快捷键</button>
        </footer>
      </section>
    </div>
  </div>
</template>

<style scoped>
.main-layout {
  display: flex;
  height: 100%;
  width: 100%;
  padding: 10px;
  gap: 10px;
  background:
    linear-gradient(135deg, rgba(255, 255, 255, 0.64), rgba(255, 255, 255, 0.2)),
    var(--bg-app);
}

.main-content {
  flex: 1;
  display: flex;
  flex-direction: column;
  overflow: hidden;
  min-width: 0;
  border: 1px solid var(--border);
  border-radius: var(--radius-2xl);
  background: var(--bg-panel-elevated);
  box-shadow: var(--shadow-lg);
  backdrop-filter: blur(18px);
}

.toolbar {
  display: flex;
  align-items: center;
  gap: 12px;
  padding: 10px 12px;
  border-bottom: 1px solid var(--divider);
  background:
    linear-gradient(90deg, var(--bg-panel-elevated), color-mix(in srgb, var(--primary-light) 36%, var(--bg-panel)));
}

.toolbar-brand {
  display: flex;
  align-items: center;
  gap: 10px;
  min-width: 210px;
}

.brand-mark {
  display: inline-flex;
  align-items: center;
  justify-content: center;
  width: 34px;
  height: 34px;
  border-radius: 12px;
  color: #fff;
  font-weight: 900;
  background: linear-gradient(135deg, var(--primary), var(--accent));
  box-shadow: 0 10px 18px rgba(79, 70, 229, 0.22);
}

.toolbar-brand strong,
.toolbar-brand small {
  display: block;
}

.toolbar-brand strong {
  font-size: 14px;
  line-height: 1.2;
}

.toolbar-brand small {
  color: var(--text-secondary);
  font-size: var(--font-size-small);
  margin-top: 2px;
}

.toolbar-status {
  display: flex;
  align-items: center;
  gap: 6px;
}

.status-pill {
  border: 1px solid var(--border);
  border-radius: 999px;
  background: var(--bg-panel);
  color: var(--text-secondary);
  padding: 4px 9px;
  font-size: var(--font-size-small);
  box-shadow: var(--shadow-sm);
}

.toolbar-actions {
  display: flex;
  align-items: center;
  gap: 8px;
  margin-left: auto;
}

.toolbar .btn.active {
  background: var(--primary-soft);
  color: var(--primary);
  border-color: var(--primary);
}

.cors-mode {
  display: flex;
  align-items: center;
  gap: 6px;
  color: var(--text-secondary);
  font-size: var(--font-size-small);
}

.cors-select {
  font-size: var(--font-size-small);
  min-height: 28px;
  padding: 3px 28px 3px 8px;
}

.proxy-url-input {
  width: 190px;
  height: 28px;
  padding: 3px 8px;
  border: 1px solid var(--border);
  border-radius: var(--radius-md);
  background: var(--bg-panel);
  color: var(--text-primary);
  font-size: var(--font-size-small);
}

.proxy-url-input:focus {
  border-color: var(--primary);
  box-shadow: var(--focus-ring);
  outline: none;
}

.content-area {
  flex: 1;
  display: flex;
  overflow: hidden;
  min-height: 0;
  position: relative;
}

.history-sidebar {
  width: 340px;
  border-left: 1px solid var(--border);
  flex-shrink: 0;
  background: var(--bg-panel);
}

.right-panel-resizer {
  width: 6px;
  flex-shrink: 0;
  cursor: col-resize;
  border-left: 1px solid var(--border);
  background: linear-gradient(90deg, transparent, color-mix(in srgb, var(--primary) 12%, transparent));
}

.right-panel-resizer:hover {
  background: color-mix(in srgb, var(--primary) 18%, transparent);
}

.right-inspector {
  position: absolute;
  top: 12px;
  right: 12px;
  bottom: 12px;
  z-index: 35;
  width: min(340px, calc(100% - 24px));
  overflow: auto;
  border: 1px solid var(--border);
  border-radius: var(--radius-2xl);
  background:
    linear-gradient(180deg, var(--bg-panel-elevated), var(--bg-panel));
  padding: 12px;
  box-shadow: var(--shadow-lg);
}

.inspector-scrim {
  position: absolute;
  inset: 0;
  z-index: 30;
  background: rgba(15, 23, 42, 0.10);
  backdrop-filter: blur(1px);
  cursor: default;
}

.inspector-drawer-enter-active,
.inspector-drawer-leave-active,
.inspector-mask-enter-active,
.inspector-mask-leave-active {
  transition: opacity 0.18s ease, transform 0.18s ease;
}

.inspector-drawer-enter-from,
.inspector-drawer-leave-to {
  opacity: 0;
  transform: translateX(24px);
}

.inspector-mask-enter-from,
.inspector-mask-leave-to {
  opacity: 0;
}

.inspector-drawer-header {
  position: sticky;
  top: -12px;
  z-index: 2;
  display: flex;
  align-items: flex-start;
  justify-content: space-between;
  gap: 12px;
  margin: -12px -12px 12px;
  padding: 12px;
  border-bottom: 1px solid var(--divider);
  background: color-mix(in srgb, var(--bg-panel-elevated) 92%, transparent);
  backdrop-filter: blur(10px);
}

.inspector-drawer-header strong,
.inspector-drawer-header small {
  display: block;
}

.inspector-drawer-header small {
  margin-top: 3px;
  color: var(--text-secondary);
  font-size: var(--font-size-small);
}

.inspector-card {
  border: 1px solid var(--border);
  border-radius: var(--radius-xl);
  background: var(--bg-panel-elevated);
  padding: 12px;
  margin-bottom: 12px;
  box-shadow: var(--shadow-sm);
}

.inspector-card h3 {
  display: flex;
  align-items: center;
  gap: 6px;
  font-size: var(--font-size-title);
  margin-bottom: 10px;
}

.workspace-controls-card {
  display: grid;
  gap: 10px;
}

.theme-btn {
  display: inline-flex;
  align-items: center;
  gap: 5px;
}

.inspector-actions-grid {
  display: grid;
  grid-template-columns: repeat(2, minmax(0, 1fr));
  gap: 8px;
}

.inspector-card .btn.active {
  background: var(--primary-soft);
  color: var(--primary);
  border-color: var(--primary);
}

.inspector-field {
  display: grid;
  gap: 6px;
  color: var(--text-secondary);
  font-size: var(--font-size-small);
}

.inspector-select.compact {
  margin-bottom: 0;
}

.inspector-input {
  width: 100%;
  height: 32px;
  padding: 6px 9px;
  border: 1px solid var(--border);
  border-radius: var(--radius-md);
  background: var(--bg-panel);
  color: var(--text-primary);
  font-size: var(--font-size-small);
}

.inspector-input:focus {
  border-color: var(--primary);
  box-shadow: var(--focus-ring);
  outline: none;
}

.inspector-full-btn {
  width: 100%;
}

.inspector-line {
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: 8px;
  min-height: 26px;
  color: var(--text-secondary);
  font-size: var(--font-size-small);
}

.inspector-line strong,
.inspector-line code {
  color: var(--text-primary);
  max-width: 190px;
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
}

.inspector-select {
  width: 100%;
  min-height: 32px;
  margin-bottom: 8px;
}

.env-var-mini-list {
  display: grid;
  gap: 6px;
}

.env-var-mini,
.dynamic-token {
  width: 100%;
  border: 1px solid var(--border);
  border-radius: var(--radius-md);
  background: var(--bg-panel);
  color: var(--text-secondary);
  cursor: pointer;
  padding: 7px 8px;
  text-align: left;
}

.env-var-mini {
  display: grid;
  gap: 3px;
}

.env-var-mini span,
.dynamic-token {
  font-family: var(--font-code);
}

.env-var-mini code {
  color: var(--text-tertiary);
  overflow: hidden;
  text-overflow: ellipsis;
}

.env-var-mini:hover,
.dynamic-token:hover {
  border-color: var(--primary);
  color: var(--primary);
}

.inspector-empty {
  color: var(--text-tertiary);
  font-size: var(--font-size-small);
}

.inspector-details {
  color: var(--text-secondary);
  font-size: var(--font-size-small);
}

.inspector-details summary {
  cursor: pointer;
  font-weight: 700;
  color: var(--text-primary);
}

.inspector-details[open] summary {
  margin-bottom: 8px;
}

.inspector-toast {
  position: sticky;
  bottom: 8px;
  margin-top: 8px;
  padding: 8px 10px;
  border-radius: var(--radius-lg);
  background: color-mix(in srgb, var(--primary) 92%, #111827);
  color: #fff;
  font-size: var(--font-size-small);
  font-weight: 700;
  text-align: center;
  box-shadow: var(--shadow-md);
}


.file-drop-overlay {
  position: fixed;
  inset: 0;
  z-index: 1300;
  display: grid;
  place-items: center;
  background: color-mix(in srgb, var(--primary) 14%, transparent);
  border: 2px dashed var(--primary);
  pointer-events: none;
}

.file-drop-card {
  display: flex;
  flex-direction: column;
  gap: 8px;
  min-width: min(420px, calc(100vw - 48px));
  padding: 24px;
  border: 1px solid var(--border);
  border-radius: var(--radius-xl);
  background: var(--bg-panel);
  box-shadow: var(--shadow-lg);
  text-align: center;
}

.file-drop-card strong {
  font-size: 18px;
}

.file-drop-card span {
  color: var(--text-secondary);
}

.file-import-toast {
  position: fixed;
  left: 50%;
  bottom: 28px;
  z-index: 1301;
  transform: translateX(-50%);
  max-width: min(620px, calc(100vw - 48px));
  padding: 10px 14px;
  border: 1px solid var(--border);
  border-radius: var(--radius-xl);
  background: var(--bg-panel);
  box-shadow: var(--shadow-lg);
  color: var(--text-primary);
}

.shortcut-modal-mask {
  position: fixed;
  inset: 0;
  z-index: 80;
  display: flex;
  align-items: center;
  justify-content: center;
  padding: 24px;
  background: rgba(15, 23, 42, 0.42);
  backdrop-filter: blur(8px);
}

.shortcut-modal {
  width: min(760px, 100%);
  max-height: min(760px, 88vh);
  overflow: auto;
  border: 1px solid var(--border);
  border-radius: var(--radius-2xl);
  background: var(--bg-panel-elevated);
  box-shadow: var(--shadow-lg);
  padding: 18px;
}

.shortcut-modal-header,
.shortcut-actions,
.shortcut-row {
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: 12px;
}

.shortcut-modal-header {
  padding-bottom: 14px;
  border-bottom: 1px solid var(--divider);
}

.shortcut-modal-header h2 {
  margin: 4px 0;
  font-size: 20px;
}

.shortcut-modal-header p,
.shortcut-meta small {
  margin: 0;
  color: var(--text-secondary);
  font-size: var(--font-size-small);
}

.shortcut-list {
  display: grid;
  gap: 10px;
  padding: 14px 0;
}

.shortcut-row {
  padding: 12px;
  border: 1px solid var(--border);
  border-radius: var(--radius-lg);
  background: var(--bg-panel);
}

.shortcut-meta {
  display: grid;
  gap: 4px;
  flex: 1;
  min-width: 0;
}

.shortcut-input {
  width: 150px;
  border: 1px solid var(--border);
  border-radius: var(--radius-md);
  background: var(--bg-input);
  color: var(--text-primary);
  font-family: var(--font-code);
  font-size: 12px;
  padding: 8px 10px;
  text-align: center;
  cursor: pointer;
}

.shortcut-input:focus {
  border-color: var(--primary);
  outline: none;
  box-shadow: 0 0 0 3px color-mix(in srgb, var(--primary) 14%, transparent);
}

.shortcut-actions {
  padding-top: 14px;
  border-top: 1px solid var(--divider);
}

@media (max-width: 920px) {
  .toolbar-status,
  .cors-mode span {
    display: none;
  }

  .toolbar-brand {
    min-width: 0;
  }
}
</style>
