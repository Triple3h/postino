<script setup lang="ts">
import { ref, watch } from 'vue'
import type { KvPair } from '@/types'
import VariableAutocomplete from '@/components/common/VariableAutocomplete.vue'
import { useVariableAutocomplete } from '@/composables/useVariableAutocomplete'

const props = defineProps<{
  modelValue: KvPair[]
  keyPlaceholder?: string
  valuePlaceholder?: string
  showDescription?: boolean
  readonly?: boolean
}>()

const emit = defineEmits<{
  'update:modelValue': [value: KvPair[]]
}>()

const rows = ref<KvPair[]>([...props.modelValue])

watch(() => props.modelValue, (val) => {
  rows.value = [...val]
}, { deep: true })

function update() {
  emit('update:modelValue', rows.value.filter(r => r.key.trim()))
}

function addRow() {
  rows.value.push({ key: '', value: '', enabled: true, description: '' })
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

const activeValueRef = ref<HTMLInputElement | null>(null)
const valueAutocomplete = useVariableAutocomplete(activeValueRef)
</script>

<template>
  <div class="kv-editor">
    <div class="kv-header">
      <span class="kv-col kv-col-check"></span>
      <span class="kv-col kv-col-key">{{ keyPlaceholder || 'Key' }}</span>
      <span class="kv-col kv-col-value">{{ valuePlaceholder || 'Value' }}</span>
      <span v-if="showDescription" class="kv-col kv-col-desc">描述</span>
      <span class="kv-col kv-col-action"></span>
    </div>
    <div class="kv-rows">
      <div v-for="(row, i) in rows" :key="i" class="kv-row" :class="{ disabled: !row.enabled }">
        <div class="kv-col kv-col-check">
          <input type="checkbox" :checked="row.enabled" @change="toggleRow(i)" :disabled="readonly" />
        </div>
        <div class="kv-col kv-col-key">
          <input
            type="text"
            v-model="row.key"
            :placeholder="keyPlaceholder || 'Key'"
            :disabled="readonly || !row.enabled"
            @input="update"
          />
        </div>
        <div class="kv-col kv-col-value">
          <input
            ref="activeValueRef"
            type="text"
            v-model="row.value"
            :placeholder="valuePlaceholder || 'Value'"
            :disabled="readonly || !row.enabled"
            @input="update; valueAutocomplete.handleInput()"
            @keydown="valueAutocomplete.handleKeydown($event) ? null : null"
          />
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
          <button class="btn-icon" @click="removeRow(i)" :disabled="readonly" title="删除">×</button>
        </div>
      </div>
    </div>
    <button class="btn btn-sm add-row-btn" @click="addRow" :disabled="readonly">+ 添加行</button>
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

.kv-header {
  display: flex;
  align-items: center;
  padding: 6px 0;
  border-bottom: 1px solid var(--divider);
  font-size: var(--font-size-small);
  color: var(--text-secondary);
  font-weight: 700;
}

.kv-row {
  display: flex;
  align-items: center;
  padding: 4px 0;
  border-bottom: 1px solid var(--divider);
}

.kv-row.disabled {
  opacity: 0.5;
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
</style>
