<script setup lang="ts">
import { ref, onMounted } from 'vue'
import { useAppStore } from '@/stores/app'
import { derivePlannedWorkspaceModel, useWorkspaceStore } from '@/stores/workspace'
import { migrateLegacyData, hasLegacyData } from '@/utils/migration'
import { db } from '@/db'
import { STORAGE_KEYS, removeFromStorage } from '@/utils/storage'

const store = useAppStore()
const workspace = useWorkspaceStore()
const show = ref(false)
const migrationResult = ref<ReturnType<typeof migrateLegacyData> | null>(null)

onMounted(() => {
  if (hasLegacyData() && Object.keys(store.apis).length === 0) {
    show.value = true
  }
})

async function doMigrate() {
  migrationResult.value = migrateLegacyData()
  if (migrationResult.value.migrated) {
    store.apis = migrationResult.value.apis
    store.groups = migrationResult.value.groups
    store.groupOrder = migrationResult.value.groupOrder
    store.environments = migrationResult.value.environments
    store.history = migrationResult.value.history

    try {
      const apiEntries = Object.values(migrationResult.value.apis)
      if (apiEntries.length > 0) {
        await db.apis.bulkAdd(apiEntries)
      }

      const groupEntries = Object.entries(migrationResult.value.groups).map(([name, group]) => ({ name, group }))
      if (groupEntries.length > 0) {
        await db.groups.bulkAdd(groupEntries)
      }

      await db.settings.put({ key: 'groupOrder', value: migrationResult.value.groupOrder })

      const plannedModel = derivePlannedWorkspaceModel(
        migrationResult.value.apis,
        migrationResult.value.groups,
        migrationResult.value.groupOrder,
      )
      await workspace.replaceModel(plannedModel)

      if (migrationResult.value.environments.length > 0) {
        await db.environments.bulkAdd(migrationResult.value.environments)
      }

      if (migrationResult.value.history.length > 0) {
        await db.history.bulkAdd(migrationResult.value.history)
      }

      removeFromStorage(STORAGE_KEYS.DATA)
      removeFromStorage(STORAGE_KEYS.ENV)
      removeFromStorage(STORAGE_KEYS.HISTORY)
    } catch (e) {
      console.error('Failed to write migrated data to IndexedDB:', e)
    }
  }
}

function skip() {
  show.value = false
}
</script>

<template>
  <div v-if="show" class="migration-overlay">
    <div class="migration-dialog">
      <h2>数据迁移</h2>
      <p>检测到旧版数据，是否迁移到新版本？</p>

      <div v-if="migrationResult" class="migration-result">
        <p>迁移完成！</p>
        <ul>
          <li>{{ migrationResult.counts.apis }} 个接口</li>
          <li>{{ migrationResult.counts.groups }} 个分组</li>
          <li>{{ migrationResult.counts.envVars }} 个环境变量</li>
          <li>{{ migrationResult.counts.historyEntries }} 条历史记录</li>
        </ul>
        <button class="btn btn-primary" @click="show = false">完成</button>
      </div>

      <div v-else class="migration-actions">
        <button class="btn" @click="skip">跳过</button>
        <button class="btn btn-primary" @click="doMigrate">迁移数据</button>
      </div>
    </div>
  </div>
</template>

<style scoped>
.migration-overlay {
  position: fixed;
  inset: 0;
  background: rgba(2, 6, 23, 0.52);
  backdrop-filter: blur(8px);
  display: flex;
  align-items: center;
  justify-content: center;
  z-index: 1003;
}

.migration-dialog {
  background: var(--bg-panel);
  border: 1px solid var(--border);
  border-radius: var(--radius-2xl);
  padding: 24px;
  width: 400px;
  max-width: calc(100vw - 28px);
  box-shadow: var(--shadow-lg);
}

.migration-dialog h2 {
  font-size: 18px;
  margin-bottom: 8px;
}

.migration-dialog p {
  color: var(--text-secondary);
  margin-bottom: 16px;
}

.migration-result ul {
  list-style: none;
  padding: 0;
  margin-bottom: 16px;
}

.migration-result li {
  padding: 4px 0;
  color: var(--text-secondary);
}

.migration-actions {
  display: flex;
  justify-content: flex-end;
  gap: 8px;
}
</style>
