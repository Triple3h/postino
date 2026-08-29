<script setup lang="ts">
import { computed, ref } from 'vue'
import { Copy, Eye, EyeOff, Globe2, Pencil, Plus, Trash2 } from '@lucide/vue'
import { useAppStore } from '@/stores/app'
import { useWorkspaceStore } from '@/stores/workspace'
import { useDialog } from '@/composables/useDialog'
import { openContextMenu } from '@/composables/useContextMenu'
import { toast } from 'vue-sonner'
import type { Environment, EnvVariable } from '@/types'

/**
 * 环境面板(FR-3.1/3.2,参考 Hoppscotch environments/index.vue):
 * 顶部固定 Global 全局环境条目,下方为当前集合的环境列表(选中 accent 高亮),
 * 编辑弹窗为三列变量表 KEY | 初始值 | 当前值,支持初始↔当前互转与 secret 掩码。
 */
const store = useAppStore()
const workspace = useWorkspaceStore()
const dialog = useDialog()

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

function openEnvEditor(envId: string) {
  revealedSecrets.value = new Set()
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
  openEnvEditor(env.id)
}

async function duplicateEnvironment(env: Environment) {
  const copy: Environment = {
    ...env,
    id: generateId(),
    name: `${env.name}-copy`,
    variables: env.variables.map(item => ({ ...item })),
  }
  await store.upsertEnvironment(copy)
  toast.success(`已复制环境:${copy.name}`)
}

async function deleteEnvironmentById(env: Environment) {
  const ok = await dialog.confirm({
    title: '删除环境',
    message: `确认删除环境「${env.name}」及其全部变量?此操作不可撤销。`,
    confirmText: '删除',
    danger: true,
  })
  if (!ok) return
  if (editingEnvId.value === env.id) editingEnvId.value = null
  await store.deleteEnvironment(env.id)
}

function envMenu(event: MouseEvent, env: Environment) {
  openContextMenu(event, [
    { key: 'edit', label: '编辑', icon: Pencil, handler: () => openEnvEditor(env.id) },
    { key: 'duplicate', label: '复制环境', icon: Copy, handler: () => duplicateEnvironment(env) },
    { key: 'delete', label: '删除', icon: Trash2, danger: true, separatorBefore: true, handler: () => deleteEnvironmentById(env) },
  ])
}

// ── 变量编辑(FR-3.2)──
async function persist() {
  const env = editingEnv.value
  if (!env) return
  await store.upsertEnvironment({ ...env, variables: env.variables.map(variable => ({ ...variable })) })
}

function addVariable() {
  const env = editingEnv.value
  if (!env) return
  env.variables.push({ key: '', value: '', initialValue: '', enabled: true })
  void persist()
}

function removeVariable(index: number) {
  const env = editingEnv.value
  if (!env) return
  env.variables.splice(index, 1)
  void persist()
}

function updateVariable(index: number, field: keyof EnvVariable, value: string | boolean) {
  const env = editingEnv.value
  if (!env) return
  const variable = env.variables[index]
  if (!variable) return
  ;(variable as Record<string, unknown>)[field] = value
  void persist()
}

/** 单行:当前值 → 初始值 */
function promoteToInitial(index: number) {
  const env = editingEnv.value
  const v = env?.variables[index]
  if (!v) return
  v.initialValue = v.value
  void persist()
}

/** 单行:初始值 → 当前值 */
function resetToInitial(index: number) {
  const env = editingEnv.value
  const v = env?.variables[index]
  if (!v) return
  v.value = v.initialValue ?? ''
  void persist()
}

/** 全部:当前值 → 初始值 */
function promoteAllToInitial() {
  const env = editingEnv.value
  if (!env) return
  for (const v of env.variables) v.initialValue = v.value
  void persist()
}

/** 全部:初始值 → 当前值 */
function resetAllToInitial() {
  const env = editingEnv.value
  if (!env) return
  for (const v of env.variables) v.value = v.initialValue ?? ''
  void persist()
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
  openEnvEditor(env.id)
}

function toggleReveal(key: string) {
  const next = new Set(revealedSecrets.value)
  if (next.has(key)) next.delete(key)
  else next.add(key)
  revealedSecrets.value = next
}

function isRevealed(envId: string, key: string, index: number): boolean {
  return revealedSecrets.value.has(`${envId}:${key}:${index}`)
}
</script>

<template>
  <div class="env-panel">
    <!-- Global 全局环境(固定条目,FR-3.1) -->
    <div class="env-group">
      <div class="env-group-title"><Globe2 :size="13" /> 全局环境</div>
      <div
        v-for="env in globalEnvs"
        :key="env.id"
        class="env-row"
        :class="{ active: env.id === store.currentEnvId }"
        :title="env.id === store.currentEnvId ? '当前使用的全局环境' : '点击设为当前全局环境'"
        @click="store.currentEnvId = env.id"
        @contextmenu="envMenu($event, env)"
      >
        <Globe2 :size="14" class="env-row-icon" />
        <span class="env-row-name">{{ env.name }}</span>
        <span class="env-row-count">{{ env.variables.length }}</span>
        <button class="row-action" title="编辑" @click.stop="openEnvEditor(env.id)"><Pencil :size="13" /></button>
        <button class="row-action" title="删除" @click.stop="deleteEnvironmentById(env)"><Trash2 :size="13" /></button>
      </div>
      <button class="add-env" @click="addGlobalEnvironment"><Plus :size="13" /> 新建全局环境</button>
    </div>

    <!-- 当前集合的环境 -->
    <div class="env-group">
      <div class="env-group-title">
        集合环境
        <small v-if="activeCollection">· {{ activeCollection.name }}</small>
      </div>
      <template v-if="activeCollection">
        <div
          v-for="env in collectionEnvs"
          :key="env.id"
          class="env-row"
          :class="{ active: env.id === activeCollection?.selectedEnvId }"
          :title="env.id === activeCollection?.selectedEnvId ? '当前集合所选环境' : '点击切换到该环境'"
          @click="store.selectCollectionEnvironment(activeCollection.id, env.id)"
          @contextmenu="envMenu($event, env)"
        >
          <span class="env-row-name">{{ env.name }}</span>
          <span class="env-row-count">{{ env.variables.length }}</span>
          <button class="row-action" title="编辑" @click.stop="openEnvEditor(env.id)"><Pencil :size="13" /></button>
          <button class="row-action" title="删除" @click.stop="deleteEnvironmentById(env)"><Trash2 :size="13" /></button>
        </div>
        <button class="add-env" @click="addCollectionEnvironment"><Plus :size="13" /> 新建集合环境</button>
        <p v-if="selectedCollectionEnv" class="env-hint">
          当前:<b>{{ selectedCollectionEnv.name }}</b> · 优先级:请求变量 &gt; 集合环境 &gt; 集合变量 &gt; 全局
        </p>
      </template>
      <p v-else class="env-hint">在集合树中选择一个请求后,可管理该集合的环境。</p>
    </div>

    <!-- 编辑弹窗(FR-3.2) -->
    <Teleport to="body">
      <div v-if="editingEnv" class="modal-overlay" @click.self="editingEnvId = null">
        <div class="env-modal">
          <header class="env-modal-header">
            <h3>
              {{ editingEnv.name }}
              <small v-if="!editingEnv.collectionId || editingEnv.collectionId === 'global'" class="scope-tag">全局</small>
              <small v-else class="scope-tag collection">集合专属</small>
            </h3>
            <div class="swap-all">
              <button class="btn btn-sm" title="全部:当前值写入初始值" @click="promoteAllToInitial">当前 → 初始</button>
              <button class="btn btn-sm" title="全部:用初始值重置当前值" @click="resetAllToInitial">初始 → 当前</button>
            </div>
          </header>

          <div class="vars-table">
            <div class="vars-head">
              <span>KEY</span>
              <span>初始值</span>
              <span>当前值</span>
              <span></span>
            </div>
            <div v-for="(v, i) in editingEnv.variables" :key="i" class="vars-row">
              <input type="checkbox" :checked="v.enabled" title="启用" @change="updateVariable(i, 'enabled', ($event.target as HTMLInputElement).checked)" />
              <input
                type="text"
                :value="v.key"
                placeholder="变量名"
                spellcheck="false"
                @input="updateVariable(i, 'key', ($event.target as HTMLInputElement).value)"
              />
              <div class="init-cell">
                <input
                  type="text"
                  :value="v.initialValue"
                  placeholder="初始值"
                  @input="updateVariable(i, 'initialValue', ($event.target as HTMLInputElement).value)"
                />
                <button class="swap-btn" title="当前值写入初始值" @click="promoteToInitial(i)">→</button>
              </div>
              <div class="current-cell">
                <input
                  :type="v.secret && !isRevealed(editingEnv.id, v.key, i) ? 'password' : 'text'"
                  :value="v.value"
                  placeholder="当前值"
                  @input="updateVariable(i, 'value', ($event.target as HTMLInputElement).value)"
                />
                <button class="swap-btn" title="用初始值重置当前值" @click="resetToInitial(i)">⇥</button>
              </div>
              <div class="row-ops">
                <button
                  class="row-action"
                  :class="{ active: v.secret }"
                  :title="v.secret ? 'Secret(导出时剥离取值)' : '标记为 Secret'"
                  @click="updateVariable(i, 'secret', !v.secret)"
                >
                  <EyeOff v-if="v.secret" :size="13" />
                  <Eye v-else :size="13" />
                </button>
                <button
                  v-if="v.secret"
                  class="row-action"
                  title="显示/隐藏"
                  @click="toggleReveal(`${editingEnv.id}:${v.key}:${i}`)"
                >
                  {{ isRevealed(editingEnv.id, v.key, i) ? '隐藏' : '显示' }}
                </button>
                <button class="row-action danger" title="删除行" @click="removeVariable(i)"><Trash2 :size="13" /></button>
              </div>
            </div>
            <p v-if="!editingEnv.variables.length" class="vars-empty">暂无变量,点击下方添加。</p>
          </div>

          <footer class="env-modal-footer">
            <button class="btn btn-sm" @click="addVariable"><Plus :size="13" /> 添加变量</button>
            <span class="flex-1"></span>
            <button class="btn btn-sm btn-primary" @click="editingEnvId = null">完成</button>
          </footer>
        </div>
      </div>
    </Teleport>
  </div>
</template>

<style scoped>
.env-panel {
  flex: 1;
  min-height: 0;
  overflow-y: auto;
  padding: 8px;
  display: flex;
  flex-direction: column;
  gap: 12px;
}

.env-group {
  display: flex;
  flex-direction: column;
  gap: 2px;
}

.env-group-title {
  display: flex;
  align-items: center;
  gap: 5px;
  padding: 2px 6px 6px;
  color: var(--secondary-light-color);
  font-size: var(--font-size-tiny);
  font-weight: 700;
}

.env-group-title small {
  font-weight: 400;
}

.env-row {
  display: flex;
  align-items: center;
  gap: 6px;
  height: 30px;
  padding: 0 6px;
  border-radius: var(--radius-md);
  cursor: pointer;
  color: var(--secondary-color);
  font-size: var(--font-size-body);
  user-select: none;
}

.env-row:hover {
  background: var(--primary-dark-color);
}

.env-row.active {
  background: color-mix(in srgb, var(--accent-color) 14%, transparent);
  color: var(--accent-color);
}

.env-row-icon {
  flex-shrink: 0;
}

.env-row-name {
  flex: 1;
  min-width: 0;
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
}

.env-row-count {
  font-size: var(--font-size-tiny);
  color: var(--secondary-light-color);
  flex-shrink: 0;
}

.row-action {
  display: inline-flex;
  align-items: center;
  justify-content: center;
  width: 22px;
  height: 22px;
  border-radius: var(--radius-sm);
  color: var(--secondary-light-color);
  font-size: var(--font-size-tiny);
  flex-shrink: 0;
}

.row-action:hover {
  background: var(--primary-light-color);
  color: var(--secondary-dark-color);
}

.row-action.active {
  color: var(--status-redirect-color);
}

.row-action.danger:hover {
  color: var(--status-critical-error-color);
}

.add-env {
  display: flex;
  align-items: center;
  gap: 5px;
  margin-top: 4px;
  padding: 6px 8px;
  border: 1px dashed var(--divider-dark-color);
  border-radius: var(--radius-md);
  color: var(--secondary-color);
  font-size: var(--font-size-tiny);
  justify-content: center;
}

.add-env:hover {
  color: var(--accent-color);
  border-color: var(--accent-color);
}

.env-hint {
  margin: 6px 0 0;
  padding: 6px 8px;
  border-radius: var(--radius-md);
  background: var(--primary-light-color);
  color: var(--secondary-light-color);
  font-size: var(--font-size-tiny);
  line-height: 1.5;
}

.env-hint b {
  color: var(--accent-color);
}

/* 编辑弹窗 */
.modal-overlay {
  position: fixed;
  inset: 0;
  z-index: 1200;
  display: flex;
  align-items: center;
  justify-content: center;
  background: rgba(0, 0, 0, 0.45);
  backdrop-filter: blur(4px);
}

.env-modal {
  display: flex;
  flex-direction: column;
  gap: 10px;
  width: min(720px, calc(100vw - 32px));
  max-height: 80vh;
  padding: 16px;
  border: 1px solid var(--divider-dark-color);
  border-radius: var(--radius-lg);
  background: var(--popover-color);
  box-shadow: var(--shadow-lg);
}

.env-modal-header {
  display: flex;
  align-items: center;
  justify-content: space-between;
}

.env-modal-header h3 {
  display: flex;
  align-items: center;
  gap: 6px;
  font-size: 14px;
}

.scope-tag {
  padding: 1px 6px;
  border-radius: 999px;
  background: var(--primary-dark-color);
  color: var(--secondary-color);
  font-size: var(--font-size-tiny);
  font-weight: 500;
}

.scope-tag.collection {
  color: var(--accent-color);
}

.swap-all {
  display: flex;
  gap: 6px;
}

.vars-table {
  flex: 1;
  min-height: 0;
  overflow-y: auto;
  display: flex;
  flex-direction: column;
  gap: 2px;
}

.vars-head {
  display: grid;
  grid-template-columns: 20px 1fr 1fr 1fr 76px;
  gap: 6px;
  padding: 4px 6px;
  color: var(--secondary-light-color);
  font-size: var(--font-size-tiny);
  font-weight: 700;
  position: sticky;
  top: 0;
  background: var(--popover-color);
}

.vars-row {
  display: grid;
  grid-template-columns: 20px 1fr 1fr 1fr 76px;
  gap: 6px;
  align-items: center;
  padding: 2px 6px;
}

.vars-row input[type='text'],
.init-cell input,
.current-cell input {
  height: 28px;
  font-size: var(--font-size-body);
  font-family: var(--font-code);
}

.init-cell,
.current-cell {
  display: flex;
  align-items: center;
  gap: 2px;
  min-width: 0;
}

.init-cell input,
.current-cell input {
  flex: 1;
  min-width: 0;
}

.swap-btn {
  display: inline-flex;
  align-items: center;
  justify-content: center;
  width: 18px;
  height: 22px;
  border-radius: var(--radius-sm);
  color: var(--secondary-light-color);
  font-size: 11px;
  flex-shrink: 0;
}

.swap-btn:hover {
  background: var(--primary-dark-color);
  color: var(--accent-color);
}

.row-ops {
  display: flex;
  align-items: center;
  gap: 2px;
}

.vars-empty {
  padding: 14px;
  text-align: center;
  color: var(--secondary-light-color);
  font-size: var(--font-size-body);
}

.env-modal-footer {
  display: flex;
  align-items: center;
  gap: 8px;
}

.flex-1 {
  flex: 1;
}
</style>
