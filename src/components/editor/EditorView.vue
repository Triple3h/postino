<script setup lang="ts">
import { useAppStore } from '@/stores/app'
import RequestBar from './RequestBar.vue'
import TabPanel from './TabPanel.vue'
import ResponsePanel from '@/components/response/ResponsePanel.vue'
import WorkspaceSettingsView from './WorkspaceSettingsView.vue'
import EnvPanel from '@/components/common/EnvPanel.vue'

const store = useAppStore()
</script>

<template>
  <div class="editor-view">
    <div class="editor-toolbar">
      <div class="editor-toolbar-title">
        <span>🌐</span>
        <strong>环境与变量</strong>
      </div>
      <EnvPanel />
    </div>
    <template v-if="store.getCurrentApi()">
      <div class="editor-main">
        <RequestBar />
        <TabPanel />
      </div>
      <ResponsePanel />
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

.editor-toolbar {
  display: flex;
  align-items: center;
  justify-content: space-between;
  padding: 8px 12px;
  border-bottom: 1px solid var(--divider);
  gap: 8px;
  background: var(--bg-panel-elevated);
}

.editor-toolbar-title {
  display: flex;
  align-items: center;
  gap: 6px;
  color: var(--text-secondary);
  font-size: var(--font-size-small);
}

.editor-main {
  flex: 1;
  display: flex;
  flex-direction: column;
  overflow: auto;
  min-height: 200px;
}
</style>
