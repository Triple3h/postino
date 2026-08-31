import { describe, expect, it } from 'vitest'
import { collectionVarsToModuleVars, moduleVarsToCollectionVars } from '@/utils/collection-migration'
import { collectionVariableValue, resolveVariableResolutions } from '@/utils/variables'
import type { Collection, CollectionVariable, Environment } from '@/types'

function variable(overrides: Partial<CollectionVariable> = {}): CollectionVariable {
  return {
    key: 'API_GATEWAY_URL',
    initialValue: 'https://default.example.com',
    currentValue: 'https://current.example.com',
    secret: false,
    enabled: true,
    ...overrides,
  }
}

describe('collectionVariableValue', () => {
  it('按集合环境读取同名变量的不同值', () => {
    const item = variable({
      environmentValues: {
        test: 'https://test.example.com',
        production: 'https://api.example.com',
      },
    })

    expect(collectionVariableValue(item, 'test')).toBe('https://test.example.com')
    expect(collectionVariableValue(item, 'production')).toBe('https://api.example.com')
  })

  it('环境化变量未配置对应环境时为空,避免沿用其他环境的值', () => {
    const item = variable({ environmentValues: { production: '' } })

    expect(collectionVariableValue(item, 'test')).toBe('')
    expect(collectionVariableValue(item, 'production')).toBe('')
  })

  it('兼容尚未启用环境映射的旧变量', () => {
    expect(collectionVariableValue(variable(), 'test')).toBe('https://current.example.com')
  })
})

describe('集合变量迁移', () => {
  it('Module 与 Collection 双向转换时保留环境值', () => {
    const collectionVariables = moduleVarsToCollectionVars({
      API_GATEWAY_URL: {
        remote: 'https://default.example.com',
        local: '',
        environmentValues: { test: 'https://test.example.com' },
      },
    })

    expect(collectionVariables[0].environmentValues).toEqual({ test: 'https://test.example.com' })
    expect(collectionVarsToModuleVars(collectionVariables).API_GATEWAY_URL.environmentValues)
      .toEqual({ test: 'https://test.example.com' })
  })
})

describe('resolveVariableResolutions', () => {
  const env = (overrides: Partial<Environment> = {}): Environment => ({
    id: 'env-1',
    name: '测试环境',
    variables: [],
    ...overrides,
  })
  const collection = (overrides: Partial<Collection> = {}): Collection => ({
    id: 'col-1',
    name: '示例集合',
    order: 0,
    auth: { type: 'none' } as Collection['auth'],
    headers: [],
    variables: [],
    preRequestScript: '',
    postRequestScript: '',
    selectedEnvId: null,
    createdAt: 0,
    updatedAt: 0,
    ...overrides,
  })

  it('无任何定义时返回空解析', () => {
    expect(resolveVariableResolutions({})).toEqual({})
  })

  it('全局环境变量标注来源为全局环境', () => {
    const result = resolveVariableResolutions({
      environments: [env({ id: 'g', name: '全局环境', collectionId: 'global', variables: [{ key: 'GLOBAL_TOKEN', value: 'g-token', enabled: true }] })],
      globalEnvId: 'g',
    })
    expect(result.GLOBAL_TOKEN).toMatchObject({ value: 'g-token', source: 'global-env', sourceName: '全局环境' })
  })

  it('集合所选环境覆盖集合变量,请求变量优先级最高', () => {
    const result = resolveVariableResolutions({
      requestVariables: [{ key: 'BASE_PATH', value: '/request', enabled: true }],
      collection: collection({
        selectedEnvId: 'env-1',
        variables: [{ key: 'BASE_PATH', initialValue: '', currentValue: '/collection', secret: false, enabled: true }],
      }),
      environments: [env({ variables: [{ key: 'BASE_PATH', value: '/env', enabled: true }] })],
    })
    expect(result.BASE_PATH).toMatchObject({ value: '/request', source: 'request', sourceName: '请求变量' })

    const withoutRequest = resolveVariableResolutions({
      collection: collection({
        selectedEnvId: 'env-1',
        variables: [{ key: 'BASE_PATH', initialValue: '', currentValue: '/collection', secret: false, enabled: true }],
      }),
      environments: [env({ variables: [{ key: 'BASE_PATH', value: '/env', enabled: true }] })],
    })
    expect(withoutRequest.BASE_PATH).toMatchObject({ value: '/env', source: 'collection-env', sourceName: '测试环境' })
  })

  it('文件夹变量近者覆盖远者,并回退集合变量', () => {
    const result = resolveVariableResolutions({
      folders: [
        { id: 'near', name: '近文件夹', variables: [{ key: 'TIMEOUT', initialValue: '', currentValue: 'near', secret: false, enabled: true }] },
        { id: 'far', name: '远文件夹', variables: [{ key: 'TIMEOUT', initialValue: '', currentValue: 'far', secret: false, enabled: true }] },
      ],
      collection: collection({
        variables: [{ key: 'TIMEOUT', initialValue: '', currentValue: 'base', secret: false, enabled: true }],
      }),
    })
    expect(result.TIMEOUT).toMatchObject({ value: 'near', source: 'folder', sourceName: '近文件夹' })

    const fallback = resolveVariableResolutions({
      collection: collection({
        variables: [{ key: 'TIMEOUT', initialValue: '', currentValue: 'base', secret: false, enabled: true }],
      }),
    })
    expect(fallback.TIMEOUT).toMatchObject({ value: 'base', source: 'collection', sourceName: '示例集合' })
  })

  it('disabled 与空 key 变量不参与解析,secret 标记透传', () => {
    const result = resolveVariableResolutions({
      collection: collection({
        variables: [
          { key: 'OFF', initialValue: '', currentValue: 'x', secret: false, enabled: false },
          { key: '', initialValue: '', currentValue: 'y', secret: false, enabled: true },
          { key: 'PASSWORD', initialValue: '', currentValue: 's', secret: true, enabled: true },
        ],
      }),
    })
    expect(result.OFF).toBeUndefined()
    expect(result['']).toBeUndefined()
    expect(result.PASSWORD).toMatchObject({ value: 's', secret: true })
  })

  it('与 collectionVariableValue 语义一致(值取自同一函数)', () => {
    const vars: CollectionVariable[] = [
      { key: 'A', initialValue: 'ia', currentValue: 'ca', secret: false, enabled: true, environmentValues: { 'env-1': 'ea' } },
    ]
    const result = resolveVariableResolutions({
      collection: collection({ selectedEnvId: 'env-1', variables: vars }),
    })
    expect(result.A.value).toBe(collectionVariableValue(vars[0], 'env-1'))
  })
})
