<script setup lang="ts">
import { onMounted, ref } from 'vue'
import { Splitpanes, Pane } from 'splitpanes'

/**
 * 可持久化分栏布局(参考 Hoppscotch app/PaneLayout.vue):
 * - orientation = columns:左右分栏;rows:上下分栏
 * - 尺寸按 layoutId 持久化到 localStorage,刷新后保持
 */
const props = withDefaults(defineProps<{
  layoutId: string
  orientation?: 'columns' | 'rows'
  defaultFirst?: number
  firstMin?: number
  secondMin?: number
  /** 交换两个槽位的渲染顺序(用于「侧栏在右」) */
  reverse?: boolean
}>(), {
  orientation: 'columns',
  defaultFirst: 22,
  firstMin: 12,
  secondMin: 30,
  reverse: false,
})

interface ResizedPayload {
  panes?: Array<{ size?: number }>
}

const firstSize = ref(props.defaultFirst)

const STORAGE_PREFIX = 'apifix_pane_'

onMounted(() => {
  try {
    const saved = localStorage.getItem(STORAGE_PREFIX + props.layoutId)
    if (saved) {
      const value = Number(saved)
      if (Number.isFinite(value) && value > props.firstMin && value < 100 - props.secondMin) {
        firstSize.value = value
      }
    }
  } catch { /* 隐私模式忽略 */ }
})

function onResized(payload: ResizedPayload) {
  const size = payload?.panes?.[0]?.size
  if (typeof size === 'number' && Number.isFinite(size)) {
    firstSize.value = size
    try { localStorage.setItem(STORAGE_PREFIX + props.layoutId, String(Math.round(size * 10) / 10)) } catch { /* 忽略 */ }
  }
}

function slotFor(pane: 'first' | 'second'): string {
  return props.reverse ? (pane === 'first' ? 'second' : 'first') : pane
}
</script>

<template>
  <Splitpanes
    class="pane-layout"
    :horizontal="orientation === 'rows'"
    :push-other-panes="false"
    @resized="onResized"
  >
    <Pane :size="firstSize" :min-size="firstMin">
      <slot :name="slotFor('first')" />
    </Pane>
    <Pane :min-size="secondMin">
      <slot :name="slotFor('second')" />
    </Pane>
  </Splitpanes>
</template>

<style scoped>
.pane-layout {
  width: 100%;
  height: 100%;
}

.pane-layout :deep(> .splitpanes__pane) {
  min-width: 0;
  min-height: 0;
  overflow: hidden;
  display: flex;
  flex-direction: column;
}
</style>
