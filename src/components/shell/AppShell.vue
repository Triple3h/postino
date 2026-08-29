<script setup lang="ts">
import { onMounted, onUnmounted } from 'vue'
import { FileUp } from '@lucide/vue'
import AppHeader from './AppHeader.vue'
import AppSidenav from './AppSidenav.vue'
import GlobalSearch from '@/components/common/GlobalSearch.vue'
import MigrationDialog from '@/components/common/MigrationDialog.vue'
import SaveRequestModal from '@/components/sidebar/SaveRequestModal.vue'
import ShortcutsPrompt from '@/components/common/ShortcutsPrompt.vue'
import { useFileImport } from '@/composables/useFileImport'
import { useKeyboardShortcuts } from '@/composables/useKeyboardShortcuts'

const { dragImportDepth, bindWindowDragImport, unbindWindowDragImport } = useFileImport()
useKeyboardShortcuts()

onMounted(bindWindowDragImport)
onUnmounted(unbindWindowDragImport)
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
