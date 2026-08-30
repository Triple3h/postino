<script setup lang="ts">
import { computed } from 'vue'
import { Ellipsis, Plus, X } from '@lucide/vue'
import { Tippy } from 'vue-tippy'
import { useAppStore } from '@/stores/app'

/**
 * 请求多标签栏(Postman 式):
 * - 点击切换、中键/× 关闭;圆点 = 未保存(未进集合树,或编辑后未 Cmd+S)
 * - 关闭有未保存修改的标签会先弹确认(保存并关闭 / 不保存 / 取消)
 * - 「+」直接开新标签(不先弹命名框),首次保存时才命名 + 选落点
 * - 「…」菜单:关闭其他 / 关闭右侧 / 全部关闭
 */
const store = useAppStore()

interface TabItem {
  id: string
  name: string
  method: string
  /** 未保存进集合树(新建请求) */
  unsaved: boolean
  /** 有未保存修改(编辑后未 Cmd+S) */
  dirty: boolean
}

const tabs = computed<TabItem[]>(() => store.openTabs
  .map(id => store.apis[id])
  .filter((api): api is NonNullable<typeof api> => Boolean(api))
  .map(api => ({
    id: api.id,
    name: api.name,
    method: api.method,
    unsaved: store.isApiUnsaved(api.id),
    dirty: store.isApiDirty(api.id),
  })))

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

function closeIfMiddleButton(event: MouseEvent, apiId: string) {
  if (event.button !== 1) return
  event.preventDefault()
  store.closeTab(apiId)
}
</script>

<template>
  <div class="request-tabs">
    <div class="tabs-scroll">
      <div
        v-for="tab in tabs"
        :key="tab.id"
        class="request-tab"
        :class="{ active: tab.id === store.currentApiId }"
        :title="`${tab.method} ${tab.name}${tab.unsaved ? '(未保存)' : tab.dirty ? '(未保存修改)' : ''}`"
        @click="store.activateTab(tab.id)"
        @auxclick="closeIfMiddleButton($event, tab.id)"
      >
        <span class="tab-method" :style="{ color: methodColor(tab.method) }">{{ tab.method }}</span>
        <span class="tab-name">{{ tab.name }}</span>
        <!-- 未保存/有未保存修改:显示待保存圆点,悬停时换回关闭按钮 -->
        <span
          v-if="tab.unsaved || tab.dirty"
          class="tab-unsaved-dot"
          :title="tab.unsaved ? '未保存到集合树(Cmd+S 保存)' : '有未保存的修改(Cmd+S 保存)'"
        ></span>
        <button class="tab-close" :title="tab.unsaved || tab.dirty ? '关闭(将确认未保存修改)' : '关闭'" @click.stop="store.closeTab(tab.id)">
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
          <button class="menu-item" :disabled="tabs.length <= 1" @click="store.currentApiId && store.closeOtherTabs(store.currentApiId)">关闭其他标签</button>
          <button class="menu-item" :disabled="tabs.length <= 1" @click="store.currentApiId && store.closeTabsToTheRight(store.currentApiId)">关闭右侧标签</button>
          <button class="menu-item" :disabled="!tabs.length" @click="store.closeAllTabs()">关闭全部标签</button>
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
