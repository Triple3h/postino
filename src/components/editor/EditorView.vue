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
}

.editor-toolbar {
  display: flex;
  align-items: center;
  padding: 4px 8px;
  border-bottom: 1px solid var(--divider);
  gap: 8px;
}

.editor-main {
  flex: 1;
  display: flex;
  flex-direction: column;
  overflow: auto;
  min-height: 200px;
}
</style>