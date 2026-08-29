<script setup lang="ts">
import { computed, ref, watch } from 'vue'
import { X } from '@lucide/vue'
import { useWorkspaceStore } from '@/stores/workspace'
import { useAppStore } from '@/stores/app'
import AuthConfig from '@/components/editor/AuthConfig.vue'
import { createDefaultAuthConfig } from '@/utils/auth'
import type { CollectionVariable, KvPair } from '@/types'

const props = defineProps<{
  collectionId: string
}>()

const emit = defineEmits<{
  close: []
}>()

const workspace = useWorkspaceStore()
const store = useAppStore()

const tab = ref<'general' | 'auth' | 'headers' | 'variables' | 'scripts'>('general')
const tabs = [
  { value: 'general', label: '基本信息' },
  { value: 'auth', label: 'Auth' },
  { value: 'headers', label: 'Headers' },
  { value: 'variables', label: '变量' },
  { value: 'scripts', label: '脚本' },
] as const

const collection = computed(() => workspace.collections.find(item => item.id === props.collectionId) ?? null)

const draftName = ref('')
const draftDescription = ref('')
const draftColor = ref('#6366f1')
const draftIcon = ref('')
const draftAuth = ref(collection.value?.auth ?? createDefaultAuthConfig())
const draftHeaders = ref<KvPair[]>([])
const draftVariables = ref<CollectionVariable[]>([])
const draftPreScript = ref('')
const draftPostScript = ref('')
const draftSelectedEnvId = ref<string | null>(null)

watch(() => props.collectionId, () => {
  const source = collection.value
  if (!source) return
  draftName.value = source.name
  draftDescription.value = source.description ?? ''
  draftColor.value = source.color || '#6366f1'
  draftIcon.value = source.icon ?? ''
  draftAuth.value = { ...source.auth }
  draftHeaders.value = source.headers.map(item => ({ ...item }))
  draftVariables.value = source.variables.map(item => ({ ...item }))
  draftPreScript.value = source.preRequestScript
  draftPostScript.value = source.postRequestScript
  draftSelectedEnvId.value = source.selectedEnvId
}, { immediate: true })

/** 该集合自己的环境(Phase 2:环境按集合隔离) */
const collectionEnvs = computed(() =>
  store.environments.filter(item => item.collectionId === props.collectionId),
)

const PRESET_COLORS = [
  '#6366f1', '#3b82f6', '#0ea5e9', '#14b8a6',
  '#10b981', '#f59e0b', '#ef4444', '#ec4899',
  '#8b5cf6', '#64748b',
]

function addHeader() {
  draftHeaders.value.push({ key: '', value: '', enabled: true })
}
function removeHeader(index: number) {
  draftHeaders.value.splice(index, 1)
}

function addVariable() {
  draftVariables.value.push({ key: '', initialValue: '', currentValue: '', secret: false, enabled: true })
}
function removeVariable(index: number) {
  draftVariables.value.splice(index, 1)
}

async function save() {
  const name = draftName.value.trim()
  if (!name) return
  await workspace.updateModule(props.collectionId, {
    name,
    color: draftColor.value,
    icon: draftIcon.value.trim() || undefined,
    description: draftDescription.value,
  })
  await workspace.updateCollectionSettings(props.collectionId, {
    auth: draftAuth.value,
    headers: draftHeaders.value.filter(item => item.key.trim()),
    variables: draftVariables.value.filter(item => item.key.trim()),
    preRequestScript: draftPreScript.value,
    postRequestScript: draftPostScript.value,
    selectedEnvId: draftSelectedEnvId.value,
    description: draftDescription.value,
    color: draftColor.value,
  })
  emit('close')
}
</script>

<template>
  <div class="modal-overlay" @click.self="emit('close')">
    <div class="modal-content collection-settings-modal">
      <div class="compare-header">
        <div>
          <h3>集合设置</h3>
          <p>集合级 Auth / Headers / 变量 / 脚本会被树内所有请求继承(就近覆盖)。</p>
        </div>
        <button class="btn btn-sm" @click="emit('close')"><X :size="15" /></button>
      </div>

      <div class="settings-tabs">
        <button
          v-for="item in tabs"
          :key="item.value"
          :class="['settings-tab', { active: tab === item.value }]"
          @click="tab = item.value"
        >{{ item.label }}</button>
      </div>

      <div class="settings-body">
        <template v-if="tab === 'general'">
          <label class="field-row">
            <span>集合名称</span>
            <input v-model="draftName" type="text" placeholder="集合名称" />
          </label>
          <label class="field-row">
            <span>描述</span>
            <input v-model="draftDescription" type="text" placeholder="可选" />
          </label>
          <label class="field-row">
            <span>图标</span>
            <input v-model="draftIcon" type="text" placeholder="1 个 Emoji 或 1-2 个字符,留空自动" />
          </label>
          <div class="field-row">
            <span>颜色</span>
            <div class="color-row">
              <button
                v-for="color in PRESET_COLORS"
                :key="color"
                class="color-dot"
                :class="{ active: draftColor === color }"
                :style="{ backgroundColor: color }"
                @click="draftColor = color"
              ></button>
            </div>
          </div>
          <div class="field-row">
            <span>当前环境</span>
            <select v-model="draftSelectedEnvId">
              <option :value="null">不使用环境</option>
              <option v-for="env in collectionEnvs" :key="env.id" :value="env.id">{{ env.name }}</option>
            </select>
          </div>
          <p v-if="collectionEnvs.length === 0" class="hint-line">
            该集合还没有自己的环境,可在底部"环境变量"面板中为当前集合创建(local / test / prod…)。
          </p>
        </template>

        <template v-else-if="tab === 'auth'">
          <p class="hint-line">请求的 Auth 类型为"继承父级"时,使用此处定义(最近的显式定义生效)。</p>
          <AuthConfig v-model="draftAuth" />
        </template>

        <template v-else-if="tab === 'headers'">
          <p class="hint-line">集合级 Headers 会与请求自身 Headers 合并发送,同名 key 以请求自身为准。</p>
          <div v-for="(header, index) in draftHeaders" :key="index" class="kv-row">
            <input v-model="header.enabled" type="checkbox" class="kv-check" title="启用" />
            <input v-model="header.key" type="text" placeholder="Header 名称" class="kv-key" />
            <input v-model="header.value" type="text" placeholder="值" class="kv-value" />
            <button class="kv-remove" @click="removeHeader(index)"><X :size="14" /></button>
          </div>
          <button class="btn btn-sm" @click="addHeader">+ 添加 Header</button>
        </template>

        <template v-else-if="tab === 'variables'">
          <p class="hint-line">集合变量:initialValue 为持久默认值,currentValue 为会话运行值(脚本可改),secret 变量导出时剥离。</p>
          <div v-for="(variable, index) in draftVariables" :key="index" class="kv-row var-row">
            <input v-model="variable.enabled" type="checkbox" class="kv-check" title="启用" />
            <input v-model="variable.key" type="text" placeholder="变量名" class="kv-key" />
            <input v-model="variable.initialValue" type="text" placeholder="初始值" class="kv-value" />
            <input v-model="variable.currentValue" :type="variable.secret ? 'password' : 'text'" placeholder="当前值" class="kv-value" />
            <label class="secret-check" title="Secret:导出时剥离取值">
              <input v-model="variable.secret" type="checkbox" /> secret
            </label>
            <button class="kv-remove" @click="removeVariable(index)"><X :size="14" /></button>
          </div>
          <button class="btn btn-sm" @click="addVariable">+ 添加变量</button>
        </template>

        <template v-else>
          <label class="field-row">
            <span>集合级 Pre Request Script</span>
            <textarea v-model="draftPreScript" class="script-editor" spellcheck="false" placeholder="对集合内所有请求生效,先于文件夹/请求级脚本执行。例如:&#10;pm.environment.set('baseUrl', 'https://api.example.com')"></textarea>
          </label>
          <label class="field-row">
            <span>集合级 Post Response Script(Tests)</span>
            <textarea v-model="draftPostScript" class="script-editor" spellcheck="false" placeholder="响应后执行,晚于请求/文件夹级 Tests。例如:&#10;pm.test('状态码 200', () => pm.expect(pm.response.code).to.equal(200))"></textarea>
          </label>
        </template>
      </div>

      <div class="modal-actions">
        <button class="btn btn-sm" @click="emit('close')">取消</button>
        <button class="btn btn-sm btn-primary" :disabled="!draftName.trim()" @click="save">保存设置</button>
      </div>
    </div>
  </div>
</template>

<style scoped>
.collection-settings-modal {
  width: min(760px, 94vw);
}

.settings-tabs {
  display: flex;
  gap: 4px;
  border-bottom: 1px solid var(--divider);
  padding-bottom: 8px;
}

.settings-tab {
  padding: 5px 12px;
  border: 1px solid transparent;
  border-radius: var(--radius-md);
  background: transparent;
  color: var(--text-secondary);
  cursor: pointer;
  font-size: var(--font-size-small);
}

.settings-tab.active {
  background: var(--primary-soft);
  color: var(--primary);
  border-color: color-mix(in srgb, var(--primary) 30%, transparent);
}

.settings-body {
  overflow-y: auto;
  max-height: 56vh;
  display: flex;
  flex-direction: column;
  gap: 10px;
  padding-right: 4px;
}

.field-row {
  display: flex;
  flex-direction: column;
  gap: 6px;
  font-size: var(--font-size-small);
  color: var(--text-secondary);
}

.field-row > span {
  font-weight: 600;
}

.field-row input[type='text'],
.field-row select {
  height: 36px;
  padding: 0 10px;
  border: 1px solid var(--border);
  border-radius: var(--radius-lg);
  background: var(--bg-secondary);
  color: var(--text-primary);
}

.color-row {
  display: flex;
  gap: 6px;
  flex-wrap: wrap;
}

.color-dot {
  width: 20px;
  height: 20px;
  border-radius: 50%;
  border: 2px solid transparent;
  cursor: pointer;
  padding: 0;
}

.color-dot.active {
  border-color: var(--text-primary);
}

.kv-row {
  display: flex;
  align-items: center;
  gap: 6px;
}

.kv-row input[type='text'] {
  height: 32px;
  padding: 0 8px;
  border: 1px solid var(--border);
  border-radius: var(--radius-md);
  background: var(--bg-secondary);
  color: var(--text-primary);
  font-size: var(--font-size-small);
}

.kv-key { width: 160px; flex-shrink: 0; }
.kv-value { flex: 1; min-width: 0; }
.var-row .kv-value { flex: 0.8; }

.kv-check { flex-shrink: 0; }
.secret-check {
  display: inline-flex;
  align-items: center;
  gap: 4px;
  font-size: var(--font-size-small);
  color: var(--text-tertiary);
  flex-shrink: 0;
}

.kv-remove {
  border: none;
  background: transparent;
  color: var(--text-tertiary);
  cursor: pointer;
  padding: 4px;
  flex-shrink: 0;
}

.kv-remove:hover { color: var(--danger, #ef4444); }

.script-editor {
  width: 100%;
  min-height: 150px;
  padding: 8px 10px;
  border: 1px solid var(--border);
  border-radius: var(--radius-lg);
  background: var(--bg-code);
  color: var(--text-primary);
  font-family: var(--font-code);
  font-size: var(--font-size-code);
  resize: vertical;
}

.hint-line {
  margin: 0;
  padding: 8px 10px;
  border: 1px solid var(--border);
  border-radius: var(--radius-lg);
  background: var(--bg-secondary);
  color: var(--text-secondary);
  font-size: var(--font-size-small);
  line-height: 1.5;
}

.compare-header {
  display: flex;
  align-items: flex-start;
  justify-content: space-between;
  gap: 12px;
}

.compare-header h3 { margin: 0 0 4px; }
.compare-header p {
  margin: 0;
  color: var(--text-secondary);
  font-size: var(--font-size-body);
}

.modal-overlay {
  position: fixed;
  inset: 0;
  background: rgba(2, 6, 23, 0.52);
  backdrop-filter: blur(8px);
  display: flex;
  align-items: center;
  justify-content: center;
  z-index: 1001;
}

.modal-content {
  background: var(--bg-panel);
  border: 1px solid var(--border);
  border-radius: var(--radius-2xl);
  padding: 20px;
  max-width: calc(100vw - 28px);
  max-height: 84vh;
  display: flex;
  flex-direction: column;
  gap: 12px;
  box-shadow: var(--shadow-lg);
}

.modal-actions {
  display: flex;
  justify-content: flex-end;
  gap: 8px;
}
</style>
