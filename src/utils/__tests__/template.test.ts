import { describe, expect, it } from 'vitest'
import { resolveTemplateVars } from '@/utils/template'
import type { Environment } from '@/types'

const envs: Environment[] = [
  {
    id: 'env:1',
    name: 'test',
    collectionId: 'col:1',
    variables: [
      { key: 'host', value: 'https://api.test', enabled: true },
      { key: 'disabledVar', value: 'nope', enabled: false },
    ],
  },
]

describe('resolveTemplateVars', () => {
  it('替换 {{var}} 为环境变量值', () => {
    expect(resolveTemplateVars('{{host}}/users', { environments: envs, currentEnvId: 'env:1' }))
      .toBe('https://api.test/users')
  })

  it('作用域优先级 request > local > remote > global > environment', () => {
    const scopes = {
      requestVars: { k: 'request' },
      localVars: { k: 'local' },
      remoteVars: { k: 'remote' },
      globalVars: { k: 'global' },
      environments: envs,
      currentEnvId: 'env:1',
    }
    expect(resolveTemplateVars('{{k}}', scopes)).toBe('request')
    expect(resolveTemplateVars('{{k}}', { ...scopes, requestVars: {} })).toBe('local')
    expect(resolveTemplateVars('{{k}}', { ...scopes, requestVars: {}, localVars: {} })).toBe('remote')
    expect(resolveTemplateVars('{{k}}', { ...scopes, requestVars: {}, localVars: {}, remoteVars: {} })).toBe('global')
    expect(resolveTemplateVars('{{k}}', { ...scopes, requestVars: {}, localVars: {}, remoteVars: {}, globalVars: {} }))
      .toBe('{{k}}')
    expect(resolveTemplateVars('{{host}}', { ...scopes, requestVars: {}, localVars: {}, remoteVars: {}, globalVars: {} }))
      .toBe('https://api.test')
  })

  it('支持默认值语法 {{var:default}}', () => {
    expect(resolveTemplateVars('{{missing:fallback}}', {})).toBe('fallback')
    expect(resolveTemplateVars('{{host:ignored}}', { environments: envs, currentEnvId: 'env:1' }))
      .toBe('https://api.test')
  })

  it('动态函数 {{$date}} / 未注册函数原样保留', () => {
    expect(resolveTemplateVars('{{$date}}', {})).toMatch(/^\d{4}-\d{2}-\d{2}$/)
    expect(resolveTemplateVars('{{$notAFunction}}', {})).toBe('{{$notAFunction}}')
  })

  it('禁用环境变量不参与解析', () => {
    expect(resolveTemplateVars('{{disabledVar}}', { environments: envs, currentEnvId: 'env:1' }))
      .toBe('{{disabledVar}}')
  })

  it('未命中变量原样保留', () => {
    expect(resolveTemplateVars('{{unknown}}', {})).toBe('{{unknown}}')
  })
})
