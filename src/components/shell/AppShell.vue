<script setup lang="ts">
import { computed, onMounted, onUnmounted } from 'vue'
import { Toaster } from 'vue-sonner'
import { FileUp } from '@lucide/vue'
import AppHeader from './AppHeader.vue'
import AppSidenav from './AppSidenav.vue'
import GlobalSearch from '@/components/common/GlobalSearch.vue'
import MigrationDialog from '@/components/common/MigrationDialog.vue'
import { useFileImport } from '@/composables/useFileImport'
import { useSettings } from '@/composables/useSettings'

const { dragImportDepth, bindWindowDragImport, unbindWindowDragImport } = useFileImport()
const { settings } = useSettings()

const systemPrefersDark = window.matchMedia('(prefers-color-scheme: dark)')
const sonnerTheme = computed<'dark' | 'light'>(() => {
  const mode = settings.value.theme
  if (mode === 'system') return systemPrefersDark.matches ? 'dark' : 'light'
  return mode === 'light' ? 'light' : 'dark'
})

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

    <!-- 全局 toast(FR-9.1) -->
    <Toaster :theme="sonnerTheme" position="top-right" rich-colors close-button :duration="3200" />

    <GlobalSearch />
    <MigrationDialog />
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
