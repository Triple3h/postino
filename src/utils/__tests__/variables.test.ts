import { describe, expect, it } from 'vitest'
import { collectionVarsToModuleVars, moduleVarsToCollectionVars } from '@/utils/collection-migration'
import { collectionVariableValue } from '@/utils/variables'
import type { CollectionVariable } from '@/types'

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
