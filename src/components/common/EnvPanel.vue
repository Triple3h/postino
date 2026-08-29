<script setup lang="ts">
import { ref, computed } from 'vue'
import { ChevronDown, Sprout, Trash2, Eye, EyeOff, Globe2, FolderTree } from '@lucide/vue'
import { useAppStore } from '@/stores/app'
import { useWorkspaceStore } from '@/stores/workspace'
import { useDialog } from '@/composables/useDialog'
import type { Environment, EnvVariable } from '@/types'

const store = useAppStore()
const workspace = useWorkspaceStore()
const dialog = useDialog()
const showEnvPanel = ref(false)
/** 当前编辑的环境 id(集合环境或全局环境) */
const editingEnvId = ref<string | null>(null)
const revealedSecrets = ref<Set<string>>(new Set())

/** 当前选中请求所属的集合(环境按集合隔离) */
const activeCollection = computed(() => {
  const node = workspace.interfaces.find(item => item.apiId === store.currentApiId)
  const cid = node ? (node.collectionId ?? node.moduleId) : null
  return cid ? workspace.collections.find(item => item.id === cid) ?? null : workspace.activeCollection
})

const collectionEnvs = computed(() => {
  if (!activeCollection.value) return []
  return store.environments.filter(env => env.collectionId === activeCollection.value!.id)
})

const globalEnvs = computed(() => store.environments.filter(env => store.isGlobalEnv(env)))

const selectedCollectionEnv = computed(() => {
  if (!activeCollection.value?.selectedEnvId) return null
  return collectionEnvs.value.find(env => env.id === activeCollection.value!.selectedEnvId) ?? null
})

const editingEnv = computed(() => {
  if (!editingEnvId.value) return null
  return store.environments.find(env => env.id === editingEnvId.value) ?? null
})

function generateId(): string {
  return Date.now().toString(36) + Math.random().toString(36).slice(2, 8)
}

function openEnvEditor(envId: string | null) {
  editingEnvId.value = envId
}

async function addCollectionEnvironment() {
  if (!activeCollection.value) return
  const name = await dialog.prompt({
    title: '新建集合环境',
    message: `为集合「${activeCollection.value.name}」创建环境,例如 local / test / prod。`,
    placeholder: '例如:test',
    confirmText: '创建',
  })
  if (!name?.trim()) return
  const env = await store.addCollectionEnvironment(activeCollection.value.id, name.trim())
  editingEnvId.value = env.id
}

async function selectCollectionEnv(envId: string) {
  if (!activeCollection.value) return
  await store.selectCollectionEnvironment(activeCollection.value.id, envId)
}

async function addGlobalEnvironment() {
  const name = await dialog.prompt({
    title: '新建全局环境',
    message: '全局环境对所有集合生效,优先级最低。',
    placeholder: '例如:全局默认',
    confirmText: '创建',
  })
  if (!name?.trim()) return
  const env: Environment = { id: generateId(), name: name.trim(), collectionId: 'global', variables: [] }
  await store.upsertEnvironment(env)
  editingEnvId.value = env.id
}

async function saveEnvironment() {
  const env = editingEnv.value
  if (!env) return
  await store.upsertEnvironment({ ...env, variables: env.variables.map(variable => ({ ...variable })) })
}

async function deleteEnvironmentById(id: string) {
  if (!window.confirm('确认删除该环境及其全部变量?')) return
  if (editingEnvId.value === id) editingEnvId.value = null
  await store.deleteEnvironment(id)
}

async function addVariable() {
  const env = editingEnv.value
  if (!env) return
  env.variables.push({ key: '', value: '', enabled: true })
  await saveEnvironment()
}

async function removeVariable(index: number) {
  const env = editingEnv.value
  if (!env) return
  env.variables.splice(index, 1)
  await saveEnvironment()
}

async function updateVariable(index: number, field: keyof EnvVariable, value: string | boolean) {
  const env = editingEnv.value
  if (!env) return
  const variable = env.variables[index]
  if (!variable) return
  ;(variable as Record<string, unknown>)[field] = value
  await saveEnvironment()
}

function toggleReveal(varKey: string) {
  const next = new Set(revealedSecrets.value)
  if (next.has(varKey)) next.delete(varKey)
  else next.add(varKey)
  revealedSecrets.value = next
}
</script>

<template>
  <div class="env-panel">
    <button class="btn btn-sm env-toggle" @click="showEnvPanel = !showEnvPanel">
      <span class="env-toggle-label">
        {{ activeCollection ? activeCollection.name : '未选择集合' }}
        <b v-if="selectedCollectionEnv">· {{ selectedCollectionEnv.name }}</b>
        <b v-else>· 无环境</b>
      </span>
      <ChevronDown :size="14" />
    </button>

    <div v-if="showEnvPanel" class="env-dropdown">
      <div class="env-dropdown-header">
        <strong>环境设置</strong>
        <small>环境按集合隔离,全局环境兜底</small>
      </div>

      <div class="env-scroll">
        <!-- 集合环境 -->
        <div class="env-section">
          <div class="env-section-title"><FolderTree :size="13" /> {{ activeCollection ? `集合「${activeCollection.name}」的环境` : '请先在侧栏选择一个集合' }}</div>
          <template v-if="activeCollection">
            <div v-if="collectionEnvs.length === 0" class="env-empty-state compact">
              <div class="empty-icon"><Sprout :size="24" /></div>
              <p>该集合还没有环境,创建 local / test / prod 后即可在请求中使用 <code>&#123;&#123;变量名&#125;&#125;</code>。</p>
              <button class="btn btn-sm btn-primary" @click="addCollectionEnvironment">+ 新建集合环境</button>
            </div>
            <div v-else class="env-list">
              <div
                v-for="env in collectionEnvs"
                :key="env.id"
                :class="['env-item', { active: env.id === activeCollection?.selectedEnvId }]"
                @click="selectCollectionEnv(env.id)"
              >
                <span class="env-name">{{ env.name }}</span>
                <span class="env-var-count">{{ env.variables.length }} 个变量</span>
                <button class="btn-icon" title="编辑" @click.stop="openEnvEditor(env.id)"><Eye :size="14" /></button>
                <button class="btn-icon" title="删除" @click.stop="deleteEnvironmentById(env.id)"><Trash2 :size="14" /></button>
              </div>
              <button class="btn btn-sm add-env-btn" @click="addCollectionEnvironment">+ 新建集合环境</button>
            </div>
            <p v-if="selectedCollectionEnv" class="env-hint-line">
              当前使用 <b>{{ selectedCollectionEnv.name }}</b>,变量解析优先级:请求变量 &gt; 集合环境 &gt; 集合变量 &gt; 全局。
            </p>
          </template>
        </div>

        <!-- 全局环境 -->
        <div class="env-section">
          <div class="env-section-title"><Globe2 :size="13" /> 全局环境(所有集合可用,优先级最低)</div>
          <div class="env-list">
            <div
              v-for="env in globalEnvs"
              :key="env.id"
              :class="['env-item', { active: env.id === store.currentEnvId }]"
              @click="store.currentEnvId = env.id"
            >
              <span class="env-name">{{ env.name }}</span>
              <span class="env-var-count">{{ env.variables.length }} 个变量</span>
              <button class="btn-icon" title="编辑" @click.stop="openEnvEditor(env.id)"><Eye :size="14" /></button>
              <button class="btn-icon" title="删除" @click.stop="deleteEnvironmentById(env.id)"><Trash2 :size="14" /></button>
            </div>
            <button class="btn btn-sm add-env-btn" @click="addGlobalEnvironment">+ 新建全局环境</button>
          </div>
        </div>

        <!-- 变量编辑区 -->
        <div v-if="editingEnv" class="env-vars">
          <div class="env-vars-header">
            <span>
              {{ editingEnv.name }} 的变量
              <small v-if="!editingEnv.collectionId || editingEnv.collectionId === 'global'" class="global-tag">全局</small>
              <small v-else class="collection-tag">集合专属</small>
            </span>
            <button class="btn btn-sm" @click="addVariable">+ 添加</button>
          </div>
          <div class="env-var-list">
            <div v-for="(v, i) in editingEnv.variables" :key="i" class="env-var-row">
              <input type="checkbox" :checked="v.enabled" @change="updateVariable(i, 'enabled', ($event.target as HTMLInputElement).checked)" />
              <input
                type="text"
                :value="v.key"
                placeholder="变量名"
                class="var-key"
                @input="updateVariable(i, 'key', ($event.target as HTMLInputElement).value)"
              />
              <input
                :type="v.secret && !revealedSecrets.has(`${editingEnv!.id}:${v.key}:${i}`) ? 'password' : 'text'"
                :value="v.value"
                placeholder="值"
                class="var-value"
                @input="updateVariable(i, 'value', ($event.target as HTMLInputElement).value)"
              />
              <button
                class="btn-icon"
                :class="{ active: v.secret }"
                :title="v.secret ? 'Secret(导出时剥离)' : '标记为 Secret'"
                @click="updateVariable(i, 'secret', !v.secret)"
              >
                <EyeOff v-if="v.secret" :size="14" />
                <Eye v-else :size="14" />
              </button>
              <button class="btn-icon" @click="removeVariable(i)" title="删除"><Trash2 :size="14" /></button>
            </div>
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
  min-width: 150px;
  max-width: 260px;
  justify-content: space-between;
  border-radius: 999px;
}

.env-toggle-label {
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
}

.env-toggle-label b {
  color: var(--primary);
  font-weight: 700;
}

.env-dropdown {
  position: absolute;
  top: 100%;
  right: 0;
  margin-top: 8px;
  width: min(460px, calc(100vw - 24px));
  max-width: calc(100vw - 24px);
  max-height: 540px;
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

.env-scroll {
  overflow-y: auto;
  flex: 1;
}

.env-section {
  padding: 8px;
  border-bottom: 1px solid var(--divider);
}

.env-section-title {
  display: flex;
  align-items: center;
  gap: 6px;
  font-size: var(--font-size-small);
  font-weight: 700;
  color: var(--text-secondary);
  margin-bottom: 6px;
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

.env-empty-state.compact {
  padding: 14px 12px;
}

.env-empty-state .empty-icon {
  font-size: 24px;
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
  display: flex;
  flex-direction: column;
  gap: 2px;
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

.env-hint-line {
  margin: 6px 0 0;
  padding: 6px 10px;
  border-radius: var(--radius-lg);
  background: var(--bg-secondary);
  color: var(--text-tertiary);
  font-size: var(--font-size-small);
}

.add-env-btn {
  width: 100%;
  margin-top: 4px;
  justify-content: center;
  border-style: dashed;
}

.env-vars {
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

.global-tag,
.collection-tag {
  padding: 1px 6px;
  border-radius: 999px;
  background: var(--bg-secondary);
  color: var(--text-tertiary);
  font-weight: 600;
}

.collection-tag {
  color: var(--primary);
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

.btn-icon {
  border: none;
  background: transparent;
  color: var(--text-tertiary);
  cursor: pointer;
  padding: 3px;
  border-radius: var(--radius-sm);
  display: inline-flex;
}

.btn-icon:hover,
.btn-icon.active {
  color: var(--primary);
  background: var(--bg-hover);
}

.env-close {
  padding: 8px;
  border-top: 1px solid var(--divider);
  text-align: right;
}
</style>
