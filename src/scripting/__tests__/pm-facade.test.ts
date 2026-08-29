import { describe, expect, it } from 'vitest'
import { installPmFacade } from '@/scripting/pm-facade'

interface TransportMock {
  listeners: Array<(event: any) => void>
  posted: any[]
  addMessageListener(listener: (event: any) => void): void
  removeMessageListener(listener: (event: any) => void): void
  postScriptRequest(payload: any): void
  postResult(payload: any): void
  dispatch(data: any): void
  waitForResult(timeoutMs?: number): Promise<any>
}

function createTransport(): TransportMock {
  const listeners: Array<(event: any) => void> = []
  const posted: any[] = []
  return {
    listeners,
    posted,
    addMessageListener(listener: (event: { data: any }) => void) { listeners.push(listener) },
    removeMessageListener(listener: (event: { data: any }) => void) {
      const index = listeners.indexOf(listener)
      if (index >= 0) listeners.splice(index, 1)
    },
    postScriptRequest(payload: any) { posted.push(payload) },
    postResult(payload: any) { posted.push(payload) },
    dispatch(data) {
      for (const listener of [...listeners]) listener({ data })
    },
    waitForResult(timeoutMs = 1000) {
      return new Promise((resolve, reject) => {
        const started = Date.now()
        const poll = () => {
          const found = posted.find(item => item.type === 'SCRIPT_RESULT')
          if (found) return resolve(found)
          if (Date.now() - started > timeoutMs) return reject(new Error('SCRIPT_RESULT not posted in time'))
          setTimeout(poll, 5)
        }
        poll()
      })
    },
  }
}

/** 安装门面并执行一段脚本,返回宿主收到的 SCRIPT_RESULT */
async function runScript(script: string, extra: Record<string, any> = {}): Promise<any> {
  const transport = createTransport()
  installPmFacade(transport)
  transport.dispatch({
    type: 'EXECUTE_SCRIPT',
    requestId: 'req:1',
    script,
    envVars: { existing: '1' },
    method: 'GET',
    headers: {},
    cookies: [],
    url: 'https://api.example.com/ping',
    body: '',
    urlencoded: [],
    formdata: [],
    ...extra,
  })
  const posted = await transport.waitForResult()
  expect(posted.requestId).toBe('req:1')
  return posted
}

describe('pm 门面(沙箱/worker 共享运行时)', () => {
  it('pm.environment.set 写回 envStore 并标记 envChangedKeys', async () => {
    const posted = await runScript(`pm.environment.set('token', 'abc')`)
    expect(posted.success).toBe(true)
    expect(posted.result.envVars.token).toBe('abc')
    expect(posted.result.envChangedKeys).toContain('token')
  })

  it('pm.request.headers.add 修改请求头', async () => {
    const posted = await runScript(`pm.request.headers.add('X-Test', '1')`)
    expect(posted.result.headers['X-Test']).toBe('1')
  })

  it('修改 method 与 url', async () => {
    const posted = await runScript(`
      pm.request.method = 'POST'
      pm.request.url = 'https://api.example.com/v2/ping'
    `)
    expect(posted.result.method).toBe('POST')
    expect(posted.result.url).toBe('https://api.example.com/v2/ping')
  })

  it('pm.test 通过/失败分别记录', async () => {
    const posted = await runScript(`
      pm.test('passes', () => pm.expect(1).to.eql(1))
      pm.test('fails', () => pm.expect(1).to.eql(2))
    `)
    const byName = Object.fromEntries(posted.result.tests.map((t: any) => [t.name, t.passed]))
    expect(byName.passes).toBe(true)
    expect(byName.fails).toBe(false)
  })

  it('作用域路由:scope="global" 时写入 globals 而非 environment', async () => {
    const posted = await runScript(`pm.environment.set('gk', 'gv', 'global')`)
    expect(posted.result.envChangedKeys).not.toContain('gk')
    expect(posted.result.envVars.gk).toBeUndefined()
  })

  it('pm.environment.get 读取传入的 envVars', async () => {
    const posted = await runScript(`
      const v = pm.environment.get('existing')
      pm.test('reads env', () => pm.expect(v).to.eql('1'))
    `)
    expect(posted.result.tests[0].passed).toBe(true)
  })

  it('脚本语法错误 → success=false 且带错误信息', async () => {
    const posted = await runScript(`this is not valid javascript !!!`)
    expect(posted.success).toBe(false)
    expect(posted.error).toBeTruthy()
  })

  it('非 EXECUTE_SCRIPT 消息被忽略', async () => {
    const transport = createTransport()
    installPmFacade(transport)
    transport.dispatch({ type: 'OTHER_MESSAGE' })
    await new Promise(resolve => setTimeout(resolve, 20))
    expect(transport.posted).toHaveLength(0)
  })
})
