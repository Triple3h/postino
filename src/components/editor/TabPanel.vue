<script setup lang="ts">
import { ref, computed } from 'vue'
import { useAppStore } from '@/stores/app'
import KvEditor from '@/components/common/KvEditor.vue'
import BodyEditor from '@/components/editor/BodyEditor.vue'
import AuthConfig from '@/components/editor/AuthConfig.vue'
import type { KvPair, BodyConfig, AuthConfig as AuthConfigType } from '@/types'

const store = useAppStore()
const activeTab = ref('params')

const currentApi = computed(() => store.getCurrentApi())

const tabs = [
  { key: 'params', label: 'Params' },
  { key: 'body', label: 'Body' },
  { key: 'headers', label: 'Headers' },
  { key: 'auth', label: 'Auth' },
  { key: 'pre-script', label: '前置脚本' },
  { key: 'post-script', label: '后置脚本' },
]

function updateParams(params: KvPair[]) {
  if (currentApi.value) store.updateApi(currentApi.value.id, { params })
}

function updateHeaders(headers: KvPair[]) {
  if (currentApi.value) store.updateApi(currentApi.value.id, { headers })
}

function updateBody(body: BodyConfig) {
  if (currentApi.value) store.updateApi(currentApi.value.id, { body })
}

function updateAuth(auth: AuthConfigType) {
  if (currentApi.value) store.updateApi(currentApi.value.id, { auth })
}

function updatePreScript(e: Event) {
  if (currentApi.value) {
    store.updateApi(currentApi.value.id, { preRequestScript: (e.target as HTMLTextAreaElement).value })
  }
}

function updatePostScript(e: Event) {
  if (currentApi.value) {
    store.updateApi(currentApi.value.id, { postRequestScript: (e.target as HTMLTextAreaElement).value })
  }
}
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
      <div v-if="activeTab === 'params'" class="tab-inner">
        <KvEditor
          :model-value="currentApi?.params || []"
          @update:model-value="updateParams"
          key-placeholder="参数名"
          value-placeholder="值"
          show-description
        />
      </div>
      <div v-if="activeTab === 'body'" class="tab-inner">
        <BodyEditor
          :model-value="currentApi?.body || { type: 'none', raw: '', formData: [], urlEncoded: [], binaryFile: null, contentType: '' }"
          :method="currentApi?.method || 'GET'"
          @update:model-value="updateBody"
        />
      </div>
      <div v-if="activeTab === 'headers'" class="tab-inner">
        <KvEditor
          :model-value="currentApi?.headers || []"
          @update:model-value="updateHeaders"
          key-placeholder="Header 名"
          value-placeholder="值"
          show-description
        />
      </div>
      <div v-if="activeTab === 'auth'" class="tab-inner">
        <AuthConfig
          :model-value="currentApi?.auth || { type: 'none', bearerToken: '', basicUsername: '', basicPassword: '', apiKeyName: '', apiKeyValue: '', apiKeyIn: 'header' }"
          @update:model-value="updateAuth"
        />
      </div>
      <div v-if="activeTab === 'pre-script'" class="tab-inner">
        <textarea
          class="script-editor"
          :value="currentApi?.preRequestScript || ''"
          @input="updatePreScript"
          placeholder="// 前置脚本：在请求发送前执行"
          spellcheck="false"
        ></textarea>
      </div>
      <div v-if="activeTab === 'post-script'" class="tab-inner">
        <textarea
          class="script-editor"
          :value="currentApi?.postRequestScript || ''"
          @input="updatePostScript"
          placeholder="// 后置脚本：在收到响应后执行"
          spellcheck="false"
        ></textarea>
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
  overflow: auto;
}

.tab-inner {
  padding: 8px 12px;
  height: 100%;
}

.script-editor {
  width: 100%;
  min-height: 200px;
  padding: 8px;
  border: 1px solid var(--border);
  border-radius: var(--radius-sm);
  background: var(--bg-code);
  color: var(--text-primary);
  font-family: var(--font-code);
  font-size: var(--font-size-code);
  resize: vertical;
  outline: none;
  line-height: 1.5;
}

.script-editor:focus {
  border-color: var(--primary);
}
</style>