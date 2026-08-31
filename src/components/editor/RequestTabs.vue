<script setup lang="ts">
import { computed } from 'vue'
import { Ellipsis, Folder, FolderTree, Plus, X } from '@lucide/vue'
import { Tippy } from 'vue-tippy'
import { useAppStore } from '@/stores/app'
import { propertyTabKey } from '@/stores/app'
import { useWorkspaceStore } from '@/stores/workspace'

/**
 * 请求多标签栏(Postman 式):
 * - 点击切换、中键/× 关闭;圆点 = 未保存(未进集合树,或编辑后未 Cmd+S)
 * - 关闭有未保存修改的标签会先弹确认(保存并关闭 / 不保存 / 取消)
 * - 「+」直接开新标签(不先弹命名框),首次保存时才命名 + 选落点
 * - 「…」菜单:关闭其他 / 关闭右侧 / 全部关闭
 */
const store = useAppStore()
const workspace = useWorkspaceStore()

interface TabItem {
  key: string
  id: string
  name: string
  method: string
  kind: 'request' | 'collection' | 'folder'
  /** 未保存进集合树(新建请求) */
  unsaved: boolean
  /** 有未保存修改(编辑后未 Cmd+S) */
  dirty: boolean
}

const requestTabs = computed<TabItem[]>(() => store.openTabs
  .map(id => store.apis[id])
  .filter((api): api is NonNullable<typeof api> => Boolean(api))
  .map(api => ({
    key: `api:${api.id}`,
    id: api.id,
    name: api.name,
    method: api.method,
    kind: 'request' as const,
    unsaved: store.isApiUnsaved(api.id),
    dirty: store.isApiDirty(api.id),
  })))

const propertyTabs = computed<TabItem[]>(() => store.openPropertyTabs.map(target => {
  const source = target.type === 'collection'
    ? workspace.collections.find(item => item.id === target.id)
    : workspace.interfaces.find(item => item.id === target.id)
  const key = propertyTabKey(target)
  return {
    key: `properties:${key}`,
    id: key,
    name: source?.name ?? (target.type === 'collection' ? '集合' : '分组'),
    method: '',
    kind: target.type,
    unsaved: false,
    dirty: Boolean(store.propertyTabDirty[key]),
  }
}))

const tabs = computed(() => [...requestTabs.value, ...propertyTabs.value])
const activeKey = computed(() => store.activePropertyTabKey
  ? `properties:${store.activePropertyTabKey}`
  : store.currentApiId ? `api:${store.currentApiId}` : null)

function methodColor(method: string): string {
  const colors: Record<string, string> = {
    GET: 'var(--method-get-color)',
    POST: 'var(--method-post-color)',
    PUT: 'var(--method-put-color)',
    DELETE: 'var(--method-delete-color)',
    PATCH: 'var(--method-patch-color)',
    HEAD: 'var(--method-head-color)',
    OPTIONS: 'var(--method-options-color)',
  }
  return colors[method?.toUpperCase()] || 'var(--method-default-color)'
}

function closeIfMiddleButton(event: MouseEvent, key: string) {
  if (event.button !== 1) return
  event.preventDefault()
  void store.closeEditorTab(key)
}
</script>

<template>
  <div class="request-tabs">
    <div class="tabs-scroll">
      <div
        v-for="tab in tabs"
        :key="tab.key"
        class="request-tab"
        :class="{ active: tab.key === activeKey }"
        :title="`${tab.kind === 'request' ? tab.method : tab.kind === 'collection' ? '集合属性' : '分组属性'} ${tab.name}${tab.unsaved ? '(未保存)' : tab.dirty ? '(未保存修改)' : ''}`"
        @click="tab.kind === 'request' ? store.activateTab(tab.id) : store.activatePropertyTab(tab.id)"
        @auxclick="closeIfMiddleButton($event, tab.key)"
      >
        <span v-if="tab.kind === 'request'" class="tab-method" :style="{ color: methodColor(tab.method) }">{{ tab.method }}</span>
        <FolderTree v-else-if="tab.kind === 'collection'" :size="12" class="tab-kind-icon" />
        <Folder v-else :size="12" class="tab-kind-icon" />
        <span class="tab-name">{{ tab.name }}</span>
        <!-- 未保存/有未保存修改:显示待保存圆点,悬停时换回关闭按钮 -->
        <span
          v-if="tab.unsaved || tab.dirty"
          class="tab-unsaved-dot"
          :title="tab.unsaved ? '未保存到集合树(Cmd+S 保存)' : '有未保存的修改(Cmd+S 保存)'"
        ></span>
        <button class="tab-close" :title="tab.unsaved || tab.dirty ? '关闭(将确认未保存修改)' : '关闭'" @click.stop="store.closeEditorTab(tab.key)">
          <X :size="12" />
        </button>
      </div>

      <button class="new-tab-btn" title="新建请求标签" data-testid="new-request-tab" @click="store.newRequestTab()">
        <Plus :size="14" />
      </button>
    </div>

    <Tippy interactive trigger="click" theme="popover" placement="bottom-end" :offset="[0, 4]">
      <button class="tabs-menu-btn" title="标签操作"><Ellipsis :size="15" /></button>
      <template #content>
        <div class="flex w-40 flex-col">
          <button class="menu-item" :disabled="tabs.length <= 1 || !activeKey" @click="activeKey && store.closeOtherEditorTabs(activeKey)">关闭其他标签</button>
          <button class="menu-item" :disabled="tabs.length <= 1 || !activeKey" @click="activeKey && store.closeEditorTabsToTheRight(activeKey)">关闭右侧标签</button>
          <button class="menu-item" :disabled="!tabs.length" @click="store.closeAllEditorTabs()">关闭全部标签</button>
        </div>
      </template>
    </Tippy>
  </div>
</template>

<style scoped>
.request-tabs {
  display: flex;
  align-items: stretch;
  flex-shrink: 0;
  height: 34px;
  border-bottom: 1px solid var(--divider-color);
  background: var(--primary-light-color);
}

.tabs-scroll {
  display: flex;
  align-items: stretch;
  flex: 1;
  min-width: 0;
  overflow-x: auto;
  scrollbar-width: thin;
}

.request-tab {
  display: flex;
  align-items: center;
  gap: 6px;
  flex-shrink: 0;
  max-width: 190px;
  min-width: 110px;
  padding: 0 10px;
  border-right: 1px solid var(--divider-color);
  border-top: 2px solid transparent;
  background: transparent;
  color: var(--secondary-color);
  font-size: var(--font-size-tiny);
  cursor: pointer;
  user-select: none;
  transition: background 0.12s ease, color 0.12s ease;
}

.request-tab:hover {
  background: var(--primary-dark-color);
  color: var(--secondary-dark-color);
}

.request-tab.active {
  background: var(--primary-color);
  border-top-color: var(--accent-color);
  color: var(--secondary-dark-color);
}

.tab-method {
  flex-shrink: 0;
  font-family: var(--font-code);
  font-weight: 700;
  font-size: 10px;
  letter-spacing: 0.02em;
}

.tab-kind-icon {
  flex-shrink: 0;
  color: var(--accent-color);
}

.tab-name {
  flex: 1;
  min-width: 0;
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
}

.tab-unsaved-dot {
  flex-shrink: 0;
  width: 7px;
  height: 7px;
  border-radius: 50%;
  background: var(--accent-color);
}

.request-tab .tab-unsaved-dot {
  display: block;
}

.request-tab:hover .tab-unsaved-dot {
  display: none;
}

.tab-close {
  display: none;
  flex-shrink: 0;
  align-items: center;
  justify-content: center;
  width: 18px;
  height: 18px;
  border-radius: var(--radius-sm);
  color: var(--secondary-color);
}

.request-tab:hover .tab-close {
  display: inline-flex;
}

.tab-close:hover {
  background: var(--divider-dark-color);
  color: var(--secondary-dark-color);
}

.new-tab-btn,
.tabs-menu-btn {
  display: inline-flex;
  align-items: center;
  justify-content: center;
  flex-shrink: 0;
  width: 30px;
  margin: 3px 2px;
  border-radius: var(--radius-sm);
  color: var(--secondary-color);
}

.new-tab-btn:hover,
.tabs-menu-btn:hover {
  background: var(--primary-dark-color);
  color: var(--secondary-dark-color);
}

.menu-item {
  display: flex;
  align-items: center;
  gap: 8px;
  width: 100%;
  padding: 7px 12px;
  border-radius: var(--radius-sm);
  font-size: var(--font-size-body);
  color: var(--secondary-dark-color);
  text-align: left;
}

.menu-item:hover:not(:disabled) {
  background: var(--primary-dark-color);
}

.menu-item:disabled {
  opacity: 0.45;
  cursor: not-allowed;
}
</style>
