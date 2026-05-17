<script setup lang="ts">
import '@/assets/styles/global.css'
import DialogHost from '@/components/common/DialogHost.vue'
import CrossViewSyncBridge from '@/components/common/CrossViewSyncBridge.vue'
import DataSourceAutoSyncBridge from '@/components/common/DataSourceAutoSyncBridge.vue'
import PendingImportBridge from '@/components/common/PendingImportBridge.vue'
import { useSettings } from '@/composables/useSettings'

useSettings()
</script>

<template>
  <router-view />
  <PendingImportBridge />
  <CrossViewSyncBridge />
  <DataSourceAutoSyncBridge />
  <DialogHost />
</template>

<style>
#app {
  height: 100%;
  width: 100%;
}
</style>
