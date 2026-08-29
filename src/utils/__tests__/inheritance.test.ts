import { describe, expect, it } from 'vitest'
import { createDefaultAuthConfig } from '@/utils/auth'
import { resolveInheritedProperties, resolveScriptChain } from '@/utils/inheritance'
import type { Collection, CollectionNode, CollectionVariable } from '@/types'

function makeCollection(overrides: Partial<Collection> = {}): Collection {
  return {
    id: 'col:1',
    name: '示例集合',
    order: 0,
    auth: createDefaultAuthConfig(),
    headers: [],
    variables: [],
    preRequestScript: '',
    postRequestScript: '',
    selectedEnvId: null,
    createdAt: 0,
    updatedAt: 0,
    ...overrides,
  }
}

function makeNode(overrides: Partial<CollectionNode> & Pick<CollectionNode, 'id'>): CollectionNode {
  return {
    moduleId: 'col:1',
    apiId: '',
    name: overrides.id,
    method: 'GET',
    url: '',
    order: 0,
    createdAt: 0,
    updatedAt: 0,
    ...overrides,
  }
}

function makeVar(key: string, value: string, enabled = true): CollectionVariable {
  return { key, initialValue: value, currentValue: value, secret: false, enabled }
}

describe('resolveInheritedProperties · Auth', () => {
  it('无任何显式定义(inherit)时 source=none', () => {
    const collection = makeCollection({ auth: { ...createDefaultAuthConfig(), type: 'inherit' } })
    const nodes = [makeNode({ id: 'req' })]
    const result = resolveInheritedProperties(collection, nodes, 'req')
    expect(result.auth.source).toBe('none')
  })

  it('集合默认 none 视为显式定义(根级无更上层,不影响解析)', () => {
    const collection = makeCollection({ auth: createDefaultAuthConfig() })
    const nodes = [makeNode({ id: 'req' })]
    const result = resolveInheritedProperties(collection, nodes, 'req')
    expect(result.auth.source).toBe('collection')
    expect(result.auth.auth.type).toBe('none')
  })

  it('集合定义 auth,请求缺省 → 继承集合', () => {
    const collection = makeCollection({ auth: { ...createDefaultAuthConfig(), type: 'bearer', bearerToken: 'tok' } })
    const nodes = [makeNode({ id: 'req' })]
    const result = resolveInheritedProperties(collection, nodes, 'req')
    expect(result.auth.source).toBe('collection')
    expect(result.auth.auth.type).toBe('bearer')
  })

  it('祖先显式 auth 覆盖集合,近层覆盖远层', () => {
    const collection = makeCollection({ auth: { ...createDefaultAuthConfig(), type: 'basic' } })
    const outer = makeNode({ id: 'f1', nodeType: 'folder', auth: { ...createDefaultAuthConfig(), type: 'bearer', bearerToken: 'outer' } })
    const inner = makeNode({ id: 'f2', nodeType: 'folder', parentId: 'f1', auth: { ...createDefaultAuthConfig(), type: 'bearer', bearerToken: 'inner' } })
    const req = makeNode({ id: 'req', parentId: 'f2' })
    const result = resolveInheritedProperties(collection, [outer, inner, req], 'req')
    expect(result.auth.source).toBe('ancestor')
    expect(result.auth.sourceName).toBe('f2')
    expect(result.auth.auth.bearerToken).toBe('inner')
  })

  it('请求自身显式 auth 优先级最高', () => {
    const collection = makeCollection({ auth: { ...createDefaultAuthConfig(), type: 'basic' } })
    const req = makeNode({ id: 'req', auth: { ...createDefaultAuthConfig(), type: 'apikey' } })
    const result = resolveInheritedProperties(collection, [req], 'req')
    expect(result.auth.source).toBe('node')
    expect(result.auth.auth.type).toBe('apikey')
  })
})

describe('resolveInheritedProperties · Headers / Variables', () => {
  it('近层同 key 覆盖远层', () => {
    const collection = makeCollection({
      headers: [{ key: 'X-Trace', value: 'root', enabled: true }],
      variables: [makeVar('env', 'prod')],
    })
    const folder = makeNode({
      id: 'f1',
      nodeType: 'folder',
      headers: [{ key: 'X-Trace', value: 'folder', enabled: true }],
      variables: [makeVar('env', 'staging')],
    })
    const req = makeNode({ id: 'req', parentId: 'f1' })
    const result = resolveInheritedProperties(collection, [folder, req], 'req')
    expect(result.headers.find(h => h.key === 'X-Trace')?.value).toBe('folder')
    expect(result.variables.find(v => v.key === 'env')?.currentValue).toBe('staging')
    expect(result.headerSources['X-Trace']).toBe('f1')
    expect(result.variableSources.env).toBe('f1')
  })

  it('禁用的祖先 header 不参与继承', () => {
    const collection = makeCollection({
      headers: [{ key: 'X-Off', value: 'root', enabled: false }],
    })
    const req = makeNode({ id: 'req' })
    const result = resolveInheritedProperties(collection, [req], 'req')
    expect(result.headers.find(h => h.key === 'X-Off')).toBeUndefined()
  })
})

describe('resolveScriptChain', () => {
  it('pre 按集合 → 文件夹(根→叶)排序', () => {
    const collection = makeCollection({ preRequestScript: 'console.log("collection")' })
    const f1 = makeNode({ id: 'f1', nodeType: 'folder', preRequestScript: 'console.log("f1")' })
    const f2 = makeNode({ id: 'f2', nodeType: 'folder', parentId: 'f1', preRequestScript: 'console.log("f2")' })
    const req = makeNode({ id: 'req', parentId: 'f2' })
    const chain = resolveScriptChain(collection, [f1, f2, req], 'req')
    expect(chain.preScripts.map(seg => seg.sourceId)).toEqual(['col:1', 'f1', 'f2'])
  })

  it('scriptsInherit=false 的节点自身脚本被跳过,但更远祖先仍继承', () => {
    const collection = makeCollection({ preRequestScript: 'root' })
    const f1 = makeNode({ id: 'f1', nodeType: 'folder', preRequestScript: 'f1' })
    const f2 = makeNode({ id: 'f2', nodeType: 'folder', parentId: 'f1', preRequestScript: 'f2', scriptsInherit: false })
    const req = makeNode({ id: 'req', parentId: 'f2' })
    const chain = resolveScriptChain(collection, [f1, f2, req], 'req')
    expect(chain.preScripts.map(seg => seg.sourceId)).toEqual(['col:1', 'f1'])
  })

  it('目标节点自身 scriptsInherit=false → 只执行自身(继承链为空)', () => {
    const collection = makeCollection({ preRequestScript: 'root' })
    const req = makeNode({ id: 'req', scriptsInherit: false })
    const chain = resolveScriptChain(collection, [req], 'req')
    expect(chain.preScripts).toEqual([])
    expect(chain.postScripts).toEqual([])
  })
})
