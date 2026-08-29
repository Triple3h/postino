import type { WsConnectionState, WsLogEntry } from '@/types'

/**
 * WebSocket 客户端门面(Phase 3.5):
 * - 扩展环境:经 named port「ws-control」由 background SW 托管连接(SW 侧保活,连接不随页面刷新丢失);
 *   UI 每 20s 发 WS_PING 重置 SW 空闲计时器,不向业务连接注入任何心跳帧。
 * - 桌面/浏览器环境:页面内直连 WebSocket。
 * 两种环境向上层暴露同一套 WsSession 接口。
 */

export interface WsSessionHandlers {
  onState(state: WsConnectionState, detail?: string): void
  onMessage(entry: WsLogEntry): void
  /** 系统级错误(发送失败、端口断开等),非连接状态 */
  onLog(level: 'info' | 'error', text: string): void
}

export interface WsSession {
  send(data: string): void
  close(code?: number, reason?: string): void
}

interface ExtensionPort {
  postMessage(message: unknown): void
  disconnect(): void
  onMessage: { addListener(listener: (message: any) => void): void }
  onDisconnect: { addListener(listener: () => void): void }
}

function isExtensionEnvironment(): boolean {
  const runtime = (globalThis as any).chrome?.runtime
  return !!runtime?.connect && typeof runtime.id === 'string'
}

function makeEntryId(): string {
  return `wsmsg:${Date.now().toString(36)}:${Math.random().toString(36).slice(2, 8)}`
}

/** SW 空闲计时器约 30s,20s 一次足以保活 */
const KEEPALIVE_INTERVAL_MS = 20_000

export function openWsSession(input: {
  url: string
  protocols?: string[]
  handlers: WsSessionHandlers
}): WsSession {
  if (isExtensionEnvironment()) return openExtensionSession(input)
  return openDirectSession(input)
}

function openExtensionSession(input: {
  url: string
  protocols?: string[]
  handlers: WsSessionHandlers
}): WsSession {
  const { url, protocols, handlers } = input
  // chrome 全局类型声明是手写最小集,端口 API 走 any(与 http.ts 同策略)
  const runtime = (globalThis as any).chrome?.runtime as {
    connect: (options: { name: string }) => ExtensionPort
  } | undefined
  if (!runtime?.connect) {
    handlers.onLog('error', 'Chrome extension runtime is unavailable')
    return openDirectSession(input)
  }
  const wsId = `ws:${Date.now().toString(36)}:${Math.random().toString(36).slice(2)}`
  const port = runtime.connect({ name: 'ws-control' })
  let closed = false

  const keepalive = setInterval(() => {
    try {
      port.postMessage({ type: 'WS_PING', wsId })
    } catch {
      // 端口已死,onDisconnect 会接管状态
    }
  }, KEEPALIVE_INTERVAL_MS)

  const teardown = () => {
    if (closed) return
    closed = true
    clearInterval(keepalive)
    try {
      port.disconnect()
    } catch {
      // 已断开
    }
  }

  port.onMessage.addListener((message: any) => {
    if (!message || message.wsId !== wsId) return
    if (message.type === 'WS_STATE') {
      handlers.onState(message.state as WsConnectionState, message.detail)
      if (message.state === 'closed' || message.state === 'error') {
        // 连接已终结;error 后紧随的 closed 仍会到达,由 store 忽略重复终态
        teardown()
      }
      return
    }
    if (message.type === 'WS_MESSAGE') {
      handlers.onMessage(message.message as WsLogEntry)
      return
    }
    if (message.type === 'WS_LOG') {
      handlers.onLog(message.level === 'error' ? 'error' : 'info', String(message.text ?? ''))
    }
  })

  port.onDisconnect.addListener(() => {
    if (closed) return
    closed = true
    clearInterval(keepalive)
    handlers.onLog('error', '与后台连接中断(SW 已回收),WebSocket 状态未知')
    handlers.onState('closed', '后台连接中断')
  })

  port.postMessage({ type: 'WS_OPEN', wsId, url, protocols: protocols ?? [] })

  return {
    send(data: string) {
      if (closed) {
        handlers.onLog('error', '会话已关闭')
        return
      }
      handlers.onMessage({ id: makeEntryId(), direction: 'out', data, timestamp: Date.now() })
      try {
        port.postMessage({ type: 'WS_SEND', wsId, data })
      } catch (err: any) {
        handlers.onLog('error', `发送失败:${err?.message ?? err}`)
      }
    },
    close(code?: number, reason?: string) {
      if (closed) return
      handlers.onState('closing')
      try {
        port.postMessage({ type: 'WS_CLOSE', wsId, code, reason })
      } catch {
        // 端口已死
      }
      teardown()
      handlers.onState('closed', '已手动关闭')
    },
  }
}

function openDirectSession(input: {
  url: string
  protocols?: string[]
  handlers: WsSessionHandlers
}): WsSession {
  const { url, protocols, handlers } = input
  let socket: WebSocket
  try {
    socket = new WebSocket(url, (protocols ?? []).filter(Boolean))
  } catch (err: any) {
    handlers.onState('error', err?.message ?? 'WebSocket 创建失败')
    return {
      send() {
        handlers.onLog('error', '会话未建立')
      },
      close() {
        /* 无连接可关 */
      },
    }
  }
  socket.binaryType = 'arraybuffer'
  handlers.onState('connecting', url)

  let manualClose = false

  socket.onopen = () => handlers.onState('open', url)
  socket.onmessage = (event) => {
    if (typeof event.data === 'string') {
      handlers.onMessage({ id: makeEntryId(), direction: 'in', data: event.data, timestamp: Date.now() })
      return
    }
    const bytes = new Uint8Array(event.data)
    handlers.onMessage({
      id: makeEntryId(),
      direction: 'in',
      data: new TextDecoder('utf-8').decode(bytes),
      binary: bytes.length,
      timestamp: Date.now(),
    })
  }
  socket.onerror = () => {
    if (!manualClose) handlers.onState('error', '连接错误')
  }
  socket.onclose = (event) => {
    if (manualClose) return
    handlers.onState(
      'closed',
      `code=${event.code}${event.reason ? ` ${event.reason}` : ''}${event.wasClean ? '' : '（异常断开）'}`,
    )
  }

  return {
    send(data: string) {
      handlers.onMessage({ id: makeEntryId(), direction: 'out', data, timestamp: Date.now() })
      try {
        socket.send(data)
      } catch (err: any) {
        handlers.onLog('error', `发送失败:${err?.message ?? err}`)
      }
    },
    close(code?: number, reason?: string) {
      manualClose = true
      handlers.onState('closing')
      try {
        socket.close(code, reason)
      } catch {
        // 已关闭
      }
      handlers.onState('closed', '已手动关闭')
    },
  }
}
