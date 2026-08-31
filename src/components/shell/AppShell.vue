<script setup lang="ts">
import { computed, onMounted, onUnmounted } from 'vue'
import { FileUp } from '@lucide/vue'
import AppHeader from './AppHeader.vue'
import AppSidenav from './AppSidenav.vue'
import GlobalSearch from '@/components/common/GlobalSearch.vue'
import MigrationDialog from '@/components/common/MigrationDialog.vue'
import SaveRequestModal from '@/components/sidebar/SaveRequestModal.vue'
import ShortcutsPrompt from '@/components/common/ShortcutsPrompt.vue'
import { useFileImport } from '@/composables/useFileImport'
import { useKeyboardShortcuts } from '@/composables/useKeyboardShortcuts'
import { useAppStore } from '@/stores/app'

const { dragImportDepth, importProgress, bindWindowDragImport, unbindWindowDragImport } = useFileImport()
useKeyboardShortcuts()
const store = useAppStore()

/** 进度条状态文案:解析中 / 写入中(带文件名) */
const importPhaseLabel = computed(() => {
  const p = importProgress.value
  if (!p.active) return ''
  const name = p.fileName ? `「${p.fileName}」` : ''
  return p.phase === 'parsing' ? `正在解析 ${name}…` : `正在写入 ${name}`
})

/** 卸载/转入后台前把未落库的编辑写入 IndexedDB,防止关窗/崩溃丢数据(不熄灭未保存圆点) */
function flushDirtyOnExit() {
  void store.flushDirtyApis()
}
function onVisibilityChange() {
  if (document.visibilityState === 'hidden') flushDirtyOnExit()
}

onMounted(() => {
  bindWindowDragImport()
  window.addEventListener('pagehide', flushDirtyOnExit)
  document.addEventListener('visibilitychange', onVisibilityChange)
})
onUnmounted(() => {
  unbindWindowDragImport()
  window.removeEventListener('pagehide', flushDirtyOnExit)
  document.removeEventListener('visibilitychange', onVisibilityChange)
})
</script>

<template>
  <div class="flex h-full w-full flex-col bg-primary text-[color:var(--secondary-dark-color)]">
    <AppHeader />
    <div class="shell-body flex min-h-0 flex-1 overflow-hidden">
      <AppSidenav />
      <div class="min-w-0 flex-1 overflow-hidden">
        <router-view />
      </div>
    </div>

    <!-- 拖拽导入覆盖层 -->
    <Transition name="fade">
      <div v-if="dragImportDepth > 0" class="pointer-events-none fixed inset-0 z-[1300] grid place-items-center bg-[color-mix(in_srgb,var(--accent-color)_12%,transparent)] outline-2 outline-dashed outline-offset-[-8px] outline-accent">
        <div class="flex flex-col items-center gap-2 rounded-md border border-dividerDark bg-popover px-8 py-6 text-center shadow-lg">
          <FileUp :size="28" class="text-accent" />
          <strong class="text-[14px]">拖拽导入接口文件</strong>
          <span class="text-[11px] text-secondary">支持 cURL、Postman Collection、OpenAPI/Swagger、HAR、自有备份</span>
        </div>
      </div>
    </Transition>

    <!-- 导入进度:顶部细进度条 + 右下角状态浮层 -->
    <Transition name="fade">
      <div v-if="importProgress.active" class="pointer-events-none fixed inset-x-0 top-0 z-[1400]">
        <div class="h-[3px] w-full bg-[color-mix(in_srgb,var(--accent-color)_15%,transparent)]">
          <div
            class="h-full bg-accent transition-[width] duration-200 ease-out"
            :style="{ width: `${importProgress.percent}%` }"
          ></div>
        </div>
        <div class="fixed bottom-4 right-4 pointer-events-auto flex items-center gap-3 rounded-md border border-dividerDark bg-popover px-4 py-3 shadow-lg">
          <div class="h-4 w-4 animate-spin rounded-full border-2 border-dividerDark border-t-accent"></div>
          <div class="flex flex-col">
            <span class="text-[12px] font-medium text-secondaryDark">{{ importPhaseLabel }}</span>
            <span class="text-[10px] text-secondary">{{ importProgress.percent }}%</span>
          </div>
        </div>
      </div>
    </Transition>

    <GlobalSearch />
    <MigrationDialog />
    <SaveRequestModal />
    <ShortcutsPrompt />
  </div>
</template>

<style scoped>
.shell-body {
  /* 窄窗下 Sidenav 固定在底部,内容区让出空间 */
}

@media (max-width: 767px) {
  .shell-body {
    padding-bottom: 48px;
  }
}

.fade-enter-active,
.fade-leave-active {
  transition: opacity 0.15s ease;
}

.fade-enter-from,
.fade-leave-to {
  opacity: 0;
}
</style>
