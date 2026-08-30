<script setup lang="ts">
import { computed, onMounted, onUnmounted, ref, watch } from 'vue'
import { Clock3, FolderTree, Layers, Plus, Search } from '@lucide/vue'
import { useAppStore } from '@/stores/app'
import CollectionsTree from './CollectionsTree.vue'
import CollectionSettingsModal from './CollectionSettingsModal.vue'
import EnvPanel from '@/components/common/EnvPanel.vue'
import HistoryPanel from '@/components/common/HistoryPanel.vue'
import { useDialog } from '@/composables/useDialog'
import { useWorkspaceStore } from '@/stores/workspace'

type SidebarTab = 'collections' | 'environments' | 'history'

const TAB_STORAGE_KEY = 'postino_sidebar_tab'

const store = useAppStore()
const workspace = useWorkspaceStore()
const dialog = useDialog()

const activeTab = ref<SidebarTab>((localStorage.getItem(TAB_STORAGE_KEY) as SidebarTab) || 'collections')
const collectionsFilter = ref('')
const propertiesTarget = ref<{ type: 'collection' | 'folder'; id: string } | null>(null)

watch(activeTab, (tab) => {
  try { localStorage.setItem(TAB_STORAGE_KEY, tab) } catch { /* 忽略 */ }
})

/** Alt+E / Alt+H 跳转(FR-8.1):切换侧栏 tab */
function onGotoSidebarTab(event: Event) {
  const tab = (event as CustomEvent<{ tab?: 'collections' | 'environments' | 'history' }>).detail?.tab
  if (tab && tabs.some(item => item.key === tab)) activeTab.value = tab
}

onMounted(() => window.addEventListener('postino:goto-sidebar-tab', onGotoSidebarTab))
onUnmounted(() => window.removeEventListener('postino:goto-sidebar-tab', onGotoSidebarTab))

const tabs: Array<{ key: SidebarTab; label: string; icon: unknown }> = [
  { key: 'collections', label: '集合', icon: FolderTree },
  { key: 'environments', label: '环境', icon: Layers },
  { key: 'history', label: '历史', icon: Clock3 },
]

const environmentCount = computed(() => store.environments.length)
const historyCount = computed(() => store.history.length)

async function createCollection() {
  const name = await dialog.prompt({ title: '新建集合', message: '集合用于组织接口、环境与脚本,是顶层组织单元。', placeholder: '例如:用户中心', confirmText: '创建' })
  if (!name?.trim()) return
  let categoryId = workspace.categories[0]?.id
  if (!categoryId) categoryId = (await workspace.ensureDefaultCategory()).id
  const module = await workspace.addModule(categoryId, name.trim())
  workspace.selectModule(module.id)
  store.currentApiId = null
  store.response = null
}
</script>

<template>
  <aside class="sidebar" :aria-label="'侧栏'">
    <div class="sidebar-tabs" role="tablist">
      <button
        v-for="tab in tabs"
        :key="tab.key"
        class="sidebar-tab"
        :class="{ active: activeTab === tab.key }"
        role="tab"
        :aria-selected="activeTab === tab.key"
        @click="activeTab = tab.key"
      >
        <component :is="tab.icon" :size="13" />
        {{ tab.label }}
      </button>
    </div>

    <!-- 集合 tab:过滤框 + 树(FR-2.1) -->
    <template v-if="activeTab === 'collections'">
      <div class="sidebar-toolbar">
        <div class="filter-box">
          <Search :size="13" />
          <input v-model="collectionsFilter" type="text" placeholder="过滤集合、请求、URL…" spellcheck="false" />
        </div>
        <button class="new-collection-btn" title="新建集合" @click="createCollection">
          <Plus :size="15" />
        </button>
      </div>
      <CollectionsTree :filter="collectionsFilter" @open-properties="propertiesTarget = $event" />
    </template>

    <!-- 环境 tab(M3 重做编辑弹窗,此为容器) -->
    <template v-else-if="activeTab === 'environments'">
      <EnvPanel class="sidebar-panel" />
    </template>

    <!-- 历史 tab(M3 重做分组/筛选,此为容器) -->
    <template v-else>
      <HistoryPanel class="sidebar-panel" />
    </template>

    <CollectionSettingsModal
      v-if="propertiesTarget"
      :target="propertiesTarget"
      @close="propertiesTarget = null"
    />

    <div class="sidebar-footer-hint">
      {{ activeTab === 'collections' ? `${workspace.collections.length} 集合` : activeTab === 'environments' ? `${environmentCount} 环境` : `${historyCount} 条记录` }}
    </div>
  </aside>
</template>

<style scoped>
.sidebar {
  height: 100%;
  display: flex;
  flex-direction: column;
  overflow: hidden;
  background: var(--primary-color);
}

.sidebar-tabs {
  display: flex;
  align-items: center;
  gap: 2px;
  padding: 6px 8px 0;
  border-bottom: 1px solid var(--divider-color);
  flex-shrink: 0;
}

.sidebar-tab {
  display: inline-flex;
  align-items: center;
  gap: 4px;
  padding: 7px 9px;
  border: none;
  border-bottom: 2px solid transparent;
  background: transparent;
  color: var(--secondary-color);
  font-size: var(--font-size-body);
  transition: color 0.12s ease, border-color 0.12s ease;
}

.sidebar-tab:hover {
  color: var(--secondary-dark-color);
}

.sidebar-tab.active {
  color: var(--accent-color);
  border-bottom-color: var(--accent-color);
}

.sidebar-toolbar {
  display: flex;
  align-items: center;
  gap: 6px;
  padding: 8px 8px 4px;
  flex-shrink: 0;
}

.filter-box {
  display: flex;
  align-items: center;
  gap: 6px;
  flex: 1;
  min-width: 0;
  height: 28px;
  padding: 0 8px;
  border: 1px solid var(--divider-dark-color);
  border-radius: var(--radius-md);
  background: var(--primary-light-color);
  color: var(--secondary-light-color);
}

.filter-box:focus-within {
  border-color: var(--accent-color);
}

.filter-box input {
  flex: 1;
  min-width: 0;
  border: none;
  background: transparent;
  color: var(--secondary-dark-color);
  font-size: var(--font-size-body);
  outline: none;
}

.filter-box input::placeholder {
  color: var(--secondary-light-color);
}

.new-collection-btn {
  display: inline-flex;
  align-items: center;
  justify-content: center;
  width: 28px;
  height: 28px;
  border-radius: var(--radius-md);
  border: 1px solid var(--divider-dark-color);
  background: var(--primary-light-color);
  color: var(--secondary-color);
  flex-shrink: 0;
}

.new-collection-btn:hover {
  color: var(--accent-color);
  border-color: var(--accent-color);
}

.sidebar-panel {
  flex: 1;
  min-height: 0;
}

.sidebar-footer-hint {
  padding: 6px 12px;
  border-top: 1px solid var(--divider-color);
  color: var(--secondary-light-color);
  font-size: var(--font-size-tiny);
  flex-shrink: 0;
}
</style>
