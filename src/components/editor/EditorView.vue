<script setup lang="ts">
import { computed } from 'vue'
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

/** 上下分栏(默认)或左右分栏(FR-6.1 通用设置) */
const innerOrientation = computed(() => (store.settings.editorLayout === 'horizontal' ? 'columns' : 'rows'))
</script>

<template>
  <div class="editor-view">
    <!-- 多标签栏常驻(Postman 式):0 标签时也保留「+」入口,集合欢迎页可点标签切回请求 -->
    <RequestTabs />
    <template v-if="currentApi">
      <!-- WS 请求(ws/wss scheme 自动识别) -->
      <div v-if="currentRequestType === 'ws'" class="editor-stack">
        <RequestBar />
        <WsPanel class="ws-panel" />
      </div>
      <PaneLayout
        v-else
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
    </template>
    <WorkspaceSettingsView v-else />
  </div>
</template>

<style scoped>
.editor-view {
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
</style>
