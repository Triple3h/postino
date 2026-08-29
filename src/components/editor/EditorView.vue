<script setup lang="ts">
import { computed } from 'vue'
import PaneLayout from '@/components/shell/PaneLayout.vue'
import RequestBar from './RequestBar.vue'
import TabPanel from './TabPanel.vue'
import ResponsePanel from '@/components/response/ResponsePanel.vue'
import WsPanel from '@/components/response/WsPanel.vue'
import WorkspaceSettingsView from './WorkspaceSettingsView.vue'
import { useAppStore } from '@/stores/app'

const store = useAppStore()
// Phase 3.1/3.5:请求类型决定下方子面板(WS 用双向消息面板,其余用响应面板)
const currentRequestType = computed(() => store.getCurrentApi()?.requestType ?? 'rest')
const currentApi = computed(() => store.getCurrentApi())

/** 上下分栏(默认)或左右分栏(FR-6.1 通用设置) */
const innerOrientation = computed(() => (store.settings.editorLayout === 'horizontal' ? 'columns' : 'rows'))
</script>

<template>
  <div class="editor-view">
    <template v-if="currentApi">
      <!-- WS 请求(M4 将换为 Realtime 布局,暂沿用现状结构) -->
      <div v-if="currentRequestType === 'ws'" class="editor-stack">
        <RequestBar />
        <WsPanel class="ws-panel" />
      </div>
      <PaneLayout
        v-else
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
