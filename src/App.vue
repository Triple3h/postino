<script setup lang="ts">
import '@/assets/styles/global.css'
import DialogHost from '@/components/common/DialogHost.vue'
</script>

<template>
  <router-view />
  <DialogHost />
</template>

<style>
#app {
  height: 100%;
  width: 100%;
}
</style>
