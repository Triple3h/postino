<script setup lang="ts">
import { Plus, Trash2 } from '@lucide/vue'
import type { PostResponseExtractor } from '@/types'

const props = defineProps<{
  modelValue: PostResponseExtractor[]
  readonly?: boolean
  hasFolder?: boolean
}>()

const emit = defineEmits<{
  'update:modelValue': [value: PostResponseExtractor[]]
}>()

function createRule(): PostResponseExtractor {
  return {
    id: `extract:${Date.now().toString(36)}${Math.random().toString(36).slice(2, 6)}`,
    enabled: true,
    variableName: '',
    variableScope: 'collection',
    source: 'response-json',
    extractMode: 'jsonpath',
    jsonPath: '',
    unwrapArray: false,
  }
}

function addRule() {
  if (props.readonly) return
  emit('update:modelValue', [...props.modelValue, createRule()])
}

function updateRule(id: string, patch: Partial<PostResponseExtractor>) {
  if (props.readonly) return
  emit('update:modelValue', props.modelValue.map(rule => rule.id === id ? { ...rule, ...patch } : rule))
}

function removeRule(id: string) {
  if (props.readonly) return
  emit('update:modelValue', props.modelValue.filter(rule => rule.id !== id))
}
</script>

<template>
  <div class="post-actions">
    <div v-if="modelValue.length === 0" class="empty-actions">
      <span>暂无后置操作</span>
      <button class="btn btn-sm btn-primary" :disabled="readonly" @click="addRule"><Plus :size="14" /> 添加提取变量</button>
    </div>

    <article v-for="(rule, index) in modelValue" :key="rule.id" class="action-card">
      <header class="action-header">
        <label class="action-title">
          <input type="checkbox" :checked="rule.enabled" :disabled="readonly" @change="updateRule(rule.id, { enabled: ($event.target as HTMLInputElement).checked })">
          <span>提取变量</span>
          <small>Response JSON</small>
        </label>
        <button class="icon-btn" title="删除操作" :disabled="readonly" @click="removeRule(rule.id)"><Trash2 :size="14" /></button>
      </header>

      <div class="action-fields">
        <label class="field">
          <span>变量名称 <b>*</b></span>
          <input :value="rule.variableName" :disabled="readonly" placeholder="例如 accessToken" @input="updateRule(rule.id, { variableName: ($event.target as HTMLInputElement).value })">
        </label>

        <label class="field">
          <span>变量类型</span>
          <select :value="rule.variableScope" :disabled="readonly" @change="updateRule(rule.id, { variableScope: ($event.target as HTMLSelectElement).value as PostResponseExtractor['variableScope'] })">
            <option value="collection">集合变量</option>
            <option value="folder" :disabled="!hasFolder">分组变量{{ hasFolder ? '' : '（当前无分组）' }}</option>
            <option value="temporary">临时变量</option>
          </select>
        </label>

        <label class="field">
          <span>提取源</span>
          <select disabled><option>Response JSON</option></select>
        </label>

        <fieldset class="field extract-mode">
          <legend>提取</legend>
          <label><input type="radio" value="whole-json" :checked="rule.extractMode === 'whole-json'" :disabled="readonly" @change="updateRule(rule.id, { extractMode: 'whole-json' })"> 整个 JSON</label>
          <label><input type="radio" value="jsonpath" :checked="rule.extractMode === 'jsonpath'" :disabled="readonly" @change="updateRule(rule.id, { extractMode: 'jsonpath' })"> JSONPath</label>
        </fieldset>

        <label v-if="rule.extractMode === 'jsonpath'" class="field full-width">
          <span>JSONPath</span>
          <input :value="rule.jsonPath" :disabled="readonly" placeholder="例如 $.data.accessToken" @input="updateRule(rule.id, { jsonPath: ($event.target as HTMLInputElement).value })">
        </label>

        <label v-if="rule.extractMode === 'jsonpath'" class="array-toggle full-width">
          <span>数组解包</span>
          <input type="checkbox" :checked="rule.unwrapArray" :disabled="readonly" @change="updateRule(rule.id, { unwrapArray: ($event.target as HTMLInputElement).checked })">
        </label>
      </div>
      <span class="action-index">{{ index + 1 }}</span>
    </article>

    <button v-if="modelValue.length" class="add-action" :disabled="readonly" @click="addRule"><Plus :size="14" /> 添加操作</button>
  </div>
</template>

<style scoped>
.post-actions { display: flex; flex-direction: column; gap: 10px; }
.empty-actions { min-height: 150px; display: flex; flex-direction: column; align-items: center; justify-content: center; gap: 12px; color: var(--secondary-color); }
.btn { display: inline-flex; align-items: center; gap: 6px; }
.action-card { position: relative; overflow: hidden; border: 1px solid var(--divider-color); border-radius: var(--radius-md); background: var(--primary-color); }
.action-header { height: 36px; padding: 0 10px; display: flex; align-items: center; justify-content: space-between; background: var(--primary-dark-color); }
.action-title { display: flex; align-items: center; gap: 8px; font-size: var(--font-size-body); color: var(--secondary-dark-color); }
.action-title small { color: var(--secondary-color); font-size: var(--font-size-tiny); font-weight: 400; }
.icon-btn { width: 26px; height: 26px; display: inline-flex; align-items: center; justify-content: center; border-radius: var(--radius-sm); color: var(--secondary-color); }
.icon-btn:hover:not(:disabled) { color: var(--danger-color); background: color-mix(in srgb, var(--danger-color) 10%, transparent); }
.action-fields { display: grid; grid-template-columns: minmax(180px, 1fr) minmax(180px, 1fr); gap: 12px 14px; padding: 12px 14px 14px; }
.field { min-width: 0; display: flex; flex-direction: column; gap: 6px; color: var(--secondary-color); font-size: var(--font-size-tiny); }
.field b { color: var(--danger-color); }
.field input[type='text'], .field > input:not([type]), .field select { width: 100%; height: 30px; padding: 0 9px; border: 1px solid var(--divider-dark-color); border-radius: var(--radius-sm); background: var(--primary-color); color: var(--secondary-dark-color); outline: none; }
.field input:focus, .field select:focus { border-color: var(--accent-color); }
.field select:disabled { opacity: .7; }
.extract-mode { flex-direction: row; align-items: center; gap: 14px; border: 0; padding: 0; margin: 0; }
.extract-mode legend { margin-bottom: 7px; }
.extract-mode label { display: inline-flex; align-items: center; gap: 5px; color: var(--secondary-dark-color); }
.full-width { grid-column: 1 / -1; }
.array-toggle { min-height: 28px; display: flex; align-items: center; justify-content: space-between; padding: 0 9px; border-radius: var(--radius-sm); background: var(--primary-dark-color); color: var(--secondary-color); font-size: var(--font-size-tiny); }
.action-index { display: none; }
.add-action { align-self: flex-start; display: inline-flex; align-items: center; gap: 5px; padding: 5px 8px; border-radius: var(--radius-sm); color: var(--accent-color); font-size: var(--font-size-tiny); }
.add-action:hover:not(:disabled) { background: color-mix(in srgb, var(--accent-color) 10%, transparent); }
@media (max-width: 640px) { .action-fields { grid-template-columns: 1fr; } .full-width { grid-column: auto; } }
</style>
