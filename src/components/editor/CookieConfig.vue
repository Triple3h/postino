<script setup lang="ts">
import { ref, watch } from 'vue'
import KvEditor from '@/components/common/KvEditor.vue'
import type { CookieItem } from '@/types'

const props = defineProps<{
  modelValue: CookieItem[]
  autoCarry: boolean
  readonly?: boolean
}>()

const emit = defineEmits<{
  'update:modelValue': [value: CookieItem[]]
  'update:autoCarry': [value: boolean]
}>()

const rows = ref<CookieItem[]>([...props.modelValue])

watch(() => props.modelValue, (val) => {
  rows.value = [...val]
}, { deep: true })

function updateCookies(cookies: CookieItem[]) {
  if (props.readonly) return
  emit('update:modelValue', cookies)
}

function toggleAutoCarry() {
  if (props.readonly) return
  emit('update:autoCarry', !props.autoCarry)
}
</script>

<template>
  <div class="cookie-config">
    <div class="auto-carry-section">
      <label class="auto-carry-label">
        <input
          type="checkbox"
          :checked="autoCarry"
          :disabled="readonly"
          @change="toggleAutoCarry"
        />
        <span>自动携带当前域名 Cookie</span>
      </label>
    </div>
    <div class="manual-cookies-section">
      <div class="section-title">手动 Cookie</div>
      <KvEditor
        :model-value="rows"
        @update:model-value="updateCookies"
        key-placeholder="Cookie 名"
        value-placeholder="值"
        show-description
        :readonly="readonly"
      />
    </div>
  </div>
</template>

<style scoped>
.cookie-config {
  display: flex;
  flex-direction: column;
  height: 100%;
  gap: 8px;
}

.auto-carry-section {
  padding: 4px 0;
  border-bottom: 1px solid var(--divider);
}

.auto-carry-label {
  display: flex;
  align-items: center;
  gap: 8px;
  cursor: pointer;
  font-size: var(--font-size-body);
  color: var(--text-primary);
}

.auto-carry-label input[type="checkbox"] {
  cursor: pointer;
}

.section-title {
  font-size: var(--font-size-small);
  color: var(--text-secondary);
  font-weight: 500;
  padding: 4px 0;
}

.manual-cookies-section {
  flex: 1;
  display: flex;
  flex-direction: column;
  overflow: hidden;
}
</style>
