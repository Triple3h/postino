<script setup lang="ts">
import { computed, ref, onMounted, onUnmounted } from 'vue'
import { Maximize2, SquareSplitHorizontal, SquareSplitVertical } from '@lucide/vue'
import PaneLayout from '@/components/shell/PaneLayout.vue'
import RequestBar from './RequestBar.vue'
import RequestTabs from './RequestTabs.vue'
import TabPanel from './TabPanel.vue'
import ResponsePanel from '@/components/response/ResponsePanel.vue'
import WsPanel from '@/components/response/WsPanel.vue'
import WorkspaceSettingsView from './WorkspaceSettingsView.vue'
import { useAppStore } from '@/stores/app'
import { isWebSocketUrl } from '@/utils/http'

const store = useAppStore()
// FR-4:请求类型自动识别 —— ws/wss scheme 即 WS 模式(双向消息面板),不再读 requestType 声明
const currentRequestType = computed(() => isWebSocketUrl(store.getCurrentApi()?.url ?? '') ? 'ws' : 'rest')
const currentApi = computed(() => store.getCurrentApi())

/** 上下分栏(默认)或左右分栏(FR-6.1 通用设置);'none' = 不分栏,编辑区占满 */
const editorLayout = computed(() => store.settings.editorLayout)
const innerOrientation = computed(() => (editorLayout.value === 'horizontal' ? 'columns' : 'rows'))

// ── 右下角布局切换入口(Apifox 式)──
const showLayoutMenu = ref(false)

function setLayout(value: 'vertical' | 'horizontal' | 'none') {
  store.settings.editorLayout = value
  showLayoutMenu.value = false
  store.saveSettings().catch(err => console.error('Failed to save layout:', err))
}

/** 点击浮钮与菜单以外区域时收起 */
function onGlobalPointerDown(event: MouseEvent) {
  if (!showLayoutMenu.value) return
  if ((event.target as HTMLElement | null)?.closest('.layout-switcher')) return
  showLayoutMenu.value = false
}

onMounted(() => document.addEventListener('click', onGlobalPointerDown, true))
onUnmounted(() => document.removeEventListener('click', onGlobalPointerDown, true))
</script>

<template>
  <div class="editor-view">
    <!-- 多标签栏常驻(Postman 式):0 标签时也保留「+」入口,集合欢迎页可点标签切回请求 -->
    <RequestTabs />
    <template v-if="currentApi">
      <!-- WS 请求(ws/wss scheme 自动识别):固定上下堆叠,无分栏概念 -->
      <div v-if="currentRequestType === 'ws'" class="editor-stack">
        <RequestBar />
        <WsPanel class="ws-panel" />
      </div>
      <template v-else>
        <PaneLayout
          v-if="editorLayout !== 'none'"
          class="editor-pane"
          layout-id="rest-primary"
          :orientation="innerOrientation"
          :default-first="52"
          :first-min="20"
          :second-min="20"
        >
          <template #first>
            <div class="editor-stack">
              <RequestBar />
              <TabPanel class="tab-panel-area" />
            </div>
          </template>
          <template #second>
            <ResponsePanel />
          </template>
        </PaneLayout>
        <!-- 不分栏:编辑区占满,响应暂不展示(右下角菜单切回) -->
        <div v-else class="editor-stack editor-pane">
          <RequestBar />
          <TabPanel class="tab-panel-area" />
        </div>

        <!-- 右下角布局切换(Apifox 式) -->
        <div class="layout-switcher">
          <button
            class="layout-btn"
            :class="{ active: showLayoutMenu }"
            title="布局切换"
            @click="showLayoutMenu = !showLayoutMenu"
          ><SquareSplitVertical :size="13" /></button>
          <div v-if="showLayoutMenu" class="layout-menu">
            <button :class="['layout-item', { active: editorLayout === 'vertical' }]" @click="setLayout('vertical')">
              <SquareSplitHorizontal :size="13" /> 上下分栏
            </button>
            <button :class="['layout-item', { active: editorLayout === 'horizontal' }]" @click="setLayout('horizontal')">
              <SquareSplitVertical :size="13" /> 左右分栏
            </button>
            <button :class="['layout-item', { active: editorLayout === 'none' }]" @click="setLayout('none')">
              <Maximize2 :size="13" /> 不分栏
            </button>
          </div>
        </div>
      </template>
    </template>
    <WorkspaceSettingsView v-else />
  </div>
</template>

<style scoped>
.editor-view {
  position: relative;
  height: 100%;
  display: flex;
  flex-direction: column;
  overflow: hidden;
  background: var(--primary-color);
}

.editor-pane {
  flex: 1;
  min-height: 0;
}

.editor-stack {
  height: 100%;
  display: flex;
  flex-direction: column;
  overflow: hidden;
}

.tab-panel-area {
  flex: 1;
  min-height: 0;
}

.ws-panel {
  flex: 1;
  min-height: 0;
}

/* 右下角布局切换(Apifox 式):浮于响应区之上,菜单向上弹出 */
.layout-switcher {
  position: absolute;
  right: 12px;
  bottom: 12px;
  z-index: 60;
}

.layout-btn {
  display: inline-flex;
  align-items: center;
  justify-content: center;
  width: 26px;
  height: 26px;
  border: 1px solid var(--divider-dark-color);
  border-radius: var(--radius-sm);
  background: color-mix(in srgb, var(--popover-color) 88%, transparent);
  color: var(--secondary-color);
  box-shadow: var(--shadow-lg);
}

.layout-btn:hover,
.layout-btn.active {
  color: var(--accent-color);
  border-color: var(--accent-color);
}

.layout-menu {
  position: absolute;
  right: 0;
  bottom: calc(100% + 6px);
  min-width: 128px;
  padding: 4px;
  border: 1px solid var(--divider-dark-color);
  border-radius: var(--radius-md);
  background: var(--popover-color);
  box-shadow: var(--shadow-lg);
  display: flex;
  flex-direction: column;
  gap: 2px;
}

.layout-item {
  display: flex;
  align-items: center;
  gap: 7px;
  padding: 6px 9px;
  border-radius: var(--radius-sm);
  color: var(--secondary-color);
  font-size: var(--font-size-tiny);
  text-align: left;
  white-space: nowrap;
}

.layout-item:hover {
  background: var(--primary-dark-color);
  color: var(--secondary-dark-color);
}

.layout-item.active {
  background: color-mix(in srgb, var(--accent-color) 10%, transparent);
  color: var(--accent-color);
}
</style>
