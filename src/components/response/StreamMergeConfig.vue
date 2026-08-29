<script setup lang="ts">
// 流式合并配置面板(FR-5):从请求栏迁入响应卡片(ApiFox 式),
// 在 事件流/合并结果 lens 的工具栏弹出;改动即时生效——合并结果由 chunks 即时重算。
import { computed } from 'vue'
import { useAppStore } from '@/stores/app'
import { useWorkspaceStore } from '@/stores/workspace'
import { STREAM_MERGE_PRESETS, defaultStreamMergeConfig } from '@/utils/stream-merge'
import type { StreamMergePreset } from '@/utils/stream-merge'
import type { StreamMergeConfig } from '@/types'

const store = useAppStore()
const workspace = useWorkspaceStore()

const currentApi = computed(() => store.getCurrentApi())

const isReadonlyModule = computed(() => {
  const api = currentApi.value
  const node = api ? workspace.interfaces.find(item => item.apiId === api.id) : null
  const module = node ? workspace.modules.find(item => item.id === node.moduleId) : null
  return module?.type === 'readonly'
})

const streamMergeConfig = computed<StreamMergeConfig>(() => ({
  ...defaultStreamMergeConfig(),
  ...currentApi.value?.streamMerge,
}))

const mode = computed({
  get: () => streamMergeConfig.value.mode,
  set: (value: StreamMergeConfig['mode']) => patch({ mode: value }),
})

function patch(part: Partial<StreamMergeConfig>) {
  if (!currentApi.value || isReadonlyModule.value) return
  store.updateApi(currentApi.value.id, { streamMerge: { ...streamMergeConfig.value, ...part } })
}

function applyPreset(preset: StreamMergePreset) {
  patch({ mode: 'custom', dataPath: preset.dataPath })
}

function onField(field: 'dataPath' | 'eventFilter' | 'separator' | 'stopMarker', event: Event) {
  const value = (event.target as HTMLInputElement).value
  if (field === 'dataPath') patch({ dataPath: value })
  else if (field === 'eventFilter') patch({ eventFilter: value })
  else if (field === 'separator') patch({ separator: value })
  else patch({ stopMarker: value })
}
</script>

<template>
  <div class="stream-merge-pop" @click.stop>
    <div class="sm-head">
      <strong>流式合并</strong>
      <small>SSE / NDJSON 逐块提取拼接</small>
    </div>
    <div class="sm-mode-row">
      <label class="sm-mode-item"><input v-model="mode" type="radio" value="off" />关闭</label>
      <label class="sm-mode-item"><input v-model="mode" type="radio" value="auto" />自动探测</label>
      <label class="sm-mode-item"><input v-model="mode" type="radio" value="custom" />自定义路径</label>
    </div>
    <template v-if="mode !== 'off'">
      <label class="sm-field">
        <span>取值路径 dataPath</span>
        <input
          type="text"
          class="sm-input"
          :value="streamMergeConfig.dataPath"
          :disabled="mode === 'auto'"
          placeholder="data.content"
          @input="onField('dataPath', $event)"
        />
      </label>
      <div class="sm-presets">
        <button
          v-for="preset in STREAM_MERGE_PRESETS"
          :key="preset.id"
          type="button"
          class="sm-preset"
          :title="preset.dataPath"
          @click="applyPreset(preset)"
        >{{ preset.label.split('(')[0] }}</button>
      </div>
      <div class="sm-grid">
        <label class="sm-field">
          <span>event 过滤</span>
          <input
            type="text"
            class="sm-input"
            :value="streamMergeConfig.eventFilter ?? ''"
            placeholder="留空 = 全部"
            @input="onField('eventFilter', $event)"
          />
        </label>
        <label class="sm-field">
          <span>拼接符</span>
          <input
            type="text"
            class="sm-input"
            :value="streamMergeConfig.separator"
            placeholder="直接拼接"
            @input="onField('separator', $event)"
          />
        </label>
        <label class="sm-field">
          <span>终止标记</span>
          <input
            type="text"
            class="sm-input"
            :value="streamMergeConfig.stopMarker"
            placeholder="[DONE]"
            @input="onField('stopMarker', $event)"
          />
        </label>
      </div>
    </template>
  </div>
</template>

<style scoped>
.stream-merge-pop {
  position: absolute;
  top: calc(100% + 6px);
  left: 0;
  z-index: 120;
  width: 300px;
  padding: 12px;
  border: 1px solid var(--divider-dark-color);
  border-radius: var(--radius-md);
  background: var(--popover-color);
  box-shadow: var(--shadow-lg);
  display: flex;
  flex-direction: column;
  gap: 10px;
  text-align: left;
}

.stream-merge-pop.align-right {
  left: auto;
  right: 0;
}

.sm-head {
  display: flex;
  align-items: baseline;
  gap: 8px;
}

.sm-head strong {
  color: var(--secondary-dark-color);
}

.sm-head small {
  color: var(--secondary-light-color);
  font-weight: 400;
}

.sm-mode-row {
  display: flex;
  gap: 10px;
}

.sm-mode-item {
  display: inline-flex;
  align-items: center;
  gap: 5px;
  color: var(--secondary-color);
  font-size: var(--font-size-tiny);
  cursor: pointer;
}

.sm-field {
  display: flex;
  flex-direction: column;
  gap: 4px;
  color: var(--secondary-color);
  font-size: var(--font-size-tiny);
}

.sm-grid {
  display: flex;
  flex-direction: column;
  gap: 8px;
}

.sm-input {
  height: 28px;
  padding: 0 8px;
  border: 1px solid var(--divider-dark-color);
  border-radius: var(--radius-sm);
  background: var(--primary-color);
  color: var(--secondary-dark-color);
  font-size: var(--font-size-tiny);
  font-family: var(--font-code);
  outline: none;
}

.sm-input:focus {
  border-color: var(--accent-color);
}

.sm-input:disabled {
  opacity: 0.6;
  cursor: not-allowed;
}

.sm-presets {
  display: flex;
  flex-wrap: wrap;
  gap: 5px;
}

.sm-preset {
  padding: 3px 8px;
  border: 1px solid var(--divider-dark-color);
  border-radius: 999px;
  background: transparent;
  color: var(--secondary-color);
  font-size: var(--font-size-tiny);
  transition: border-color 0.12s ease, color 0.12s ease;
}

.sm-preset:hover {
  border-color: var(--accent-color);
  color: var(--accent-color);
}
</style>
