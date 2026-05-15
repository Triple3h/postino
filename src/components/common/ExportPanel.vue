<script setup lang="ts">
import { ref, computed, watch } from 'vue'
import type { ApiConfig } from '@/types'
import { generateCurl, generatePostmanCollection, generateMarkdownDoc } from '@/utils/export'

const props = defineProps<{
  visible: boolean
  api: ApiConfig | null
  envVars: Record<string, string>
}>()

const emit = defineEmits<{
  (e: 'close'): void
}>()

const activeTab = ref<'curl' | 'postman' | 'markdown'>('curl')
const copied = ref(false)

const generatedContent = computed(() => {
  if (!props.api) return ''
  switch (activeTab.value) {
    case 'curl':
      return generateCurl(props.api, props.envVars)
    case 'postman':
      return generatePostmanCollection([props.api], props.api.name)
    case 'markdown':
      return generateMarkdownDoc(props.api)
    default:
      return ''
  }
})

watch(() => props.visible, (v) => {
  if (v) {
    activeTab.value = 'curl'
    copied.value = false
  }
})

function close() {
  emit('close')
}

async function copyToClipboard() {
  try {
    await navigator.clipboard.writeText(generatedContent.value)
    copied.value = true
    setTimeout(() => { copied.value = false }, 2000)
  } catch {
    const textarea = document.createElement('textarea')
    textarea.value = generatedContent.value
    document.body.appendChild(textarea)
    textarea.select()
    document.execCommand('copy')
    document.body.removeChild(textarea)
    copied.value = true
    setTimeout(() => { copied.value = false }, 2000)
  }
}

function downloadFile() {
  if (!props.api) return
  let filename = ''
  let mimeType = 'text/plain'

  switch (activeTab.value) {
    case 'curl':
      filename = `${props.api.name || 'curl'}.sh`
      break
    case 'postman':
      filename = `${props.api.name || 'collection'}.json`
      mimeType = 'application/json'
      break
    case 'markdown':
      filename = `${props.api.name || 'api'}.md`
      break
  }

  const blob = new Blob([generatedContent.value], { type: mimeType })
  const url = URL.createObjectURL(blob)
  const a = document.createElement('a')
  a.href = url
  a.download = filename
  a.click()
  URL.revokeObjectURL(url)
}
</script>

<template>
  <div v-if="visible" class="modal-overlay" @click.self="close">
    <div class="modal-content">
      <div class="modal-header">
        <h3>导出请求</h3>
        <button class="btn-icon close-btn" @click="close" title="关闭">×</button>
      </div>
      <div class="export-tabs">
        <button :class="['btn btn-sm', { active: activeTab === 'curl' }]" @click="activeTab = 'curl'">cURL</button>
        <button :class="['btn btn-sm', { active: activeTab === 'postman' }]" @click="activeTab = 'postman'">Postman</button>
        <button :class="['btn btn-sm', { active: activeTab === 'markdown' }]" @click="activeTab = 'markdown'">Markdown</button>
      </div>
      <pre class="export-content">{{ generatedContent }}</pre>
      <div class="modal-actions">
        <button class="btn" @click="close">关闭</button>
        <button class="btn btn-primary" @click="copyToClipboard">
          {{ copied ? '已复制' : '复制' }}
        </button>
        <button v-if="activeTab !== 'curl'" class="btn" @click="downloadFile">下载</button>
      </div>
    </div>
  </div>
</template>

<style scoped>
.modal-overlay {
  position: fixed;
  inset: 0;
  background: rgba(0, 0, 0, 0.5);
  display: flex;
  align-items: center;
  justify-content: center;
  z-index: 1001;
}

.modal-content {
  background: var(--bg-panel);
  border-radius: var(--radius-lg);
  padding: 20px;
  width: 600px;
  max-height: 80vh;
  display: flex;
  flex-direction: column;
  gap: 12px;
}

.modal-header {
  display: flex;
  align-items: center;
  justify-content: space-between;
}

.modal-header h3 {
  font-size: 16px;
  font-weight: 600;
  margin: 0;
}

.close-btn {
  font-size: 18px;
  line-height: 1;
  padding: 2px 6px;
  border: none;
  background: transparent;
  color: var(--text-secondary);
  cursor: pointer;
  border-radius: var(--radius-sm);
}

.close-btn:hover {
  background: var(--bg-hover);
  color: var(--text-primary);
}

.export-tabs {
  display: flex;
  gap: 4px;
}

.export-tabs .btn.active {
  background: var(--primary-light);
  color: var(--primary);
  border-color: var(--primary);
}

.export-content {
  flex: 1;
  min-height: 200px;
  max-height: 400px;
  overflow: auto;
  padding: 12px;
  margin: 0;
  background: var(--bg-code);
  border: 1px solid var(--border);
  border-radius: var(--radius-sm);
  font-family: var(--font-code);
  font-size: var(--font-size-code);
  white-space: pre-wrap;
  word-break: break-all;
  color: var(--text-primary);
}

.modal-actions {
  display: flex;
  justify-content: flex-end;
  gap: 8px;
}
</style>
