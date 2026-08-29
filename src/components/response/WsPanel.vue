<script setup lang="ts">
import { computed, nextTick, ref, watch } from 'vue'
import { ArrowDownLeft, ArrowUpRight, PlugZap, Trash2 } from '@lucide/vue'
import { useAppStore } from '@/stores/app'
import { useWorkspaceStore } from '@/stores/workspace'
import { useWsStore } from '@/stores/ws'
import type { WsConnectionState, WsLogEntry } from '@/types'

const store = useAppStore()
const workspace = useWorkspaceStore()
const ws = useWsStore()

const currentApi = computed(() => store.getCurrentApi())
const isReadonly = computed(() => {
  const node = workspace.interfaces.find(item => item.apiId === store.currentApiId)
  const module = node ? workspace.modules.find(item => item.id === node.moduleId) : null
  return module?.type === 'readonly'
})

// 子协议输入:切到别的请求时重新加载该请求的配置
const protocolsText = ref('')
const protocolsLoadedFor = ref<string | null>(null)
watch(currentApi, (api) => {
  if (!api) return
  if (protocolsLoadedFor.value !== api.id) {
    protocolsText.value = (api.wsProtocols ?? []).join(', ')
    protocolsLoadedFor.value = api.id
  }
}, { immediate: true })

function persistProtocols() {
  const api = currentApi.value
  if (!api || isReadonly.value) return
  const protocols = protocolsText.value.split(/[,，]/).map(item => item.trim()).filter(Boolean)
  if (JSON.stringify(protocols) !== JSON.stringify(api.wsProtocols ?? [])) {
    store.updateApi(api.id, { wsProtocols: protocols })
  }
}

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

// ── 消息日志自动滚动(用户上翻时暂停跟随)──
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
    <div class="ws-toolbar">
      <span class="ws-status" :class="ws.status">
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
      <button class="btn btn-sm" :disabled="!currentApi" @click="toggleConnection">
        <PlugZap :size="14" />{{ ws.isBusy ? '断开' : '连接' }}
      </button>
      <button class="btn btn-sm" title="清空消息日志" @click="ws.clearLogs()"><Trash2 :size="14" />清空</button>
    </div>
    <div class="ws-config">
      <label class="ws-protocols">
        <span>子协议</span>
        <input
          v-model="protocolsText"
          type="text"
          class="ws-protocols-input"
          placeholder="逗号分隔,如 chat, json(可选)"
          :disabled="isReadonly"
          @change="persistProtocols"
        />
      </label>
    </div>
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
  </div>
</template>

<style scoped>
.ws-panel {
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

.ws-toolbar {
  display: flex;
  align-items: center;
  gap: 10px;
  padding: 8px 12px;
  border-bottom: 1px solid var(--divider);
  font-size: var(--font-size-small);
}

.ws-status {
  display: inline-flex;
  align-items: center;
  gap: 6px;
  font-weight: 750;
  color: var(--text-secondary);
}

.ws-status small {
  color: var(--text-tertiary);
  font-weight: 500;
  max-width: 320px;
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
}

.ws-dot {
  width: 8px;
  height: 8px;
  border-radius: 50%;
  background: var(--text-tertiary);
  flex-shrink: 0;
}

.ws-status.open {
  color: var(--success);
}

.ws-status.open .ws-dot {
  background: var(--success);
  box-shadow: 0 0 0 3px color-mix(in srgb, var(--success) 16%, transparent);
}

.ws-status.connecting,
.ws-status.closing {
  color: var(--warning);
}

.ws-status.connecting .ws-dot,
.ws-status.closing .ws-dot {
  background: var(--warning);
}

.ws-status.error {
  color: var(--error);
}

.ws-status.error .ws-dot {
  background: var(--error);
}

.ws-spinner {
  width: 10px;
  height: 10px;
  border: 2px solid color-mix(in srgb, var(--warning) 35%, transparent);
  border-top-color: var(--warning);
  border-radius: 50%;
  animation: ws-spin 0.8s linear infinite;
}

.ws-reconnect {
  display: inline-flex;
  align-items: center;
  gap: 5px;
  color: var(--text-secondary);
  font-weight: 600;
  cursor: pointer;
  user-select: none;
}

.ws-reconnect input {
  accent-color: var(--primary);
}

.ws-reconnect-count {
  color: var(--warning);
  font-weight: 700;
}

.ws-toolbar-spacer {
  flex: 1;
}

.ws-config {
  display: flex;
  align-items: center;
  gap: 10px;
  padding: 6px 12px;
  border-bottom: 1px solid var(--divider);
}

.ws-protocols {
  display: flex;
  align-items: center;
  gap: 8px;
  flex: 1;
  color: var(--text-tertiary);
  font-size: var(--font-size-small);
  font-weight: 700;
}

.ws-protocols-input {
  flex: 1;
  max-width: 420px;
  height: 28px;
  padding: 0 8px;
  border: 1px solid var(--border);
  border-radius: var(--radius-md);
  background: var(--bg-base);
  color: var(--text-primary);
  font-size: var(--font-size-code);
  font-family: var(--font-code);
  outline: none;
  transition: border-color 0.15s ease, box-shadow 0.15s ease;
}

.ws-protocols-input:focus {
  border-color: var(--primary);
  box-shadow: var(--focus-ring);
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
  color: var(--text-tertiary);
  font-size: var(--font-size-small);
}

.ws-entry {
  display: grid;
  grid-template-columns: auto auto auto 1fr;
  align-items: baseline;
  gap: 8px;
  padding: 5px 8px;
  border: 1px solid var(--divider);
  border-radius: var(--radius-md);
  background: var(--bg-base);
}

.ws-entry.out {
  border-left: 3px solid var(--primary);
}

.ws-entry.in {
  border-left: 3px solid var(--success);
}

.ws-entry.system {
  background: transparent;
  border-style: dashed;
  color: var(--text-tertiary);
}

.ws-entry-dir {
  display: inline-flex;
  align-items: center;
  gap: 3px;
  font-size: 11px;
  font-weight: 750;
  color: var(--text-secondary);
}

.ws-entry.out .ws-entry-dir {
  color: var(--primary);
}

.ws-entry.in .ws-entry-dir {
  color: var(--success);
}

.ws-entry-time {
  font-size: 11px;
  color: var(--text-tertiary);
  font-family: var(--font-code);
}

.ws-entry-binary {
  font-size: 11px;
  font-weight: 700;
  color: var(--warning);
}

.ws-entry-data {
  margin: 0;
  min-width: 0;
  white-space: pre-wrap;
  word-break: break-all;
  font-family: var(--font-code);
  font-size: var(--font-size-code);
  line-height: 1.5;
  color: var(--text-primary);
}

.ws-entry.system .ws-entry-data {
  color: var(--text-tertiary);
}

.ws-sendbox {
  display: flex;
  align-items: flex-end;
  gap: 8px;
  padding: 8px 12px;
  border-top: 1px solid var(--divider);
}

.ws-draft {
  flex: 1;
  resize: none;
  padding: 7px 9px;
  border: 1px solid var(--border);
  border-radius: var(--radius-lg);
  background: var(--bg-base);
  color: var(--text-primary);
  font-family: var(--font-code);
  font-size: var(--font-size-code);
  line-height: 1.5;
  outline: none;
  transition: border-color 0.15s ease, box-shadow 0.15s ease;
}

.ws-draft:focus {
  border-color: var(--primary);
  box-shadow: var(--focus-ring);
}

.ws-send-btn {
  height: 34px;
  border-radius: var(--radius-lg);
}

@keyframes ws-spin {
  to { transform: rotate(360deg); }
}
</style>
