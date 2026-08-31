import type { PostResponseExtractor } from '@/types'

type JsonPathToken = string | number | '*'

export function appendJsonPath(parentPath: string, key: string, isIndex = false): string {
  if (isIndex) return `${parentPath}[${key}]`
  if (/^[A-Za-z_$][\w$]*$/.test(key)) return `${parentPath}.${key}`
  return `${parentPath}['${key.replace(/\\/g, '\\\\').replace(/'/g, "\\'")}']`
}

function tokenizeJsonPath(path: string): JsonPathToken[] {
  const input = path.trim()
  if (!input || input === '$') return []
  let cursor = input.startsWith('$') ? 1 : 0
  const tokens: JsonPathToken[] = []

  while (cursor < input.length) {
    if (input[cursor] === '.') {
      cursor += 1
      if (input[cursor] === '*') {
        tokens.push('*')
        cursor += 1
        continue
      }
      const match = input.slice(cursor).match(/^[A-Za-z_$][\w$-]*/)
      if (!match) throw new Error(`JSONPath 在第 ${cursor + 1} 位无效`)
      tokens.push(match[0])
      cursor += match[0].length
      continue
    }

    if (input[cursor] === '[') {
      const end = input.indexOf(']', cursor + 1)
      if (end < 0) throw new Error('JSONPath 缺少 ]')
      const content = input.slice(cursor + 1, end).trim()
      if (content === '*') tokens.push('*')
      else if (/^\d+$/.test(content)) tokens.push(Number(content))
      else {
        const quoted = content.match(/^(['"])(.*)\1$/)
        if (!quoted) throw new Error(`不支持的 JSONPath 片段 [${content}]`)
        tokens.push(quoted[2].replace(/\\(['"\\])/g, '$1'))
      }
      cursor = end + 1
      continue
    }

    if (cursor === 0) {
      const match = input.match(/^[A-Za-z_$][\w$-]*/)
      if (match) {
        tokens.push(match[0])
        cursor += match[0].length
        continue
      }
    }
    throw new Error(`JSONPath 在第 ${cursor + 1} 位无效`)
  }
  return tokens
}

export function queryJsonPath(root: unknown, path: string): unknown[] {
  let values: unknown[] = [root]
  for (const token of tokenizeJsonPath(path)) {
    const next: unknown[] = []
    for (const value of values) {
      if (token === '*') {
        if (Array.isArray(value)) next.push(...value)
        else if (value && typeof value === 'object') next.push(...Object.values(value))
      } else if (typeof token === 'number') {
        if (Array.isArray(value) && token < value.length) next.push(value[token])
      } else if (value && typeof value === 'object' && Object.prototype.hasOwnProperty.call(value, token)) {
        next.push((value as Record<string, unknown>)[token])
      }
    }
    values = next
  }
  return values
}

function stringifyExtracted(value: unknown): string {
  if (value == null) return value === null ? 'null' : ''
  if (typeof value === 'string') return value
  if (typeof value === 'number' || typeof value === 'boolean') return String(value)
  return JSON.stringify(value)
}

export function extractPostResponseValue(rule: PostResponseExtractor, json: unknown): string {
  if (rule.extractMode === 'whole-json') return stringifyExtracted(json)
  const values = queryJsonPath(json, rule.jsonPath)
  if (values.length === 0) throw new Error(`JSONPath 未匹配到值：${rule.jsonPath || '$'}`)
  if (rule.unwrapArray) return values.flatMap(value => Array.isArray(value) ? value : [value]).map(stringifyExtracted).join(',')
  return stringifyExtracted(values.length === 1 ? values[0] : values)
}
