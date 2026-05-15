<script setup lang="ts">
import { useAppStore } from '@/stores/app'
import RequestBar from './RequestBar.vue'
import TabPanel from './TabPanel.vue'
import ResponsePanel from '@/components/response/ResponsePanel.vue'

const store = useAppStore()
</script>

<template>
  <div class="editor-view">
    <div class="editor-main">
      <RequestBar />
      <TabPanel />
    </div>
    <ResponsePanel />
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

.editor-main {
  flex: 1;
  display: flex;
  flex-direction: column;
  overflow: auto;
}
</style>