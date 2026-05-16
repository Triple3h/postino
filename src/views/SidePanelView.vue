<script setup lang="ts">
import Sidebar from '@/components/sidebar/Sidebar.vue'
import EditorView from '@/components/editor/EditorView.vue'
</script>

<template>
  <div class="sidepanel-layout">
    <Sidebar />
    <EditorView />
  </div>
</template>

<style scoped>
.sidepanel-layout {
  display: flex;
  height: 100%;
  width: 100%;
  gap: 8px;
  padding: 8px;
  background: var(--bg-app);
}

@media (max-width: 400px) {
  .sidepanel-layout :deep(.sidebar) {
    width: var(--sidebar-collapsed);
  }
}

@media (max-width: 600px) {
  .sidepanel-layout :deep(.sidebar) {
    width: 180px;
  }
}
</style>
