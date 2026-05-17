<script setup lang="ts">
import { ref, computed } from 'vue'
import { ChevronDown, Sprout, Trash2 } from '@lucide/vue'
import { useAppStore } from '@/stores/app'
import { useDialog } from '@/composables/useDialog'
import type { Environment, EnvVariable } from '@/types'

const store = useAppStore()
const dialog = useDialog()
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

async function addEnvironment() {
  const name = await dialog.prompt({
    title: '新建环境',
    message: '为环境变量集合命名，创建后可在当前请求中引用。',
    placeholder: '例如：测试环境',
    confirmText: '创建',
  })
  if (!name?.trim()) return
  const env: Environment = {
    id: generateId(),
    name: name.trim(),
    variables: [],
  }
  await store.upsertEnvironment(env)
}

async function deleteEnvironment(id: string) {
  await store.deleteEnvironment(id)
}

async function saveCurrentEnvironment() {
  if (!currentEnv.value) return
  await store.upsertEnvironment({
    ...currentEnv.value,
    variables: currentEnv.value.variables.map(variable => ({ ...variable })),
  })
}

async function addVariable() {
  if (!currentEnv.value) return
  currentEnv.value.variables.push({ key: '', value: '', enabled: true })
  await saveCurrentEnvironment()
}

async function removeVariable(index: number) {
  if (!currentEnv.value) return
  currentEnv.value.variables.splice(index, 1)
  await saveCurrentEnvironment()
}

async function toggleVariable(index: number) {
  if (!currentEnv.value) return
  currentEnv.value.variables[index].enabled = !currentEnv.value.variables[index].enabled
  await saveCurrentEnvironment()
}

async function updateVariable(index: number, field: keyof EnvVariable, value: string) {
  if (!currentEnv.value) return
  const variable = currentEnv.value.variables[index]
  if (!variable) return
  if (field === 'enabled') {
    variable.enabled = value === 'true'
  } else {
    variable[field] = value
  }
  await saveCurrentEnvironment()
}

function selectEnv(id: string) {
  store.currentEnvId = id
}
</script>

<template>
  <div class="env-panel">
    <button class="btn btn-sm env-toggle" @click="showEnvPanel = !showEnvPanel">
      {{ currentEnv?.name || '无环境' }} <ChevronDown :size="14" />
    </button>

    <div v-if="showEnvPanel" class="env-dropdown">
      <div class="env-dropdown-header">
        <strong>环境设置</strong>
        <small>管理当前请求可引用的变量</small>
      </div>

      <div v-if="store.environments.length === 0" class="env-empty-state">
        <div class="empty-icon"><Sprout :size="30" /></div>
        <strong>还没有环境</strong>
        <p>创建测试、预发或生产环境后，就可以在 URL、Header、Body 中使用 <code>&#123;&#123;变量名&#125;&#125;</code>。</p>
        <button class="btn btn-sm btn-primary" @click="addEnvironment">+ 新建环境</button>
      </div>

      <div v-else class="env-list">
        <div
          v-for="env in store.environments"
          :key="env.id"
          :class="['env-item', { active: env.id === store.currentEnvId }]"
          @click="selectEnv(env.id)"
        >
          <span class="env-name">{{ env.name }}</span>
          <span class="env-var-count">{{ env.variables.length }} 个变量</span>
          <button class="btn-icon" @click.stop="deleteEnvironment(env.id)" title="删除"><Trash2 :size="14" /></button>
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
            <input
              type="text"
              :value="v.key"
              placeholder="变量名"
              class="var-key"
              @input="updateVariable(i, 'key', ($event.target as HTMLInputElement).value)"
            />
            <input
              type="text"
              :value="v.value"
              placeholder="值"
              class="var-value"
              @input="updateVariable(i, 'value', ($event.target as HTMLInputElement).value)"
            />
            <button class="btn-icon" @click="removeVariable(i)" title="删除"><Trash2 :size="14" /></button>
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
  display: inline-flex;
}

.env-toggle {
  min-width: 118px;
  justify-content: space-between;
  border-radius: 999px;
}

.env-dropdown {
  position: absolute;
  top: 100%;
  right: 0;
  margin-top: 8px;
  width: min(430px, calc(100vw - 24px));
  max-width: calc(100vw - 24px);
  max-height: 500px;
  background: var(--bg-panel);
  border: 1px solid var(--border);
  border-radius: var(--radius-xl);
  box-shadow: var(--shadow-lg);
  z-index: 1000;
  display: flex;
  flex-direction: column;
  overflow: hidden;
}

.env-dropdown-header {
  display: flex;
  align-items: baseline;
  justify-content: space-between;
  gap: 10px;
  padding: 10px 12px;
  border-bottom: 1px solid var(--divider);
  background: var(--bg-panel-elevated);
}

.env-dropdown-header strong {
  font-size: var(--font-size-title);
}

.env-dropdown-header small {
  color: var(--text-tertiary);
  font-size: var(--font-size-small);
}

.env-empty-state {
  display: flex;
  flex-direction: column;
  align-items: center;
  gap: 8px;
  padding: 24px 20px;
  text-align: center;
  color: var(--text-secondary);
}

.env-empty-state .empty-icon {
  font-size: 24px;
}

.env-empty-state strong {
  color: var(--text-primary);
}

.env-empty-state p {
  max-width: 340px;
  line-height: 1.6;
  font-size: var(--font-size-small);
}

.env-empty-state code {
  padding: 1px 4px;
  border-radius: 4px;
  background: var(--bg-code);
  color: var(--primary);
}

.env-list {
  padding: 8px;
  border-bottom: 1px solid var(--divider);
}

.env-item {
  display: flex;
  align-items: center;
  padding: 8px;
  border-radius: var(--radius-lg);
  cursor: pointer;
  gap: 8px;
}

.env-item:hover {
  background: var(--bg-hover);
}

.env-item.active {
  background: var(--primary-soft);
  color: var(--primary);
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
  gap: 6px;
  padding: 3px 0;
}

.var-key,
.var-value {
  flex: 1;
  height: 30px;
  font-size: var(--font-size-body);
}

.var-key:focus,
.var-value:focus {
  border-color: var(--primary);
  box-shadow: var(--focus-ring);
}

.env-close {
  padding: 8px;
  border-top: 1px solid var(--divider);
  text-align: right;
}
</style>
