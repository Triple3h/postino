<template>
  <Teleport to="body">
    <div
      v-if="visible && filteredItems.length > 0"
      class="var-autocomplete"
      :style="{ top: position.top + 'px', left: position.left + 'px' }"
    >
      <div
        v-for="(item, i) in filteredItems"
        :key="item.name"
        class="var-item"
        :class="{ active: i === selectedIndex }"
        @mousedown.prevent="select(item.name)"
        @mouseenter="selectedIndex = i"
      >
        <span class="var-name">{{ item.name }}</span>
        <span class="var-preview">{{ item.preview }}</span>
        <span class="var-badge" :class="item.source === '动态函数' ? 'fn' : 'env'">{{ item.source }}</span>
      </div>
    </div>
  </Teleport>
</template>

<script setup lang="ts">
import { ref, computed, watch } from 'vue'

interface AutocompleteItem {
  name: string
  preview: string
  source: string
}

const props = defineProps<{
  visible: boolean
  position: { top: number; left: number }
  filter: string
  items: AutocompleteItem[]
}>()

const emit = defineEmits<{
  select: [name: string]
  close: []
}>()

const selectedIndex = ref(0)

const filteredItems = computed(() => {
  if (!props.filter) return props.items.slice(0, 50)
  const q = props.filter.toLowerCase()
  return props.items.filter(it => it.name.toLowerCase().includes(q)).slice(0, 50)
})

watch(() => props.filter, () => { selectedIndex.value = 0 })
watch(() => props.visible, () => { selectedIndex.value = 0 })

function select(name: string) {
  emit('select', name)
}

function moveUp() {
  if (selectedIndex.value > 0) selectedIndex.value--
}

function moveDown() {
  if (selectedIndex.value < filteredItems.value.length - 1) selectedIndex.value++
}

function confirmSelect() {
  if (filteredItems.value[selectedIndex.value]) {
    select(filteredItems.value[selectedIndex.value].name)
  }
}

defineExpose({ moveUp, moveDown, confirmSelect })
</script>

<style scoped>
.var-autocomplete {
  position: fixed;
  z-index: 10000;
  min-width: 320px;
  max-width: 420px;
  max-height: 280px;
  overflow-y: auto;
  background: var(--bg-primary, #fff);
  border: 1px solid var(--border-color, #ddd);
  border-radius: 6px;
  box-shadow: 0 4px 16px rgba(0,0,0,.12);
  padding: 4px 0;
}

.var-item {
  display: flex;
  align-items: center;
  gap: 8px;
  padding: 6px 12px;
  cursor: pointer;
  font-size: 13px;
}
.var-item:hover,
.var-item.active {
  background: var(--primary-light, #e8f0fe);
}

.var-name {
  font-family: 'SF Mono', 'Fira Code', monospace;
  font-weight: 600;
  color: var(--text-primary, #333);
  white-space: nowrap;
}

.var-preview {
  flex: 1;
  color: var(--text-secondary, #888);
  font-size: 12px;
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
}

.var-badge {
  font-size: 10px;
  padding: 1px 6px;
  border-radius: 8px;
  white-space: nowrap;
}
.var-badge.env {
  background: #e0edff;
  color: #1a73e8;
}
.var-badge.fn {
  background: #f0e6ff;
  color: #7c3aed;
}

[data-theme="dark"] .var-autocomplete {
  background: #2a2a2a;
  border-color: #444;
}
[data-theme="dark"] .var-item:hover,
[data-theme="dark"] .var-item.active {
  background: #3a3a4a;
}
[data-theme="dark"] .var-name { color: #e0e0e0; }
[data-theme="dark"] .var-preview { color: #888; }
[data-theme="dark"] .var-badge.env { background: #1a3a5c; color: #6db3f2; }
[data-theme="dark"] .var-badge.fn { background: #3a1a5c; color: #b48ef2; }
</style>
