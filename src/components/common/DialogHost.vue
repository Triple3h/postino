<script setup lang="ts">
import { nextTick, ref, watch } from 'vue'
import { AlertTriangle, Pencil } from '@lucide/vue'
import { dialogState, resolveDialog } from '@/composables/useDialog'

const inputRef = ref<HTMLInputElement | null>(null)

watch(() => dialogState.visible, async visible => {
  if (visible && dialogState.kind === 'prompt') {
    await nextTick()
    inputRef.value?.focus()
    inputRef.value?.select()
  }
})
</script>

<template>
  <Teleport to="body">
    <Transition name="dialog-fade">
      <div v-if="dialogState.visible" class="dialog-overlay" @click.self="resolveDialog(false)">
        <div class="dialog-card" role="dialog" aria-modal="true" :aria-labelledby="'app-dialog-title'">
          <div class="dialog-icon" :class="{ danger: dialogState.danger }">
            <Pencil v-if="dialogState.kind === 'prompt'" :size="18" />
            <AlertTriangle v-else :size="18" />
          </div>
          <div class="dialog-body">
            <h3 id="app-dialog-title">{{ dialogState.title }}</h3>
            <p>{{ dialogState.message }}</p>
            <input
              v-if="dialogState.kind === 'prompt'"
              ref="inputRef"
              v-model="dialogState.inputValue"
              type="text"
              class="dialog-input"
              :placeholder="dialogState.placeholder"
              @keydown.enter="resolveDialog(true)"
              @keydown.escape="resolveDialog(false)"
            />
          </div>
          <div class="dialog-actions">
            <button v-if="dialogState.tertiaryText" class="btn" @click="resolveDialog('tertiary')">
              {{ dialogState.tertiaryText }}
            </button>
            <button class="btn" @click="resolveDialog(false)">{{ dialogState.cancelText }}</button>
            <button :class="['btn', dialogState.danger ? 'btn-danger' : 'btn-primary']" @click="resolveDialog(true)">
              {{ dialogState.confirmText }}
            </button>
          </div>
        </div>
      </div>
    </Transition>
  </Teleport>
</template>

<style scoped>
.dialog-overlay {
  position: fixed;
  inset: 0;
  z-index: 3000;
  display: grid;
  place-items: center;
  padding: 18px;
  background: rgba(2, 6, 23, 0.5);
  backdrop-filter: blur(8px);
}

.dialog-card {
  width: min(420px, 100%);
  display: grid;
  grid-template-columns: auto minmax(0, 1fr);
  gap: 14px;
  border: 1px solid var(--border);
  border-radius: var(--radius-2xl);
  background: var(--bg-panel);
  color: var(--text-primary);
  box-shadow: var(--shadow-lg);
  padding: 18px;
}

.dialog-icon {
  width: 34px;
  height: 34px;
  display: inline-flex;
  align-items: center;
  justify-content: center;
  border-radius: 13px;
  background: var(--primary-soft);
  color: var(--primary);
  font-weight: 900;
}

.dialog-icon.danger {
  background: color-mix(in srgb, var(--error) 14%, transparent);
  color: var(--error);
}

.dialog-body {
  min-width: 0;
}

.dialog-body h3 {
  margin: 0 0 6px;
  font-size: 16px;
}

.dialog-body p {
  margin: 0;
  color: var(--text-secondary);
  line-height: 1.6;
}

.dialog-input {
  width: 100%;
  margin-top: 12px;
  min-height: 36px;
}

.dialog-actions {
  grid-column: 1 / -1;
  display: flex;
  justify-content: flex-end;
  gap: 8px;
  padding-top: 2px;
}

.btn-danger {
  background: linear-gradient(135deg, var(--error), #f97316);
  color: #fff;
  border-color: transparent;
  box-shadow: 0 10px 18px color-mix(in srgb, var(--error) 25%, transparent);
}

.dialog-fade-enter-active,
.dialog-fade-leave-active {
  transition: opacity 0.16s ease;
}

.dialog-fade-enter-from,
.dialog-fade-leave-to {
  opacity: 0;
}
</style>
