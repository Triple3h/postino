<script setup lang="ts">
import { computed, ref } from 'vue'
import { Check, Layers, Search } from '@lucide/vue'
import { Tippy } from 'vue-tippy'
import { useAppStore } from '@/stores/app'
import { useWorkspaceStore } from '@/stores/workspace'
import type { Collection, Environment } from '@/types'

/**
 * 常驻环境选择器(FR-3.3):tab 栏右侧 layers 图标 + 当前环境名,
 * popover 含搜索、集合环境、Global / 无环境选项(切换写 collection.selectedEnvId)。
 */
const store = useAppStore()
const workspace = useWorkspaceStore()
const keyword = ref('')

const currentCollection = computed<Collection | null>(() => {
  const node = workspace.interfaces.find(item => item.apiId === store.currentApiId)
  const cid = node ? (node.collectionId ?? node.moduleId) : null
  return cid ? workspace.collections.find(item => item.id === cid) ?? null : null
})

const collectionEnvs = computed(() => {
  const cid = currentCollection.value?.id
  return cid ? store.environments.filter(env => env.collectionId === cid) : []
})

const globalEnvs = computed(() => store.environments.filter(env => store.isGlobalEnv(env)))

const activeEnvName = computed(() => {
  const cid = currentCollection.value?.id
  const selected = cid && currentCollection.value?.selectedEnvId
    ? store.environments.find(env => env.id === currentCollection.value!.selectedEnvId)
    : null
  if (selected) return selected.name
  const global = store.environments.find(item => item.id === store.currentEnvId)
  return global?.name ?? '无环境'
})

const filteredCollectionEnvs = computed(() => filterEnvs(collectionEnvs.value))
const filteredGlobalEnvs = computed(() => filterEnvs(globalEnvs.value))

function filterEnvs(envs: Environment[]): Environment[] {
  const kw = keyword.value.trim().toLowerCase()
  if (!kw) return envs
  return envs.filter(env => env.name.toLowerCase().includes(kw)
    || env.variables.some(v => v.key.toLowerCase().includes(kw)))
}

function selectCollectionEnv(envId: string | null) {
  const cid = currentCollection.value?.id
  if (cid) void store.selectCollectionEnvironment(cid, envId)
}

function selectGlobalEnv(id: string | null) {
  store.currentEnvId = id
}
</script>

<template>
  <Tippy interactive trigger="click" theme="popover" placement="bottom-end" :offset="[0, 4]">
    <button class="env-selector" :title="`环境:${activeEnvName}`">
      <Layers :size="14" />
      <span class="env-name">{{ activeEnvName }}</span>
    </button>
    <template #content>
      <div class="env-menu">
        <div class="env-search">
          <Search :size="13" />
          <input v-model="keyword" type="text" placeholder="搜索环境或变量…" />
        </div>

        <template v-if="currentCollection">
          <div class="env-group">集合环境 · {{ currentCollection.name }}</div>
          <template v-if="filteredCollectionEnvs.length">
            <button
              v-for="env in filteredCollectionEnvs"
              :key="env.id"
              class="env-option"
              :class="{ active: env.id === currentCollection?.selectedEnvId }"
              @click="selectCollectionEnv(env.id)"
            >
              <span class="env-check"><Check v-if="env.id === currentCollection?.selectedEnvId" :size="13" /></span>
              <span class="truncate">{{ env.name }}</span>
              <small class="env-count">{{ env.variables.length }} 变量</small>
            </button>
          </template>
          <div v-else class="env-empty">当前集合暂无环境</div>
          <button
            v-if="collectionEnvs.length"
            class="env-option"
            :class="{ active: !currentCollection?.selectedEnvId }"
            @click="selectCollectionEnv(null)"
          >
            <span class="env-check"><Check v-if="!currentCollection?.selectedEnvId" :size="13" /></span>
            <span>跟随全局</span>
          </button>
          <div class="env-group">全局环境</div>
        </template>
        <div v-else class="env-group">全局环境</div>

        <button
          v-for="env in filteredGlobalEnvs"
          :key="env.id"
          class="env-option"
          :class="{ active: env.id === store.currentEnvId }"
          @click="selectGlobalEnv(env.id)"
        >
          <span class="env-check"><Check v-if="env.id === store.currentEnvId" :size="13" /></span>
          <span class="truncate">{{ env.name }}</span>
          <small class="env-count">{{ env.variables.length }} 变量</small>
        </button>
        <button
          class="env-option"
          :class="{ active: store.currentEnvId === null }"
          @click="selectGlobalEnv(null)"
        >
          <span class="env-check"><Check v-if="store.currentEnvId === null" :size="13" /></span>
          <span>无环境</span>
        </button>
        <div v-if="!filteredGlobalEnvs.length" class="env-empty">无匹配的全局环境</div>
      </div>
    </template>
  </Tippy>
</template>

<style scoped>
.env-selector {
  display: inline-flex;
  align-items: center;
  gap: 5px;
  max-width: 180px;
  height: 26px;
  padding: 0 8px;
  border-radius: var(--radius-md);
  color: var(--secondary-color);
  font-size: var(--font-size-tiny);
  transition: background 0.12s ease, color 0.12s ease;
}

.env-selector:hover {
  background: var(--primary-dark-color);
  color: var(--secondary-dark-color);
}

.env-name {
  max-width: 120px;
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
}

.env-menu {
  width: 248px;
  max-height: 320px;
  overflow-y: auto;
}

.env-search {
  display: flex;
  align-items: center;
  gap: 6px;
  padding: 2px 4px 8px;
  border-bottom: 1px solid var(--divider-color);
  margin-bottom: 4px;
  color: var(--secondary-light-color);
}

.env-search input {
  flex: 1;
  min-width: 0;
  border: none;
  background: transparent;
  color: var(--secondary-dark-color);
  font-size: var(--font-size-body);
  outline: none;
}

.env-group {
  padding: 6px 8px 3px;
  color: var(--secondary-light-color);
  font-size: var(--font-size-tiny);
  font-weight: 600;
}

.env-option {
  display: flex;
  align-items: center;
  gap: 7px;
  width: 100%;
  padding: 6px 8px;
  border-radius: var(--radius-sm);
  background: transparent;
  color: var(--secondary-dark-color);
  font-size: var(--font-size-body);
  text-align: left;
}

.env-option:hover {
  background: var(--primary-dark-color);
}

.env-option.active {
  color: var(--accent-color);
  font-weight: 600;
}

.env-check {
  width: 14px;
  flex-shrink: 0;
  display: inline-flex;
}

.env-count {
  margin-left: auto;
  color: var(--secondary-light-color);
  font-size: var(--font-size-tiny);
}

.env-empty {
  padding: 4px 8px 6px;
  color: var(--secondary-light-color);
  font-size: var(--font-size-tiny);
}
</style>
