<script setup lang="ts">
import { ref, computed, watch, reactive } from 'vue'
import JsonTreeNode from './JsonTreeNode.vue'

const props = withDefaults(defineProps<{
  data: unknown
  maxDepth?: number
  searchQuery?: string
  rootName?: string
}>(), {
  maxDepth: 10,
  searchQuery: '',
  rootName: 'response',
})

const expandedPaths = reactive(new Set<string>())

function buildPath(parentPath: string, key: string, isIndex: boolean): string {
  if (isIndex) return `${parentPath}[${key}]`
  if (parentPath) return `${parentPath}.${key}`
  return key
}

function matchesSearch(val: unknown, key: string, query: string): boolean {
  if (!query) return false
  const q = query.toLowerCase()
  if (key.toLowerCase().includes(q)) return true
  if (typeof val === 'string' && val.toLowerCase().includes(q)) return true
  if (typeof val === 'number' || typeof val === 'boolean') return String(val).toLowerCase().includes(q)
  return false
}

function hasDescendantMatch(val: unknown, query: string): boolean {
  if (!query) return false
  if (val === null || val === undefined || typeof val !== 'object') return false
  const entries = Array.isArray(val)
    ? (val as unknown[]).map((v, i) => [String(i), v] as [string, unknown])
    : Object.entries(val as Record<string, unknown>)
  for (const [k, v] of entries) {
    if (matchesSearch(v, k, query)) return true
    if (hasDescendantMatch(v, query)) return true
  }
  return false
}

function toggleNode(path: string) {
  if (expandedPaths.has(path)) {
    expandedPaths.delete(path)
  } else {
    expandedPaths.add(path)
  }
}

function collapseAll() {
  expandedPaths.clear()
}

function expandAll() {
  function addAllPaths(data: unknown, key: string, depth: number, parentPath: string) {
    if (data === null || data === undefined || typeof data !== 'object') return
    const isRoot = depth === 0
    const path = isRoot ? props.rootName : buildPath(parentPath, key, /^\d+$/.test(key))
    expandedPaths.add(path)
    const entries = Array.isArray(data)
      ? (data as unknown[]).map((v, i) => [String(i), v] as [string, unknown])
      : Object.entries(data as Record<string, unknown>)
    for (const [childKey, childVal] of entries) {
      addAllPaths(childVal, childKey, depth + 1, path)
    }
  }
  addAllPaths(props.data, '', 0, '')
}

watch(() => props.searchQuery, () => {
  if (props.searchQuery) {
    expandMatchingPaths(props.data, '', 0, '')
  }
})

function expandMatchingPaths(data: unknown, key: string, depth: number, parentPath: string): boolean {
  if (data === null || data === undefined || typeof data !== 'object') {
    return matchesSearch(data, key, props.searchQuery)
  }
  const isRoot = depth === 0
  const path = isRoot ? props.rootName : buildPath(parentPath, key, /^\d+$/.test(key))
  let anyMatch = false
  const entries = Array.isArray(data)
    ? (data as unknown[]).map((v, i) => [String(i), v] as [string, unknown])
    : Object.entries(data as Record<string, unknown>)
  for (const [childKey, childVal] of entries) {
    if (expandMatchingPaths(childVal, childKey, depth + 1, path)) {
      anyMatch = true
    }
  }
  if (anyMatch) expandedPaths.add(path)
  if (matchesSearch(data, key, props.searchQuery)) anyMatch = true
  return anyMatch
}

const contextMenu = reactive({
  visible: false,
  x: 0,
  y: 0,
  value: '',
  path: '',
})

function onContextMenu(e: MouseEvent, value: unknown, path: string) {
  e.preventDefault()
  contextMenu.visible = true
  contextMenu.x = e.clientX
  contextMenu.y = e.clientY
  contextMenu.value = typeof value === 'object' && value !== null
    ? JSON.stringify(value, null, 2)
    : String(value)
  contextMenu.path = path
  document.addEventListener('click', closeContextMenu, { once: true })
}

function closeContextMenu() {
  contextMenu.visible = false
}

async function copyValue() {
  try { await navigator.clipboard.writeText(contextMenu.value) } catch { /* */ }
  closeContextMenu()
}

async function copyPath() {
  try { await navigator.clipboard.writeText(contextMenu.path) } catch { /* */ }
  closeContextMenu()
}

const parsedData = computed(() => {
  try {
    if (typeof props.data === 'string') {
      return JSON.parse(props.data)
    }
    return props.data
  } catch {
    return props.data
  }
})
</script>

<template>
  <div class="json-tree-viewer">
    <div class="tree-toolbar">
      <button class="tree-action-btn" @click="expandAll">Expand All</button>
      <button class="tree-action-btn" @click="collapseAll">Collapse All</button>
    </div>
    <div class="tree-content">
      <JsonTreeNode
        :data="parsedData"
        :key-name="rootName"
        :depth="0"
        :is-root="true"
        :path="rootName"
        :search-query="searchQuery"
        :is-index="false"
        :max-depth="maxDepth"
        :expanded-paths="expandedPaths"
        @toggle="toggleNode"
        @context-menu="onContextMenu"
      />
    </div>
    <Teleport to="body">
      <div
        v-if="contextMenu.visible"
        class="context-menu"
        :style="{ left: contextMenu.x + 'px', top: contextMenu.y + 'px' }"
      >
        <button class="context-menu-item" @click="copyValue">Copy Value</button>
        <button class="context-menu-item" @click="copyPath">Copy Path</button>
      </div>
    </Teleport>
  </div>
</template>

<style scoped>
.json-tree-viewer {
  display: flex;
  flex-direction: column;
  height: 100%;
  font-family: var(--font-code);
  font-size: var(--font-size-code);
}

.tree-toolbar {
  display: flex;
  gap: 4px;
  padding: 4px 8px;
  border-bottom: 1px solid var(--divider);
  flex-shrink: 0;
}

.tree-action-btn {
  padding: 4px 10px;
  border: 1px solid var(--border);
  background: var(--bg-panel);
  color: var(--text-secondary);
  cursor: pointer;
  font-size: var(--font-size-small);
  border-radius: 999px;
  font-weight: 700;
  font-family: var(--font-ui);
}

.tree-action-btn:hover {
  background: var(--bg-hover);
  color: var(--text-primary);
}

.tree-content {
  flex: 1;
  overflow: auto;
  padding: 4px 0;
}

.context-menu {
  position: fixed;
  z-index: 10000;
  background: var(--bg-panel);
  border: 1px solid var(--border);
  border-radius: var(--radius-lg);
  box-shadow: var(--shadow-lg);
  padding: 4px 0;
  min-width: 140px;
  overflow: hidden;
}

.context-menu-item {
  display: block;
  width: 100%;
  padding: 6px 12px;
  background: transparent;
  color: var(--text-primary);
  font-size: var(--font-size-small);
  font-family: var(--font-ui);
  cursor: pointer;
  text-align: left;
}

.context-menu-item:hover {
  background: var(--bg-hover);
}
</style>
