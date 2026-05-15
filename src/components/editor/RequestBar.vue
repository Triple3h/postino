<script setup lang="ts">
import { ref, computed, watch } from 'vue'
import { useAppStore } from '@/stores/app'
import { sendRequest as httpSendRequest } from '@/utils/http'
import { executePreRequestScript } from '@/utils/pre-request'
import type { HttpMethod, ResponseData } from '@/types'

const store = useAppStore()
const methods: HttpMethod[] = ['GET', 'POST', 'PUT', 'DELETE', 'PATCH', 'HEAD', 'OPTIONS']

const currentApi = computed(() => store.getCurrentApi())
const currentMethod = ref<HttpMethod>('GET')
const currentUrl = ref('')

watch(currentApi, (api) => {
  if (api) {
    currentMethod.value = api.method
    currentUrl.value = api.url
  }
}, { immediate: true })

watch([currentMethod, currentUrl], () => {
  if (currentApi.value) {
    store.updateApi(currentApi.value.id, {
      method: currentMethod.value,
      url: currentUrl.value,
    })
  }
})

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

async function send() {
  if (!currentUrl.value.trim()) return
  if (!currentApi.value) return

  store.loading = true
  store.response = null

  try {
    const api = currentApi.value
    const envVars = store.getEnvVariables()

    // Execute pre-request script
    let headers: Record<string, string> = {}
    for (const h of api.headers) {
      if (h.enabled && h.key) headers[h.key] = h.value
    }

    let url = api.url
    let body = api.body.raw || ''
    let urlencoded = [...api.body.urlEncoded]
    let formdata = [...api.body.formData]

    if (api.preRequestScript) {
      const scriptResult = executePreRequestScript(
        api.preRequestScript,
        headers,
        url,
        body,
        urlencoded,
        formdata,
        envVars,
      )
      headers = scriptResult.headers
      url = scriptResult.url
      body = scriptResult.body
      urlencoded = scriptResult.urlencoded
      formdata = scriptResult.formdata
    }

    // Send request
    const response = await httpSendRequest({
      method: api.method,
      url: currentUrl.value,
      headers: api.headers,
      params: api.params,
      body: api.body,
      auth: api.auth,
      corsMode: store.settings.corsMode,
      proxyUrl: store.settings.proxyUrl,
      envVars,
    })

    store.response = response

    // Add to history
    store.addHistory({
      id: Date.now().toString(36) + Math.random().toString(36).slice(2, 8),
      apiId: api.id,
      method: api.method,
      url: currentUrl.value,
      status: response.status,
      statusText: response.statusText,
      duration: response.duration,
      timestamp: Date.now(),
      requestHeaders: response.requestHeaders,
      requestBody: response.requestBody,
      responseSize: response.size,
    })
  } catch (err: any) {
    store.response = {
      status: 0,
      statusText: err.message || 'Unknown Error',
      headers: {},
      body: '',
      duration: 0,
      size: 0,
      url: currentUrl.value,
      method: currentMethod.value,
      requestHeaders: {},
      requestBody: null,
      timestamp: Date.now(),
    }
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
      @keydown.enter="send"
    />
    <button class="btn btn-primary send-btn" @click="send" :disabled="store.loading">
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

.send-btn {
  min-width: 60px;
}
</style>