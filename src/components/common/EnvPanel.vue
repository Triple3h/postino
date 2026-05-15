<script setup lang="ts">
import { ref, computed } from 'vue'
import { useAppStore } from '@/stores/app'
import type { Environment, EnvVariable } from '@/types'

const store = useAppStore()
const showEnvPanel = ref(false)

const currentEnv = computed(() => {
  return store.environments.find(e => e.id === store.currentEnvId)
})

const envVars = computed(() => {
  return currentEnv.value?.variables || []
})

function generateId(): string {
  return Date.now().toString(36) + Math.random().toString(36).slice(2, 8)
}

function addEnvironment() {
  const name = prompt('输入环境名称：')
  if (!name?.trim()) return
  const env: Environment = {
    id: generateId(),
    name,
    variables: [],
  }
  store.environments.push(env)
  store.currentEnvId = env.id
}

function deleteEnvironment(id: string) {
  store.environments = store.environments.filter(e => e.id !== id)
  if (store.currentEnvId === id) {
    store.currentEnvId = store.environments[0]?.id ?? null
  }
}

function addVariable() {
  if (!currentEnv.value) return
  currentEnv.value.variables.push({ key: '', value: '', enabled: true })
}

function removeVariable(index: number) {
  if (!currentEnv.value) return
  currentEnv.value.variables.splice(index, 1)
}

function toggleVariable(index: number) {
  if (!currentEnv.value) return
  currentEnv.value.variables[index].enabled = !currentEnv.value.variables[index].enabled
}

function selectEnv(id: string) {
  store.currentEnvId = id
}
</script>

<template>
  <div class="env-panel">
    <button class="btn btn-sm env-toggle" @click="showEnvPanel = !showEnvPanel">
      {{ currentEnv?.name || '无环境' }} ▼
    </button>

    <div v-if="showEnvPanel" class="env-dropdown">
      <div class="env-list">
        <div
          v-for="env in store.environments"
          :key="env.id"
          :class="['env-item', { active: env.id === store.currentEnvId }]"
          @click="selectEnv(env.id)"
        >
          <span class="env-name">{{ env.name }}</span>
          <span class="env-var-count">{{ env.variables.length }} 个变量</span>
          <button class="btn-icon" @click.stop="deleteEnvironment(env.id)" title="删除">×</button>
        </div>
        <button class="btn btn-sm add-env-btn" @click="addEnvironment">+ 新建环境</button>
      </div>

      <div v-if="currentEnv" class="env-vars">
        <div class="env-vars-header">
          <span>{{ currentEnv.name }} - 变量</span>
          <button class="btn btn-sm" @click="addVariable">+ 添加</button>
        </div>
        <div class="env-var-list">
          <div v-for="(v, i) in envVars" :key="i" class="env-var-row">
            <input type="checkbox" :checked="v.enabled" @change="toggleVariable(i)" />
            <input type="text" v-model="v.key" placeholder="变量名" class="var-key" />
            <input type="text" v-model="v.value" placeholder="值" class="var-value" />
            <button class="btn-icon" @click="removeVariable(i)" title="删除">×</button>
          </div>
        </div>
      </div>

      <div class="env-close">
        <button class="btn btn-sm" @click="showEnvPanel = false">关闭</button>
      </div>
    </div>
  </div>
</template>

<style scoped>
.env-panel {
  position: relative;
}

.env-toggle {
  min-width: 80px;
  justify-content: space-between;
}

.env-dropdown {
  position: absolute;
  top: 100%;
  left: 0;
  width: 400px;
  max-height: 500px;
  background: var(--bg-panel);
  border: 1px solid var(--border);
  border-radius: var(--radius-md);
  box-shadow: 0 4px 12px rgba(0, 0, 0, 0.15);
  z-index: 1000;
  display: flex;
  flex-direction: column;
  overflow: hidden;
}

.env-list {
  padding: 8px;
  border-bottom: 1px solid var(--divider);
}

.env-item {
  display: flex;
  align-items: center;
  padding: 6px 8px;
  border-radius: var(--radius-sm);
  cursor: pointer;
  gap: 8px;
}

.env-item:hover {
  background: var(--bg-hover);
}

.env-item.active {
  background: var(--primary-light);
}

.env-name {
  flex: 1;
  font-weight: 500;
}

.env-var-count {
  font-size: var(--font-size-small);
  color: var(--text-tertiary);
}

.add-env-btn {
  width: 100%;
  margin-top: 4px;
  justify-content: center;
  border-style: dashed;
}

.env-vars {
  flex: 1;
  overflow: auto;
  padding: 8px;
}

.env-vars-header {
  display: flex;
  align-items: center;
  justify-content: space-between;
  margin-bottom: 8px;
  font-size: var(--font-size-title);
  font-weight: 500;
}

.env-var-list {
  display: flex;
  flex-direction: column;
  gap: 4px;
}

.env-var-row {
  display: flex;
  align-items: center;
  gap: 4px;
}

.var-key,
.var-value {
  flex: 1;
  height: 26px;
  padding: 0 6px;
  border: 1px solid var(--border);
  border-radius: var(--radius-sm);
  font-size: var(--font-size-body);
  background: var(--bg-base);
  outline: none;
}

.var-key:focus,
.var-value:focus {
  border-color: var(--primary);
}

.env-close {
  padding: 8px;
  border-top: 1px solid var(--divider);
  text-align: right;
}
</style>