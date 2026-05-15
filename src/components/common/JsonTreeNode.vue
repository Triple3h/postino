<script setup lang="ts">
import { computed } from 'vue'

const props = defineProps<{
  data: unknown
  keyName: string
  depth: number
  isRoot: boolean
  path: string
  searchQuery: string
  isIndex: boolean
  maxDepth: number
  expandedPaths: Set<string>
}>()

const emit = defineEmits<{
  toggle: [path: string]
  'context-menu': [event: MouseEvent, value: unknown, path: string]
}>()

function getType(val: unknown): 'string' | 'number' | 'boolean' | 'null' | 'array' | 'object' | 'undefined' {
  if (val === null) return 'null'
  if (val === undefined) return 'undefined'
  if (Array.isArray(val)) return 'array'
  return typeof val as 'string' | 'number' | 'boolean' | 'object'
}

const nodeType = computed(() => getType(props.data))
const childCount = computed(() => {
  if (props.data === null || props.data === undefined) return 0
  if (Array.isArray(props.data)) return props.data.length
  if (typeof props.data === 'object') return Object.keys(props.data as Record<string, unknown>).length
  return 0
})

const expanded = computed(() => {
  if (props.expandedPaths.has(props.path)) return true
  if (props.depth < 2) return true
  if (props.searchQuery && hasDescendantMatch(props.data, props.searchQuery)) return true
  return false
})

const isContainer = computed(() => nodeType.value === 'object' || nodeType.value === 'array')

const entries = computed(() => {
  if (!isContainer.value || props.data === null || props.data === undefined) return []
  if (Array.isArray(props.data)) {
    return (props.data as unknown[]).map((v, i) => ({
      key: String(i),
      value: v,
      isIndex: true,
    }))
  }
  return Object.entries(props.data as Record<string, unknown>).map(([k, v]) => ({
    key: k,
    value: v,
    isIndex: false,
  }))
})

function buildChildPath(key: string, isIndex: boolean): string {
  if (isIndex) return `${props.path}[${key}]`
  return `${props.path}.${key}`
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
  const ents = Array.isArray(val)
    ? (val as unknown[]).map((v, i) => [String(i), v] as [string, unknown])
    : Object.entries(val as Record<string, unknown>)
  for (const [k, v] of ents) {
    if (matchesSearch(v, k, query)) return true
    if (hasDescendantMatch(v, query)) return true
  }
  return false
}

const keyMatches = computed(() => matchesSearch(props.data, props.keyName, props.searchQuery))
const valueMatches = computed(() => {
  if (!props.searchQuery) return false
  if (typeof props.data === 'string') return (props.data as string).toLowerCase().includes(props.searchQuery.toLowerCase())
  if (typeof props.data === 'number' || typeof props.data === 'boolean') return String(props.data).toLowerCase().includes(props.searchQuery.toLowerCase())
  return false
})

function formatPrimitive(): string {
  if (nodeType.value === 'string') return `"${props.data as string}"`
  if (nodeType.value === 'null') return 'null'
  if (nodeType.value === 'undefined') return 'undefined'
  return String(props.data)
}

function onToggle() {
  emit('toggle', props.path)
}

function onContextMenu(e: MouseEvent) {
  emit('context-menu', e, props.data, props.path)
}

const typeBadgeMap: Record<string, string> = {
  string: 'badge-string',
  number: 'badge-number',
  boolean: 'badge-boolean',
  null: 'badge-null',
  array: 'badge-array',
  object: 'badge-object',
  undefined: 'badge-null',
}
</script>

<template>
  <div class="tree-node">
    <div
      class="tree-row"
      :class="{ 'has-match': (keyMatches || valueMatches) && searchQuery }"
      :style="{ paddingLeft: (depth * 20 + 8) + 'px' }"
      @contextmenu="onContextMenu"
    >
      <span
        v-if="isContainer"
        class="toggle-arrow"
        :class="{ expanded }"
        @click="onToggle"
      >
        <svg width="10" height="10" viewBox="0 0 10 10">
          <path d="M3 1L7 5L3 9" fill="currentColor" />
        </svg>
      </span>
      <span v-else class="toggle-placeholder" />

      <span class="tree-key" :class="{ 'root-key': isRoot, 'search-highlight': keyMatches && searchQuery }">
        {{ keyName }}
      </span>

      <template v-if="isContainer">
        <span class="colon">: </span>
        <span :class="['type-badge', typeBadgeMap[nodeType]]">{{ nodeType }}</span>
        <span v-if="!expanded" class="summary-text">
          <template v-if="nodeType === 'array'">[{{ childCount }} items]</template>
          <template v-else>{&#8230;{{ childCount }} keys}</template>
        </span>
        <span v-else class="open-bracket">
          <template v-if="nodeType === 'array'">[</template>
          <template v-else>{</template>
        </span>
      </template>

      <template v-else>
        <span class="colon">: </span>
        <span :class="['type-badge', typeBadgeMap[nodeType]]">{{ nodeType }}</span>
        <span :class="['tree-value', `value-${nodeType}`, { 'search-highlight': valueMatches && searchQuery }]">
          {{ formatPrimitive() }}
        </span>
      </template>
    </div>

    <template v-if="isContainer && expanded">
      <JsonTreeNode
        v-for="entry in entries"
        :key="entry.key"
        :data="entry.value"
        :key-name="entry.key"
        :depth="depth + 1"
        :is-root="false"
        :path="buildChildPath(entry.key, entry.isIndex)"
        :search-query="searchQuery"
        :is-index="entry.isIndex"
        :max-depth="maxDepth"
        :expanded-paths="expandedPaths"
        @toggle="(p: string) => $emit('toggle', p)"
        @context-menu="(e: MouseEvent, v: unknown, p: string) => $emit('context-menu', e, v, p)"
      />
      <div
        class="tree-row closing-row"
        :style="{ paddingLeft: (depth * 20 + 8) + 'px' }"
      >
        <span class="toggle-placeholder" />
        <span class="closing-bracket">{{ nodeType === 'array' ? ']' : '}' }}</span>
        <span v-if="isRoot" class="closing-summary"> // {{ childCount }} {{ nodeType === 'array' ? 'items' : 'keys' }}</span>
      </div>
    </template>
  </div>
</template>

<script lang="ts">
export default { name: 'JsonTreeNode' }
</script>

<style scoped>
.tree-node {
  /* no extra styling needed, rows handle themselves */
}

.tree-row {
  display: flex;
  align-items: center;
  gap: 4px;
  padding: 1px 8px 1px 8px;
  min-height: 22px;
  line-height: 22px;
  white-space: nowrap;
  cursor: default;
}

.tree-row:hover {
  background: var(--bg-hover);
}

.tree-row.has-match {
  background: color-mix(in srgb, var(--warning) 10%, transparent);
}

.toggle-arrow {
  display: inline-flex;
  align-items: center;
  justify-content: center;
  width: 16px;
  height: 16px;
  cursor: pointer;
  color: var(--text-tertiary);
  flex-shrink: 0;
  transition: transform 0.15s ease;
  transform: rotate(0deg);
}

.toggle-arrow.expanded {
  transform: rotate(90deg);
}

.toggle-arrow:hover {
  color: var(--text-primary);
}

.toggle-placeholder {
  display: inline-block;
  width: 16px;
  flex-shrink: 0;
}

.tree-key {
  color: var(--json-key, #7c3aed);
  font-weight: 500;
  flex-shrink: 0;
}

.root-key {
  color: var(--text-secondary);
  font-weight: 600;
}

.colon {
  color: var(--text-tertiary);
  flex-shrink: 0;
}

.summary-text {
  color: var(--text-tertiary);
}

.open-bracket {
  color: var(--text-tertiary);
}

.tree-value {
  word-break: break-all;
  white-space: pre-wrap;
}

.value-string { color: var(--json-string, #16a34a); }
.value-number { color: var(--json-number, #2563eb); }
.value-boolean { color: var(--json-boolean, #ea580c); }
.value-null { color: var(--json-null, #9ca3af); font-style: italic; }
.value-undefined { color: var(--json-null, #9ca3af); font-style: italic; }

.type-badge {
  display: inline-block;
  padding: 0 4px;
  border-radius: 3px;
  font-size: 9px;
  font-weight: 600;
  text-transform: uppercase;
  letter-spacing: 0.5px;
  line-height: 16px;
  flex-shrink: 0;
}

.badge-string { background: #dcfce7; color: #15803d; }
.badge-number { background: #dbeafe; color: #1d4ed8; }
.badge-boolean { background: #ffedd5; color: #c2410c; }
.badge-null { background: #f3f4f6; color: #6b7280; }
.badge-array { background: #ede9fe; color: #6d28d9; }
.badge-object { background: #e0e7ff; color: #4338ca; }

[data-theme="dark"] .badge-string { background: #14532d; color: #86efac; }
[data-theme="dark"] .badge-number { background: #1e3a5f; color: #93c5fd; }
[data-theme="dark"] .badge-boolean { background: #431407; color: #fdba74; }
[data-theme="dark"] .badge-null { background: #374151; color: #9ca3af; }
[data-theme="dark"] .badge-array { background: #2e1065; color: #c4b5fd; }
[data-theme="dark"] .badge-object { background: #1e1b4b; color: #a5b4fc; }

.search-highlight {
  background: #fef08a;
  border-radius: 2px;
  padding: 0 1px;
}

[data-theme="dark"] .search-highlight {
  background: #854d0e;
  color: #fef08a;
}

.closing-row {
  color: var(--text-tertiary);
}

.closing-bracket {
  font-weight: 600;
  color: var(--text-tertiary);
}

.closing-summary {
  color: var(--text-tertiary);
  font-style: italic;
  font-size: 11px;
}
</style>
