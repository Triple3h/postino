import type { AuthConfig, Collection, CollectionNode, CollectionVariable, KvPair } from '@/types'

/**
 * 集合继承解析器(Phase 1.2)。
 *
 * 语义(Hoppscotch 同款 + Postman 顺序):
 * - Auth:节点自身显式定义(非 'inherit' 且非 undefined)→ 最近祖先显式定义 → 集合定义 → none
 * - Headers:祖先激活项合并,同 key 近层覆盖远层;请求自身的合并由发送方追加(优先级最高)
 * - Variables:同 key 近层覆盖远层
 * - Pre Scripts:Collection → 文件夹(根→叶),跳过 scriptsInherit === false 的节点;节点自身脚本由调用方追加在最后
 * - Post Scripts:同一脚本链(根→叶),执行时由调用方按 请求 → 文件夹(叶→根) → Collection 反序执行
 */

export interface ScriptSegment {
  sourceId: string
  sourceName: string
  script: string
}

export interface InheritedAuth {
  /** 来源层级:node=节点自身,ancestor=最近祖先,collection=集合,none=无任何定义 */
  source: 'node' | 'ancestor' | 'collection' | 'none'
  sourceId: string | null
  sourceName: string | null
  auth: AuthConfig
}

export interface InheritedProperties {
  auth: InheritedAuth
  /** 祖先(远→近)合并后的激活 headers,同 key 近者覆盖 */
  headers: KvPair[]
  /** key → 提供该 header 的节点/集合 id(UI"继承自 XX"标记用) */
  headerSources: Record<string, string>
  /** 合并后的激活集合变量,近者覆盖 */
  variables: CollectionVariable[]
  /** key → 提供该变量的节点/集合 id */
  variableSources: Record<string, string>
  /** 继承的 pre 脚本段,根→叶(不含节点自身) */
  preScripts: ScriptSegment[]
  /** 继承的 post 脚本段,根→叶(不含节点自身) */
  postScripts: ScriptSegment[]
}

function hasExplicitAuth(auth?: AuthConfig): boolean {
  return !!auth && auth.type !== 'inherit'
}

function chainOf(nodes: CollectionNode[], nodeId: string): CollectionNode[] {
  const byId = new Map(nodes.map(node => [node.id, node]))
  const chain: CollectionNode[] = []
  let current = byId.get(nodeId)
  const guard = new Set<string>()
  while (current) {
    const parentId = current.parentId ?? null
    if (!parentId || guard.has(parentId)) break
    guard.add(parentId)
    const parent = byId.get(parentId)
    if (!parent) break
    chain.unshift(parent)
    current = parent
  }
  return chain
}

function mergeKvLayers(layers: Array<{ id: string; headers: KvPair[] | undefined }>): {
  headers: KvPair[]
  sources: Record<string, string>
} {
  const merged = new Map<string, KvPair>()
  const sources: Record<string, string> = {}
  for (const layer of layers) {
    for (const header of layer.headers ?? []) {
      if (!header.enabled || !header.key) continue
      merged.set(header.key, header)
      sources[header.key] = layer.id
    }
  }
  return { headers: Array.from(merged.values()), sources }
}

function mergeVariableLayers(layers: Array<{ id: string; variables: CollectionVariable[] | undefined }>): {
  variables: CollectionVariable[]
  sources: Record<string, string>
} {
  const merged = new Map<string, CollectionVariable>()
  const sources: Record<string, string> = {}
  for (const layer of layers) {
    for (const variable of layer.variables ?? []) {
      if (!variable.enabled || !variable.key) continue
      merged.set(variable.key, variable)
      sources[variable.key] = layer.id
    }
  }
  return { variables: Array.from(merged.values()), sources }
}

/**
 * 解析节点从集合树继承到的全部属性。
 * @param collection        所属集合(根定义)
 * @param nodes             该集合内的全部节点(含 folder/request)
 * @param nodeId            目标节点 id
 */
export function resolveInheritedProperties(
  collection: Collection,
  nodes: CollectionNode[],
  nodeId: string,
): InheritedProperties {
  const chain = chainOf(nodes, nodeId)
  const target = nodes.find(node => node.id === nodeId)

  // ── Auth:自身 → 最近祖先 → 集合 ──
  let auth: InheritedAuth = hasExplicitAuth(collection.auth)
    ? { source: 'collection', sourceId: collection.id, sourceName: collection.name, auth: collection.auth }
    : { source: 'none', sourceId: null, sourceName: null, auth: collection.auth }
  for (let i = chain.length - 1; i >= 0; i--) {
    const node = chain[i]
    if (hasExplicitAuth(node.auth)) {
      auth = { source: 'ancestor', sourceId: node.id, sourceName: node.name, auth: node.auth! }
      break
    }
  }
  if (hasExplicitAuth(target?.auth)) {
    auth = { source: 'node', sourceId: target!.id, sourceName: target!.name, auth: target!.auth! }
  }

  // ── Headers / Variables:远→近 ──
  const headerLayers = [
    { id: collection.id, headers: collection.headers },
    ...chain.map(node => ({ id: node.id, headers: node.headers })),
  ]
  const variableLayers = [
    { id: collection.id, variables: collection.variables },
    ...chain.map(node => ({ id: node.id, variables: node.variables })),
  ]
  const { headers, sources: headerSources } = mergeKvLayers(headerLayers)
  const { variables, sources: variableSources } = mergeVariableLayers(variableLayers)

  // ── Scripts:根→叶,scriptsInherit === false 截断继承 ──
  const preScripts: ScriptSegment[] = []
  const postScripts: ScriptSegment[] = []
  const push = (node: CollectionNode) => {
    if (node.scriptsInherit === false) return
    if (node.preRequestScript) preScripts.push({ sourceId: node.id, sourceName: node.name, script: node.preRequestScript })
    if (node.postRequestScript) postScripts.push({ sourceId: node.id, sourceName: node.name, script: node.postRequestScript })
  }
  if (collection.preRequestScript) preScripts.push({ sourceId: collection.id, sourceName: collection.name, script: collection.preRequestScript })
  if (collection.postRequestScript) postScripts.push({ sourceId: collection.id, sourceName: collection.name, script: collection.postRequestScript })
  for (const node of chain) push(node)

  return { auth, headers, headerSources, variables, variableSources, preScripts, postScripts }
}

/**
 * 脚本执行链(Phase 4 发送时调用):
 * - scriptsInherit !== false:pre = [collection, ...祖先(根→叶)],节点自身脚本由调用方追加在最后;
 * - scriptsInherit === false:只返回空链(仅执行节点自身)。
 */
export function resolveScriptChain(
  collection: Collection,
  nodes: CollectionNode[],
  nodeId: string,
): { preScripts: ScriptSegment[]; postScripts: ScriptSegment[] } {
  const target = nodes.find(node => node.id === nodeId)
  if (target?.scriptsInherit === false) return { preScripts: [], postScripts: [] }
  const inherited = resolveInheritedProperties(collection, nodes, nodeId)
  return { preScripts: inherited.preScripts, postScripts: inherited.postScripts }
}
