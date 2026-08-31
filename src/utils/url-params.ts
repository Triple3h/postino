import type { KvPair } from '@/types'

/**
 * URL query ↔ params 表双向同步(Postman 式):
 * - URL 变更(query 存在)→ 以 URL 为准回填参数表;URL 无 query 时不动参数表
 *   (存量请求可能只在参数表填了参数,清空会造成数据丢失)。
 * - params 表变更 → 用启用参数重建 URL query(禁用参数不进 URL,与 Postman 一致)。
 *
 * 编码语义:参数表里存「用户输入原文」;写入 URL 时做最小转义(&、=、+、空格、% 等,
 * 但保留 {{ }} 使变量模板可读),解析 URL 时做对应解码,往返稳定不转义升级。
 */

/** 最小转义:encodeURIComponent 后还原花括号,保证 {{var}} 模板在 URL 中原样展示 */
export function encodeQueryValue(raw: string): string {
  return encodeURIComponent(raw).replace(/%7B/g, '{').replace(/%7D/g, '}')
}

/** 对应解码:非法 % 序列(手输原文)回退为原文 */
function decodeQueryValue(raw: string): string {
  try {
    return decodeURIComponent(raw)
  } catch {
    return raw
  }
}

/** 把 URL 中的 query 解析为参数行(值已解码;忽略无 key 片段;保留重复 key) */
export function parseUrlQueryToPairs(url: string): KvPair[] {
  const qIndex = url.indexOf('?')
  if (qIndex === -1) return []
  const query = url.slice(qIndex + 1)
  // 去掉 hash,避免 #fragment 被当作参数值
  const hashIndex = query.indexOf('#')
  const rawQuery = hashIndex === -1 ? query : query.slice(0, hashIndex)
  if (!rawQuery) return []

  return rawQuery
    .split('&')
    .filter(Boolean)
    .map(chunk => {
      const eq = chunk.indexOf('=')
      return {
        key: decodeQueryValue(eq === -1 ? chunk : chunk.slice(0, eq)),
        value: eq === -1 ? '' : decodeQueryValue(chunk.slice(eq + 1)),
        enabled: true,
      }
    })
    .filter(pair => pair.key.length > 0)
}

/** URL 去掉 query/hash 后的前半段(路径部分原样保留,含 {{var}} 模板) */
export function stripUrlQuery(url: string): string {
  const qIndex = url.indexOf('?')
  const base = qIndex === -1 ? url : url.slice(0, qIndex)
  const hashIndex = base.indexOf('#')
  return hashIndex === -1 ? base : base.slice(0, hashIndex)
}

/**
 * 用启用中的参数重建 URL:base + ?k=v&k2=v2(空值参数保留为 k=)。
 * 禁用参数不进 URL —— 与 Postman 一致,禁用即不发送,URL 上也不展示。
 */
export function buildUrlFromPairs(baseUrl: string, pairs: KvPair[]): string {
  const base = stripUrlQuery(baseUrl)
  const query = pairs
    .filter(pair => pair.enabled && pair.key.trim())
    .map(pair => `${encodeQueryValue(pair.key)}=${encodeQueryValue(pair.value)}`)
    .join('&')
  return query ? `${base}?${query}` : base
}

/**
 * URL → params 回填(URL 编辑共用,URL query 为唯一事实源):
 * - URL 有参数:与现有启用行按 (key, value) 依次匹配,匹配行保留原位与元数据,
 *   URL 新出现的参数追加到表尾;表中 URL 没有的启用行视为已被 URL 删除,随之移除;
 *   禁用行不受影响。
 * - URL 无参数:保持参数表不变(避免无 query 的 URL 编辑误清仅存于参数表的参数)。
 */
export function mergeUrlQueryIntoPairs(url: string, existing: KvPair[] | undefined): KvPair[] {
  const fromUrl = parseUrlQueryToPairs(url)
  const rows = (existing ?? []).map(pair => ({ ...pair }))
  if (!fromUrl.length) return rows

  const consumed = new Set<number>()
  const appended: KvPair[] = []
  for (const incoming of fromUrl) {
    const matched = rows.findIndex(
      (pair, i) => !consumed.has(i) && pair.enabled && pair.key === incoming.key && pair.value === incoming.value)
    if (matched >= 0) consumed.add(matched)
    else appended.push({ ...incoming, type: 'text' })
  }
  const result = rows.filter((_, i) => consumed.has(i) || !rows[i].enabled)
  result.push(...appended)
  return result
}

/**
 * URL → params 增量回填(存量迁移/导入共用):只把 URL 中缺失的参数追加到表尾,
 * 绝不删除或改动已有行 —— 与 mergeUrlQueryIntoPairs 的「URL 为准重建」区分开。
 */
export function backfillParamsFromUrl(url: string, existing: KvPair[] | undefined): KvPair[] {
  const fromUrl = parseUrlQueryToPairs(url)
  if (!fromUrl.length) return existing ?? []
  const result = (existing ?? []).map(pair => ({ ...pair }))
  for (const incoming of fromUrl) {
    const duplicated = result.some(pair => pair.enabled && pair.key === incoming.key && pair.value === incoming.value)
    if (!duplicated) result.push({ ...incoming, type: 'text' })
  }
  return result
}

/**
 * params 表 → URL 重建(params 编辑共用):
 * 以启用参数为准重建 query;没有启用参数时摘掉 URL 的 query。
 */
export function syncPairsToUrl(url: string, pairs: KvPair[]): string {
  return buildUrlFromPairs(url, pairs)
}
