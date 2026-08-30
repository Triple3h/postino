<script setup lang="ts">
import { onMounted, ref, type ComponentPublicInstance } from 'vue'
import { Splitpanes, Pane } from 'splitpanes'

/**
 * 可持久化分栏布局(参考 Hoppscotch app/PaneLayout.vue):
 * - orientation = columns:左右分栏;rows:上下分栏
 * - 尺寸按 layoutId 持久化到 localStorage,刷新后保持
 * 注意:splitpanes v4 的 resized 事件负载只有 { event },不带尺寸,
 * 因此拖拽结束时从首个 Pane 的实际渲染尺寸换算百分比保存。
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

const firstSize = ref(props.defaultFirst)
const layoutRef = ref<ComponentPublicInstance | null>(null)
const firstPaneRef = ref<ComponentPublicInstance | null>(null)

// 必须用 chrome.storage.local:未打包扩展每次 ↻ 重载会清空 localStorage,
// chrome.storage.local 跨重载/重启持久,且 popup/sidepanel/tab 三处共享。
const STORAGE_PREFIX = 'postino_pane_'

function storageKey(): string {
  return STORAGE_PREFIX + props.layoutId
}

function readSaved(raw: unknown) {
  const value = Number(raw)
  if (!Number.isFinite(value) || value <= 0 || value >= 100) return
  // 反向布局时两个窗格内容互换,min/max 随之对调
  const min1 = props.reverse ? props.secondMin : props.firstMin
  const min2 = props.reverse ? props.firstMin : props.secondMin
  // 收敛到合法区间而非拒绝:避免历史脏值/边界值导致布局弹回默认
  firstSize.value = Math.min(Math.max(value, min1), 100 - min2)
}

onMounted(async () => {
  const chromeApi = (globalThis as any).chrome
  if (chromeApi?.storage?.local?.get) {
    try {
      const result = await chromeApi.storage.local.get(storageKey())
      readSaved(result?.[storageKey()])
    } catch { /* 读取失败保持默认 */ }
  } else {
    try { readSaved(localStorage.getItem(storageKey())) } catch { /* 隐私模式忽略 */ }
  }
})

function persist(percent: number) {
  const chromeApi = (globalThis as any).chrome
  if (chromeApi?.storage?.local) {
    try {
      chromeApi.storage.local.set({ [storageKey()]: percent })?.catch?.(() => { /* 忽略 */ })
    } catch { /* 忽略 */ }
    return
  }
  try { localStorage.setItem(storageKey(), String(percent)) } catch { /* 忽略 */ }
}

function onResized(...payload: unknown[]) {
  // splitpanes v4:拖拽结束的 resized 带 {event} 负载;初始化/面板增删触发的
  // resized 没有参数 —— 后者是瞬时布局,落盘会污染存储,必须忽略。
  if (!payload.length) return
  const paneEl = firstPaneRef.value?.$el as HTMLElement | undefined
  if (!paneEl) return
  // 直接读 splitpanes 写入的内联百分比(逻辑尺寸),比像素换算精确
  const raw = props.orientation === 'rows' ? paneEl.style.height : paneEl.style.width
  const percent = parseFloat(raw)
  if (!Number.isFinite(percent) || percent <= 0 || percent >= 100) return
  firstSize.value = percent
  persist(percent)
}

function slotFor(pane: 'first' | 'second'): string {
  return props.reverse ? (pane === 'first' ? 'second' : 'first') : pane
}
</script>

<template>
  <Splitpanes
    ref="layoutRef"
    class="pane-layout"
    :horizontal="orientation === 'rows'"
    :push-other-panes="false"
    @resized="onResized"
  >
    <!-- 两个窗格都必须显式绑定 size:splitpanes v4 对"异步变更已注册窗格的 size"
         不做兄弟重归一化(readSaved 在挂载后改 firstSize 时,无 size 的第二窗格
         保留初始分配值,容器会出现未分配的空白带),和恒为 100% 才安全 -->
    <Pane ref="firstPaneRef" :size="firstSize" :min-size="reverse ? secondMin : firstMin">
      <slot :name="slotFor('first')" />
    </Pane>
    <Pane :size="100 - firstSize" :min-size="reverse ? firstMin : secondMin">
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
