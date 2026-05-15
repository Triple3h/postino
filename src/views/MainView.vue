<script setup lang="ts">
import { ref } from 'vue'
import { useAppStore } from '@/stores/app'
import Sidebar from '@/components/sidebar/Sidebar.vue'
import EditorView from '@/components/editor/EditorView.vue'
import GlobalSearch from '@/components/common/GlobalSearch.vue'
import HistoryPanel from '@/components/common/HistoryPanel.vue'
import MigrationDialog from '@/components/common/MigrationDialog.vue'
import { useSettings } from '@/composables/useSettings'
import { useKeyboardShortcuts } from '@/composables/useKeyboardShortcuts'

const store = useAppStore()
const { settings, toggleTheme } = useSettings()
useKeyboardShortcuts()

const showHistory = ref(false)
</script>

<template>
  <div class="main-layout">
    <Sidebar />
    <div class="main-content">
      <div class="toolbar">
        <button class="btn btn-sm" @click="showHistory = !showHistory" :class="{ active: showHistory }">
          历史
        </button>
        <select v-model="settings.corsMode" class="cors-select">
          <option value="cors">CORS</option>
          <option value="proxy">代理</option>
          <option value="no-cors">No-CORS</option>
        </select>
        <button class="btn btn-sm" @click="toggleTheme">
          {{ settings.theme === 'dark' ? '☀️' : settings.theme === 'light' ? '🌙' : '💻' }}
        </button>
      </div>
      <div class="content-area">
        <EditorView />
        <HistoryPanel v-if="showHistory" class="history-sidebar" />
      </div>
    </div>
    <GlobalSearch />
    <MigrationDialog />
  </div>
</template>

<style scoped>
.main-layout {
  display: flex;
  height: 100%;
  width: 100%;
}

.main-content {
  flex: 1;
  display: flex;
  flex-direction: column;
  overflow: hidden;
}

.toolbar {
  display: flex;
  align-items: center;
  gap: 4px;
  padding: 4px 8px;
  border-bottom: 1px solid var(--divider);
}

.toolbar .btn.active {
  background: var(--primary-light);
  color: var(--primary);
}

.cors-select {
  padding: 2px 6px;
  border: 1px solid var(--border);
  border-radius: var(--radius-sm);
  font-size: var(--font-size-small);
  background: var(--bg-base);
  margin-left: auto;
}

.content-area {
  flex: 1;
  display: flex;
  overflow: hidden;
}

.history-sidebar {
  width: 300px;
  border-left: 1px solid var(--border);
  flex-shrink: 0;
}
</style>