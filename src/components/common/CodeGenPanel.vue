<script setup lang="ts">
import { ref, computed, watch } from 'vue'
import type { ApiConfig } from '@/types'
import { generatePythonRequests, generateJavaScriptFetch, generateJavaScriptAxios } from '@/utils/export'

const props = defineProps<{
  visible: boolean
  api: ApiConfig | null
  envVars: Record<string, string>
}>()

const emit = defineEmits<{
  (e: 'close'): void
}>()

type CodeLang = 'python-requests' | 'js-fetch' | 'js-axios'

const langOptions: { value: CodeLang; label: string }[] = [
  { value: 'python-requests', label: 'Python (requests)' },
  { value: 'js-fetch', label: 'JavaScript (fetch)' },
  { value: 'js-axios', label: 'JavaScript (axios)' },
]

const selectedLang = ref<CodeLang>('python-requests')
const copied = ref(false)

const generatedCode = computed(() => {
  if (!props.api) return ''
  switch (selectedLang.value) {
    case 'python-requests':
      return generatePythonRequests(props.api, props.envVars)
    case 'js-fetch':
      return generateJavaScriptFetch(props.api, props.envVars)
    case 'js-axios':
      return generateJavaScriptAxios(props.api, props.envVars)
    default:
      return ''
  }
})

watch(() => props.visible, (v) => {
  if (v) {
    selectedLang.value = 'python-requests'
    copied.value = false
  }
})

function close() {
  emit('close')
}

async function copyToClipboard() {
  try {
    await navigator.clipboard.writeText(generatedCode.value)
    copied.value = true
    setTimeout(() => { copied.value = false }, 2000)
  } catch {
    const textarea = document.createElement('textarea')
    textarea.value = generatedCode.value
    document.body.appendChild(textarea)
    textarea.select()
    document.execCommand('copy')
    document.body.removeChild(textarea)
    copied.value = true
    setTimeout(() => { copied.value = false }, 2000)
  }
}
</script>

<template>
  <div v-if="visible" class="modal-overlay" @click.self="close">
    <div class="modal-content">
      <div class="modal-header">
        <h3>代码生成</h3>
        <button class="btn-icon close-btn" @click="close" title="关闭">×</button>
      </div>
      <div class="lang-selector">
        <label>语言：</label>
        <select v-model="selectedLang" class="lang-select">
          <option v-for="opt in langOptions" :key="opt.value" :value="opt.value">{{ opt.label }}</option>
        </select>
      </div>
      <pre class="code-content">{{ generatedCode }}</pre>
      <div class="modal-actions">
        <button class="btn" @click="close">关闭</button>
        <button class="btn btn-primary" @click="copyToClipboard">
          {{ copied ? '已复制' : '复制' }}
        </button>
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

.lang-selector {
  display: flex;
  align-items: center;
  gap: 8px;
}

.lang-selector label {
  font-size: var(--font-size-sm);
  color: var(--text-secondary);
  white-space: nowrap;
}

.lang-select {
  flex: 1;
  padding: 6px 8px;
  border: 1px solid var(--border);
  border-radius: var(--radius-sm);
  background: var(--bg-input);
  color: var(--text-primary);
  font-size: var(--font-size-sm);
}

.code-content {
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
