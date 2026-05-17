<script setup lang="ts">
import { ref, watch, computed } from 'vue'
import type { KvPair } from '@/types'
import VariableAutocomplete from '@/components/common/VariableAutocomplete.vue'
import { useVariableAutocomplete } from '@/composables/useVariableAutocomplete'

const props = defineProps<{
  modelValue: KvPair[]
  keyPlaceholder?: string
  valuePlaceholder?: string
  showDescription?: boolean
  readonly?: boolean
  allowFileUpload?: boolean
}>()

const emit = defineEmits<{
  'update:modelValue': [value: KvPair[]]
}>()

const rows = ref<KvPair[]>([...props.modelValue])
const fileInputRefs = ref<Map<number, HTMLInputElement>>(new Map())

// --- Bulk edit mode ---
const bulkMode = ref(false)
const bulkText = ref('')

// --- Import dialog ---
const showImportDialog = ref(false)
const importText = ref('')

// --- Drag and drop ---
const dragIndex = ref<number | null>(null)
const dropIndex = ref<number | null>(null)

watch(() => props.modelValue, (val) => {
  rows.value = [...val]
}, { deep: true })

function update() {
  emit('update:modelValue', rows.value.filter(r => r.key.trim()))
}

function addRow() {
  rows.value.push({ key: '', value: '', enabled: true, description: '', type: 'text' })
  update()
}

function removeRow(index: number) {
  rows.value.splice(index, 1)
  update()
}

function toggleRow(index: number) {
  rows.value[index].enabled = !rows.value[index].enabled
  update()
}

function toggleType(index: number) {
  const row = rows.value[index]
  if (row.type === 'file') {
    row.type = 'text'
    row.value = ''
    row.fileName = undefined
  } else {
    row.type = 'file'
    row.value = ''
    row.fileName = ''
  }
  update()
}

function triggerFileInput(index: number) {
  const input = fileInputRefs.value.get(index)
  if (input) {
    input.value = ''
    input.click()
  }
}

function handleFileSelect(index: number, event: Event) {
  const input = event.target as HTMLInputElement
  const file = input.files?.[0]
  if (!file) return

  const row = rows.value[index]
  row.fileName = file.name

  const reader = new FileReader()
  reader.onload = () => {
    row.value = reader.result as string
    update()
  }
  reader.readAsDataURL(file)
}

const activeValueRef = ref<HTMLInputElement | null>(null)
const valueAutocomplete = useVariableAutocomplete(activeValueRef)

// ========== Bulk Edit Mode ==========

function enterBulkMode() {
  // Serialize current rows to text
  const lines: string[] = []
  for (const row of rows.value) {
    if (!row.key.trim() && !row.value.trim()) continue
    const prefix = row.enabled ? '' : '!'
    const desc = row.description ? ` // ${row.description}` : ''
    lines.push(`${prefix}${row.key}: ${row.value}${desc}`)
  }
  bulkText.value = lines.join('\n')
  bulkMode.value = true
}

function exitBulkMode() {
  // Parse text back to rows
  const parsed = parseBulkText(bulkText.value)
  rows.value = parsed
  update()
  bulkMode.value = false
}

function toggleBulkMode() {
  if (bulkMode.value) {
    exitBulkMode()
  } else {
    enterBulkMode()
  }
}

function parseBulkText(text: string): KvPair[] {
  const result: KvPair[] = []
  const lines = text.split('\n')

  for (let line of lines) {
    // Trim trailing whitespace but preserve leading for ! detection
    const trimmed = line.trimEnd()
    if (!trimmed) continue

    // Skip comment lines
    if (trimmed.startsWith('//') || trimmed.startsWith('#')) continue

    // Check for disabled prefix
    let enabled = true
    let content = trimmed
    if (content.startsWith('!')) {
      enabled = false
      content = content.slice(1).trimStart()
    }

    // Extract inline description (// at end)
    let description = ''
    const descMatch = content.match(/\s+\/\/\s+(.+)$/)
    if (descMatch) {
      description = descMatch[1]
      content = content.slice(0, content.length - descMatch[0].length)
    }

    // Parse key:value or key=value
    let key = ''
    let value = ''

    const colonIdx = content.indexOf(':')
    const eqIdx = content.indexOf('=')

    if (colonIdx === -1 && eqIdx === -1) {
      // No separator, treat entire line as key
      key = content.trim()
      value = ''
    } else if (colonIdx !== -1 && (eqIdx === -1 || colonIdx < eqIdx)) {
      // Colon separator comes first
      key = content.slice(0, colonIdx).trim()
      value = content.slice(colonIdx + 1).trim()
    } else {
      // Equals separator comes first
      key = content.slice(0, eqIdx).trim()
      value = content.slice(eqIdx + 1).trim()
    }

    result.push({
      key,
      value,
      enabled,
      description: description || undefined,
      type: 'text'
    })
  }

  return result
}

// ========== Sort Rows ==========

function sortRows() {
  rows.value.sort((a, b) => {
    const keyA = a.key.toLowerCase()
    const keyB = b.key.toLowerCase()
    return keyA.localeCompare(keyB)
  })
  update()
}

// ========== Import from Text ==========

function openImportDialog() {
  importText.value = ''
  showImportDialog.value = true
}

function closeImportDialog() {
  showImportDialog.value = false
  importText.value = ''
}

function doImport() {
  const parsed = parseImportText(importText.value)
  // Add as new rows, don't replace existing
  for (const pair of parsed) {
    rows.value.push(pair)
  }
  update()
  closeImportDialog()
}

function parseImportText(text: string): KvPair[] {
  const result: KvPair[] = []

  // First, check for semicolon-separated format on a single line
  // If the text has no newlines and contains semicolons, treat as semicolon-separated
  const trimmedText = text.trim()

  if (!trimmedText.includes('\n') && trimmedText.includes(';')) {
    // Semicolon-separated single line: "key: value; key2: value2"
    const segments = trimmedText.split(';')
    for (const segment of segments) {
      const pair = parseSinglePair(segment.trim())
      if (pair) result.push(pair)
    }
    return result
  }

  // Multi-line format
  const lines = trimmedText.split('\n')
  for (const line of lines) {
    const trimmedLine = line.trim()
    if (!trimmedLine) continue
    if (trimmedLine.startsWith('//') || trimmedLine.startsWith('#')) continue

    const pair = parseSinglePair(trimmedLine)
    if (pair) result.push(pair)
  }

  return result
}

function parseSinglePair(line: string): KvPair | null {
  if (!line) return null

  const colonIdx = line.indexOf(':')
  const eqIdx = line.indexOf('=')

  let key = ''
  let value = ''

  if (colonIdx === -1 && eqIdx === -1) {
    key = line.trim()
    value = ''
  } else if (colonIdx !== -1 && (eqIdx === -1 || colonIdx < eqIdx)) {
    key = line.slice(0, colonIdx).trim()
    value = line.slice(colonIdx + 1).trim()
  } else {
    key = line.slice(0, eqIdx).trim()
    value = line.slice(eqIdx + 1).trim()
  }

  if (!key) return null

  return {
    key,
    value,
    enabled: true,
    type: 'text'
  }
}

// ========== Drag and Drop Reorder ==========

function onDragStart(index: number, event: DragEvent) {
  dragIndex.value = index
  if (event.dataTransfer) {
    event.dataTransfer.effectAllowed = 'move'
    event.dataTransfer.setData('text/plain', String(index))
  }
}

function onDragOver(index: number, event: DragEvent) {
  event.preventDefault()
  if (event.dataTransfer) {
    event.dataTransfer.dropEffect = 'move'
  }
  dropIndex.value = index
}

function onDragLeave() {
  dropIndex.value = null
}

function onDrop(index: number, event: DragEvent) {
  event.preventDefault()
  const from = dragIndex.value
  const to = index

  if (from !== null && from !== to) {
    const item = rows.value.splice(from, 1)[0]
    rows.value.splice(to, 0, item)
    update()
  }

  dragIndex.value = null
  dropIndex.value = null
}

function onDragEnd() {
  dragIndex.value = null
  dropIndex.value = null
}

// ========== Duplicate Key Detection ==========

function isDuplicateKey(index: number): boolean {
  const currentKey = rows.value[index]?.key?.trim()
  if (!currentKey) return false
  return rows.value.some((row, i) => i !== index && row.key?.trim() === currentKey)
}

const duplicateKeyIndices = computed(() => {
  const keyMap = new Map<string, number[]>()
  rows.value.forEach((row, i) => {
    const k = row.key?.trim()
    if (!k) return
    const indices = keyMap.get(k) || []
    indices.push(i)
    keyMap.set(k, indices)
  })
  const dupIndices = new Set<number>()
  for (const [, indices] of keyMap) {
    if (indices.length > 1) {
      indices.forEach(i => dupIndices.add(i))
    }
  }
  return dupIndices
})
</script>

<template>
  <div class="kv-editor">
    <!-- Header row with action buttons -->
    <div class="kv-toolbar">
      <div class="kv-toolbar-left">
        <button
          class="toolbar-btn"
          :class="{ active: bulkMode }"
          @click="toggleBulkMode"
          :disabled="readonly"
          title="批量编辑"
        >
          批量编辑
        </button>
        <button
          class="toolbar-btn"
          @click="sortRows"
          :disabled="readonly || bulkMode"
          title="按键名排序"
        >
          排序
        </button>
        <button
          class="toolbar-btn"
          @click="openImportDialog"
          :disabled="readonly || bulkMode"
          title="从文本导入"
        >
          导入
        </button>
      </div>
    </div>

    <!-- Table header (hidden in bulk mode) -->
    <div v-if="!bulkMode" class="kv-header">
      <span class="kv-col kv-col-check"></span>
      <span class="kv-col kv-col-key">{{ keyPlaceholder || 'Key' }}</span>
      <span v-if="allowFileUpload" class="kv-col kv-col-type">类型</span>
      <span class="kv-col kv-col-value">{{ valuePlaceholder || 'Value' }}</span>
      <span v-if="showDescription" class="kv-col kv-col-desc">描述</span>
      <span class="kv-col kv-col-action"></span>
    </div>

    <!-- Table rows (hidden in bulk mode) -->
    <div v-if="!bulkMode" class="kv-rows">
      <div
        v-for="(row, i) in rows"
        :key="i"
        class="kv-row"
        :class="{
          disabled: !row.enabled,
          'drag-over-above': dropIndex === i && dragIndex !== null && dragIndex < i,
          'drag-over-below': dropIndex === i && dragIndex !== null && dragIndex > i,
          'dragging': dragIndex === i
        }"
        :draggable="!readonly && row.enabled"
        @dragstart="!readonly ? onDragStart(i, $event) : null"
        @dragover="!readonly ? onDragOver(i, $event) : null"
        @dragleave="onDragLeave"
        @drop="!readonly ? onDrop(i, $event) : null"
        @dragend="onDragEnd"
      >
        <div class="kv-col kv-col-check">
          <input type="checkbox" :checked="row.enabled" @change="toggleRow(i)" :disabled="readonly" />
        </div>
        <div class="kv-col kv-col-key" :class="{ 'has-duplicate': duplicateKeyIndices.has(i) }">
          <input
            type="text"
            v-model="row.key"
            :placeholder="keyPlaceholder || 'Key'"
            :disabled="readonly || !row.enabled"
            @input="update"
          />
          <span
            v-if="duplicateKeyIndices.has(i)"
            class="duplicate-indicator"
            title="重复的键名"
          >!</span>
        </div>
        <div v-if="allowFileUpload" class="kv-col kv-col-type">
          <button
            class="type-toggle-btn"
            :class="{ 'type-file': row.type === 'file' }"
            :disabled="readonly"
            @click="toggleType(i)"
            :title="row.type === 'file' ? '切换为文本' : '切换为文件'"
          >
            {{ row.type === 'file' ? '文件' : '文本' }}
          </button>
        </div>
        <div class="kv-col kv-col-value">
          <template v-if="row.type === 'file' && allowFileUpload">
            <div class="file-input-wrapper">
              <button
                class="file-select-btn"
                :disabled="readonly || !row.enabled"
                @click="triggerFileInput(i)"
              >
                选择文件
              </button>
              <span v-if="row.fileName" class="file-name-display" :title="row.fileName">{{ row.fileName }}</span>
              <span v-else class="file-name-placeholder">未选择文件</span>
              <input
                type="file"
                class="file-input-hidden"
                :ref="(el) => { if (el) fileInputRefs.set(i, el as HTMLInputElement) }"
                :disabled="readonly || !row.enabled"
                @change="handleFileSelect(i, $event)"
              />
            </div>
          </template>
          <template v-else>
            <input
              ref="activeValueRef"
              type="text"
              v-model="row.value"
              :placeholder="valuePlaceholder || 'Value'"
              :disabled="readonly || !row.enabled"
              @input="update(); valueAutocomplete.handleInput()"
              @keydown="valueAutocomplete.handleKeydown($event) ? null : null"
            />
          </template>
        </div>
        <div v-if="showDescription" class="kv-col kv-col-desc">
          <input
            type="text"
            v-model="row.description"
            placeholder="描述"
            :disabled="readonly || !row.enabled"
            @input="update"
          />
        </div>
        <div class="kv-col kv-col-action">
          <button class="btn-icon" @click="removeRow(i)" :disabled="readonly" title="删除">&times;</button>
        </div>
      </div>
    </div>

    <!-- Bulk edit textarea (shown in bulk mode) -->
    <div v-if="bulkMode" class="kv-bulk-editor">
      <textarea
        v-model="bulkText"
        class="bulk-textarea"
        placeholder="每行一个键值对，格式：key: value&#10;以 ! 开头表示禁用：!key: value&#10;// 或 # 开头的行为注释"
        :readonly="readonly"
        spellcheck="false"
      ></textarea>
      <div class="bulk-hint">
        格式: key: value 或 key=value，! 前缀禁用，// 或 # 注释
      </div>
    </div>

    <button
      v-if="!bulkMode"
      class="btn btn-sm add-row-btn"
      @click="addRow"
      :disabled="readonly"
    >+ 添加行</button>

    <!-- Import dialog -->
    <Teleport to="body">
      <div v-if="showImportDialog" class="import-overlay" @click.self="closeImportDialog">
        <div class="import-dialog">
          <div class="import-dialog-header">
            <span>从文本导入</span>
            <button class="btn-icon" @click="closeImportDialog" title="关闭">&times;</button>
          </div>
          <div class="import-dialog-body">
            <textarea
              v-model="importText"
              class="import-textarea"
              placeholder="粘贴键值对，支持以下格式：&#10;&#10;key: value&#10;key=value&#10;key: value; key2: value2（单行分号分隔）"
              spellcheck="false"
            ></textarea>
          </div>
          <div class="import-dialog-footer">
            <button class="btn btn-sm" @click="closeImportDialog">取消</button>
            <button class="btn btn-sm btn-primary" @click="doImport" :disabled="!importText.trim()">导入</button>
          </div>
        </div>
      </div>
    </Teleport>
  </div>

  <VariableAutocomplete
    :visible="valueAutocomplete.showAutocomplete.value"
    :position="valueAutocomplete.autocompletePosition.value"
    :filter="valueAutocomplete.autocompleteFilter.value"
    :items="valueAutocomplete.allItems.value"
    @select="valueAutocomplete.insertVariable"
    @close="valueAutocomplete.close"
  />
</template>

<style scoped>
.kv-editor {
  display: flex;
  flex-direction: column;
  height: 100%;
}

/* ========== Toolbar ========== */

.kv-toolbar {
  display: flex;
  align-items: center;
  justify-content: space-between;
  padding: 4px 0;
  margin-bottom: 2px;
}

.kv-toolbar-left {
  display: flex;
  align-items: center;
  gap: 4px;
}

.toolbar-btn {
  height: 24px;
  padding: 0 8px;
  border: 1px solid var(--border);
  border-radius: var(--radius-md);
  background: var(--bg-panel);
  color: var(--text-secondary);
  cursor: pointer;
  font-size: 11px;
  font-weight: 500;
  white-space: nowrap;
  transition: all 0.15s;
}

.toolbar-btn:hover:not(:disabled) {
  border-color: var(--primary);
  color: var(--primary);
}

.toolbar-btn.active {
  background: var(--primary-soft);
  border-color: var(--primary);
  color: var(--primary);
}

.toolbar-btn:disabled {
  opacity: 0.4;
  cursor: not-allowed;
}

/* ========== Table Header ========== */

.kv-header {
  display: flex;
  align-items: center;
  padding: 6px 0;
  border-bottom: 1px solid var(--divider);
  font-size: var(--font-size-small);
  color: var(--text-secondary);
  font-weight: 700;
}

/* ========== Table Rows ========== */

.kv-row {
  display: flex;
  align-items: center;
  padding: 4px 0;
  border-bottom: 1px solid var(--divider);
  transition: background 0.15s;
  position: relative;
}

.kv-row.disabled {
  opacity: 0.5;
}

.kv-row.dragging {
  opacity: 0.4;
  background: var(--bg-panel-elevated);
}

.kv-row.drag-over-above {
  box-shadow: inset 0 2px 0 0 var(--primary);
}

.kv-row.drag-over-below {
  box-shadow: inset 0 -2px 0 0 var(--primary);
}

.kv-col {
  padding: 0 4px;
}

.kv-col-check {
  width: 28px;
  flex-shrink: 0;
  text-align: center;
}

.kv-col-key {
  flex: 1;
  min-width: 0;
  position: relative;
  display: flex;
  align-items: center;
  gap: 2px;
}

.kv-col-key .duplicate-indicator {
  position: absolute;
  right: 8px;
  width: 16px;
  height: 16px;
  border-radius: 50%;
  background: #f59e0b;
  color: #fff;
  font-size: 10px;
  font-weight: 700;
  display: flex;
  align-items: center;
  justify-content: center;
  flex-shrink: 0;
  pointer-events: none;
  line-height: 1;
}

.kv-col-key.has-duplicate input[type="text"] {
  padding-right: 26px;
}

.kv-col-type {
  width: 60px;
  flex-shrink: 0;
  text-align: center;
}

.kv-col-value {
  flex: 1.5;
  min-width: 0;
}

.kv-col-desc {
  flex: 1;
  min-width: 0;
}

.kv-col-action {
  width: 28px;
  flex-shrink: 0;
  text-align: center;
}

.kv-col input[type="text"] {
  width: 100%;
  height: 30px;
  border: 1px solid transparent;
  border-radius: var(--radius-md);
  padding: 0 8px;
  font-size: var(--font-size-body);
  background: transparent;
}

.kv-col input[type="text"]:focus {
  border-color: var(--primary);
  background: var(--bg-panel);
  box-shadow: var(--focus-ring);
}

.kv-col input[type="text"]:disabled {
  opacity: 0.5;
}

.kv-col input[type="checkbox"] {
  cursor: pointer;
}

.type-toggle-btn {
  width: 100%;
  height: 26px;
  border: 1px solid var(--border);
  border-radius: var(--radius-md);
  background: var(--bg-panel);
  color: var(--text-secondary);
  cursor: pointer;
  font-size: 11px;
  font-weight: 600;
  transition: all 0.15s;
  white-space: nowrap;
}

.type-toggle-btn:hover:not(:disabled) {
  border-color: var(--primary);
  color: var(--primary);
}

.type-toggle-btn.type-file {
  background: var(--primary-soft);
  border-color: var(--primary);
  color: var(--primary);
}

.type-toggle-btn:disabled {
  opacity: 0.5;
  cursor: not-allowed;
}

.file-input-wrapper {
  display: flex;
  align-items: center;
  gap: 6px;
  width: 100%;
  height: 30px;
}

.file-select-btn {
  flex-shrink: 0;
  height: 26px;
  padding: 0 10px;
  border: 1px solid var(--border);
  border-radius: var(--radius-md);
  background: var(--bg-panel-elevated);
  color: var(--text-secondary);
  cursor: pointer;
  font-size: 11px;
  white-space: nowrap;
  transition: all 0.15s;
}

.file-select-btn:hover:not(:disabled) {
  border-color: var(--primary);
  color: var(--primary);
}

.file-select-btn:disabled {
  opacity: 0.5;
  cursor: not-allowed;
}

.file-name-display {
  flex: 1;
  min-width: 0;
  font-size: var(--font-size-small);
  color: var(--text-primary);
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
}

.file-name-placeholder {
  flex: 1;
  min-width: 0;
  font-size: var(--font-size-small);
  color: var(--text-tertiary);
}

.file-input-hidden {
  display: none;
}

.kv-rows {
  flex: 1;
  overflow-y: auto;
}

.add-row-btn {
  margin-top: 4px;
  width: 100%;
  justify-content: center;
  border-style: dashed;
  color: var(--text-secondary);
}

.add-row-btn:hover {
  color: var(--primary);
  border-color: var(--primary);
}

/* ========== Bulk Edit Mode ========== */

.kv-bulk-editor {
  flex: 1;
  display: flex;
  flex-direction: column;
  min-height: 0;
}

.bulk-textarea {
  flex: 1;
  width: 100%;
  min-height: 120px;
  resize: vertical;
  border: 1px solid var(--border);
  border-radius: var(--radius-md);
  padding: 8px;
  font-family: var(--font-mono, 'Menlo', 'Consolas', monospace);
  font-size: var(--font-size-body);
  line-height: 1.6;
  background: var(--bg-panel);
  color: var(--text-primary);
  outline: none;
}

.bulk-textarea:focus {
  border-color: var(--primary);
  box-shadow: var(--focus-ring);
}

.bulk-hint {
  margin-top: 4px;
  font-size: 11px;
  color: var(--text-tertiary);
}

/* ========== Import Dialog ========== */

.import-overlay {
  position: fixed;
  inset: 0;
  z-index: 9999;
  background: rgba(0, 0, 0, 0.45);
  display: flex;
  align-items: center;
  justify-content: center;
}

.import-dialog {
  width: 480px;
  max-width: 90vw;
  background: var(--bg-panel-elevated);
  border-radius: var(--radius-lg, 8px);
  box-shadow: 0 8px 32px rgba(0, 0, 0, 0.25);
  display: flex;
  flex-direction: column;
  overflow: hidden;
}

.import-dialog-header {
  display: flex;
  align-items: center;
  justify-content: space-between;
  padding: 12px 16px;
  border-bottom: 1px solid var(--divider);
  font-weight: 600;
  font-size: var(--font-size-body);
  color: var(--text-primary);
}

.import-dialog-body {
  padding: 16px;
}

.import-textarea {
  width: 100%;
  min-height: 180px;
  resize: vertical;
  border: 1px solid var(--border);
  border-radius: var(--radius-md);
  padding: 8px;
  font-family: var(--font-mono, 'Menlo', 'Consolas', monospace);
  font-size: var(--font-size-body);
  line-height: 1.6;
  background: var(--bg-panel);
  color: var(--text-primary);
  outline: none;
}

.import-textarea:focus {
  border-color: var(--primary);
  box-shadow: var(--focus-ring);
}

.import-dialog-footer {
  display: flex;
  align-items: center;
  justify-content: flex-end;
  gap: 8px;
  padding: 12px 16px;
  border-top: 1px solid var(--divider);
}

.btn-primary {
  background: var(--primary);
  color: #fff;
  border-color: var(--primary);
}

.btn-primary:hover:not(:disabled) {
  opacity: 0.9;
}

.btn-primary:disabled {
  opacity: 0.5;
  cursor: not-allowed;
}
</style>
