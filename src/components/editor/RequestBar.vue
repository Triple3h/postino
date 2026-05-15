<script setup lang="ts">
import { ref, computed } from 'vue'
import { useAppStore } from '@/stores/app'
import type { HttpMethod } from '@/types'

const store = useAppStore()
const methods: HttpMethod[] = ['GET', 'POST', 'PUT', 'DELETE', 'PATCH', 'HEAD', 'OPTIONS']
const currentMethod = ref<HttpMethod>('GET')
const currentUrl = ref('')

const currentApi = computed(() => store.getCurrentApi())

function methodColor(method: HttpMethod): string {
  const colors: Record<string, string> = {
    GET: 'var(--method-get)',
    POST: 'var(--method-post)',
    PUT: 'var(--method-put)',
    DELETE: 'var(--method-delete)',
    PATCH: 'var(--method-patch)',
    HEAD: 'var(--method-head)',
    OPTIONS: 'var(--method-options)',
  }
  return colors[method] || 'var(--text-secondary)'
}

async function sendRequest() {
  if (!currentUrl.value.trim()) return
  store.loading = true
  try {
    // Will be implemented with http utility
  } finally {
    store.loading = false
  }
}
</script>

<template>
  <div class="request-bar">
    <select v-model="currentMethod" class="method-select" :style="{ color: methodColor(currentMethod) }">
      <option v-for="m in methods" :key="m" :value="m">{{ m }}</option>
    </select>
    <input
      v-model="currentUrl"
      type="url"
      class="url-input"
      placeholder="输入请求 URL"
      @keydown.enter="sendRequest"
    />
    <button class="btn btn-primary" @click="sendRequest" :disabled="store.loading">
      {{ store.loading ? '发送中...' : '发送' }}
    </button>
  </div>
</template>

<style scoped>
.request-bar {
  display: flex;
  align-items: center;
  gap: 4px;
  padding: 8px;
  border-bottom: 1px solid var(--border);
}

.method-select {
  padding: 4px 8px;
  border: 1px solid var(--border);
  border-radius: var(--radius-sm);
  background: var(--bg-base);
  font-weight: 600;
  font-size: var(--font-size-body);
  cursor: pointer;
  min-width: 80px;
  outline: none;
}

.url-input {
  flex: 1;
  height: 30px;
  font-size: var(--font-size-body);
  font-family: var(--font-code);
}
</style>