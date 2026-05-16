<script setup lang="ts">
import { ref, computed, onMounted, onUnmounted } from 'vue'
import { useAppStore } from '@/stores/app'
import { useWorkspaceStore } from '@/stores/workspace'

const store = useAppStore()
const workspace = useWorkspaceStore()
const showSearch = ref(false)
const searchQuery = ref('')

const results = computed(() => {
  if (!searchQuery.value.trim()) return []
  const q = searchQuery.value.toLowerCase()
  const items: Array<{ type: string; name: string; id: string; extra: string }> = []

  const indexedApiIds = new Set<string>()

  // Search planned interfaces first so results can show category/module context.
  for (const interfaceNode of workspace.interfaces) {
    const api = store.apis[interfaceNode.apiId]
    const module = workspace.modules.find(item => item.id === interfaceNode.moduleId)
    const category = module ? workspace.categories.find(item => item.id === module.categoryId) : null
    const name = api?.name ?? interfaceNode.name
    const url = api?.url ?? interfaceNode.url
    const method = api?.method ?? interfaceNode.method
    const path = [category?.name, module?.name].filter(Boolean).join(' / ')
    indexedApiIds.add(interfaceNode.apiId)

    if (
      name.toLowerCase().includes(q) ||
      url.toLowerCase().includes(q) ||
      method.toLowerCase().includes(q) ||
      path.toLowerCase().includes(q)
    ) {
      items.push({
        type: '接口',
        name,
        id: interfaceNode.apiId,
        extra: `${path ? `${path} · ` : ''}${method} ${url}`,
      })
    }
  }

  // Fallback for legacy APIs that have not been indexed yet.
  for (const [id, api] of Object.entries(store.apis)) {
    if (indexedApiIds.has(id)) continue
    if (api.name.toLowerCase().includes(q) || api.url.toLowerCase().includes(q) || api.method.toLowerCase().includes(q)) {
      items.push({ type: '接口', name: api.name, id, extra: `${api.method} ${api.url}` })
    }
  }

  // Search environment variables
  for (const env of store.environments) {
    for (const v of env.variables) {
      if (v.key.toLowerCase().includes(q) || v.value.toLowerCase().includes(q)) {
        items.push({ type: '变量', name: `${env.name}.${v.key}`, id: env.id, extra: v.value })
      }
    }
  }

  // Search history
  for (const h of store.history) {
    if (h.url.toLowerCase().includes(q)) {
      items.push({ type: '历史', name: `${h.method} ${h.url}`, id: h.apiId, extra: `${h.status} ${h.duration}ms` })
    }
  }

  return items.slice(0, 20)
})

function openSearch() {
  showSearch.value = true
  searchQuery.value = ''
}

function closeSearch() {
  showSearch.value = false
}

function selectResult(result: typeof results.value[0]) {
  if (result.type === '接口') {
    const interfaceNode = workspace.interfaces.find(item => item.apiId === result.id)
    workspace.selectInterface(interfaceNode?.id ?? result.id)
    store.currentApiId = result.id
  }
  closeSearch()
}

function handleKeydown(e: KeyboardEvent) {
  if (e.key === 'k' && (e.ctrlKey || e.metaKey)) {
    e.preventDefault()
    openSearch()
  }
  if (e.key === 'Escape' && showSearch.value) {
    closeSearch()
  }
}

onMounted(() => window.addEventListener('keydown', handleKeydown))
onUnmounted(() => window.removeEventListener('keydown', handleKeydown))
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
      />
      <div class="search-results">
        <div v-for="r in results" :key="r.id + r.name" class="search-result" @click="selectResult(r)">
          <span class="result-type">{{ r.type }}</span>
          <span class="result-name">{{ r.name }}</span>
          <span class="result-extra">{{ r.extra }}</span>
        </div>
        <div v-if="results.length === 0 && searchQuery.trim()" class="search-empty">
          未找到匹配项
        </div>
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
  width: 500px;
  max-width: calc(100vw - 28px);
  max-height: 400px;
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

.search-results {
  overflow-y: auto;
  max-height: 350px;
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

.search-result:hover {
  background: var(--bg-hover);
  border-left-color: var(--primary);
}

.result-type {
  font-size: var(--font-size-small);
  color: var(--primary);
  min-width: 40px;
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
  max-width: 150px;
  overflow: hidden;
  text-overflow: ellipsis;
}

.search-empty {
  padding: 20px;
  text-align: center;
  color: var(--text-tertiary);
}
</style>
