import { describe, expect, it } from 'vitest'
import {
  backfillParamsFromUrl,
  buildUrlFromPairs,
  mergeUrlQueryIntoPairs,
  parseUrlQueryToPairs,
  stripUrlQuery,
  syncPairsToUrl,
} from '../url-params'

describe('parseUrlQueryToPairs', () => {
  it('解析普通 query 为参数行', () => {
    expect(parseUrlQueryToPairs('https://a.com/x?areaCode=440000&pageSize=5')).toEqual([
      { key: 'areaCode', value: '440000', enabled: true },
      { key: 'pageSize', value: '5', enabled: true },
    ])
  })

  it('空值参数保留为空字符串值', () => {
    expect(parseUrlQueryToPairs('https://a.com/x?taskName=&type=sxsl')).toEqual([
      { key: 'taskName', value: '', enabled: true },
      { key: 'type', value: 'sxsl', enabled: true },
    ])
  })

  it('无 = 号的片段值为空', () => {
    expect(parseUrlQueryToPairs('https://a.com/x?flag&b=1')).toEqual([
      { key: 'flag', value: '', enabled: true },
      { key: 'b', value: '1', enabled: true },
    ])
  })

  it('忽略 hash 与无 key 片段', () => {
    expect(parseUrlQueryToPairs('https://a.com/x?a=1#section')).toEqual([{ key: 'a', value: '1', enabled: true }])
    expect(parseUrlQueryToPairs('https://a.com/x?=orphan&b=2')).toEqual([{ key: 'b', value: '2', enabled: true }])
  })

  it('保留重复 key 与原始编码', () => {
    expect(parseUrlQueryToPairs('https://a.com/x?tag=a&tag=b')).toEqual([
      { key: 'tag', value: 'a', enabled: true },
      { key: 'tag', value: 'b', enabled: true },
    ])
    expect(parseUrlQueryToPairs('https://a.com/x?q=%E4%B8%AD')).toEqual([
      { key: 'q', value: '中', enabled: true },
    ])
  })

  it('URL 无 query 时返回空数组', () => {
    expect(parseUrlQueryToPairs('https://a.com/x')).toEqual([])
    expect(parseUrlQueryToPairs('')).toEqual([])
  })

  it('支持 {{var}} 模板 URL', () => {
    expect(parseUrlQueryToPairs('{{base}}/api?{{paramName}}=v')).toEqual([
      { key: '{{paramName}}', value: 'v', enabled: true },
    ])
  })
})

describe('stripUrlQuery / buildUrlFromPairs / syncPairsToUrl', () => {
  it('stripUrlQuery 去掉 query 与 hash', () => {
    expect(stripUrlQuery('https://a.com/x?b=1#c')).toBe('https://a.com/x')
    expect(stripUrlQuery('https://a.com/x')).toBe('https://a.com/x')
  })

  it('用启用参数重建 URL,禁用与空 key 行不进 URL', () => {
    const url = buildUrlFromPairs('https://a.com/x?old=1', [
      { key: 'a', value: '1', enabled: true },
      { key: 'b', value: '', enabled: true },
      { key: 'off', value: 'x', enabled: false },
      { key: '', value: 'draft', enabled: true },
    ])
    expect(url).toBe('https://a.com/x?a=1&b=')
  })

  it('没有启用参数时摘掉 query', () => {
    expect(syncPairsToUrl('https://a.com/x?a=1', [])).toBe('https://a.com/x')
    expect(syncPairsToUrl('https://a.com/x?a=1', [{ key: 'a', value: '1', enabled: false }])).toBe('https://a.com/x')
  })

  it('保留路径中的变量模板', () => {
    expect(syncPairsToUrl('{{base}}/api/{{id}}?x=1', [{ key: 'x', value: '2', enabled: true }])).toBe(
      '{{base}}/api/{{id}}?x=2',
    )
  })
})

describe('编码往返', () => {
  it('表值写入 URL 时最小转义,{{var}} 保持原样', () => {
    const url = syncPairsToUrl('https://a.com/x', [
      { key: 'q', value: 'a&b=c d', enabled: true },
      { key: 'tpl', value: '{{apiKey}}', enabled: true },
    ])
    expect(url).toBe('https://a.com/x?q=a%26b%3Dc%20d&tpl={{apiKey}}')
  })

  it('解析已编码 URL 解码为原文,往返稳定', () => {
    const pairs = parseUrlQueryToPairs('https://a.com/x?q=a%26b%3Dc%20d')
    expect(pairs).toEqual([{ key: 'q', value: 'a&b=c d', enabled: true }])
    expect(syncPairsToUrl('https://a.com/x', pairs)).toBe('https://a.com/x?q=a%26b%3Dc%20d')
  })

  it('非法 % 序列(手输原文)不丢数据', () => {
    expect(parseUrlQueryToPairs('https://a.com/x?q=100%')).toEqual([{ key: 'q', value: '100%', enabled: true }])
  })
})

describe('mergeUrlQueryIntoPairs(URL 编辑 → 参数表)', () => {
  it('回填 URL 中缺失的参数', () => {
    const merged = mergeUrlQueryIntoPairs('https://a.com/x?areaCode=440000&pageSize=5', [])
    expect(merged.map(p => ({ key: p.key, value: p.value }))).toEqual([
      { key: 'areaCode', value: '440000' },
      { key: 'pageSize', value: '5' },
    ])
  })

  it('保留已有行的元数据,URL 删除的启用行随之移除', () => {
    const existing = [
      { key: 'a', value: '1', enabled: true, description: '备注' },
      { key: 'gone', value: '2', enabled: true },
      { key: 'off', value: '3', enabled: false },
    ]
    const merged = mergeUrlQueryIntoPairs('https://a.com/x?a=1&new=9', existing)
    expect(merged).toEqual([
      { key: 'a', value: '1', enabled: true, description: '备注' },
      { key: 'off', value: '3', enabled: false },
      { key: 'new', value: '9', enabled: true, type: 'text' },
    ])
  })

  it('URL 无参数时保持参数表不变(仅存于参数表的参数不被误清)', () => {
    const existing = [
      { key: 'a', value: '1', enabled: true },
      { key: 'off', value: '3', enabled: false },
    ]
    expect(mergeUrlQueryIntoPairs('https://a.com/x', existing)).toEqual(existing)
  })

  it('URL 内同名同值重复出现时保留多行', () => {
    const merged = mergeUrlQueryIntoPairs('https://a.com/x?tag=a&tag=a', [])
    expect(merged.filter(p => p.key === 'tag').length).toBe(2)
  })
})

describe('backfillParamsFromUrl(迁移/导入,只增不减)', () => {
  it('只追加缺失参数,不动已有行(含禁用行)', () => {
    const existing = [
      { key: 'a', value: '1', enabled: true, description: 'keep' },
      { key: 'off', value: '3', enabled: false },
    ]
    const merged = backfillParamsFromUrl('https://a.com/x?a=1&new=9', existing)
    expect(merged).toEqual([
      { key: 'a', value: '1', enabled: true, description: 'keep' },
      { key: 'off', value: '3', enabled: false },
      { key: 'new', value: '9', enabled: true, type: 'text' },
    ])
  })

  it('已齐全时不新增行', () => {
    const existing = [{ key: 'a', value: '1', enabled: true }]
    expect(backfillParamsFromUrl('https://a.com/x?a=1', existing)).toEqual(existing)
  })

  it('URL 无 query 时原样返回', () => {
    const existing = [{ key: 'a', value: '1', enabled: true }]
    expect(backfillParamsFromUrl('https://a.com/x', existing)).toBe(existing)
    expect(backfillParamsFromUrl('https://a.com/x', undefined)).toEqual([])
  })
})
