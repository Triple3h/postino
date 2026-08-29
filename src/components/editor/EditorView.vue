<script setup lang="ts">
import { computed } from 'vue'
import { useAppStore } from '@/stores/app'
import RequestBar from './RequestBar.vue'
import TabPanel from './TabPanel.vue'
import ResponsePanel from '@/components/response/ResponsePanel.vue'
import WsPanel from '@/components/response/WsPanel.vue'
import WorkspaceSettingsView from './WorkspaceSettingsView.vue'

const store = useAppStore()
// Phase 3.1/3.5:请求类型决定下方子面板(WS 用双向消息面板,其余用响应面板)
const currentRequestType = computed(() => store.getCurrentApi()?.requestType ?? 'rest')
</script>

<template>
  <div class="editor-view">
    <template v-if="store.getCurrentApi()">
      <div class="editor-main">
        <RequestBar />
        <TabPanel />
      </div>
      <WsPanel v-if="currentRequestType === 'ws'" />
      <ResponsePanel v-else />
    </template>
    <WorkspaceSettingsView v-else />
  </div>
</template>

<style scoped>
.editor-view {
  flex: 1;
  display: flex;
  flex-direction: column;
  overflow: hidden;
  min-width: 600px;
  background: var(--bg-panel);
}

.editor-main {
  flex: 1;
  display: flex;
  flex-direction: column;
  overflow: auto;
  min-height: 200px;
}
</style>
