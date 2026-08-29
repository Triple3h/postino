import { defineStore } from 'pinia'
import { computed, ref } from 'vue'
import type { ApiConfig, WsConnectionState, WsLogEntry } from '@/types'
import { useAppStore } from '@/stores/app'
import { resolveTemplateVars } from '@/utils/template'
import { openWsSession } from '@/utils/ws-client'
import type { WsSession } from '@/utils/ws-client'

const LOG_CAP = 500
const RECONNECT_DELAY_MS = 2000
const MAX_RECONNECT_ATTEMPTS = 10

const TERMINAL_STATES: ReadonlySet<WsConnectionState> = new Set(['closed', 'error'])

let entrySeq = 0
function makeEntryId(): string {
  entrySeq += 1
  return `wslog:${Date.now().toString(36)}:${entrySeq}`
}

/**
 * WebSocket 调试会话状态(Phase 3.5)。
 * 同一时刻只维护一条连接(当前打开的 WS 请求);切换请求后旧连接保持,
 * 面板按 activeApiId 判断归属。
 */
export const useWsStore = defineStore('ws', () => {
  const status = ref<WsConnectionState>('idle')
  const statusDetail = ref<string | null>(null)
  const logs = ref<WsLogEntry[]>([])
  const autoReconnect = ref(false)
  const reconnectAttempts = ref(0)
  const activeApiId = ref<string | null>(null)
  const activeUrl = ref('')

  const isOpen = computed(() => status.value === 'open')
  const isBusy = computed(() => status.value === 'open' || status.value === 'connecting')
  const belongsTo = computed(() => (apiId: string) => activeApiId.value === apiId)

  let session: WsSession | null = null
  let manualClose = false
  let reconnectTimer: ReturnType<typeof setTimeout> | null = null

  function pushLog(entry: WsLogEntry) {
    logs.value.push(entry)
    if (logs.value.length > LOG_CAP) {
      logs.value.splice(0, logs.value.length - LOG_CAP)
    }
  }

  function pushSystem(text: string) {
    pushLog({ id: makeEntryId(), direction: 'system', data: text, timestamp: Date.now() })
  }

  function clearLogs() {
    logs.value = []
  }

  function resolveValue(value: string): string {
    const appStore = useAppStore()
    return resolveTemplateVars(value, { globalVars: appStore.getEnvVariables() })
  }

  function connect(api: ApiConfig) {
    if (status.value === 'open' || status.value === 'connecting') return
    if (reconnectTimer) {
      clearTimeout(reconnectTimer)
      reconnectTimer = null
    }

    const url = resolveValue(api.url || '')
    const protocols = (api.wsProtocols ?? []).map(p => resolveValue(p))
    activeApiId.value = api.id
    activeUrl.value = url
    manualClose = false
    reconnectAttempts.value = 0
    pushSystem(`正在连接 ${url}${protocols.length ? ` · 协议:${protocols.join(', ')}` : ''}`)
    status.value = 'connecting'

    session = openWsSession({
      url,
      protocols,
      handlers: {
        onState: handleState,
        onMessage: pushLog,
        onLog: (level, text) => pushSystem(text),
      },
    })
  }

  function handleState(state: WsConnectionState, detail?: string) {
    if (TERMINAL_STATES.has(status.value) && TERMINAL_STATES.has(state)) return
    status.value = state
    statusDetail.value = detail ?? null

    if (state === 'open') {
      reconnectAttempts.value = 0
      pushSystem('连接已建立')
      return
    }
    if (state === 'closed') {
      session = null
      pushSystem(detail ? `连接关闭(${detail})` : '连接关闭')
      scheduleReconnect()
    }
  }

  function scheduleReconnect() {
    if (manualClose || !autoReconnect.value || !activeApiId.value) return
    if (reconnectAttempts.value >= MAX_RECONNECT_ATTEMPTS) {
      pushSystem(`自动重连已达上限(${MAX_RECONNECT_ATTEMPTS} 次)`)
      return
    }
    const appStore = useAppStore()
    const apiId = activeApiId.value
    reconnectAttempts.value += 1
    const attempt = reconnectAttempts.value
    pushSystem(`${RECONNECT_DELAY_MS / 1000}s 后自动重连(第 ${attempt} 次)`)
    reconnectTimer = setTimeout(() => {
      reconnectTimer = null
      const api = appStore.apis[apiId]
      if (api) connect(api)
    }, RECONNECT_DELAY_MS)
  }

  function disconnect() {
    manualClose = true
    if (reconnectTimer) {
      clearTimeout(reconnectTimer)
      reconnectTimer = null
    }
    session?.close()
    session = null
  }

  function toggleConnect(api: ApiConfig) {
    const busy = status.value === 'open' || status.value === 'connecting'
    // 连接归属其它请求时,先断开旧连接再连新的
    if (busy && activeApiId.value === api.id) {
      disconnect()
      return
    }
    if (busy) disconnect()
    connect(api)
  }

  function send(data: string) {
    if (status.value !== 'open' || !session) {
      pushSystem('未连接,无法发送')
      return
    }
    session.send(data)
  }

  return {
    status,
    statusDetail,
    logs,
    autoReconnect,
    reconnectAttempts,
    activeApiId,
    activeUrl,
    isOpen,
    isBusy,
    belongsTo,
    connect,
    disconnect,
    toggleConnect,
    send,
    clearLogs,
  }
})
