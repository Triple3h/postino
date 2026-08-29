<script setup lang="ts">
import { onMounted } from 'vue'
import PaneLayout from '@/components/shell/PaneLayout.vue'
import Sidebar from '@/components/sidebar/Sidebar.vue'
import EditorView from '@/components/editor/EditorView.vue'
import { useAppStore } from '@/stores/app'
import { useWorkspaceStore } from '@/stores/workspace'
import { applyViewOpenContext, clearViewOpenContext, readViewOpenContext } from '@/utils/view-context'

const store = useAppStore()
const workspace = useWorkspaceStore()

async function restoreOpenContext() {
  const context = await readViewOpenContext('main')
  if (applyViewOpenContext(context, store, workspace)) clearViewOpenContext()
}

onMounted(() => {
  void restoreOpenContext()
})
</script>

<template>
  <div class="h-full w-full overflow-hidden">
    <PaneLayout
      layout-id="http"
      orientation="columns"
      :default-first="22"
      :first-min="14"
      :second-min="40"
      :reverse="!store.settings.sidebarOnLeft"
    >
      <template #first>
        <Sidebar />
      </template>
      <template #second>
        <EditorView />
      </template>
    </PaneLayout>
  </div>
</template>
