import { afterEach, describe, expect, it, vi } from 'vitest'
import { executeScriptInWorkerSandbox } from '@/utils/pre-request'

const CSP_EVAL_ERROR =
  "Evaluating a string as JavaScript violates the following Content Security Policy directive because 'unsafe-eval' is not an allowed source of script: \"script-src 'self' 'wasm-unsafe-eval' 'inline-speculation-rules' http://localhost:* http://127.0.0.1:*\"."

/** 模拟 MV3 扩展里的 Worker:AsyncFunction 被 CSP 拦截,pm-facade 捕获后回发 success:false */
class FakeWorker {
  static instances: FakeWorker[] = []
  onmessage: ((event: { data: any }) => void) | null = null
  onerror: ((event: { message: string }) => void) | null = null
  __replyFor?: (data: any) => any

  constructor(_url: string | URL, _options?: { name?: string }) {
    FakeWorker.instances.push(this)
  }

  postMessage(data: any) {
    setTimeout(() => {
      const reply = this.__replyFor?.(data) ?? { type: 'SCRIPT_RESULT', requestId: data.requestId, success: false, error: CSP_EVAL_ERROR }
      this.onmessage?.({ data: reply })
    }, 0)
  }

  terminate() {}
}

function stubWorkerEnvironment() {
  // getWorkerSandboxUrl 依赖 window.location;node 测试环境手动 stub
  vi.stubGlobal('window', { location: { href: 'chrome-extension://abc/index.html' } })
  vi.stubGlobal('Worker', FakeWorker as unknown as typeof Worker)
}

describe('Worker 沙箱 CSP eval 拦截的降级触发(MV3 扩展)', () => {
  afterEach(() => {
    vi.unstubAllGlobals()
    FakeWorker.instances = []
  })

  it('CSP eval 错误必须 reject,上层 catch 才会降级到 sandbox iframe', async () => {
    stubWorkerEnvironment()
    const pending = executeScriptInWorkerSandbox(
      'pm.request.headers.add({ key: "a", value: "b" })',
      {},
      'https://api.example.com/ping',
      '',
      [],
      [],
      {},
    )
    await expect(pending).rejects.toThrow(/Content Security Policy/)
    expect(FakeWorker.instances).toHaveLength(1)
  })

  it('普通脚本错误仍 resolve(error 字段),不触发降级', async () => {
    stubWorkerEnvironment()
    const pending = executeScriptInWorkerSandbox(
      'pm.request.headers.add({ key: "a", value: "b" })',
      {},
      'https://api.example.com/ping',
      '',
      [],
      [],
      {},
    )
    const instance = FakeWorker.instances[FakeWorker.instances.length - 1]
    if (!instance) throw new Error('FakeWorker 未实例化')
    instance.__replyFor = (data: any) => ({ type: 'SCRIPT_RESULT', requestId: data.requestId, success: false, error: 'ReferenceError: foo is not defined' })
    const result = await pending
    expect(result.error).toContain('ReferenceError')
  })
})
