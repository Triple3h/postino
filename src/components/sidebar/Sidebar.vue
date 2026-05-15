<script setup lang="ts">
import { useAppStore } from '@/stores/app'

const store = useAppStore()
</script>

<template>
  <div class="sidebar">
    <div class="sidebar-header">
      <input
        type="text"
        placeholder="搜索接口..."
        class="sidebar-search"
      />
    </div>
    <div class="sidebar-content">
      <div v-for="groupName in store.groupOrder" :key="groupName" class="group-section">
        <div class="group-header">
          <span class="group-name">{{ groupName }}</span>
        </div>
        <div v-for="apiId in store.groups[groupName]?.apiIds || []" :key="apiId" class="api-item">
          <span :class="['method-badge', store.apis[apiId]?.method?.toLowerCase()]">
            {{ store.apis[apiId]?.method }}
          </span>
          <span class="api-name">{{ store.apis[apiId]?.name }}</span>
        </div>
      </div>
    </div>
    <div class="sidebar-footer">
      <button class="btn btn-sm">+ 新建分组</button>
    </div>
  </div>
</template>

<style scoped>
.sidebar {
  width: var(--sidebar-width);
  height: 100%;
  background: var(--bg-sidebar);
  border-right: 1px solid var(--border);
  display: flex;
  flex-direction: column;
  overflow: hidden;
}

.sidebar-header {
  padding: 8px;
  border-bottom: 1px solid var(--divider);
}

.sidebar-search {
  width: 100%;
  height: 28px;
  font-size: var(--font-size-small);
}

.sidebar-content {
  flex: 1;
  overflow-y: auto;
  padding: 4px 0;
}

.group-section {
  margin-bottom: 4px;
}

.group-header {
  padding: 6px 12px;
  font-size: var(--font-size-title);
  font-weight: 600;
  color: var(--text-secondary);
  cursor: pointer;
}

.group-header:hover {
  background: var(--bg-hover);
}

.api-item {
  padding: 4px 12px 4px 20px;
  display: flex;
  align-items: center;
  gap: 6px;
  cursor: pointer;
  font-size: var(--font-size-body);
}

.api-item:hover {
  background: var(--bg-hover);
}

.api-name {
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
}

.sidebar-footer {
  padding: 8px;
  border-top: 1px solid var(--divider);
}
</style>