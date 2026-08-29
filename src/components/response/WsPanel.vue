<script setup lang="ts">
import { computed, nextTick, ref, watch } from 'vue'
import { ArrowDownLeft, ArrowUpRight, GripVertical, PlugZap, Plus, Trash2, X } from '@lucide/vue'
import { useAppStore } from '@/stores/app'
import { useWorkspaceStore } from '@/stores/workspace'
import { useWsStore } from '@/stores/ws'
import AuthConfig from '@/components/editor/AuthConfig.vue'
import type { AuthConfig as AuthConfigData, WsConnectionState, WsLogEntry } from '@/types'

/**
 * Realtime / WS 布局(FR-5.1/5.2,参考 Hoppscotch realtime/websocket.vue):
 * 顶部连接状态栏(连接中置灰 + 断线自动重连开关 + 重连计数),
 * tabs:通信(双向消息日志 + 发送框,收发色区分)/ 子协议(可拖拽排序)/ 认证。
 */
const store = useAppStore()
const workspace = useWorkspaceStore()
const ws = useWsStore()

const currentApi = computed(() => store.getCurrentApi())
const isReadonly = computed(() => {
  const node = workspace.interfaces.find(item => item.apiId === store.currentApiId)
  const module = node ? workspace.modules.find(item => item.id === node.moduleId) : null
  return module?.type === 'readonly'
})

const activeTab = ref<'communication' | 'protocols' | 'auth'>('communication')
const tabs = [
  { key: 'communication', label: '通信' },
  { key: 'protocols', label: '子协议' },
  { key: 'auth', label: '认证' },
] as const

const currentAuth = computed(() => currentApi.value?.auth)

function updateAuth(value: AuthConfigData) {
  const api = currentApi.value
  if (!api || isReadonly.value) return
  store.updateApi(api.id, { auth: value })
}

// ── 子协议(可拖拽排序列表)──
const protocols = computed<string[]>(() => currentApi.value?.wsProtocols ?? [])
const newProtocol = ref('')
const dragIndex = ref<number | null>(null)
const dropIndex = ref<number | null>(null)

function addProtocol() {
  const value = newProtocol.value.trim()
  const api = currentApi.value
  if (!api || isReadonly.value || !value) return
  if (protocols.value.includes(value)) {
    newProtocol.value = ''
    return
  }
  store.updateApi(api.id, { wsProtocols: [...protocols.value, value] })
  newProtocol.value = ''
}

function removeProtocol(index: number) {
  const api = currentApi.value
  if (!api || isReadonly.value) return
  const next = protocols.value.filter((_, i) => i !== index)
  store.updateApi(api.id, { wsProtocols: next })
}

function onProtocolDragStart(index: number) {
  dragIndex.value = index
}

function onProtocolDragOver(index: number) {
  if (dragIndex.value === null) return
  dropIndex.value = index
}

async function onProtocolDrop() {
  const from = dragIndex.value
  const to = dropIndex.value
  const api = currentApi.value
  dragIndex.value = null
  dropIndex.value = null
  if (from === null || to === null || from === to || !api || isReadonly.value) return
  const next = [...protocols.value]
  const [moved] = next.splice(from, 1)
  next.splice(to, 0, moved)
  store.updateApi(api.id, { wsProtocols: next })
}

// ── 状态与日志 ──
const statusLabels: Record<WsConnectionState, string> = {
  idle: '未连接',
  connecting: '连接中',
  open: '已连接',
  closing: '断开中',
  closed: '已断开',
  error: '连接错误',
}

function statusLabel(state: WsConnectionState): string {
  return statusLabels[state]
}

function directionLabel(direction: WsLogEntry['direction']): string {
  if (direction === 'out') return '发送'
  if (direction === 'in') return '接收'
  return '系统'
}

function formatTime(timestamp: number): string {
  return new Date(timestamp).toLocaleTimeString('zh-CN', { hour12: false })
}

const logsRef = ref<HTMLElement | null>(null)
const stickToBottom = ref(true)

function onLogsScroll() {
  const el = logsRef.value
  if (!el) return
  stickToBottom.value = el.scrollHeight - el.scrollTop - el.clientHeight < 80
}

watch(() => ws.logs.length, async () => {
  if (!stickToBottom.value) return
  await nextTick()
  const el = logsRef.value
  if (el) el.scrollTop = el.scrollHeight
})

// ── 发送框 ──
const draft = ref('')

function sendDraft() {
  const text = draft.value
  if (!text.trim()) return
  ws.send(text)
  draft.value = ''
}

function onDraftKeydown(event: KeyboardEvent) {
  if (event.key === 'Enter' && !event.shiftKey) {
    event.preventDefault()
    sendDraft()
  }
}

function toggleConnection() {
  if (!currentApi.value) return
  ws.toggleConnect(currentApi.value)
}
</script>

<template>
  <div class="ws-panel">
    <!-- 连接状态栏(FR-5.1) -->
    <div class="ws-toolbar">
      <span class="ws-status" :class="[ws.status, { busy: ws.isBusy }]">
        <span v-if="ws.status === 'connecting'" class="ws-spinner"></span>
        <span v-else class="ws-dot"></span>
        {{ statusLabel(ws.status) }}
        <small v-if="ws.statusDetail"> · {{ ws.statusDetail }}</small>
      </span>
      <label class="ws-reconnect" title="连接意外断开时每 2s 自动重连,最多 10 次">
        <input v-model="ws.autoReconnect" type="checkbox" />
        断线自动重连
      </label>
      <span v-if="ws.reconnectAttempts > 0" class="ws-reconnect-count">重连 {{ ws.reconnectAttempts }}/10</span>
      <span class="ws-toolbar-spacer"></span>
      <button class="connect-btn" :disabled="!currentApi" @click="toggleConnection">
        <PlugZap :size="14" />{{ ws.isBusy ? '断开' : '连接' }}
      </button>
      <button class="toolbar-action" title="清空消息日志" @click="ws.clearLogs()"><Trash2 :size="14" /></button>
    </div>

    <!-- tabs -->
    <div class="ws-tabs">
      <button
        v-for="tab in tabs"
        :key="tab.key"
        class="ws-tab"
        :class="{ active: activeTab === tab.key }"
        @click="activeTab = tab.key"
      >{{ tab.label }}</button>
    </div>

    <!-- 通信 -->
    <template v-if="activeTab === 'communication'">
      <div ref="logsRef" class="ws-logs" @scroll="onLogsScroll">
        <div v-if="!ws.logs.length" class="ws-logs-empty">暂无消息,连接后收发的帧会显示在这里(URL 支持环境变量)</div>
        <div v-for="entry in ws.logs" :key="entry.id" class="ws-entry" :class="entry.direction">
          <span class="ws-entry-dir">
            <ArrowUpRight v-if="entry.direction === 'out'" :size="12" />
            <ArrowDownLeft v-else-if="entry.direction === 'in'" :size="12" />
            {{ directionLabel(entry.direction) }}
          </span>
          <span class="ws-entry-time">{{ formatTime(entry.timestamp) }}</span>
          <span v-if="entry.binary" class="ws-entry-binary">binary {{ entry.binary }}B</span>
          <pre class="ws-entry-data">{{ entry.data }}</pre>
        </div>
      </div>
      <div class="ws-sendbox">
        <textarea
          v-model="draft"
          class="ws-draft"
          rows="2"
          placeholder="输入要发送的文本…(Enter 发送,Shift+Enter 换行)"
          @keydown="onDraftKeydown"
        ></textarea>
        <button class="btn btn-primary ws-send-btn" :disabled="!ws.isOpen || !draft.trim()" @click="sendDraft">发送</button>
      </div>
    </template>

    <!-- 子协议 -->
    <div v-else-if="activeTab === 'protocols'" class="ws-protocols-pane">
      <p class="pane-hint">Sec-WebSocket-Protocol 子协议,按序发送;拖拽调整顺序。</p>
      <div class="protocol-list">
        <div
          v-for="(protocol, index) in protocols"
          :key="`${protocol}-${index}`"
          class="protocol-row"
          :class="{ dragging: dragIndex === index, 'drop-target': dropIndex === index && dragIndex !== index }"
          draggable="true"
          @dragstart="onProtocolDragStart(index)"
          @dragover.prevent="onProtocolDragOver(index)"
          @drop.prevent="onProtocolDrop"
          @dragend="dragIndex = null; dropIndex = null"
        >
          <GripVertical :size="14" class="protocol-grip" />
          <code class="protocol-name">{{ protocol }}</code>
          <button class="protocol-remove" :disabled="isReadonly" @click="removeProtocol(index)"><X :size="13" /></button>
        </div>
        <div v-if="!protocols.length" class="protocols-empty">未配置子协议</div>
      </div>
      <div class="protocol-add">
        <input
          v-model="newProtocol"
          type="text"
          placeholder="添加子协议,如 chat"
          :disabled="isReadonly"
          spellcheck="false"
          @keydown.enter="addProtocol"
        />
        <button class="btn btn-sm" :disabled="isReadonly || !newProtocol.trim()" @click="addProtocol"><Plus :size="13" /> 添加</button>
      </div>
    </div>

    <!-- 认证 -->
    <div v-else class="ws-auth-pane">
      <AuthConfig
        v-if="currentAuth"
        :model-value="currentAuth"
        @update:model-value="updateAuth($event)"
        :readonly="isReadonly"
      />
    </div>
  </div>
</template>

<style scoped>
.ws-panel {
  flex: 1;
  min-height: 0;
  display: flex;
  flex-direction: column;
  overflow: hidden;
  background: var(--primary-color);
}

.ws-toolbar {
  display: flex;
  align-items: center;
  gap: 10px;
  padding: 8px 12px;
  border-bottom: 1px solid var(--divider-color);
  font-size: var(--font-size-body);
  flex-shrink: 0;
}

.ws-status {
  display: inline-flex;
  align-items: center;
  gap: 6px;
  font-weight: 600;
  color: var(--secondary-color);
}

.ws-status small {
  color: var(--secondary-light-color);
  font-weight: 400;
  max-width: 320px;
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
}

.ws-dot {
  width: 8px;
  height: 8px;
  border-radius: 50%;
  background: var(--secondary-light-color);
  flex-shrink: 0;
}

.ws-status.open {
  color: var(--status-success-color);
}

.ws-status.open .ws-dot {
  background: var(--status-success-color);
  box-shadow: 0 0 0 3px color-mix(in srgb, var(--status-success-color) 16%, transparent);
}

.ws-status.busy {
  opacity: 0.75;
}

.ws-status.connecting,
.ws-status.closing {
  color: var(--status-redirect-color);
}

.ws-status.connecting .ws-dot,
.ws-status.closing .ws-dot {
  background: var(--status-redirect-color);
}

.ws-status.error {
  color: var(--status-critical-error-color);
}

.ws-status.error .ws-dot {
  background: var(--status-critical-error-color);
}

.ws-spinner {
  width: 10px;
  height: 10px;
  border: 2px solid color-mix(in srgb, var(--status-redirect-color) 35%, transparent);
  border-top-color: var(--status-redirect-color);
  border-radius: 50%;
  animation: ws-spin 0.8s linear infinite;
}

.ws-reconnect {
  display: inline-flex;
  align-items: center;
  gap: 5px;
  color: var(--secondary-color);
  cursor: pointer;
  user-select: none;
  font-size: var(--font-size-tiny);
}

.ws-reconnect-count {
  color: var(--status-redirect-color);
  font-weight: 700;
  font-size: var(--font-size-tiny);
}

.ws-toolbar-spacer {
  flex: 1;
}

.connect-btn {
  display: inline-flex;
  align-items: center;
  gap: 5px;
  height: 28px;
  padding: 0 12px;
  border-radius: var(--radius-md);
  background: var(--accent-color);
  color: var(--accent-contrast-color);
  font-size: var(--font-size-body);
  font-weight: 600;
}

.connect-btn:hover:not(:disabled) {
  background: var(--accent-dark-color);
}

.connect-btn:disabled {
  opacity: 0.45;
  cursor: not-allowed;
}

.toolbar-action {
  display: inline-flex;
  padding: 5px;
  border-radius: var(--radius-sm);
  color: var(--secondary-color);
}

.toolbar-action:hover {
  background: var(--primary-dark-color);
  color: var(--secondary-dark-color);
}

.ws-tabs {
  display: flex;
  gap: 2px;
  padding: 0 8px;
  border-bottom: 1px solid var(--divider-color);
  flex-shrink: 0;
}

.ws-tab {
  padding: 7px 10px;
  border: none;
  border-bottom: 2px solid transparent;
  background: transparent;
  color: var(--secondary-color);
  font-size: var(--font-size-body);
}

.ws-tab:hover {
  color: var(--secondary-dark-color);
}

.ws-tab.active {
  color: var(--accent-color);
  border-bottom-color: var(--accent-color);
}

.ws-logs {
  flex: 1;
  min-height: 0;
  overflow-y: auto;
  padding: 8px 12px;
  display: flex;
  flex-direction: column;
  gap: 6px;
}

.ws-logs-empty {
  margin: auto;
  color: var(--secondary-light-color);
  font-size: var(--font-size-body);
}

.ws-entry {
  display: grid;
  grid-template-columns: auto auto auto 1fr;
  align-items: baseline;
  gap: 8px;
  padding: 5px 8px;
  border: 1px solid var(--divider-color);
  border-radius: var(--radius-md);
  background: var(--primary-light-color);
}

.ws-entry.out {
  border-left: 3px solid var(--accent-color);
}

.ws-entry.in {
  border-left: 3px solid var(--status-success-color);
}

.ws-entry.system {
  background: transparent;
  border-style: dashed;
  color: var(--secondary-light-color);
}

.ws-entry-dir {
  display: inline-flex;
  align-items: center;
  gap: 3px;
  font-size: var(--font-size-tiny);
  font-weight: 700;
  color: var(--secondary-color);
}

.ws-entry.out .ws-entry-dir {
  color: var(--accent-color);
}

.ws-entry.in .ws-entry-dir {
  color: var(--status-success-color);
}

.ws-entry-time {
  font-size: var(--font-size-tiny);
  color: var(--secondary-light-color);
  font-family: var(--font-code);
}

.ws-entry-binary {
  font-size: var(--font-size-tiny);
  font-weight: 700;
  color: var(--status-redirect-color);
}

.ws-entry-data {
  margin: 0;
  min-width: 0;
  white-space: pre-wrap;
  word-break: break-all;
  font-family: var(--font-code);
  font-size: var(--font-size-body);
  line-height: 1.5;
  color: var(--secondary-dark-color);
}

.ws-sendbox {
  display: flex;
  align-items: flex-end;
  gap: 8px;
  padding: 8px 12px;
  border-top: 1px solid var(--divider-color);
  flex-shrink: 0;
}

.ws-draft {
  flex: 1;
  resize: none;
  padding: 7px 9px;
  border: 1px solid var(--divider-dark-color);
  border-radius: var(--radius-md);
  background: var(--primary-light-color);
  color: var(--secondary-dark-color);
  font-family: var(--font-code);
  font-size: var(--font-size-body);
  line-height: 1.5;
  outline: none;
}

.ws-draft:focus {
  border-color: var(--accent-color);
}

.ws-send-btn {
  height: 34px;
}

/* 子协议 */
.ws-protocols-pane {
  flex: 1;
  min-height: 0;
  overflow-y: auto;
  padding: 10px 12px;
  display: flex;
  flex-direction: column;
  gap: 8px;
}

.pane-hint {
  margin: 0;
  color: var(--secondary-light-color);
  font-size: var(--font-size-tiny);
}

.protocol-list {
  display: flex;
  flex-direction: column;
  gap: 4px;
}

.protocol-row {
  display: flex;
  align-items: center;
  gap: 6px;
  padding: 6px 8px;
  border: 1px solid var(--divider-color);
  border-radius: var(--radius-md);
  background: var(--primary-light-color);
  cursor: grab;
}

.protocol-row.dragging {
  opacity: 0.5;
}

.protocol-row.drop-target {
  border-color: var(--accent-color);
  background: color-mix(in srgb, var(--accent-color) 12%, transparent);
}

.protocol-grip {
  color: var(--secondary-light-color);
  flex-shrink: 0;
}

.protocol-name {
  flex: 1;
  font-family: var(--font-code);
  font-size: var(--font-size-body);
  color: var(--secondary-dark-color);
}

.protocol-remove {
  display: inline-flex;
  padding: 3px;
  border-radius: var(--radius-sm);
  color: var(--secondary-light-color);
}

.protocol-remove:hover:not(:disabled) {
  color: var(--status-critical-error-color);
}

.protocols-empty {
  padding: 12px;
  text-align: center;
  color: var(--secondary-light-color);
  font-size: var(--font-size-body);
}

.protocol-add {
  display: flex;
  gap: 6px;
}

.protocol-add input {
  flex: 1;
  height: 30px;
  font-family: var(--font-code);
  font-size: var(--font-size-body);
}

.ws-auth-pane {
  flex: 1;
  min-height: 0;
  overflow-y: auto;
  padding: 12px;
}

@keyframes ws-spin {
  to { transform: rotate(360deg); }
}
</style>
