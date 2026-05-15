<script setup lang="ts">
import { ref, computed, watch } from 'vue'
import { useAppStore } from '@/stores/app'
import { sendRequest as httpSendRequest } from '@/utils/http'
import { executePreRequestScript, executePostResponseScript } from '@/utils/pre-request'
import type { PostResponseData } from '@/utils/pre-request'
import ExportPanel from '@/components/common/ExportPanel.vue'
import CodeGenPanel from '@/components/common/CodeGenPanel.vue'
import VariableAutocomplete from '@/components/common/VariableAutocomplete.vue'
import { useVariableAutocomplete } from '@/composables/useVariableAutocomplete'
import type { HttpMethod, ResponseData } from '@/types'

const store = useAppStore()
const methods: HttpMethod[] = ['GET', 'POST', 'PUT', 'DELETE', 'PATCH', 'HEAD', 'OPTIONS']

const currentApi = computed(() => store.getCurrentApi())
const currentMethod = ref<HttpMethod>('GET')
const currentUrl = ref('')
const showExportPanel = ref(false)
const showCodeGenPanel = ref(false)
const showActionMenu = ref(false)

const envVars = computed(() => store.getEnvVariables())

const urlInputRef = ref<HTMLInputElement | null>(null)
const urlAutocomplete = useVariableAutocomplete(urlInputRef)

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
  store.scriptLogs = []

  const allLogs: import('@/utils/pre-request').ScriptLog[] = []

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
      allLogs.push(...scriptResult.logs)
    }

    // Send request
    const response = await httpSendRequest({
      method: api.method,
      url: currentUrl.value,
      headers: api.headers,
      params: api.params,
      cookies: api.cookies || [],
      autoCarryCookies: store.autoCarryCookies,
      body: api.body,
      auth: api.auth,
      corsMode: store.settings.corsMode,
      proxyUrl: store.settings.proxyUrl,
      envVars,
    })

    store.response = response

    // Execute post-response script
    if (api.postRequestScript) {
      const postData: PostResponseData = {
        status: response.status,
        statusText: response.statusText,
        headers: response.headers,
        body: response.body,
        duration: response.duration,
        responseSize: response.size,
      }
      const postResult = executePostResponseScript(
        api.postRequestScript,
        postData,
        envVars,
      )
      allLogs.push(...postResult.logs)
    }

    store.scriptLogs = allLogs

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
      starred: false,
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
    store.scriptLogs = allLogs
  } finally {
    store.loading = false
  }
}

function toggleActionMenu() {
  showActionMenu.value = !showActionMenu.value
}

function openExport() {
  showActionMenu.value = false
  showExportPanel.value = true
}

function openCodeGen() {
  showActionMenu.value = false
  showCodeGenPanel.value = true
}

function closeActionMenu() {
  showActionMenu.value = false
}
</script>

<template>
  <div class="request-bar" @click="closeActionMenu">
    <select v-model="currentMethod" class="method-select" :style="{ color: methodColor(currentMethod) }">
      <option v-for="m in methods" :key="m" :value="m">{{ m }}</option>
    </select>
    <input
      ref="urlInputRef"
      v-model="currentUrl"
      type="url"
      class="url-input"
      placeholder="输入请求 URL"
      @keydown.enter="send"
      @input="urlAutocomplete.handleInput()"
      @keydown="urlAutocomplete.handleKeydown($event) ? null : null"
    />
    <button class="btn btn-primary send-btn" @click="send" :disabled="store.loading">
      {{ store.loading ? '发送中...' : '发送' }}
    </button>
    <div class="action-menu-wrapper">
      <button class="btn btn-sm action-btn" @click.stop="toggleActionMenu" title="更多操作">⋯</button>
      <div v-if="showActionMenu" class="action-dropdown" @click.stop>
        <button class="action-item" @click="openExport">导出请求</button>
        <button class="action-item" @click="openCodeGen">代码生成</button>
      </div>
    </div>
  </div>

  <ExportPanel
    :visible="showExportPanel"
    :api="currentApi"
    :env-vars="envVars"
    @close="showExportPanel = false"
  />

  <CodeGenPanel
    :visible="showCodeGenPanel"
    :api="currentApi"
    :env-vars="envVars"
    @close="showCodeGenPanel = false"
  />

  <VariableAutocomplete
    :visible="urlAutocomplete.showAutocomplete.value"
    :position="urlAutocomplete.autocompletePosition.value"
    :filter="urlAutocomplete.autocompleteFilter.value"
    :items="urlAutocomplete.allItems.value"
    @select="urlAutocomplete.insertVariable"
    @close="urlAutocomplete.close"
  />
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

.action-menu-wrapper {
  position: relative;
}

.action-btn {
  font-size: 16px;
  padding: 4px 8px;
  line-height: 1;
}

.action-dropdown {
  position: absolute;
  top: 100%;
  right: 0;
  margin-top: 4px;
  background: var(--bg-panel);
  border: 1px solid var(--border);
  border-radius: var(--radius-sm);
  box-shadow: 0 4px 12px rgba(0, 0, 0, 0.15);
  z-index: 100;
  min-width: 120px;
}

.action-item {
  display: block;
  width: 100%;
  padding: 8px 12px;
  border: none;
  background: transparent;
  color: var(--text-primary);
  text-align: left;
  cursor: pointer;
  font-size: var(--font-size-sm);
}

.action-item:hover {
  background: var(--bg-hover);
}
</style>