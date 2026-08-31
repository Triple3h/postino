import { describe, expect, it } from 'vitest'
import { appendJsonPath, extractPostResponseValue, queryJsonPath } from '@/utils/post-response-extract'
import type { PostResponseExtractor } from '@/types'

function rule(overrides: Partial<PostResponseExtractor> = {}): PostResponseExtractor {
  return {
    id: 'rule-1',
    enabled: true,
    variableName: 'token',
    variableScope: 'collection',
    source: 'response-json',
    extractMode: 'jsonpath',
    jsonPath: '$.data.token',
    unwrapArray: false,
    ...overrides,
  }
}

describe('post response extraction', () => {
  const response = {
    data: { token: 'abc123', users: [{ id: 1 }, { id: 2 }] },
    'access-token': 'quoted-key',
  }

  it('reads dot, array and quoted-key JSONPath forms', () => {
    expect(queryJsonPath(response, '$.data.token')).toEqual(['abc123'])
    expect(queryJsonPath(response, '$.data.users[1].id')).toEqual([2])
    expect(queryJsonPath(response, "$['access-token']")).toEqual(['quoted-key'])
  })

  it('builds executable paths for arrays and special property names', () => {
    expect(appendJsonPath('$.data', '0', true)).toBe('$.data[0]')
    const specialPath = appendJsonPath('$', "access token's")
    expect(specialPath).toBe("$['access token\\'s']")
    expect(queryJsonPath({ "access token's": 'abc' }, specialPath)).toEqual(['abc'])
  })

  it('collects wildcard matches', () => {
    expect(queryJsonPath(response, '$.data.users[*].id')).toEqual([1, 2])
  })

  it('keeps arrays as JSON unless array unwrapping is enabled', () => {
    expect(extractPostResponseValue(rule({ jsonPath: '$.data.users' }), response)).toBe('[{"id":1},{"id":2}]')
    expect(extractPostResponseValue(rule({ jsonPath: '$.data.users[*].id', unwrapArray: true }), response)).toBe('1,2')
  })

  it('can capture the complete JSON response', () => {
    expect(extractPostResponseValue(rule({ extractMode: 'whole-json' }), response)).toBe(JSON.stringify(response))
  })

  it('reports an unmatched path', () => {
    expect(() => extractPostResponseValue(rule({ jsonPath: '$.missing' }), response)).toThrow('未匹配到值')
  })
})
