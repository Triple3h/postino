<script setup lang="ts">
import { ref } from 'vue'
import { useAppStore } from '@/stores/app'

const store = useAppStore()
const activeTab = ref('params')

const tabs = [
  { key: 'params', label: 'Params' },
  { key: 'body', label: 'Body' },
  { key: 'headers', label: 'Headers' },
  { key: 'auth', label: 'Auth' },
  { key: 'pre-script', label: '前置脚本' },
  { key: 'post-script', label: '后置脚本' },
]
</script>

<template>
  <div class="tab-panel">
    <div class="tab-header">
      <button
        v-for="tab in tabs"
        :key="tab.key"
        :class="['tab-btn', { active: activeTab === tab.key }]"
        @click="activeTab = tab.key"
      >
        {{ tab.label }}
      </button>
    </div>
    <div class="tab-content">
      <div v-if="activeTab === 'params'" class="kv-editor-placeholder">
        参数编辑器（待实现）
      </div>
      <div v-if="activeTab === 'body'" class="body-placeholder">
        Body 编辑器（待实现）
      </div>
      <div v-if="activeTab === 'headers'" class="kv-editor-placeholder">
        Headers 编辑器（待实现）
      </div>
      <div v-if="activeTab === 'auth'" class="auth-placeholder">
        Auth 配置（待实现）
      </div>
      <div v-if="activeTab === 'pre-script'" class="script-placeholder">
        前置脚本编辑器（待实现）
      </div>
      <div v-if="activeTab === 'post-script'" class="script-placeholder">
        后置脚本编辑器（待实现）
      </div>
    </div>
  </div>
</template>

<style scoped>
.tab-panel {
  display: flex;
  flex-direction: column;
  overflow: hidden;
}

.tab-header {
  display: flex;
  border-bottom: 1px solid var(--border);
  padding: 0 8px;
}

.tab-btn {
  padding: 6px 12px;
  border: none;
  background: transparent;
  color: var(--text-secondary);
  cursor: pointer;
  font-size: var(--font-size-body);
  border-bottom: 2px solid transparent;
  transition: all 0.15s;
}

.tab-btn:hover {
  color: var(--text-primary);
}

.tab-btn.active {
  color: var(--primary);
  border-bottom-color: var(--primary);
}

.tab-content {
  flex: 1;
  padding: 12px;
  overflow: auto;
}

.kv-editor-placeholder,
.body-placeholder,
.auth-placeholder,
.script-placeholder {
  color: var(--text-tertiary);
  font-size: var(--font-size-body);
  padding: 20px;
  text-align: center;
}
</style>