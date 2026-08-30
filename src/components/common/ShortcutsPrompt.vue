<script setup lang="ts">
import { computed, onMounted, onUnmounted, ref } from 'vue'
import { X } from '@lucide/vue'
import { useAppStore } from '@/stores/app'
import { SHORTCUT_ACTIONS, formatShortcutForDisplay, getEffectiveShortcuts } from '@/utils/shortcuts'
import type { AppShortcutAction } from '@/types'

/**
 * 快捷键总览弹窗(FR-8.2,参考 Hoppscotch ShortcutsPrompt.vue):
 * 数据即声明式注册表,展示自定义生效后的组合;`?` 或 postino:show-shortcuts 唤起。
 */
const store = useAppStore()
const visible = ref(false)

const groups = computed(() => {
  const effective = getEffectiveShortcuts(store.settings.customShortcuts)
  const byGroup = new Map<string, Array<{ label: string; description: string; keys: string }>>()
  for (const meta of SHORTCUT_ACTIONS) {
    const list = byGroup.get(meta.group) ?? []
    list.push({
      label: meta.label,
      description: meta.description,
      keys: formatShortcutForDisplay(effective[meta.action]),
    })
    byGroup.set(meta.group, list)
  }
  return [...byGroup.entries()].map(([name, items]) => ({ name, items }))
})

function open() {
  visible.value = true
}

function close() {
  visible.value = false
}

function onKeydown(e: KeyboardEvent) {
  if (!visible.value) return
  if (e.key === 'Escape') close()
}

onMounted(() => {
  window.addEventListener('postino:show-shortcuts', open)
  document.addEventListener('keydown', onKeydown)
})
onUnmounted(() => {
  window.removeEventListener('postino:show-shortcuts', open)
  document.removeEventListener('keydown', onKeydown)
})
</script>

<template>
  <Teleport to="body">
    <div v-if="visible" class="modal-overlay" @click.self="close">
      <div class="shortcuts-modal">
        <header class="modal-header">
          <div>
            <h3>键盘快捷键</h3>
            <p>在 设置 → 快捷键 中可以重新绑定。</p>
          </div>
          <button class="close-btn" @click="close"><X :size="15" /></button>
        </header>
        <div class="shortcuts-body">
          <section v-for="group in groups" :key="group.name" class="shortcut-group">
            <h4>{{ group.name }}</h4>
            <div v-for="item in group.items" :key="item.label" class="shortcut-row">
              <span class="shortcut-label" :title="item.description">{{ item.label }}</span>
              <span class="shortcut-desc">{{ item.description }}</span>
              <kbd class="shortcut-keys">{{ item.keys }}</kbd>
            </div>
          </section>
        </div>
      </div>
    </div>
  </Teleport>
</template>

<style scoped>
.modal-overlay {
  position: fixed;
  inset: 0;
  z-index: 1250;
  display: flex;
  align-items: center;
  justify-content: center;
  background: rgba(0, 0, 0, 0.45);
  backdrop-filter: blur(4px);
}

.shortcuts-modal {
  display: flex;
  flex-direction: column;
  width: min(620px, calc(100vw - 32px));
  max-height: 82vh;
  padding: 16px;
  border: 1px solid var(--divider-dark-color);
  border-radius: var(--radius-lg);
  background: var(--popover-color);
  box-shadow: var(--shadow-lg);
}

.modal-header {
  display: flex;
  align-items: flex-start;
  justify-content: space-between;
  margin-bottom: 8px;
}

.modal-header h3 {
  font-size: 15px;
}

.modal-header p {
  margin-top: 3px;
  color: var(--secondary-color);
  font-size: var(--font-size-tiny);
}

.close-btn {
  display: inline-flex;
  padding: 4px;
  border-radius: var(--radius-sm);
  color: var(--secondary-color);
}

.close-btn:hover {
  background: var(--primary-dark-color);
  color: var(--secondary-dark-color);
}

.shortcuts-body {
  overflow-y: auto;
  display: grid;
  grid-template-columns: repeat(auto-fit, minmax(260px, 1fr));
  gap: 8px 24px;
}

.shortcut-group h4 {
  padding: 6px 0;
  color: var(--accent-color);
  font-size: var(--font-size-tiny);
  font-weight: 700;
  text-transform: uppercase;
  letter-spacing: 0.05em;
}

.shortcut-row {
  display: flex;
  align-items: center;
  gap: 8px;
  padding: 4px 0;
  border-bottom: 1px solid color-mix(in srgb, var(--divider-color) 60%, transparent);
  font-size: var(--font-size-body);
}

.shortcut-label {
  font-weight: 600;
  color: var(--secondary-dark-color);
  flex-shrink: 0;
}

.shortcut-desc {
  flex: 1;
  min-width: 0;
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
  color: var(--secondary-light-color);
  font-size: var(--font-size-tiny);
}

.shortcut-keys {
  border: 1px solid var(--divider-dark-color);
  border-radius: 4px;
  padding: 1px 7px;
  font-family: var(--font-mono);
  font-size: var(--font-size-tiny);
  color: var(--secondary-color);
  flex-shrink: 0;
}
</style>
