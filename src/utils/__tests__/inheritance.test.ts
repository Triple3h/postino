import { describe, expect, it } from 'vitest'
import { createDefaultAuthConfig } from '@/utils/auth'
import { matchInheritedScript, resolveInheritedProperties, resolveScriptChain, stripInheritedPrefix } from '@/utils/inheritance'
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

describe('matchInheritedScript', () => {
  const segments = [
    { sourceId: 'col:1', sourceName: '集合', script: 'console.log("collection")' },
    { sourceId: 'f1', sourceName: '文件夹', script: 'console.log("folder")' },
  ]

  it('与单段继承脚本一致 → 命中该段', () => {
    expect(matchInheritedScript(segments, 'console.log("folder")')).toEqual([segments[1]])
  })

  it('与多段按根→叶空行拼接一致 → 命中连续段(Postman 导入场景)', () => {
    expect(matchInheritedScript(segments, 'console.log("collection")\n\nconsole.log("folder")')).toEqual(segments)
  })

  it('忽略首尾空白差异', () => {
    expect(matchInheritedScript(segments, '  console.log("collection")\n')).toEqual([segments[0]])
  })

  it('自定义脚本(追加了自己的逻辑)→ 不命中', () => {
    expect(matchInheritedScript(segments, 'console.log("collection")\n\nconsole.log("mine")')).toBeNull()
  })

  it('空脚本 / 空继承链 → 不命中', () => {
    expect(matchInheritedScript(segments, '')).toBeNull()
    expect(matchInheritedScript(segments, undefined)).toBeNull()
    expect(matchInheritedScript([], 'console.log("x")')).toBeNull()
  })
})

describe('stripInheritedPrefix', () => {
  it('剥离单段继承前缀,还原节点自身脚本', () => {
    const inherited = ['console.log("collection")']
    expect(stripInheritedPrefix('console.log("collection")\n\nconsole.log("folder")', inherited)).toBe('console.log("folder")')
  })

  it('内容与继承段完全一致 → 空串(纯副本)', () => {
    expect(stripInheritedPrefix('console.log("collection")', ['console.log("collection")'])).toBe('')
  })

  it('多段继承链按顺序逐段剥离', () => {
    const inherited = ['console.log("collection")', 'console.log("folder")']
    expect(stripInheritedPrefix('console.log("collection")\n\nconsole.log("folder")\n\nconsole.log("req")', inherited)).toBe('console.log("req")')
  })

  it('无烘焙前缀的脚本原样返回', () => {
    expect(stripInheritedPrefix('console.log("mine")', ['console.log("collection")'])).toBe('console.log("mine")')
  })

  it('空脚本或空继承链 → 原样返回(trim)', () => {
    expect(stripInheritedPrefix('', ['x'])).toBe('')
    expect(stripInheritedPrefix(undefined, ['x'])).toBe('')
    expect(stripInheritedPrefix('  a  ', [])).toBe('a')
  })
})

describe('resolveScriptChain · 烘焙数据归一化', () => {
  it('文件夹存有"集合+自身"烘焙脚本时,继承链不重复收录集合脚本', () => {
    const collection = makeCollection({ preRequestScript: 'root' })
    const folder = makeNode({ id: 'f1', nodeType: 'folder', preRequestScript: 'root\n\nfolder-own' })
    const req = makeNode({ id: 'req', parentId: 'f1', preRequestScript: 'root\n\nfolder-own\n\nreq-own' })
    const chain = resolveScriptChain(collection, [folder, req], 'req')
    expect(chain.preScripts.map(seg => seg.script)).toEqual(['root', 'folder-own'])
  })

  it('请求脚本为父级链纯副本时,继承链仍完整(去重由执行方按副本识别)', () => {
    const collection = makeCollection({ preRequestScript: 'root' })
    const req = makeNode({ id: 'req', preRequestScript: 'root' })
    const chain = resolveScriptChain(collection, [req], 'req')
    expect(chain.preScripts.map(seg => seg.script)).toEqual(['root'])
  })

  it('普通自身脚本不受剥离逻辑影响', () => {
    const collection = makeCollection({ preRequestScript: 'root' })
    const folder = makeNode({ id: 'f1', nodeType: 'folder', preRequestScript: 'console.log("f1")' })
    const req = makeNode({ id: 'req', parentId: 'f1', preRequestScript: 'console.log("req")' })
    const chain = resolveScriptChain(collection, [folder, req], 'req')
    expect(chain.preScripts.map(seg => seg.script)).toEqual(['root', 'console.log("f1")'])
  })
})
