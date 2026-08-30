<script setup lang="ts">
import { computed, nextTick, ref, watch, onMounted, onUnmounted } from 'vue'
import { useRouter } from 'vue-router'
import { Clock3, CornerDownLeft, FolderTree, Layers, Moon, Plus, Search, Settings } from '@lucide/vue'
import { useAppStore } from '@/stores/app'
import { useWorkspaceStore } from '@/stores/workspace'
import { createNewRequestAction, cycleThemeAction } from '@/utils/request-actions'

/**
 * Spotlight(FR-7.1,参考 Hoppscotch app/spotlight/index.vue):
 * Ctrl/⌘+K 呼出,大输入框 + 分组结果(导航/集合与请求/环境变量/历史/设置项),
 * ↑↓ 选择、↩ 确认、ESC 关闭;选中请求 = 打开并展开祖先。
 */
const store = useAppStore()
const workspace = useWorkspaceStore()
const router = useRouter()

const showSearch = ref(false)
const searchQuery = ref('')
const selectedIndex = ref(0)
const inputRef = ref<HTMLInputElement | null>(null)
const listRef = ref<HTMLElement | null>(null)

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

// --- Fuzzy matching ---
interface FuzzyResult {
  score: number
  matchedIndices: number[]
}

function fuzzyMatch(query: string, target: string): FuzzyResult | null {
  if (!query) return { score: 0, matchedIndices: [] }
  const q = query.toLowerCase()
  const t = target.toLowerCase()

  const subIdx = t.indexOf(q)
  if (subIdx !== -1) {
    const indices = Array.from({ length: q.length }, (_, i) => subIdx + i)
    let score = 100
    if (subIdx === 0 || /[\s\-_./]/.test(t[subIdx - 1])) score += 20
    score += Math.max(0, 30 - (t.length - q.length))
    return { score, matchedIndices: indices }
  }

  const matchedIndices: number[] = []
  let qi = 0
  for (let ti = 0; ti < t.length && qi < q.length; ti++) {
    if (t[ti] === q[qi]) {
      matchedIndices.push(ti)
      qi++
    }
  }

  if (qi < q.length) return null

  let score = 50
  let consecutive = 0
  for (let i = 1; i < matchedIndices.length; i++) {
    if (matchedIndices[i] === matchedIndices[i - 1] + 1) {
      consecutive++
      score += 5
    }
  }
  if (consecutive >= 3) score += 15

  for (const idx of matchedIndices) {
    if (idx === 0 || /[\s\-_./]/.test(t[idx - 1])) {
      score += 8
    }
    if (idx > 0 && /[a-z]/.test(t[idx - 1]) && /[A-Z]/.test(t[idx])) {
      score += 6
    }
  }

  const coverage = q.length / t.length
  score += Math.round(coverage * 20)

  return { score, matchedIndices }
}

// --- 结果类型 ---
interface SearchResult {
  type: '接口' | '文件夹' | '环境变量' | '集合变量' | '请求变量' | '历史' | '导航' | '设置项'
  name: string
  id: string
  extra: string
  score: number
  nameMatchedIndices: number[]
  extraMatchedIndices: number[]
  icon?: 'request' | 'folder' | 'variable' | 'history' | 'nav' | 'settings'
  run?: () => void
}

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
  const collapsedKeys = new Set(chain.map(id => `collapsed:node:${id}`))
  if (store.expandedFolders.some(key => collapsedKeys.has(key))) {
    store.expandedFolders = store.expandedFolders.filter(key => !collapsedKeys.has(key))
  }
  const collapsedCollectionKey = `collapsed:module:${collectionId}`
  if (store.expandedFolders.includes(collapsedCollectionKey)) {
    store.expandedFolders = store.expandedFolders.filter(key => key !== collapsedCollectionKey)
  }
}

// --- 导航 / 设置项条目 ---
const navEntries: Array<{ keywords: string; label: string; icon: SearchResult['icon']; run: () => void }> = [
  { keywords: '新建请求 new request', label: '新建请求', icon: 'nav', run: () => void createNewRequestAction() },
  { keywords: '设置 settings preferences', label: '打开设置页', icon: 'settings', run: () => void router.push('/settings') },
  { keywords: '主题 theme 亮色 暗色 纯黑', label: '切换主题', icon: 'nav', run: () => cycleThemeAction() },
  { keywords: '快捷键 shortcuts 键盘', label: '快捷键总览', icon: 'nav', run: () => window.dispatchEvent(new CustomEvent('apifix:show-shortcuts')) },
]

const settingEntries: Array<{ keywords: string; label: string; section: string }> = [
  { keywords: '外观 主题 accent 强调色 theme', label: '外观:主题四档与强调色', section: '外观' },
  { keywords: '通用 语言 导航 侧栏 分栏 general', label: '通用:语言 / 展开导航 / 分栏', section: '通用' },
  { keywords: '网络 cors 代理 发送通道 network proxy', label: '网络:发送通道与代理', section: '网络' },
  { keywords: '快捷键 重绑 keybinding shortcuts', label: '快捷键:查看与重绑', section: '快捷键' },
  { keywords: '数据 备份 恢复 导入 导出 迁移 清空 data', label: '数据:备份 / 导入导出 / 迁移', section: '数据' },
]

const results = computed<SearchResult[]>(() => {
  const q = searchQuery.value.trim()
  if (!q) return []

  const items: SearchResult[] = []

  // 导航
  for (const entry of navEntries) {
    const match = fuzzyMatch(q, entry.keywords) ?? fuzzyMatch(q, entry.label)
    if (match) {
      items.push({
        type: '导航', name: entry.label, id: `nav:${entry.label}`, extra: '', score: match.score + 10,
        nameMatchedIndices: fuzzyMatch(q, entry.label)?.matchedIndices ?? [], extraMatchedIndices: [],
        icon: entry.icon, run: entry.run,
      })
    }
  }

  const indexedApiIds = new Set<string>()

  // 集合与请求
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

    const bestMatch = [fuzzyMatch(q, name), fuzzyMatch(q, url), fuzzyMatch(q, method), fuzzyMatch(q, path)]
      .reduce<FuzzyResult | null>((best, cur) => (!cur ? best : !best || cur.score > best.score ? cur : best), null)

    if (bestMatch) {
      const nameMatch = fuzzyMatch(q, name)
      items.push({
        type: '接口', name, id: interfaceNode.apiId, extra, score: bestMatch.score,
        nameMatchedIndices: nameMatch?.matchedIndices ?? [], extraMatchedIndices: bestMatch === nameMatch ? [] : bestMatch.matchedIndices,
        icon: 'request',
      })
    }
  }

  for (const folderNode of workspace.interfaces) {
    if ((folderNode.nodeType ?? 'request') !== 'folder') continue
    const collection = workspace.collections.find(item => item.id === (folderNode.collectionId ?? folderNode.moduleId))
    const path = [collection?.name, ...folderChainOf(folderNode)].filter(Boolean).join(' / ')
    const bestMatch = [fuzzyMatch(q, folderNode.name), fuzzyMatch(q, path)]
      .reduce<FuzzyResult | null>((best, cur) => (!cur ? best : !best || cur.score > best.score ? cur : best), null)
    if (bestMatch) {
      items.push({
        type: '文件夹', name: folderNode.name, id: folderNode.id, extra: path, score: bestMatch.score,
        nameMatchedIndices: fuzzyMatch(q, folderNode.name)?.matchedIndices ?? [], extraMatchedIndices: [], icon: 'folder',
      })
    }
  }

  for (const [id, api] of Object.entries(store.apis)) {
    if (indexedApiIds.has(id)) continue
    const bestMatch = [fuzzyMatch(q, api.name), fuzzyMatch(q, api.url), fuzzyMatch(q, api.method)]
      .reduce<FuzzyResult | null>((best, cur) => (!cur ? best : !best || cur.score > best.score ? cur : best), null)
    if (bestMatch) {
      items.push({
        type: '接口', name: api.name, id, extra: `${api.method} ${api.url}`, score: bestMatch.score,
        nameMatchedIndices: fuzzyMatch(q, api.name)?.matchedIndices ?? [], extraMatchedIndices: [], icon: 'request',
      })
    }
  }

  // 环境变量
  for (const env of store.environments) {
    for (const v of env.variables) {
      const nameStr = `${env.name}.${v.key}`
      const bestMatch = [fuzzyMatch(q, nameStr), fuzzyMatch(q, v.value)]
        .reduce<FuzzyResult | null>((best, cur) => (!cur ? best : !best || cur.score > best.score ? cur : best), null)
      if (bestMatch) {
        items.push({
          type: '环境变量', name: nameStr, id: env.id, extra: v.value, score: bestMatch.score,
          nameMatchedIndices: fuzzyMatch(q, nameStr)?.matchedIndices ?? [], extraMatchedIndices: [], icon: 'variable',
        })
      }
    }
  }

  // 集合变量
  for (const collection of workspace.collections) {
    for (const v of collection.variables ?? []) {
      if (!v.key) continue
      const nameStr = `${collection.name}.${v.key}`
      const displayValue = v.currentValue || v.initialValue || ''
      const bestMatch = [fuzzyMatch(q, nameStr), fuzzyMatch(q, String(displayValue))]
        .reduce<FuzzyResult | null>((best, cur) => (!cur ? best : !best || cur.score > best.score ? cur : best), null)
      if (bestMatch) {
        items.push({
          type: '集合变量', name: nameStr, id: collection.id, extra: String(displayValue), score: bestMatch.score,
          nameMatchedIndices: fuzzyMatch(q, nameStr)?.matchedIndices ?? [], extraMatchedIndices: [], icon: 'variable',
        })
      }
    }
  }

  // 请求变量
  for (const [apiId, api] of Object.entries(store.apis)) {
    for (const variable of api.requestVariables ?? []) {
      if (!variable.key) continue
      const nameStr = `${api.name}.${variable.key}`
      const bestMatch = [fuzzyMatch(q, nameStr), fuzzyMatch(q, String(variable.value || ''))]
        .reduce<FuzzyResult | null>((best, cur) => (!cur ? best : !best || cur.score > best.score ? cur : best), null)
      if (bestMatch) {
        items.push({
          type: '请求变量', name: nameStr, id: apiId, extra: variable.value || variable.description || '', score: bestMatch.score,
          nameMatchedIndices: fuzzyMatch(q, nameStr)?.matchedIndices ?? [], extraMatchedIndices: [], icon: 'variable',
        })
      }
    }
  }

  // 历史
  for (const h of store.history.slice(0, 100)) {
    const nameStr = `${h.method} ${h.url}`
    const bestMatch = [fuzzyMatch(q, nameStr), fuzzyMatch(q, h.url)]
      .reduce<FuzzyResult | null>((best, cur) => (!cur ? best : !best || cur.score > best.score ? cur : best), null)
    if (bestMatch) {
      items.push({
        type: '历史', name: nameStr, id: h.apiId, extra: `${h.status} ${h.duration}ms`, score: bestMatch.score,
        nameMatchedIndices: fuzzyMatch(q, nameStr)?.matchedIndices ?? [], extraMatchedIndices: [], icon: 'history',
      })
    }
  }

  // 设置项
  for (const entry of settingEntries) {
    const match = fuzzyMatch(q, entry.keywords) ?? fuzzyMatch(q, entry.label)
    if (match) {
      items.push({
        type: '设置项', name: entry.label, id: `setting:${entry.section}`, extra: entry.section, score: match.score,
        nameMatchedIndices: fuzzyMatch(q, entry.label)?.matchedIndices ?? [], extraMatchedIndices: [], icon: 'settings',
      })
    }
  }

  items.sort((a, b) => b.score - a.score)
  return items.slice(0, 50)
})

interface ResultGroup { type: SearchResult['type']; label: string; items: Array<{ result: SearchResult; index: number }> }

const groupedResults = computed<ResultGroup[]>(() => {
  const order: Array<{ type: SearchResult['type']; label: string }> = [
    { type: '导航', label: '导航' },
    { type: '接口', label: '集合与请求' },
    { type: '文件夹', label: '集合与请求' },
    { type: '环境变量', label: '环境变量' },
    { type: '集合变量', label: '环境变量' },
    { type: '请求变量', label: '环境变量' },
    { type: '历史', label: '历史' },
    { type: '设置项', label: '设置项' },
  ]
  const groups: ResultGroup[] = []
  for (const { type, label } of order) {
    const items = results.value
      .map((result, index) => ({ result, index }))
      .filter(({ result }) => result.type === type)
    if (!items.length) continue
    const existing = groups.find(g => g.label === label)
    if (existing) existing.items.push(...items)
    else groups.push({ type, label, items })
  }
  return groups
})

// --- Highlight ---
function highlightText(text: string, matchedIndices: number[]): string {
  if (!matchedIndices.length) return escapeHtml(text)
  const set = new Set(matchedIndices)
  let result = ''
  for (let i = 0; i < text.length; i++) {
    const ch = escapeHtml(text[i])
    result += set.has(i) ? `<mark>${ch}</mark>` : ch
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

// --- 打开 / 选择 ---
function openSearch() {
  showSearch.value = true
  searchQuery.value = ''
  selectedIndex.value = 0
  loadRecentSearches()
  void nextTick(() => inputRef.value?.focus())
}

function closeSearch() {
  showSearch.value = false
}

function selectResult(result: SearchResult) {
  saveRecentSearch(searchQuery.value)
  if (result.type === '接口' || result.type === '历史' || result.type === '请求变量') {
    const interfaceNode = workspace.interfaces.find(item => item.apiId === result.id)
    workspace.selectInterface(interfaceNode?.id ?? result.id)
    store.openApiInTab(result.id)
    // 打开并展开祖先
    if (interfaceNode) {
      const collapsedCollectionKey = `collapsed:module:${interfaceNode.collectionId ?? interfaceNode.moduleId}`
      const collapsedKeys = new Set<string>([collapsedCollectionKey])
      let parentId = interfaceNode.parentId ?? null
      const guard = new Set<string>()
      while (parentId && !guard.has(parentId)) {
        guard.add(parentId)
        collapsedKeys.add(`collapsed:node:${parentId}`)
        parentId = workspace.interfaces.find(item => item.id === parentId)?.parentId ?? null
      }
      if (store.expandedFolders.some(key => collapsedKeys.has(key))) {
        store.expandedFolders = store.expandedFolders.filter(key => !collapsedKeys.has(key))
      }
    }
  } else if (result.type === '文件夹') {
    revealFolder(result.id)
  } else if (result.type === '集合变量') {
    workspace.selectModule(result.id)
    store.currentApiId = null
  } else if (result.type === '导航' || result.type === '设置项') {
    result.run?.()
  }
  closeSearch()
}

function activateSelected() {
  const result = results.value[selectedIndex.value] ?? results.value[0]
  if (result) selectResult(result)
}

function moveSelection(delta: number) {
  if (results.value.length === 0) return
  selectedIndex.value = (selectedIndex.value + delta + results.value.length) % results.value.length
  void nextTick(() => {
    listRef.value?.querySelector('[data-active="true"]')?.scrollIntoView({ block: 'nearest' })
  })
}

watch(results, () => {
  selectedIndex.value = 0
})

function handleKeydown(e: KeyboardEvent) {
  if (!showSearch.value) return
  if (e.key === 'Escape') {
    e.preventDefault()
    e.stopImmediatePropagation()
    closeSearch()
  }
}

onMounted(() => {
  window.addEventListener('keydown', handleKeydown, true)
  window.addEventListener('apifix:open-spotlight', openSearch)
  window.addEventListener('apifix:open-global-search', openSearch)
  loadRecentSearches()
})
onUnmounted(() => {
  window.removeEventListener('keydown', handleKeydown, true)
  window.removeEventListener('apifix:open-spotlight', openSearch)
  window.removeEventListener('apifix:open-global-search', openSearch)
})
</script>

<template>
  <Teleport to="body">
    <div v-if="showSearch" class="spotlight-overlay" @click.self="closeSearch">
      <div class="spotlight">
        <div class="spotlight-input-wrap">
          <Search :size="16" class="spotlight-search-icon" />
          <input
            ref="inputRef"
            v-model="searchQuery"
            type="text"
            class="spotlight-input"
            placeholder="搜索请求、环境变量、历史、设置项…"
            spellcheck="false"
            @keydown.escape="closeSearch"
            @keydown.down.prevent="moveSelection(1)"
            @keydown.up.prevent="moveSelection(-1)"
            @keydown.enter.prevent="activateSelected"
          />
          <kbd class="spotlight-esc">ESC</kbd>
        </div>

        <div ref="listRef" class="spotlight-results">
          <!-- 最近搜索 -->
          <template v-if="!searchQuery.trim() && recentSearches.length">
            <div class="result-group-label">最近搜索</div>
            <button
              v-for="recent in recentSearches"
              :key="recent"
              class="result-row"
              @click="searchQuery = recent"
            >
              <Clock3 :size="14" class="result-icon" />
              <span class="result-name">{{ recent }}</span>
            </button>
          </template>

          <template v-for="group in groupedResults" :key="group.label">
            <div class="result-group-label">{{ group.label }}</div>
            <button
              v-for="{ result, index } in group.items"
              :key="`${result.type}:${result.id}:${index}`"
              class="result-row"
              :data-active="selectedIndex === index"
              :class="{ active: selectedIndex === index }"
              @click="selectResult(result)"
              @mousemove="selectedIndex = index"
            >
              <component
                :is="result.icon === 'folder' ? FolderTree : result.icon === 'variable' ? Layers : result.icon === 'history' ? Clock3 : result.icon === 'settings' ? Settings : result.icon === 'nav' ? Moon : Search"
                :size="14"
                class="result-icon"
              />
              <span class="result-name" v-html="highlightText(result.name, result.nameMatchedIndices)"></span>
              <span class="result-extra">{{ result.extra }}</span>
              <CornerDownLeft v-if="selectedIndex === index" :size="12" class="result-enter" />
            </button>
          </template>

          <div v-if="searchQuery.trim() && !results.length" class="spotlight-empty">没有匹配的结果</div>
        </div>

        <footer class="spotlight-footer">
          <span><kbd>↑</kbd><kbd>↓</kbd> 选择</span>
          <span><kbd>↩</kbd> 打开</span>
          <span><kbd>ESC</kbd> 关闭</span>
        </footer>
      </div>
    </div>
  </Teleport>
</template>

<style scoped>
.spotlight-overlay {
  position: fixed;
  inset: 0;
  z-index: 1300;
  display: flex;
  align-items: flex-start;
  justify-content: center;
  padding-top: 12vh;
  background: rgba(0, 0, 0, 0.4);
  backdrop-filter: blur(3px);
}

.spotlight {
  display: flex;
  flex-direction: column;
  width: min(620px, calc(100vw - 32px));
  max-height: 68vh;
  border: 1px solid var(--divider-dark-color);
  border-radius: var(--radius-lg);
  background: var(--popover-color);
  box-shadow: var(--shadow-lg);
  overflow: hidden;
}

.spotlight-input-wrap {
  display: flex;
  align-items: center;
  gap: 8px;
  padding: 12px 14px;
  border-bottom: 1px solid var(--divider-color);
  color: var(--secondary-light-color);
}

.spotlight-input {
  flex: 1;
  border: none;
  background: transparent;
  color: var(--secondary-dark-color);
  font-size: 15px;
  outline: none;
}

.spotlight-input::placeholder {
  color: var(--secondary-light-color);
}

.spotlight-esc {
  border: 1px solid var(--divider-dark-color);
  border-radius: 4px;
  padding: 1px 6px;
  font-size: var(--font-size-tiny);
  color: var(--secondary-light-color);
}

.spotlight-results {
  flex: 1;
  min-height: 120px;
  overflow-y: auto;
  padding: 6px;
}

.result-group-label {
  padding: 8px 8px 3px;
  color: var(--secondary-light-color);
  font-size: var(--font-size-tiny);
  font-weight: 700;
  text-transform: uppercase;
  letter-spacing: 0.04em;
}

.result-row {
  display: flex;
  align-items: center;
  gap: 8px;
  width: 100%;
  padding: 7px 8px;
  border-radius: var(--radius-sm);
  color: var(--secondary-dark-color);
  font-size: var(--font-size-body);
  text-align: left;
}

.result-row.active {
  background: color-mix(in srgb, var(--accent-color) 14%, transparent);
  color: var(--accent-color);
}

.result-icon {
  flex-shrink: 0;
  color: var(--secondary-light-color);
}

.result-row.active .result-icon {
  color: var(--accent-color);
}

.result-name {
  flex-shrink: 0;
  max-width: 55%;
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
  font-weight: 500;
}

.result-name :deep(mark) {
  background: transparent;
  color: var(--accent-color);
  font-weight: 700;
}

.result-extra {
  flex: 1;
  min-width: 0;
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
  color: var(--secondary-light-color);
  font-size: var(--font-size-tiny);
}

.result-enter {
  flex-shrink: 0;
}

.spotlight-empty {
  padding: 24px;
  text-align: center;
  color: var(--secondary-light-color);
  font-size: var(--font-size-body);
}

.spotlight-footer {
  display: flex;
  gap: 16px;
  padding: 8px 14px;
  border-top: 1px solid var(--divider-color);
  color: var(--secondary-light-color);
  font-size: var(--font-size-tiny);
}

.spotlight-footer kbd {
  border: 1px solid var(--divider-dark-color);
  border-radius: 3px;
  padding: 0 4px;
  margin-right: 3px;
  font-family: var(--font-mono);
}
</style>
