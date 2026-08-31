<script setup lang="ts">
import { ref, computed, watch, onMounted, onUnmounted, nextTick } from 'vue'
import { ChevronDown, ChevronRight, Ellipsis, House, Lock, Pencil, Save, X } from '@lucide/vue'
import { Tippy } from 'vue-tippy'
import { toast } from 'vue-sonner'
import { useAppStore } from '@/stores/app'
import { useWorkspaceStore } from '@/stores/workspace'
import { useWsStore } from '@/stores/ws'
import { isWebSocketUrl } from '@/utils/http'
import { resolveInheritedProperties } from '@/utils/inheritance'
import { runApiRequest } from '@/utils/api-request-runner'
import { responseBodyToBlob, responseContentType, responseFileExtension } from '@/utils/binary-response'
import { generateCurl } from '@/utils/export'
import ExportPanel from '@/components/common/ExportPanel.vue'
import CodeGenPanel from '@/components/common/CodeGenPanel.vue'
import VariableAutocomplete from '@/components/common/VariableAutocomplete.vue'
import { useVariableAutocomplete } from '@/composables/useVariableAutocomplete'
import type { CollectionNode, HttpMethod, RequestType, ResponseData } from '@/types'

const store = useAppStore()
const workspace = useWorkspaceStore()
const wsStore = useWsStore()
const methods: HttpMethod[] = ['GET', 'POST', 'PUT', 'PATCH', 'DELETE', 'HEAD', 'OPTIONS']

const currentApi = computed(() => store.getCurrentApi())
const currentModule = computed(() => {
  const interfaceNode = workspace.interfaces.find(item => item.apiId === store.currentApiId)
  return interfaceNode ? workspace.modules.find(item => item.id === interfaceNode.moduleId) ?? null : null
})
const currentCategory = computed(() => currentModule.value ? workspace.categories.find(category => category.id === currentModule.value?.categoryId) ?? null : null)
const isReadonlyModule = computed(() => currentModule.value?.type === 'readonly')

// ── 请求位置面包屑:集合 › 文件夹(根→叶) › 请求名 ──
const breadcrumbFolderNames = computed<string[]>(() => {
  const node = workspace.interfaces.find(item => item.apiId === store.currentApiId && (item.nodeType ?? 'request') === 'request')
  if (!node) return []
  const names: string[] = []
  let cursor = node.parentId ?? null
  let guard = 0
  while (cursor && guard++ < 32) {
    const parent = workspace.interfaces.find(item => item.id === cursor)
    if (!parent) break
    names.unshift(parent.name)
    cursor = parent.parentId ?? null
  }
  return names
})

// ── 请求名就地重命名(提交后立即落库并同步集合树) ──
const isRenaming = ref(false)
const renameDraft = ref('')
const renameInputRef = ref<HTMLInputElement | null>(null)

function startRename() {
  if (!currentApi.value || isReadonlyModule.value) return
  renameDraft.value = currentApi.value.name
  isRenaming.value = true
  nextTick(() => {
    renameInputRef.value?.focus()
    renameInputRef.value?.select()
  })
}

async function commitRename() {
  if (!isRenaming.value) return
  isRenaming.value = false
  const name = renameDraft.value.trim()
  const api = currentApi.value
  if (!api || !name || name === api.name) return
  await store.updateApiNow(api.id, { name })
  toast.success('已重命名')
}

function cancelRename() {
  isRenaming.value = false
}
const currentMethod = ref<HttpMethod>('GET')
const currentUrl = ref('')
const urlScrollLeft = ref(0)
const showExportPanel = ref(false)
const showCodeGenPanel = ref(false)
const showActionMenu = ref(false)
const actionTippyRef = ref<{ hide: () => void } | null>(null)
function closeActionMenu() {
  showActionMenu.value = false
  actionTippyRef.value?.hide()
}
const showMethodMenu = ref(false)
const showBaseUrlMenu = ref(false)
const customMethodDraft = ref('')
const customMethodInputRef = ref<HTMLInputElement | null>(null)
const postSendAction = ref<null | 'download' | 'codegen'>(null)

const envVars = computed(() => store.getEnvVariables())
const canRetry = computed(() => !store.loading && Boolean(store.response && (store.response.status === 0 || store.response.status >= 400)))
const wsActiveForCurrent = computed(() => wsStore.activeApiId === currentApi.value?.id && wsStore.isBusy)
const sendButtonLabel = computed(() => {
  if (currentRequestType.value === 'ws') return wsActiveForCurrent.value ? '断开' : '连接'
  if (canRetry.value) return '重试'
  return '发送'
})
const baseUrlOptions = computed(() => {
  const keywordPattern = /(base|url|host|origin|endpoint|api)/i
  return Object.entries(envVars.value)
    .filter(([key, value]) => Boolean(key) && (keywordPattern.test(key) || /^https?:\/\//i.test(value)))
    .sort((a, b) => Number(/^https?:\/\//i.test(b[1])) - Number(/^https?:\/\//i.test(a[1])))
    .slice(0, 12)
    .map(([key, value]) => ({
      key,
      template: `{{${key}}}`,
      preview: value,
    }))
})
const highlightedUrlSegments = computed(() => splitUrlForHighlight(currentUrl.value, envVars.value))

// ── Phase 2:当前请求所属集合与它的环境 ──
// ── Phase 1.5:继承标记(集合/文件夹级 Auth/Headers/变量/脚本)──
const inheritedSummary = computed(() => {
  const api = currentApi.value
  const node = api ? workspace.interfaces.find(item => item.apiId === api.id) : null
  const cid = node ? (node.collectionId ?? node.moduleId) : null
  const collection = cid ? workspace.collections.find(item => item.id === cid) : null
  if (!collection || !node) return null
  const inherited = resolveInheritedProperties(collection, workspace.interfaces as CollectionNode[], node.id)
  return {
    collectionName: collection.name,
    auth: inherited.auth.source !== 'none' && inherited.auth.source !== 'node'
      ? `${inherited.auth.sourceName}(${inherited.auth.auth.type})`
      : null,
    headers: inherited.headers.map(h => ({ key: h.key, source: inherited.headerSources[h.key] })),
    variables: inherited.variables.map(v => ({ key: v.key, source: inherited.variableSources[v.key] })),
    preScripts: inherited.preScripts.map(script => script.sourceName),
    postScripts: inherited.postScripts.map(script => script.sourceName),
  }
})

/** 模板渲染用的继承 chips(无任何继承项时为 null) */
interface InheritedChip { key: string; label: string; title: string }
const inheritedChips = computed<{ collectionName: string; chips: InheritedChip[] } | null>(() => {
  const summary = inheritedSummary.value
  if (!summary) return null
  const chips: InheritedChip[] = []
  if (summary.auth && inheritedSummary.value?.auth && !inheritedSummary.value.auth.endsWith('(none)')) {
    chips.push({ key: 'auth', label: `Auth · ${summary.auth}`, title: `Auth 继承自:${summary.auth}` })
  }
  if (summary.headers.length) {
    chips.push({
      key: 'headers',
      label: `Headers ×${summary.headers.length}`,
      title: `${summary.headers.length} 个 Header 继承:\n${summary.headers.map(h => `${h.key} ← ${h.source}`).join('\n')}`,
    })
  }
  if (summary.variables.length) {
    chips.push({
      key: 'variables',
      label: `变量 ×${summary.variables.length}`,
      title: `${summary.variables.length} 个变量继承:\n${summary.variables.map(v => `${v.key} ← ${v.source}`).join('\n')}`,
    })
  }
  if (summary.preScripts.length) {
    chips.push({
      key: 'pre',
      label: `Pre 脚本 ×${summary.preScripts.length}`,
      title: `Pre 脚本执行顺序(集合 → 文件夹):${summary.preScripts.join(' → ')}`,
    })
  }
  if (summary.postScripts.length) {
    chips.push({
      key: 'post',
      label: `Post 脚本 ×${summary.postScripts.length}`,
      title: `Post 脚本执行顺序(文件夹 → 集合):${summary.postScripts.join(' → ')}`,
    })
  }
  return chips.length ? { collectionName: summary.collectionName, chips } : null
})

// ── FR-4:请求类型自动识别 —— ws/wss scheme 即 WS 模式,其余统一走流式 HTTP 管道;
// ApiConfig.requestType 仅保留兼容存量数据,不再作为 UI 分支依据 ──
const currentRequestType = computed<RequestType>(() => isWebSocketUrl(currentUrl.value) ? 'ws' : 'rest')

const urlInputRef = ref<HTMLInputElement | null>(null)
const urlAutocomplete = useVariableAutocomplete(urlInputRef)

watch(currentApi, (api) => {
  if (api) {
    currentMethod.value = api.method
    currentUrl.value = api.url
  }
}, { immediate: true })

watch([currentMethod, currentUrl], () => {
  if (currentApi.value && !isReadonlyModule.value) {
    store.updateApi(currentApi.value.id, {
      method: currentMethod.value,
      url: currentUrl.value,
    })
  }
})

type UrlHighlightSegment = {
  text: string
  variable?: boolean
  resolved?: boolean
  preview?: string
}

function splitUrlForHighlight(url: string, vars: Record<string, string>): UrlHighlightSegment[] {
  const segments: UrlHighlightSegment[] = []
  const pattern = /\{\{\s*([^}]+?)\s*\}\}/g
  let lastIndex = 0
  let match: RegExpExecArray | null

  while ((match = pattern.exec(url))) {
    if (match.index > lastIndex) segments.push({ text: url.slice(lastIndex, match.index) })
    const expression = match[1]?.trim() || ''
    segments.push({
      text: match[0],
      variable: true,
      resolved: expression.startsWith('$') || Object.prototype.hasOwnProperty.call(vars, expression),
      preview: expression.startsWith('$') ? '动态变量' : vars[expression],
    })
    lastIndex = match.index + match[0].length
  }

  if (lastIndex < url.length) segments.push({ text: url.slice(lastIndex) })
  return segments.length ? segments : [{ text: url }]
}

function syncUrlScroll() {
  urlScrollLeft.value = urlInputRef.value?.scrollLeft ?? 0
}

function handleUrlInput() {
  syncUrlScroll()
  urlAutocomplete.handleInput()
}

function extractUrlSuffix(url: string): string {
  const trimmed = url.trim()
  if (!trimmed) return ''

  const templateMatch = trimmed.match(/^\{\{[^}]+\}\}(.*)$/)
  if (templateMatch) return normalizeUrlSuffix(templateMatch[1] || '')

  if (/^[a-z][a-z\d+.-]*:\/\//i.test(trimmed)) {
    try {
      const parsed = new URL(trimmed)
      const suffix = `${parsed.pathname === '/' ? '' : parsed.pathname}${parsed.search}${parsed.hash}`
      return suffix || ''
    } catch {
      return ''
    }
  }

  if (trimmed.startsWith('/')) return trimmed
  return ''
}

function normalizeUrlSuffix(suffix: string): string {
  const trimmed = suffix.trim()
  if (!trimmed) return ''
  if (trimmed.startsWith('/')) return trimmed
  if (trimmed.startsWith('?') || trimmed.startsWith('#')) return `/${trimmed}`
  return `/${trimmed}`
}

function applyBaseUrlTemplate(key: string) {
  showBaseUrlMenu.value = false
  if (!key || isReadonlyModule.value) return
  const option = baseUrlOptions.value.find(item => item.key === key)
  if (!option) return
  currentUrl.value = `${option.template}${extractUrlSuffix(currentUrl.value)}`
  window.setTimeout(() => urlInputRef.value?.focus(), 0)
}

function methodColor(method: HttpMethod): string {
  const colors: Record<string, string> = {
    GET: 'var(--method-get-color)',
    POST: 'var(--method-post-color)',
    PUT: 'var(--method-put-color)',
    DELETE: 'var(--method-delete-color)',
    PATCH: 'var(--method-patch-color)',
    HEAD: 'var(--method-head-color)',
    OPTIONS: 'var(--method-options-color)',
  }
  return colors[method] || 'var(--method-default-color)'
}

const isCustomMethod = computed(() => !methods.includes(currentMethod.value))

// ── Alt+↑/↓ 循环切换 method(FR-1.1 / FR-8.1;由全局快捷键派发)──
function cycleMethod(direction: 1 | -1) {
  if (isReadonlyModule.value || currentRequestType.value === 'ws') return
  const base = isCustomMethod.value ? -1 : methods.indexOf(currentMethod.value)
  const next = (base + direction + methods.length) % methods.length
  currentMethod.value = methods[next]
}

function onCycleMethodEvent(event: Event) {
  const direction = (event as CustomEvent<{ direction?: 1 | -1 }>).detail?.direction ?? 1
  cycleMethod(direction)
}

/** FR-8.1:Ctrl+I 重置请求(清空响应 + 重置参数) */
function resetRequest() {
  const api = currentApi.value
  if (!api || isReadonlyModule.value) return
  store.response = null
  currentUrl.value = ''
  currentMethod.value = 'GET'
  store.updateApi(api.id, {
    method: 'GET',
    url: '',
    headers: [],
    params: [],
    body: { type: 'none', raw: '', formData: [], urlEncoded: [], binaryFile: null, contentType: '' },
  })
  toast.success('请求已重置')
}

// ── CUSTOM method ──
function pickCustomMethod() {
  customMethodDraft.value = isCustomMethod.value ? currentMethod.value : ''
  showMethodMenu.value = false
  nextTick(() => customMethodInputRef.value?.focus())
}

function commitCustomMethod() {
  const verb = customMethodDraft.value.trim().toUpperCase()
  if (verb) currentMethod.value = verb as HttpMethod
  else if (isCustomMethod.value) currentMethod.value = 'GET'
}

async function send() {
  if (!currentUrl.value.trim() || !currentApi.value) return
  if (currentRequestType.value === 'ws') {
    wsStore.toggleConnect(currentApi.value)
    return
  }

  const abortController = new AbortController()
  store.setRequestAbortController(abortController)
  store.loading = true
  store.response = null

  try {
    const response = await runApiRequest(currentApi.value, {
      method: currentMethod.value,
      url: currentUrl.value,
      signal: abortController.signal,
      onStreamingUpdate: streamingResponse => {
        store.response = streamingResponse
      },
    })
    store.response = response

    if (postSendAction.value === 'download') {
      downloadResponse(response)
    } else if (postSendAction.value === 'codegen') {
      showCodeGenPanel.value = true
    }
    postSendAction.value = null
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error)
    store.response = {
      status: 0,
      statusText: message || 'Unknown Error',
      headers: {},
      body: '',
      duration: 0,
      size: 0,
      url: currentUrl.value,
      method: currentMethod.value,
      requestHeaders: {},
      requestBody: null,
      timestamp: Date.now(),
    }
    postSendAction.value = null
  } finally {
    store.loading = false
    store.clearRequestAbortController(abortController)
  }
}

function openExport() {
  closeActionMenu()
  showExportPanel.value = true
}

function openCodeGen() {
  closeActionMenu()
  showCodeGenPanel.value = true
}

/** FR-2.5:保存按钮 → Save 弹窗(已保存请求静默落库并熄灭未保存圆点) */
function saveCurrentApi() {
  if (!currentApi.value || isReadonlyModule.value) return
  window.dispatchEvent(new CustomEvent('postino:save-request'))
}

function copyAsCurl() {
  const api = currentApi.value
  if (!api) return
  void navigator.clipboard.writeText(generateCurl(api, store.getEnvVariables()))
  closeActionMenu()
  toast.success('已复制 cURL')
}

function downloadResponse(response: ResponseData) {
  const contentType = responseContentType(response)
  const extension = responseFileExtension(contentType)
  const blob = responseBodyToBlob(response)
  const url = URL.createObjectURL(blob)
  const a = document.createElement('a')
  a.href = url
  a.download = `response-${new Date(response.timestamp).toISOString().replace(/[:.]/g, '-')}.${extension}`
  a.click()
  URL.revokeObjectURL(url)
}

async function sendAndThen(action: 'download' | 'codegen') {
  closeActionMenu()
  postSendAction.value = action
  await send()
}

function closeMenus() {
  showActionMenu.value = false
  showMethodMenu.value = false
  showBaseUrlMenu.value = false
}

function handleGlobalSend() {
  // FR-8.1:Ctrl+Enter 发送/取消 —— 发送中再按一次取消
  if (store.loading) {
    store.cancelCurrentRequest()
    return
  }
  if (currentUrl.value.trim()) {
    send()
  }
}

function handleGlobalOpenCodeGen() {
  if (currentApi.value) openCodeGen()
}

onMounted(() => {
  window.addEventListener('postino:send-current-request', handleGlobalSend)
  window.addEventListener('postino:open-codegen', handleGlobalOpenCodeGen)
  window.addEventListener('postino:cycle-method', onCycleMethodEvent)
  window.addEventListener('postino:reset-request', resetRequest)
})
onUnmounted(() => {
  window.removeEventListener('postino:send-current-request', handleGlobalSend)
  window.removeEventListener('postino:open-codegen', handleGlobalOpenCodeGen)
  window.removeEventListener('postino:cycle-method', onCycleMethodEvent)
  window.removeEventListener('postino:reset-request', resetRequest)
})
</script>

<template>
  <div class="request-bar-area">
    <!-- 请求名 + 位置面包屑(集合 › 文件夹 › 请求名;点击请求名就地重命名) -->
    <div class="request-meta-row">
      <span class="request-name-dot" :style="{ backgroundColor: methodColor(currentMethod) }"></span>
      <template v-if="isRenaming">
        <input
          ref="renameInputRef"
          v-model="renameDraft"
          type="text"
          class="rename-input"
          maxlength="120"
          @keydown.enter.stop="commitRename"
          @keydown.esc.stop="cancelRename"
          @blur="commitRename"
          @click.stop
        />
      </template>
      <template v-else>
        <span v-if="currentCategory" class="crumb-folder" :title="currentCategory.name">{{ currentCategory.name }}</span>
        <ChevronRight v-if="currentCategory" :size="11" class="crumb-sep" />
        <span v-if="currentModule" class="crumb-folder" :title="currentModule.name">{{ currentModule.name }}</span>
        <ChevronRight v-if="currentModule" :size="11" class="crumb-sep" />
        <span
          v-for="(folderName, index) in breadcrumbFolderNames"
          :key="`${index}-${folderName}`"
          class="crumb-folder"
          :title="folderName"
        >{{ folderName }}</span>
        <ChevronRight v-if="breadcrumbFolderNames.length" :size="11" class="crumb-sep" />
        <span
          class="request-name"
          :title="`${currentApi?.name ?? ''}(点击重命名)`"
          role="button"
          tabindex="0"
          @click="startRename"
          @keydown.enter.stop.prevent="startRename"
        >{{ currentApi?.name || '未命名请求' }}</span>
        <button class="rename-btn" title="重命名" @click.stop="startRename"><Pencil :size="12" /></button>
      </template>
      <template v-if="inheritedChips && !isRenaming">
        <span
          v-for="chip in inheritedChips.chips"
          :key="chip.key"
          class="inherit-chip"
          :title="chip.title"
        >{{ chip.label }}</span>
      </template>
    </div>

    <!-- 请求行(FR-1.1;FR-4:无类型切换,ws/wss scheme 自动进入 WS 模式) -->
    <div class="request-line" @click="closeMenus">
      <!-- method 彩色下拉(含 CUSTOM;WS 模式无 method) -->
      <div v-if="currentRequestType !== 'ws'" class="method-picker relative">
        <button
          type="button"
          class="method-btn"
          :style="{ color: methodColor(currentMethod) }"
          :disabled="isReadonlyModule"
          aria-haspopup="listbox"
          :aria-expanded="showMethodMenu"
          @click.stop="showMethodMenu = !showMethodMenu"
        >
          <span>{{ isCustomMethod ? currentMethod : currentMethod }}</span>
          <ChevronDown :size="13" class="opacity-60" />
        </button>
        <div v-if="showMethodMenu" class="method-menu" role="listbox">
          <button
            v-for="m in methods"
            :key="m"
            type="button"
            class="method-option"
            :class="{ active: m === currentMethod }"
            role="option"
            :aria-selected="m === currentMethod"
            @click.stop="currentMethod = m; showMethodMenu = false"
          >
            <strong :style="{ color: methodColor(m) }">{{ m }}</strong>
          </button>
          <div class="method-menu-divider"></div>
          <button
            type="button"
            class="method-option"
            :class="{ active: isCustomMethod }"
            role="option"
            :aria-selected="isCustomMethod"
            @click.stop="pickCustomMethod"
          >
            <strong class="text-[color:var(--method-default-color)]">CUSTOM</strong>
          </button>
          <div v-if="isCustomMethod" class="p-2">
            <input
              ref="customMethodInputRef"
              v-model="customMethodDraft"
              type="text"
              class="custom-method-input"
              placeholder="自定义动词,如 PURGE"
              maxlength="12"
              @keydown.enter.stop="commitCustomMethod(); showMethodMenu = false"
              @blur="commitCustomMethod"
              @click.stop
            />
          </div>
        </div>
      </div>

      <!-- URL 输入(环境变量高亮 + 自动补全) -->
      <div class="url-field">
        <div class="url-input-wrap">
          <div
            class="url-highlight-layer"
            aria-hidden="true"
            :style="{ transform: `translateX(-${urlScrollLeft}px)` }"
          >
            <span
              v-for="(segment, index) in highlightedUrlSegments"
              :key="`${index}-${segment.text}`"
              :class="{ 'url-var-token': segment.variable, unresolved: segment.variable && !segment.resolved }"
              :title="segment.variable ? (segment.resolved ? segment.preview : '未定义变量') : undefined"
            >{{ segment.text }}</span>
          </div>
          <input
            ref="urlInputRef"
            v-model="currentUrl"
            type="url"
            class="url-input"
            placeholder="https://api.example.com/users/{{id}}"
            spellcheck="false"
            @keydown.enter="send"
            @input="handleUrlInput"
            @scroll="syncUrlScroll"
            :disabled="isReadonlyModule"
          />
        </div>
        <div v-if="baseUrlOptions.length" class="base-url-picker">
          <button
            type="button"
            class="base-url-btn"
            title="选择基础地址变量并保留当前路径"
            :disabled="isReadonlyModule"
            aria-haspopup="listbox"
            :aria-expanded="showBaseUrlMenu"
            @click.stop="showBaseUrlMenu = !showBaseUrlMenu"
          >
            <House :size="13" />
            <ChevronDown :size="11" class="opacity-60" />
          </button>
          <div v-if="showBaseUrlMenu" class="base-url-menu" role="listbox">
            <button
              v-for="item in baseUrlOptions"
              :key="item.key"
              type="button"
              class="base-url-option"
              role="option"
              :title="item.preview"
              @click.stop="applyBaseUrlTemplate(item.key)"
            >
              <span class="base-url-key">{{ item.key }}</span>
              <span class="base-url-preview">{{ item.preview }}</span>
            </button>
          </div>
        </div>
      </div>

      <!-- 发送 / 取消 -->
      <button
        v-if="!store.loading"
        class="send-btn"
        :class="{ retry: canRetry && currentRequestType !== 'ws' }"
        :disabled="!currentUrl.trim()"
        :title="currentRequestType === 'ws' ? '连接 / 断开 WebSocket' : '发送(Ctrl+Enter)'"
        @click="send"
      >
        {{ sendButtonLabel }}
      </button>
      <button v-else class="send-btn cancel" @click="store.cancelCurrentRequest()">
        <X :size="14" /> 取消
      </button>

      <!-- 保存 -->
      <button
        class="save-btn"
        :disabled="isReadonlyModule || !currentApi"
        title="保存(Ctrl+S)"
        @click="saveCurrentApi"
      >
        <Save :size="14" />
      </button>

      <!-- 更多操作 -->
      <Tippy ref="actionTippyRef" interactive trigger="click" theme="popover" placement="bottom-end" :offset="[0, 4]">
        <button class="action-btn" title="更多操作"><Ellipsis :size="16" /></button>
        <template #content>
          <div class="flex w-44 flex-col">
            <button class="menu-item" @click="closeActionMenu(); sendAndThen('download')">发送并下载响应</button>
            <button class="menu-item" @click="closeActionMenu(); sendAndThen('codegen')">发送后生成代码</button>
            <button class="menu-item" @click="copyAsCurl">复制为 cURL</button>
            <button class="menu-item" @click="openCodeGen">生成代码</button>
            <button class="menu-item" @click="openExport">导出请求</button>
          </div>
        </template>
      </Tippy>
    </div>

    <div v-if="isReadonlyModule" class="readonly-hint"><Lock :size="13" /> 当前集合为只读模式:可发送请求,但接口定义只能通过导入/同步更新。</div>
  </div>

  <ExportPanel
    :visible="showExportPanel"
    :api="currentApi"
    :env-vars="envVars"
    @close="showExportPanel = false"
  />

  <CodeGenPanel
    :visible="showCodeGenPanel"
    :api="currentApi"
    :env-vars="envVars"
    @close="showCodeGenPanel = false"
  />

  <VariableAutocomplete
    :visible="urlAutocomplete.showAutocomplete.value"
    :position="urlAutocomplete.autocompletePosition.value"
    :filter="urlAutocomplete.autocompleteFilter.value"
    :items="urlAutocomplete.allItems.value"
    @select="urlAutocomplete.insertVariable"
    @close="urlAutocomplete.close"
  />
</template>

<style scoped>
.request-bar-area {
  padding: 8px 12px 10px;
  border-bottom: 1px solid var(--divider-color);
  background: var(--primary-light-color);
}

.request-meta-row {
  display: flex;
  align-items: center;
  gap: 5px;
  margin-bottom: 8px;
  font-size: var(--font-size-body);
  font-weight: 600;
  color: var(--secondary-dark-color);
  min-height: 18px;
  overflow: hidden;
}

/* 面包屑:集合/文件夹段弱化展示,可横向收缩 */
.crumb-folder {
  flex-shrink: 1;
  min-width: 0;
  max-width: 180px;
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
  color: var(--secondary-color);
  font-weight: 500;
  font-size: var(--font-size-tiny);
}

.crumb-sep {
  flex-shrink: 0;
  color: var(--secondary-light-color);
}

.request-name {
  min-width: 0;
  max-width: 320px;
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
  border-radius: var(--radius-sm);
  cursor: text;
}

.request-name:hover {
  color: var(--accent-color);
}

.rename-btn {
  display: inline-flex;
  align-items: center;
  justify-content: center;
  width: 20px;
  height: 20px;
  flex-shrink: 0;
  border-radius: var(--radius-sm);
  color: var(--secondary-light-color);
  opacity: 0;
  transition: opacity 0.12s ease, color 0.12s ease;
}

.request-meta-row:hover .rename-btn {
  opacity: 1;
}

.rename-btn:hover {
  color: var(--accent-color);
  background: var(--primary-dark-color);
}

.rename-input {
  width: 320px;
  max-width: 60%;
  height: 24px;
  padding: 0 7px;
  border: 1px solid var(--accent-color);
  border-radius: var(--radius-sm);
  background: var(--primary-color);
  color: var(--secondary-dark-color);
  font-size: var(--font-size-body);
  font-weight: 600;
  outline: none;
}

.request-name-dot {
  width: 8px;
  height: 8px;
  border-radius: 50%;
  flex-shrink: 0;
}

.inherit-chip {
  display: inline-flex;
  align-items: center;
  gap: 3px;
  max-width: 200px;
  padding: 1px 7px;
  border: 1px solid var(--divider-dark-color);
  border-radius: 999px;
  color: var(--secondary-color);
  font-size: var(--font-size-tiny);
  font-weight: 500;
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
  flex-shrink: 0;
}

.request-line {
  display: flex;
  align-items: center;
  gap: 0;
}

/* method 下拉:与 URL 输入方角拼接 */
.method-picker {
  flex-shrink: 0;
}

.method-btn {
  display: inline-flex;
  align-items: center;
  gap: 5px;
  height: 34px;
  padding: 0 8px 0 10px;
  border: 1px solid var(--divider-dark-color);
  border-right: none;
  border-radius: 0;
  background: var(--primary-light-color);
  font-weight: 700;
  font-size: var(--font-size-body);
  font-family: var(--font-code);
  white-space: nowrap;
  transition: background 0.12s ease;
}

.method-btn:hover:not(:disabled) {
  background: var(--primary-dark-color);
}

.method-btn:disabled {
  cursor: not-allowed;
  opacity: 0.6;
}

.method-menu {
  position: absolute;
  top: calc(100% + 4px);
  left: 0;
  z-index: 110;
  min-width: 132px;
  padding: 4px;
  border: 1px solid var(--divider-dark-color);
  border-radius: var(--radius-md);
  background: var(--popover-color);
  box-shadow: var(--shadow-lg);
}

.method-option {
  display: flex;
  align-items: center;
  width: 100%;
  padding: 6px 9px;
  border-radius: var(--radius-sm);
  background: transparent;
  color: var(--secondary-dark-color);
  cursor: pointer;
  text-align: left;
  font-size: var(--font-size-body);
}

.method-option:hover,
.method-option.active {
  background: var(--primary-dark-color);
}

.method-menu-divider {
  height: 1px;
  margin: 4px 6px;
  background: var(--divider-color);
}

.custom-method-input {
  width: 100%;
  height: 26px;
  padding: 0 7px;
  font-family: var(--font-code);
  font-size: var(--font-size-tiny);
  text-transform: uppercase;
}

/* URL 输入框 */
.url-field {
  flex: 1;
  min-width: 0;
  display: flex;
  align-items: center;
  height: 34px;
  border: 1px solid var(--divider-dark-color);
  background: var(--primary-color);
  transition: border-color 0.12s ease;
}

.url-field:focus-within {
  border-color: var(--accent-color);
}

.url-input-wrap {
  position: relative;
  flex: 1;
  min-width: 0;
  height: 32px;
  overflow: hidden;
}

.url-highlight-layer,
.url-input {
  position: absolute;
  inset: 0;
  width: 100%;
  height: 32px;
  padding: 0 10px;
  font-size: var(--font-size-body);
  font-family: var(--font-code);
  line-height: 32px;
  white-space: pre;
}

.url-highlight-layer {
  pointer-events: none;
  color: var(--secondary-dark-color);
}

.url-input {
  border: none;
  background: transparent;
  color: transparent;
  caret-color: var(--secondary-dark-color);
}

.url-input:disabled {
  cursor: not-allowed;
}

.url-input::placeholder {
  color: var(--secondary-light-color);
}

.url-var-token {
  color: var(--accent-color);
  border-bottom: 1px dashed var(--accent-color);
  font-weight: 700;
}

.url-var-token.unresolved {
  color: var(--status-critical-error-color);
  border-bottom-color: var(--status-critical-error-color);
}

.base-url-picker {
  position: relative;
  flex-shrink: 0;
}

.base-url-btn {
  display: flex;
  align-items: center;
  gap: 3px;
  height: 26px;
  margin-right: 4px;
  padding: 0 6px;
  border: 1px solid var(--divider-dark-color);
  border-radius: var(--radius-sm);
  background-color: var(--primary-light-color);
  color: var(--secondary-color);
  font-size: var(--font-size-tiny);
  outline: none;
  cursor: pointer;
}

.base-url-btn:hover:not(:disabled) {
  color: var(--secondary-dark-color);
  border-color: var(--accent-color);
}

.base-url-btn:disabled {
  cursor: not-allowed;
  opacity: 0.6;
}

.base-url-menu {
  position: absolute;
  top: calc(100% + 4px);
  right: 0;
  z-index: 110;
  min-width: 340px;
  max-width: 440px;
  max-height: 260px;
  overflow-y: auto;
  padding: 4px;
  border: 1px solid var(--divider-dark-color);
  border-radius: var(--radius-md);
  background: var(--popover-color);
  box-shadow: var(--shadow-lg);
}

.base-url-option {
  display: flex;
  align-items: center;
  gap: 8px;
  width: 100%;
  padding: 6px 9px;
  border-radius: var(--radius-sm);
  cursor: pointer;
  text-align: left;
  font-size: var(--font-size-body);
}

.base-url-option:hover {
  background: var(--primary-dark-color);
}

.base-url-key {
  font-family: 'SF Mono', 'Fira Code', monospace;
  font-weight: 600;
  color: var(--secondary-dark-color);
  white-space: nowrap;
}

.base-url-preview {
  flex: 1;
  min-width: 0;
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
  color: var(--accent-color);
}

/* 发送 / 保存 */
.send-btn {
  display: inline-flex;
  align-items: center;
  justify-content: center;
  gap: 4px;
  height: 34px;
  min-width: 74px;
  padding: 0 14px;
  border-radius: 0;
  background: var(--accent-color);
  color: var(--accent-contrast-color);
  font-size: var(--font-size-body);
  font-weight: 600;
  transition: background 0.12s ease;
}

.send-btn:hover:not(:disabled) {
  background: var(--accent-dark-color);
}

.send-btn:disabled {
  opacity: 0.45;
  cursor: not-allowed;
}

.send-btn.retry {
  background: var(--status-redirect-color);
}

.send-btn.cancel {
  background: var(--status-critical-error-color);
}

.save-btn {
  display: inline-flex;
  align-items: center;
  justify-content: center;
  width: 38px;
  height: 34px;
  border: 1px solid var(--divider-dark-color);
  border-left: none;
  border-radius: 0 var(--radius-md) var(--radius-md) 0;
  background: var(--primary-light-color);
  color: var(--secondary-color);
  transition: background 0.12s ease, color 0.12s ease;
}

.save-btn:hover:not(:disabled) {
  background: var(--primary-dark-color);
  color: var(--secondary-dark-color);
}

.save-btn:disabled {
  opacity: 0.45;
  cursor: not-allowed;
}

.action-btn {
  display: inline-flex;
  align-items: center;
  justify-content: center;
  width: 30px;
  height: 34px;
  margin-left: 2px;
  border-radius: var(--radius-md);
  color: var(--secondary-color);
}

.action-btn:hover {
  background: var(--primary-dark-color);
  color: var(--secondary-dark-color);
}

.readonly-hint {
  display: flex;
  align-items: center;
  gap: 6px;
  margin-top: 8px;
  color: var(--secondary-color);
  font-size: var(--font-size-tiny);
}

.menu-item {
  display: flex;
  align-items: center;
  gap: 8px;
  width: 100%;
  padding: 7px 12px;
  border-radius: var(--radius-sm);
  font-size: var(--font-size-body);
  color: var(--secondary-dark-color);
  text-align: left;
}

.menu-item:hover {
  background: var(--primary-dark-color);
}
</style>
