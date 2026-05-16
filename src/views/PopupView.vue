<script setup lang="ts">
import { ref, computed } from 'vue'
import { useAppStore } from '@/stores/app'
import { sendRequest as httpSendRequest } from '@/utils/http'
import type { HttpMethod, ResponseData } from '@/types'

const store = useAppStore()
const method = ref<HttpMethod>('GET')
const url = ref('')
const loading = ref(false)
const response = ref<ResponseData | null>(null)

const recentHistory = computed(() => store.history.slice(0, 10))

const methods: HttpMethod[] = ['GET', 'POST', 'PUT', 'DELETE', 'PATCH']

function methodColor(m: HttpMethod): string {
  const colors: Record<string, string> = {
    GET: 'var(--method-get)', POST: 'var(--method-post)', PUT: 'var(--method-put)',
    DELETE: 'var(--method-delete)', PATCH: 'var(--method-patch)',
  }
  return colors[m] || 'var(--text-secondary)'
}

async function send() {
  if (!url.value.trim()) return
  loading.value = true
  response.value = null
  try {
    response.value = await httpSendRequest({
      method: method.value,
      url: url.value,
      headers: [],
      params: [],
      body: { type: 'none', raw: '', formData: [], urlEncoded: [], binaryFile: null, contentType: '' },
      auth: { type: 'none', bearerToken: '', basicUsername: '', basicPassword: '', apiKeyName: '', apiKeyValue: '', apiKeyIn: 'header' },
      corsMode: store.settings.corsMode,
      proxyUrl: store.settings.proxyUrl,
      envVars: store.getEnvVariables(),
    })
  } finally {
    loading.value = false
  }
}

function loadFromHistory(entry: typeof store.history[0]) {
  url.value = entry.url
  method.value = entry.method
}
</script>

<template>
  <div class="popup-view">
    <div class="popup-header">
      <h2>API Fox Lite</h2>
    </div>
    <div class="popup-input">
      <select v-model="method" class="method-select" :style="{ color: methodColor(method) }">
        <option v-for="m in methods" :key="m" :value="m">{{ m }}</option>
      </select>
      <input v-model="url" type="url" placeholder="输入 URL" class="url-input" @keydown.enter="send" />
      <button class="btn btn-primary" @click="send" :disabled="loading">
        {{ loading ? '...' : '发送' }}
      </button>
    </div>
    <div v-if="response" class="popup-response">
      <div class="response-status">
        <span :class="['status', { success: response.status >= 200 && response.status < 300, error: response.status >= 400 }]">
          {{ response.status }}
        </span>
        <span class="duration">{{ response.duration }}ms</span>
      </div>
      <pre class="response-body">{{ response.body }}</pre>
    </div>
    <div v-if="recentHistory.length > 0" class="popup-history">
      <h3>最近请求</h3>
      <div v-for="entry in recentHistory" :key="entry.id" class="history-item" @click="loadFromHistory(entry)">
        <span :class="['method-badge', entry.method.toLowerCase()]">{{ entry.method }}</span>
        <span class="history-url">{{ entry.url }}</span>
        <span class="history-status">{{ entry.status }}</span>
      </div>
    </div>
  </div>
</template>

<style scoped>
.popup-view {
  padding: 12px;
  width: 420px;
  min-width: 360px;
  max-width: 500px;
}

.popup-header {
  margin-bottom: 12px;
}

.popup-header h2 {
  font-size: 16px;
  font-weight: 600;
}

.popup-input {
  display: flex;
  gap: 4px;
  margin-bottom: 12px;
}

.method-select {
  padding: 4px 6px;
  border: 1px solid var(--border);
  border-radius: var(--radius-sm);
  background: var(--bg-base);
  font-weight: 600;
  font-size: var(--font-size-body);
  min-width: 70px;
  outline: none;
}

.url-input {
  flex: 1;
  height: 30px;
  font-size: var(--font-size-body);
  font-family: var(--font-code);
}

.popup-response {
  margin-bottom: 12px;
  border: 1px solid var(--border);
  border-radius: var(--radius-md);
  overflow: hidden;
}

.response-status {
  display: flex;
  align-items: center;
  gap: 8px;
  padding: 6px 8px;
  background: var(--bg-sidebar);
  border-bottom: 1px solid var(--divider);
  font-size: var(--font-size-small);
}

.status { font-weight: 600; }
.status.success { color: var(--success); }
.status.error { color: var(--error); }
.duration { color: var(--text-secondary); }

.response-body {
  padding: 8px;
  font-family: var(--font-code);
  font-size: var(--font-size-code);
  max-height: 200px;
  overflow: auto;
  white-space: pre-wrap;
  word-break: break-all;
}

.popup-history h3 {
  font-size: var(--font-size-title);
  font-weight: 600;
  margin-bottom: 6px;
  color: var(--text-secondary);
}

.history-item {
  display: flex;
  align-items: center;
  gap: 6px;
  padding: 4px 6px;
  border-radius: var(--radius-sm);
  cursor: pointer;
  font-size: var(--font-size-small);
}

.history-item:hover {
  background: var(--bg-hover);
}

.history-url {
  flex: 1;
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
  font-family: var(--font-code);
}

.history-status {
  color: var(--text-secondary);
}
</style>
