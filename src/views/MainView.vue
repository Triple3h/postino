<script setup lang="ts">
import Sidebar from '@/components/sidebar/Sidebar.vue'
import EditorView from '@/components/editor/EditorView.vue'
</script>

<template>
  <div class="main-layout">
    <Sidebar />
    <EditorView />
  </div>
</template>

<style scoped>
.main-layout {
  display: flex;
  height: 100%;
  width: 100%;
}
</style>
