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
        <div class="toolbar-brand">
          <span class="brand-mark">A</span>
          <div>
            <strong>ApiFix Bin Pro</strong>
            <small>轻量 API 调试工作台</small>
          </div>
        </div>
        <div class="toolbar-status">
          <span class="status-pill">⌘K 搜索</span>
          <span class="status-pill">{{ store.history.length }} 条历史</span>
        </div>
        <div class="toolbar-actions">
          <button class="btn btn-sm" @click="showHistory = !showHistory" :class="{ active: showHistory }">
            {{ showHistory ? '收起历史' : '历史记录' }}
          </button>
          <label class="cors-mode">
            <span>网络模式</span>
            <select v-model="settings.corsMode" class="cors-select">
              <option value="cors">CORS</option>
              <option value="proxy">代理</option>
              <option value="no-cors">No-CORS</option>
            </select>
          </label>
          <button class="btn btn-sm theme-btn" @click="toggleTheme" title="切换主题">
            {{ settings.theme === 'dark' ? '☀️ Light' : settings.theme === 'light' ? '🌙 Dark' : '💻 System' }}
          </button>
        </div>
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
  padding: 10px;
  gap: 10px;
  background:
    linear-gradient(135deg, rgba(255, 255, 255, 0.64), rgba(255, 255, 255, 0.2)),
    var(--bg-app);
}

.main-content {
  flex: 1;
  display: flex;
  flex-direction: column;
  overflow: hidden;
  min-width: 0;
  border: 1px solid var(--border);
  border-radius: var(--radius-2xl);
  background: var(--bg-panel-elevated);
  box-shadow: var(--shadow-lg);
  backdrop-filter: blur(18px);
}

.toolbar {
  display: flex;
  align-items: center;
  gap: 12px;
  padding: 10px 12px;
  border-bottom: 1px solid var(--divider);
  background:
    linear-gradient(90deg, var(--bg-panel-elevated), color-mix(in srgb, var(--primary-light) 36%, var(--bg-panel)));
}

.toolbar-brand {
  display: flex;
  align-items: center;
  gap: 10px;
  min-width: 210px;
}

.brand-mark {
  display: inline-flex;
  align-items: center;
  justify-content: center;
  width: 34px;
  height: 34px;
  border-radius: 12px;
  color: #fff;
  font-weight: 900;
  background: linear-gradient(135deg, var(--primary), var(--accent));
  box-shadow: 0 10px 18px rgba(79, 70, 229, 0.22);
}

.toolbar-brand strong,
.toolbar-brand small {
  display: block;
}

.toolbar-brand strong {
  font-size: 14px;
  line-height: 1.2;
}

.toolbar-brand small {
  color: var(--text-secondary);
  font-size: var(--font-size-small);
  margin-top: 2px;
}

.toolbar-status {
  display: flex;
  align-items: center;
  gap: 6px;
}

.status-pill {
  border: 1px solid var(--border);
  border-radius: 999px;
  background: var(--bg-panel);
  color: var(--text-secondary);
  padding: 4px 9px;
  font-size: var(--font-size-small);
  box-shadow: var(--shadow-sm);
}

.toolbar-actions {
  display: flex;
  align-items: center;
  gap: 8px;
  margin-left: auto;
}

.toolbar .btn.active {
  background: var(--primary-soft);
  color: var(--primary);
  border-color: var(--primary);
}

.cors-mode {
  display: flex;
  align-items: center;
  gap: 6px;
  color: var(--text-secondary);
  font-size: var(--font-size-small);
}

.cors-select {
  font-size: var(--font-size-small);
  min-height: 28px;
  padding: 3px 28px 3px 8px;
}

.content-area {
  flex: 1;
  display: flex;
  overflow: hidden;
  min-height: 0;
}

.history-sidebar {
  width: 340px;
  border-left: 1px solid var(--border);
  flex-shrink: 0;
  background: var(--bg-panel);
}

@media (max-width: 920px) {
  .toolbar-status,
  .cors-mode span {
    display: none;
  }

  .toolbar-brand {
    min-width: 0;
  }
}
</style>
