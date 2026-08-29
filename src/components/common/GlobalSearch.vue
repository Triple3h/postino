<script setup lang="ts">
import { ref, computed, watch, onMounted, onUnmounted } from 'vue'
import { Search } from '@lucide/vue'
import { useAppStore } from '@/stores/app'
import { useWorkspaceStore } from '@/stores/workspace'

const store = useAppStore()
const workspace = useWorkspaceStore()
const showSearch = ref(false)
const searchQuery = ref('')
const selectedIndex = ref(0)
const scopeFilter = ref<'all' | 'interface' | 'variable' | 'history'>('all')

// --- Recent searches ---
const RECENT_KEY = 'apifix_recent_searches'
const recentSearches = ref<string[]>([])

function loadRecentSearches() {
  try {
    const raw = localStorage.getItem(RECENT_KEY)
    recentSearches.value = raw ? JSON.parse(raw) : []
  } catch {
    recentSearches.value = []
  }
}

function saveRecentSearch(query: string) {
  const q = query.trim()
  if (!q) return
  const list = recentSearches.value.filter(s => s !== q)
  list.unshift(q)
  recentSearches.value = list.slice(0, 5)
  try {
    localStorage.setItem(RECENT_KEY, JSON.stringify(recentSearches.value))
  } catch { /* ignore */ }
}

function clickRecentSearch(query: string) {
  searchQuery.value = query
  selectedIndex.value = 0
}

function clearRecentSearches() {
  recentSearches.value = []
  try {
    localStorage.removeItem(RECENT_KEY)
  } catch { /* ignore */ }
}

// --- Fuzzy matching ---
interface FuzzyResult {
  score: number
  matchedIndices: number[]
}

/**
 * Simple fuzzy matching algorithm.
 * Splits query into characters, checks if they appear in order in the target.
 * Scoring: consecutive characters score higher, matches at word boundaries score higher.
 * Returns null if no match.
 */
function fuzzyMatch(query: string, target: string): FuzzyResult | null {
  if (!query) return { score: 0, matchedIndices: [] }
  const q = query.toLowerCase()
  const t = target.toLowerCase()

  // Fast path: exact substring match
  const subIdx = t.indexOf(q)
  if (subIdx !== -1) {
    const indices = Array.from({ length: q.length }, (_, i) => subIdx + i)
    // Score: base score + bonus for word boundary + bonus for consecutive
    let score = 100
    // Word boundary bonus
    if (subIdx === 0 || /[\s\-_./]/.test(t[subIdx - 1])) score += 20
    // Length ratio bonus (shorter target = better match)
    score += Math.max(0, 30 - (t.length - q.length))
    return { score, matchedIndices: indices }
  }

  // Fuzzy path: characters must appear in order
  const matchedIndices: number[] = []
  let qi = 0
  for (let ti = 0; ti < t.length && qi < q.length; ti++) {
    if (t[ti] === q[qi]) {
      matchedIndices.push(ti)
      qi++
    }
  }

  if (qi < q.length) return null // Not all query chars matched

  // Score fuzzy match
  let score = 50 // Base fuzzy score (lower than substring)

  // Consecutive character bonus
  let consecutive = 0
  for (let i = 1; i < matchedIndices.length; i++) {
    if (matchedIndices[i] === matchedIndices[i - 1] + 1) {
      consecutive++
      score += 5
    }
  }
  // Extra bonus for long consecutive runs
  if (consecutive >= 3) score += 15

  // Word boundary bonus
  for (const idx of matchedIndices) {
    if (idx === 0 || /[\s\-_./]/.test(t[idx - 1])) {
      score += 8
    }
    // CamelCase boundary bonus
    if (idx > 0 && /[a-z]/.test(t[idx - 1]) && /[A-Z]/.test(t[idx])) {
      score += 6
    }
  }

  // Coverage bonus (higher ratio of matched chars to target length)
  const coverage = q.length / t.length
  score += Math.round(coverage * 20)

  return { score, matchedIndices }
}

// --- Search result type mapping ---
const TYPE_SCOPE_MAP: Record<string, 'interface' | 'variable' | 'history'> = {
  '接口': 'interface',
  '文件夹': 'interface',
  '环境变量': 'variable',
  '集合变量': 'variable',
  '请求变量': 'variable',
  '历史': 'history',
}

interface SearchResult {
  type: string
  name: string
  id: string
  extra: string
  score: number
  nameMatchedIndices: number[]
  extraMatchedIndices: number[]
}

/** 集合树:节点祖先文件夹链(根→叶名称) */
function folderChainOf(node: { parentId?: string | null }): string[] {
  const byId = new Map(workspace.interfaces.map(item => [item.id, item]))
  const names: string[] = []
  let parentId = node.parentId ?? null
  const guard = new Set<string>()
  while (parentId && !guard.has(parentId)) {
    guard.add(parentId)
    const parent = byId.get(parentId)
    if (!parent) break
    names.unshift(parent.name)
    parentId = parent.parentId ?? null
  }
  return names
}

/** 选中文件夹结果:打开所属集合,并展开该文件夹及祖先(移除折叠标记) */
function revealFolder(folderId: string) {
  const node = workspace.interfaces.find(item => item.id === folderId)
  const collectionId = node ? (node.collectionId ?? node.moduleId) : null
  if (!node || !collectionId) return
  workspace.selectModule(collectionId)
  store.currentApiId = null
  const byId = new Map(workspace.interfaces.map(item => [item.id, item]))
  const chain: string[] = [node.id]
  let parentId = node.parentId ?? null
  const guard = new Set<string>()
  while (parentId && !guard.has(parentId)) {
    guard.add(parentId)
    const parent = byId.get(parentId)
    if (!parent || (parent.nodeType ?? 'request') !== 'folder') break
    chain.unshift(parent.id)
    parentId = parent.parentId ?? null
  }
  // Sidebar 的展开约定:默认展开,存在 collapsed:node:<id> 即为折叠
  const collapsedKeys = new Set(chain.map(id => `collapsed:node:${id}`))
  if (store.expandedFolders.some(key => collapsedKeys.has(key))) {
    store.expandedFolders = store.expandedFolders.filter(key => !collapsedKeys.has(key))
  }
}

const results = computed(() => {
  const q = searchQuery.value.trim()
  if (!q) return []

  const items: SearchResult[] = []

  const indexedApiIds = new Set<string>()

  // Search planned interfaces(Phase 5.3:路径 = 集合名 + 文件夹链)
  for (const interfaceNode of workspace.interfaces) {
    if ((interfaceNode.nodeType ?? 'request') === 'folder') continue
    const api = store.apis[interfaceNode.apiId]
    const collection = workspace.collections.find(item => item.id === (interfaceNode.collectionId ?? interfaceNode.moduleId))
    const path = [collection?.name, ...folderChainOf(interfaceNode)].filter(Boolean).join(' / ')
    const name = api?.name ?? interfaceNode.name
    const url = api?.url ?? interfaceNode.url
    const method = api?.method ?? interfaceNode.method
    indexedApiIds.add(interfaceNode.apiId)

    const extra = `${path ? `${path} · ` : ''}${method} ${url}`

    const nameMatch = fuzzyMatch(q, name)
    const urlMatch = fuzzyMatch(q, url)
    const methodMatch = fuzzyMatch(q, method)
    const pathMatch = fuzzyMatch(q, path)
    const extraMatch = fuzzyMatch(q, extra)

    const bestMatch = [nameMatch, urlMatch, methodMatch, pathMatch, extraMatch].reduce<
      FuzzyResult | null
    >((best, cur) => {
      if (!cur) return best
      if (!best || cur.score > best.score) return cur
      return best
    }, null)

    if (bestMatch) {
      // Determine which field had the best match for highlighting
      const nameResult = nameMatch && nameMatch.score >= (urlMatch?.score ?? 0) && nameMatch.score >= (extraMatch?.score ?? 0)
        ? nameMatch
        : null
      const extraResult = extraMatch && !nameResult
        ? extraMatch
        : null

      items.push({
        type: '接口',
        name,
        id: interfaceNode.apiId,
        extra,
        score: bestMatch.score,
        nameMatchedIndices: nameResult?.matchedIndices ?? [],
        extraMatchedIndices: extraResult?.matchedIndices ?? [],
      })
    }
  }

  // Search folders(Phase 5.3:集合树的文件夹也可检索)
  for (const folderNode of workspace.interfaces) {
    if ((folderNode.nodeType ?? 'request') !== 'folder') continue
    const collection = workspace.collections.find(item => item.id === (folderNode.collectionId ?? folderNode.moduleId))
    const path = [collection?.name, ...folderChainOf(folderNode)].filter(Boolean).join(' / ')
    const name = folderNode.name
    const nameMatch = fuzzyMatch(q, name)
    const pathMatch = fuzzyMatch(q, path)
    const bestMatch = nameMatch && pathMatch
      ? (nameMatch.score >= pathMatch.score ? nameMatch : pathMatch)
      : nameMatch ?? pathMatch

    if (bestMatch) {
      items.push({
        type: '文件夹',
        name,
        id: folderNode.id,
        extra: path,
        score: bestMatch.score,
        nameMatchedIndices: nameMatch?.matchedIndices ?? [],
        extraMatchedIndices: pathMatch?.matchedIndices ?? [],
      })
    }
  }

  // Fallback for legacy APIs
  for (const [id, api] of Object.entries(store.apis)) {
    if (indexedApiIds.has(id)) continue
    const nameMatch = fuzzyMatch(q, api.name)
    const urlMatch = fuzzyMatch(q, api.url)
    const methodMatch = fuzzyMatch(q, api.method)
    const extra = `${api.method} ${api.url}`
    const extraMatch = fuzzyMatch(q, extra)

    const bestMatch = [nameMatch, urlMatch, methodMatch, extraMatch].reduce<
      FuzzyResult | null
    >((best, cur) => {
      if (!cur) return best
      if (!best || cur.score > best.score) return cur
      return best
    }, null)

    if (bestMatch) {
      const nameResult = nameMatch && nameMatch.score >= (urlMatch?.score ?? 0) && nameMatch.score >= (extraMatch?.score ?? 0)
        ? nameMatch
        : null
      const extraResult = extraMatch && !nameResult ? extraMatch : null

      items.push({
        type: '接口',
        name: api.name,
        id,
        extra,
        score: bestMatch.score,
        nameMatchedIndices: nameResult?.matchedIndices ?? [],
        extraMatchedIndices: extraResult?.matchedIndices ?? [],
      })
    }
  }

  // Search environment variables
  for (const env of store.environments) {
    for (const v of env.variables) {
      const nameStr = `${env.name}.${v.key}`
      const nameMatch = fuzzyMatch(q, nameStr)
      const valueMatch = fuzzyMatch(q, v.value)

      const bestMatch = nameMatch && valueMatch
        ? (nameMatch.score >= valueMatch.score ? nameMatch : valueMatch)
        : nameMatch ?? valueMatch

      if (bestMatch) {
        items.push({
          type: '环境变量',
          name: nameStr,
          id: env.id,
          extra: v.value,
          score: bestMatch.score,
          nameMatchedIndices: nameMatch?.matchedIndices ?? [],
          extraMatchedIndices: valueMatch?.matchedIndices ?? [],
        })
      }
    }
  }

  // Search collection variables(Phase 5.3:替代遗留模块变量)
  for (const collection of workspace.collections) {
    for (const v of collection.variables ?? []) {
      if (!v.key) continue
      const nameStr = `${collection.name}.${v.key}`
      const displayValue = v.currentValue || v.initialValue || ''

      const nameMatch = fuzzyMatch(q, nameStr)
      const valueMatch = fuzzyMatch(q, String(displayValue))

      const bestMatch = nameMatch && valueMatch
        ? (nameMatch.score >= valueMatch.score ? nameMatch : valueMatch)
        : nameMatch ?? valueMatch

      if (bestMatch) {
        items.push({
          type: '集合变量',
          name: nameStr,
          id: collection.id,
          extra: String(displayValue),
          score: bestMatch.score,
          nameMatchedIndices: nameMatch?.matchedIndices ?? [],
          extraMatchedIndices: valueMatch?.matchedIndices ?? [],
        })
      }
    }
  }

  // Search request-level variables
  for (const [apiId, api] of Object.entries(store.apis)) {
    for (const variable of api.requestVariables ?? []) {
      if (!variable.key) continue
      const nameStr = `${api.name}.${variable.key}`
      const nameMatch = fuzzyMatch(q, nameStr)
      const valueMatch = fuzzyMatch(q, String(variable.value || ''))
      const descMatch = fuzzyMatch(q, String(variable.description || ''))

      const bestMatch = [nameMatch, valueMatch, descMatch].reduce<FuzzyResult | null>((best, cur) => {
        if (!cur) return best
        if (!best || cur.score > best.score) return cur
        return best
      }, null)

      if (bestMatch) {
        items.push({
          type: '请求变量',
          name: nameStr,
          id: apiId,
          extra: variable.value || variable.description || '',
          score: bestMatch.score,
          nameMatchedIndices: nameMatch?.matchedIndices ?? [],
          extraMatchedIndices: (valueMatch ?? descMatch)?.matchedIndices ?? [],
        })
      }
    }
  }

  // Search history
  for (const h of store.history) {
    const nameStr = `${h.method} ${h.url}`
    const nameMatch = fuzzyMatch(q, nameStr)
    const urlMatch = fuzzyMatch(q, h.url)
    const extra = `${h.status} ${h.duration}ms`
    const extraMatch = fuzzyMatch(q, extra)

    const bestMatch = [nameMatch, urlMatch, extraMatch].reduce<FuzzyResult | null>((best, cur) => {
      if (!cur) return best
      if (!best || cur.score > best.score) return cur
      return best
    }, null)

    if (bestMatch) {
      items.push({
        type: '历史',
        name: nameStr,
        id: h.apiId,
        extra,
        score: bestMatch.score,
        nameMatchedIndices: (nameMatch ?? urlMatch)?.matchedIndices ?? [],
        extraMatchedIndices: extraMatch?.matchedIndices ?? [],
      })
    }
  }

  // Sort by score descending
  items.sort((a, b) => b.score - a.score)

  // Apply scope filter
  const filtered = scopeFilter.value === 'all'
    ? items
    : items.filter(item => TYPE_SCOPE_MAP[item.type] === scopeFilter.value)

  return filtered.slice(0, 50)
})

// --- Highlight rendering ---
function highlightText(text: string, matchedIndices: number[]): string {
  if (!matchedIndices.length) return escapeHtml(text)
  const set = new Set(matchedIndices)
  let result = ''
  for (let i = 0; i < text.length; i++) {
    const ch = escapeHtml(text[i])
    if (set.has(i)) {
      result += `<mark class="search-highlight">${ch}</mark>`
    } else {
      result += ch
    }
  }
  return result
}

function escapeHtml(value: string): string {
  return value
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#39;')
}

function openSearch() {
  showSearch.value = true
  searchQuery.value = ''
  selectedIndex.value = 0
  scopeFilter.value = 'all'
  loadRecentSearches()
}

function closeSearch() {
  showSearch.value = false
}

function selectResult(result: typeof results.value[0], sendAfterSelect = false) {
  saveRecentSearch(searchQuery.value)
  if (result.type === '接口' || result.type === '历史' || result.type === '请求变量') {
    const interfaceNode = workspace.interfaces.find(item => item.apiId === result.id)
    workspace.selectInterface(interfaceNode?.id ?? result.id)
    store.currentApiId = result.id
    if (sendAfterSelect) {
      window.dispatchEvent(new CustomEvent('apifix:send-current-request'))
    }
  } else if (result.type === '文件夹') {
    revealFolder(result.id)
  } else if (result.type === '集合变量') {
    workspace.selectModule(result.id)
    store.currentApiId = null
  }
  closeSearch()
}

function activateSelected(sendAfterSelect = false) {
  const result = results.value[selectedIndex.value] ?? results.value[0]
  if (result) selectResult(result, sendAfterSelect)
}

function moveSelection(delta: number) {
  if (results.value.length === 0) return
  selectedIndex.value = (selectedIndex.value + delta + results.value.length) % results.value.length
}

watch(results, () => {
  selectedIndex.value = 0
})

function handleSearchEnter(e: KeyboardEvent) {
  if (e.ctrlKey || e.metaKey) return
  e.preventDefault()
  activateSelected(true)
}

function handleKeydown(e: KeyboardEvent) {
  if (e.key === 'Escape' && showSearch.value) {
    e.preventDefault()
    e.stopImmediatePropagation()
    closeSearch()
  }
}

onMounted(() => {
  window.addEventListener('keydown', handleKeydown)
  window.addEventListener('apifix:open-global-search', openSearch)
  loadRecentSearches()
})
onUnmounted(() => {
  window.removeEventListener('keydown', handleKeydown)
  window.removeEventListener('apifix:open-global-search', openSearch)
})
</script>

<template>
  <div v-if="showSearch" class="search-overlay" @click.self="closeSearch">
    <div class="search-modal">
      <input
        v-model="searchQuery"
        type="text"
        class="search-input"
        placeholder="搜索接口、变量、历史..."
        autofocus
        @keydown.escape="closeSearch"
        @keydown.down.prevent="moveSelection(1)"
        @keydown.up.prevent="moveSelection(-1)"
        @keydown.enter="handleSearchEnter"
      />
      <div class="scope-tabs">
        <button
          v-for="tab in ([
            { key: 'all', label: '全部' },
            { key: 'interface', label: '接口' },
            { key: 'variable', label: '变量' },
            { key: 'history', label: '历史' },
          ] as const)"
          :key="tab.key"
          :class="['scope-tab', { active: scopeFilter === tab.key }]"
          @click="scopeFilter = tab.key"
        >{{ tab.label }}</button>
      </div>
      <div class="search-results">
        <!-- Recent searches (shown when query is empty) -->
        <template v-if="!searchQuery.trim() && recentSearches.length > 0">
          <div class="recent-header">
            <span class="recent-label">最近搜索</span>
            <button class="recent-clear" @click="clearRecentSearches">清除</button>
          </div>
          <div
            v-for="(query, idx) in recentSearches"
            :key="'recent-' + idx"
            class="search-result recent-item"
            @click="clickRecentSearch(query)"
          >
            <span class="recent-icon"><Search :size="14" /></span>
            <span class="result-name">{{ query }}</span>
          </div>
        </template>
        <!-- Search results -->
        <template v-if="searchQuery.trim()">
          <div
            v-for="(r, index) in results"
            :key="r.id + r.name"
            :class="['search-result', { selected: selectedIndex === index }]"
            @mouseenter="selectedIndex = index"
            @click="selectResult(r)"
          >
            <span class="result-type" :class="'type-' + TYPE_SCOPE_MAP[r.type]">{{ r.type }}</span>
            <span class="result-name" v-html="highlightText(r.name, r.nameMatchedIndices)"></span>
            <span class="result-extra" v-html="highlightText(r.extra, r.extraMatchedIndices)"></span>
          </div>
          <div v-if="results.length === 0 && searchQuery.trim()" class="search-empty">
            未找到匹配项
          </div>
        </template>
      </div>
    </div>
  </div>
</template>

<style scoped>
.search-overlay {
  position: fixed;
  inset: 0;
  background: rgba(2, 6, 23, 0.5);
  backdrop-filter: blur(8px);
  display: flex;
  align-items: flex-start;
  justify-content: center;
  padding-top: 100px;
  z-index: 1002;
}

.search-modal {
  background: var(--bg-panel);
  border: 1px solid var(--border);
  border-radius: var(--radius-2xl);
  width: 560px;
  max-width: calc(100vw - 28px);
  max-height: 520px;
  overflow: hidden;
  box-shadow: var(--shadow-lg);
}

.search-input {
  width: 100%;
  height: 40px;
  padding: 0 16px;
  border: none;
  border-bottom: 1px solid var(--divider);
  font-size: 14px;
  background: transparent;
  box-shadow: none;
}

.scope-tabs {
  display: flex;
  gap: 2px;
  padding: 6px 12px;
  border-bottom: 1px solid var(--divider);
}

.scope-tab {
  padding: 3px 10px;
  border: 1px solid var(--border);
  border-radius: 999px;
  background: var(--bg-panel);
  color: var(--text-secondary);
  cursor: pointer;
  font-size: var(--font-size-small);
  font-weight: 600;
  transition: all 0.15s;
}

.scope-tab:hover {
  background: var(--bg-hover);
}

.scope-tab.active {
  background: var(--primary-soft);
  color: var(--primary);
  border-color: var(--primary);
}

.search-results {
  overflow-y: auto;
  max-height: 420px;
}

.search-result {
  display: flex;
  align-items: center;
  gap: 8px;
  padding: 8px 16px;
  cursor: pointer;
  border-left: 3px solid transparent;
  transition: background 0.15s ease, border-color 0.15s ease;
}

.search-result:hover,
.search-result.selected {
  background: var(--bg-hover);
  border-left-color: var(--primary);
}

.result-type {
  font-size: var(--font-size-small);
  min-width: 40px;
  font-weight: 600;
  padding: 1px 6px;
  border-radius: 4px;
  flex-shrink: 0;
}

.result-type.type-interface {
  color: var(--primary);
  background: var(--primary-soft);
}

.result-type.type-variable {
  color: var(--warning);
  background: color-mix(in srgb, var(--warning) 12%, var(--bg-panel));
}

.result-type.type-history {
  color: var(--info);
  background: color-mix(in srgb, var(--info) 10%, var(--bg-panel));
}

.result-name {
  flex: 1;
  font-size: var(--font-size-body);
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
}

.result-extra {
  font-size: var(--font-size-small);
  color: var(--text-tertiary);
  max-width: 180px;
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
}

.search-empty {
  padding: 20px;
  text-align: center;
  color: var(--text-tertiary);
}

/* Recent searches */
.recent-header {
  display: flex;
  align-items: center;
  justify-content: space-between;
  padding: 8px 16px 4px;
}

.recent-label {
  font-size: var(--font-size-small);
  font-weight: 600;
  color: var(--text-tertiary);
  text-transform: uppercase;
  letter-spacing: 0.5px;
}

.recent-clear {
  border: none;
  background: none;
  color: var(--text-tertiary);
  cursor: pointer;
  font-size: var(--font-size-small);
  padding: 2px 6px;
  border-radius: var(--radius-sm);
}

.recent-clear:hover {
  color: var(--primary);
  background: var(--bg-hover);
}

.recent-item {
  gap: 6px;
}

.recent-icon {
  font-size: 12px;
  flex-shrink: 0;
  opacity: 0.5;
}

/* Highlight */
:deep(.search-highlight) {
  background: color-mix(in srgb, var(--primary) 25%, transparent);
  color: var(--primary);
  border-radius: 2px;
  padding: 0 1px;
  font-weight: 600;
}
</style>
