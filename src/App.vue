<script setup lang="ts">
import { computed } from 'vue'
import { Toaster } from 'vue-sonner'
import '@/assets/styles/global.css'
import DialogHost from '@/components/common/DialogHost.vue'
import CrossViewSyncBridge from '@/components/common/CrossViewSyncBridge.vue'
import DataSourceAutoSyncBridge from '@/components/common/DataSourceAutoSyncBridge.vue'
import PendingImportBridge from '@/components/common/PendingImportBridge.vue'
import { useSettings } from '@/composables/useSettings'

useSettings()

// 全局 toast 挂在根组件:主窗口与 popup/sidepanel 小窗共用(FR-9.1)
const { settings } = useSettings()
const systemPrefersDark = window.matchMedia('(prefers-color-scheme: dark)')
const sonnerTheme = computed<'dark' | 'light'>(() => {
  const mode = settings.value.theme
  if (mode === 'system') return systemPrefersDark.matches ? 'dark' : 'light'
  return mode === 'light' ? 'light' : 'dark'
})
</script>

<template>
  <router-view />
  <PendingImportBridge />
  <CrossViewSyncBridge />
  <DataSourceAutoSyncBridge />
  <DialogHost />
  <Toaster :theme="sonnerTheme" position="top-right" rich-colors close-button :duration="3200" />
</template>

<style>
#app {
  height: 100%;
  width: 100%;
}
</style>
