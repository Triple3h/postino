<script setup lang="ts">
import { computed } from 'vue'
import type { AuthConfig } from '@/types'

const props = defineProps<{
  modelValue: AuthConfig
}>()

const emit = defineEmits<{
  'update:modelValue': [value: AuthConfig]
}>()

const auth = computed({
  get: () => props.modelValue,
  set: (val) => emit('update:modelValue', val),
})

const authTypes: { value: AuthConfig['type']; label: string }[] = [
  { value: 'none', label: '无认证' },
  { value: 'bearer', label: 'Bearer Token' },
  { value: 'basic', label: 'Basic Auth' },
  { value: 'apikey', label: 'API Key' },
]

function update(partial: Partial<AuthConfig>) {
  emit('update:modelValue', { ...props.modelValue, ...partial })
}
</script>

<template>
  <div class="auth-config">
    <div class="auth-type-select">
      <label>认证类型</label>
      <select :value="auth.type" @change="update({ type: ($event.target as HTMLSelectElement).value as AuthConfig['type'] })">
        <option v-for="t in authTypes" :key="t.value" :value="t.value">{{ t.label }}</option>
      </select>
    </div>

    <div v-if="auth.type === 'bearer'" class="auth-fields">
      <div class="field">
        <label>Token</label>
        <input type="text" :value="auth.bearerToken" @input="update({ bearerToken: ($event.target as HTMLInputElement).value })" placeholder="输入 Bearer Token" />
      </div>
      <div class="field-hint">
        将发送 <code>Authorization: Bearer {{ auth.bearerToken || 'token' }}</code>
      </div>
    </div>

    <div v-if="auth.type === 'basic'" class="auth-fields">
      <div class="field">
        <label>用户名</label>
        <input type="text" :value="auth.basicUsername" @input="update({ basicUsername: ($event.target as HTMLInputElement).value })" placeholder="用户名" />
      </div>
      <div class="field">
        <label>密码</label>
        <input type="text" :value="auth.basicPassword" @input="update({ basicPassword: ($event.target as HTMLInputElement).value })" placeholder="密码" />
      </div>
    </div>

    <div v-if="auth.type === 'apikey'" class="auth-fields">
      <div class="field">
        <label>Key 名称</label>
        <input type="text" :value="auth.apiKeyName" @input="update({ apiKeyName: ($event.target as HTMLInputElement).value })" placeholder="Header 或 Query 参数名" />
      </div>
      <div class="field">
        <label>Key 值</label>
        <input type="text" :value="auth.apiKeyValue" @input="update({ apiKeyValue: ($event.target as HTMLInputElement).value })" placeholder="API Key 值" />
      </div>
      <div class="field">
        <label>添加到</label>
        <select :value="auth.apiKeyIn" @change="update({ apiKeyIn: ($event.target as HTMLSelectElement).value as AuthConfig['apiKeyIn'] })">
          <option value="header">Header</option>
          <option value="query">Query 参数</option>
        </select>
      </div>
    </div>
  </div>
</template>

<style scoped>
.auth-config {
  padding: 8px 0;
}

.auth-type-select {
  display: flex;
  align-items: center;
  gap: 12px;
  margin-bottom: 12px;
}

.auth-type-select label {
  font-size: var(--font-size-body);
  color: var(--text-secondary);
  min-width: 70px;
}

.auth-type-select select {
  font-size: var(--font-size-body);
  min-height: 34px;
}

.auth-fields {
  display: flex;
  flex-direction: column;
  gap: 8px;
}

.field {
  display: flex;
  align-items: center;
  gap: 12px;
}

.field label {
  font-size: var(--font-size-body);
  color: var(--text-secondary);
  min-width: 70px;
}

.field input,
.field select {
  flex: 1;
  min-height: 34px;
  font-size: var(--font-size-body);
}

.field input:focus,
.field select:focus {
  border-color: var(--primary);
}

.field-hint {
  padding-left: 82px;
  font-size: var(--font-size-small);
  color: var(--text-tertiary);
}

.field-hint code {
  background: var(--bg-code);
  padding: 1px 4px;
  border-radius: 2px;
  font-family: var(--font-code);
  font-size: var(--font-size-small);
}
</style>
