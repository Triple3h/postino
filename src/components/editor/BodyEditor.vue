<script setup lang="ts">
import { computed, ref, watch } from 'vue'
import type { BodyConfig, KvPair } from '@/types'
import KvEditor from '@/components/common/KvEditor.vue'
import CodeMirrorEditor from '@/components/common/CodeMirrorEditor.vue'

const props = defineProps<{
  modelValue: BodyConfig
  method: string
  readonly?: boolean
}>()

const emit = defineEmits<{
  'update:modelValue': [value: BodyConfig]
}>()

const body = computed({
  get: () => props.modelValue,
  set: (val) => emit('update:modelValue', val),
})

const bodyTypes: { value: BodyConfig['type']; label: string }[] = [
  { value: 'none', label: 'none' },
  { value: 'json', label: 'JSON' },
  { value: 'form', label: 'form-data' },
  { value: 'urlencoded', label: 'x-www-form-urlencoded' },
  { value: 'raw', label: 'raw' },
  { value: 'binary', label: 'binary' },
]

const rawModes: { value: string; label: string }[] = [
  { value: 'text/plain', label: 'Text' },
  { value: 'application/json', label: 'JSON' },
  { value: 'application/xml', label: 'XML' },
  { value: 'text/html', label: 'HTML' },
  { value: 'text/javascript', label: 'JavaScript' },
]

const rawContent = ref(props.modelValue.raw)
const rawMessage = ref('')

const dynamicTokens = ['{{$timestamp}}', '{{$isoTimestamp}}', '{{$guid}}', '{{$randomInt}}', '{{$randomEmail}}']

const rawStats = computed(() => {
  const text = rawContent.value || ''
  return {
    lines: text ? text.split(/\r?\n/).length : 0,
    chars: text.length,
  }
})

watch(() => props.modelValue.raw, (val) => {
  rawContent.value = val
})

function update(partial: Partial<BodyConfig>) {
  if (props.readonly) return
  emit('update:modelValue', { ...props.modelValue, ...partial })
}

function updateType(type: BodyConfig['type']) {
  if (props.readonly) return
  const updates: Partial<BodyConfig> = { type }
  if (type === 'json') {
    updates.contentType = 'application/json'
    if (!props.modelValue.raw) updates.raw = '{\n  \n}'
  } else if (type === 'form') {
    updates.contentType = 'multipart/form-data'
  } else if (type === 'urlencoded') {
    updates.contentType = 'application/x-www-form-urlencoded'
  } else if (type === 'raw') {
    updates.contentType = props.modelValue.contentType || 'text/plain'
  }
  emit('update:modelValue', { ...props.modelValue, ...updates })
}

function updateFormData(formData: KvPair[]) {
  update({ formData })
}

function updateUrlEncoded(urlEncoded: KvPair[]) {
  update({ urlEncoded })
}

function updateRawContent(clearMessage = true) {
  if (props.readonly) return
  if (clearMessage) rawMessage.value = ''
  update({ raw: rawContent.value })
}

function transformJsonBody(compact = false) {
  if (props.readonly) return
  try {
    const parsed = JSON.parse(rawContent.value || 'null')
    rawContent.value = JSON.stringify(parsed, null, compact ? 0 : 2)
    rawMessage.value = compact ? 'JSON 已压缩' : 'JSON 已美化'
    updateRawContent(false)
  } catch (err) {
    rawMessage.value = `JSON 解析失败：${err instanceof Error ? err.message : String(err)}`
  }
}


function insertDynamicToken(token: string) {
  if (props.readonly) return
  rawContent.value = rawContent.value ? `${rawContent.value}${token}` : token
  updateRawContent()
}

const isBodyDisabled = computed(() => props.method === 'GET' || props.method === 'HEAD')

const rawLanguage = computed(() => {
  const ct = props.modelValue.contentType
  if (ct === 'application/json') return 'json'
  if (ct === 'application/xml') return 'xml'
  if (ct === 'text/html') return 'html'
  if (ct === 'text/javascript') return 'javascript'
  return 'text'
})
</script>

<template>
  <div class="body-editor" :class="{ disabled: isBodyDisabled }">
    <div v-if="isBodyDisabled" class="body-disabled-hint">
      {{ method }} 请求不支持 Body
    </div>
    <template v-else>
      <div class="body-type-bar">
        <button
          v-for="bt in bodyTypes"
          :key="bt.value"
          :class="['body-type-btn', { active: body.type === bt.value }]"
          @click="updateType(bt.value)"
          :disabled="readonly"
        >
          {{ bt.label }}
        </button>
      </div>

      <div v-if="body.type === 'none'" class="body-empty">
        该请求没有 Body
      </div>

      <div v-if="body.type === 'json'" class="body-raw">
        <div class="raw-helper-bar">
          <div class="json-tools">
            <button :disabled="readonly" @click="transformJsonBody(false)">美化</button>
            <button :disabled="readonly" @click="transformJsonBody(true)">压缩</button>
          </div>
          <div class="dynamic-token-list">
            <button v-for="token in dynamicTokens" :key="`json-${token}`" :disabled="readonly" @click="insertDynamicToken(token)">{{ token }}</button>
          </div>
          <span>{{ rawStats.lines }} 行 · {{ rawStats.chars }} 字符</span>
          <span v-if="rawMessage" class="raw-message">{{ rawMessage }}</span>
        </div>
        <CodeMirrorEditor
          :model-value="rawContent"
          language="json"
          placeholder='{"key": "value"}'
          :readonly="readonly"
          @update:model-value="rawContent = $event; updateRawContent()"
        />
      </div>

      <div v-if="body.type === 'raw'" class="body-raw">
        <div class="raw-mode-select">
          <select :value="body.contentType" :disabled="readonly" @change="update({ contentType: ($event.target as HTMLSelectElement).value })">
            <option v-for="rm in rawModes" :key="rm.value" :value="rm.value">{{ rm.label }}</option>
          </select>
          <div class="dynamic-token-list">
            <button v-for="token in dynamicTokens" :key="`raw-${token}`" :disabled="readonly" @click="insertDynamicToken(token)">{{ token }}</button>
          </div>
          <span class="raw-stats">{{ rawStats.lines }} 行 · {{ rawStats.chars }} 字符</span>
        </div>
        <CodeMirrorEditor
          :model-value="rawContent"
          :language="rawLanguage"
          placeholder="输入请求体内容..."
          :readonly="readonly"
          @update:model-value="rawContent = $event; updateRawContent()"
        />
      </div>

      <div v-if="body.type === 'form'" class="body-form">
        <KvEditor
          :model-value="body.formData"
          @update:model-value="updateFormData"
          key-placeholder="字段名"
          value-placeholder="值"
          :readonly="readonly"
          :allow-file-upload="true"
        />
      </div>

      <div v-if="body.type === 'urlencoded'" class="body-urlencoded">
        <KvEditor
          :model-value="body.urlEncoded"
          @update:model-value="updateUrlEncoded"
          key-placeholder="字段名"
          value-placeholder="值"
          :readonly="readonly"
        />
      </div>

      <div v-if="body.type === 'binary'" class="body-binary">
        <div class="binary-upload">
          <input type="file" :disabled="readonly" @change="update({ binaryFile: ($event.target as HTMLInputElement).files?.[0]?.name ?? null })" />
          <span v-if="body.binaryFile" class="binary-filename">{{ body.binaryFile }}</span>
        </div>
      </div>
    </template>
  </div>
</template>

<style scoped>
.body-editor {
  display: flex;
  flex-direction: column;
  height: 100%;
}

.body-editor.disabled {
  opacity: 0.5;
  pointer-events: none;
}


.raw-helper-bar,
.raw-mode-select {
  display: flex;
  align-items: center;
  flex-wrap: wrap;
  gap: 8px;
}

.raw-helper-bar {
  margin-bottom: 8px;
  color: var(--text-tertiary);
  font-size: var(--font-size-small);
}

.json-tools,
.dynamic-token-list {
  display: flex;
  flex-wrap: wrap;
  gap: 4px;
}

.json-tools button,
.dynamic-token-list button {
  border: 1px solid var(--border);
  border-radius: 999px;
  background: var(--bg-panel-elevated);
  color: var(--text-secondary);
  cursor: pointer;
  padding: 2px 7px;
  font-family: var(--font-code);
  font-size: 11px;
}

.json-tools button:hover:not(:disabled),
.dynamic-token-list button:hover:not(:disabled) {
  color: var(--primary);
  border-color: var(--primary);
}

.raw-message {
  color: var(--text-tertiary);
}

.raw-stats {
  margin-left: auto;
  color: var(--text-tertiary);
  font-size: var(--font-size-small);
}

.body-disabled-hint {
  padding: 20px;
  text-align: center;
  color: var(--text-tertiary);
}

.body-type-bar {
  display: flex;
  gap: 4px;
  margin-bottom: 8px;
  border-bottom: 1px solid var(--divider);
  padding-bottom: 4px;
}

.body-type-btn {
  padding: 5px 12px;
  border: 1px solid transparent;
  background: transparent;
  color: var(--text-secondary);
  cursor: pointer;
  font-size: var(--font-size-small);
  border-radius: 999px;
  font-weight: 700;
  transition: all 0.15s;
}

.body-type-btn:hover {
  background: var(--bg-hover);
  color: var(--text-primary);
}

.body-type-btn.active {
  background: var(--primary-soft);
  border-color: var(--primary);
  color: var(--primary);
}

.body-empty {
  padding: 20px;
  text-align: center;
  color: var(--text-tertiary);
}

.body-raw {
  flex: 1;
  display: flex;
  flex-direction: column;
  min-height: 150px;
}

.raw-mode-select {
  margin-bottom: 4px;
}

.raw-mode-select select {
  font-size: var(--font-size-small);
  min-height: 30px;
}

.body-form,
.body-urlencoded {
  flex: 1;
  overflow: auto;
}

.body-binary {
  padding: 20px;
}

.binary-upload {
  display: flex;
  align-items: center;
  gap: 8px;
  padding: 12px;
  border: 1px solid var(--border);
  border-radius: var(--radius-xl);
  background: var(--bg-panel);
}

.binary-filename {
  font-size: var(--font-size-small);
  color: var(--text-secondary);
}
</style>
