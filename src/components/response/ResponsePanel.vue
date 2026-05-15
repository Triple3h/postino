<script setup lang="ts">
import { useAppStore } from '@/stores/app'

const store = useAppStore()
</script>

<template>
  <div class="response-panel">
    <div v-if="!store.response" class="response-empty">
      发送请求后在此查看响应
    </div>
    <div v-else class="response-content">
      <div class="response-status-bar">
        <span :class="['status-code', {
          success: store.response.status >= 200 && store.response.status < 300,
          warning: store.response.status >= 300 && store.response.status < 400,
          error: store.response.status >= 400,
        }]">
          {{ store.response.status }} {{ store.response.statusText }}
        </span>
        <span class="response-meta">{{ store.response.duration }}ms</span>
        <span class="response-meta">{{ store.response.size }}B</span>
      </div>
      <div class="response-body">
        <pre>{{ store.response.body }}</pre>
      </div>
    </div>
  </div>
</template>

<style scoped>
.response-panel {
  height: 300px;
  border-top: 1px solid var(--border);
  display: flex;
  flex-direction: column;
  overflow: hidden;
}

.response-empty {
  display: flex;
  align-items: center;
  justify-content: center;
  flex: 1;
  color: var(--text-tertiary);
  font-size: var(--font-size-body);
}

.response-content {
  display: flex;
  flex-direction: column;
  flex: 1;
  overflow: hidden;
}

.response-status-bar {
  display: flex;
  align-items: center;
  gap: 12px;
  padding: 6px 12px;
  border-bottom: 1px solid var(--divider);
  font-size: var(--font-size-body);
}

.status-code {
  font-weight: 600;
}

.status-code.success { color: var(--success); }
.status-code.warning { color: var(--info); }
.status-code.error { color: var(--error); }

.response-meta {
  color: var(--text-secondary);
  font-size: var(--font-size-small);
}

.response-body {
  flex: 1;
  overflow: auto;
  padding: 8px;
}

.response-body pre {
  font-family: var(--font-code);
  font-size: var(--font-size-code);
  white-space: pre-wrap;
  word-break: break-all;
}
</style>