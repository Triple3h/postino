<script setup lang="ts">
import { computed, ref, watch } from 'vue'
import { X } from '@lucide/vue'
import { useWorkspaceStore } from '@/stores/workspace'
import { useAppStore } from '@/stores/app'
import AuthConfig from '@/components/editor/AuthConfig.vue'
import CodeMirrorEditor from '@/components/common/CodeMirrorEditor.vue'
import { createDefaultAuthConfig } from '@/utils/auth'
import type { AuthConfig as AuthConfigData, CollectionVariable, KvPair } from '@/types'

/**
 * Properties 弹窗(FR-2.6,参考 Hoppscotch Properties.vue):
 * Headers / Auth / 变量 / 脚本(前置+后置子 tab) / 详情 五 tab;
 * 集合与文件夹双模式,文件夹多「脚本继承父级」开关。
 */
const props = defineProps<{
  target: { type: 'collection' | 'folder'; id: string }
}>()

const emit = defineEmits<{
  close: []
}>()

const workspace = useWorkspaceStore()
const store = useAppStore()

type TabKey = 'headers' | 'auth' | 'variables' | 'scripts' | 'details'
const tab = ref<TabKey>('details')
const scriptSubTab = ref<'pre' | 'post'>('pre')
const tabs: Array<{ key: TabKey; label: string }> = [
  { key: 'details', label: '详情' },
  { key: 'headers', label: 'Headers' },
  { key: 'auth', label: 'Auth' },
  { key: 'variables', label: '变量' },
  { key: 'scripts', label: '脚本' },
]

const isFolderMode = computed(() => props.target.type === 'folder')

const collection = computed(() => isFolderMode.value ? null : workspace.collections.find(item => item.id === props.target.id) ?? null)
const folder = computed(() => isFolderMode.value ? workspace.interfaces.find(item => item.id === props.target.id) ?? null : null)

const PRESET_COLORS = ['#6366f1', '#3b82f6', '#0ea5e9', '#14b8a6', '#10b981', '#f59e0b', '#ef4444', '#ec4899', '#8b5cf6', '#71717a']

// 详情
const draftName = ref('')
const draftDescription = ref('')
const draftColor = ref('#6366f1')
const draftIcon = ref('')
const draftSelectedEnvId = ref<string | null>(null)

// Headers / Auth / 变量 / 脚本
const draftHeaders = ref<KvPair[]>([])
const draftAuth = ref<AuthConfigData>(createDefaultAuthConfig())
const draftAuthOverride = ref(true)
const draftVariables = ref<CollectionVariable[]>([])
const draftPreScript = ref('')
const draftPostScript = ref('')
const draftScriptsInherit = ref(true)

watch(() => props.target, () => {
  const source = collection.value ?? folder.value
  if (!source) return
  draftName.value = source.name
  draftHeaders.value = (source.headers ?? []).map(item => ({ ...item }))
  draftVariables.value = (source.variables ?? []).map(item => ({ ...item }))
  draftPreScript.value = source.preRequestScript ?? ''
  draftPostScript.value = source.postRequestScript ?? ''

  if (collection.value) {
    draftDescription.value = collection.value.description ?? ''
    draftColor.value = collection.value.color || '#6366f1'
    draftIcon.value = collection.value.icon ?? ''
    draftSelectedEnvId.value = collection.value.selectedEnvId
    draftAuth.value = { ...collection.value.auth }
    draftAuthOverride.value = true
    draftScriptsInherit.value = true
  } else if (folder.value) {
    draftDescription.value = ''
    draftColor.value = '#6366f1'
    draftIcon.value = ''
    draftSelectedEnvId.value = null
    draftAuth.value = folder.value.auth ? { ...folder.value.auth } : createDefaultAuthConfig()
    draftAuthOverride.value = Boolean(folder.value.auth)
    draftScriptsInherit.value = folder.value.scriptsInherit !== false
  }
}, { immediate: true })

const collectionEnvs = computed(() =>
  store.environments.filter(item => item.collectionId === props.target.id),
)

const folderStats = computed(() => {
  if (!isFolderMode.value) return null
  const descendants = workspace.getDescendantNodes(props.target.id)
  return {
    folders: descendants.filter(item => (item.nodeType ?? 'request') === 'folder').length,
    requests: descendants.filter(item => (item.nodeType ?? 'request') !== 'folder').length,
  }
})

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
  if (isFolderMode.value && folder.value) {
    const updates: Record<string, unknown> = {
      name,
      scriptsInherit: draftScriptsInherit.value,
      preRequestScript: draftPreScript.value,
      postRequestScript: draftPostScript.value,
      headers: draftHeaders.value.filter(item => item.key.trim()),
      variables: draftVariables.value.filter(item => item.key.trim()),
    }
    if (draftAuthOverride.value) updates.auth = draftAuth.value
    else updates.auth = undefined
    await workspace.updateInterfaceNode(folder.value.id, updates)
  } else if (collection.value) {
    await workspace.updateModule(collection.value.id, {
      name,
      color: draftColor.value,
      icon: draftIcon.value.trim() || undefined,
      description: draftDescription.value,
    })
    await workspace.updateCollectionSettings(collection.value.id, {
      auth: draftAuth.value,
      headers: draftHeaders.value.filter(item => item.key.trim()),
      variables: draftVariables.value.filter(item => item.key.trim()),
      preRequestScript: draftPreScript.value,
      postRequestScript: draftPostScript.value,
      selectedEnvId: draftSelectedEnvId.value,
      description: draftDescription.value,
      color: draftColor.value,
    })
  }
  emit('close')
}
</script>

<template>
  <Teleport to="body">
    <div class="modal-overlay" @click.self="emit('close')">
      <div class="properties-modal">
        <header class="modal-header">
          <div>
            <h3>属性 · {{ draftName || (isFolderMode ? '文件夹' : '集合') }}</h3>
            <p>{{ isFolderMode ? '文件夹级配置会被子节点继承(就近覆盖)。' : '集合级配置会被树内所有请求继承(就近覆盖)。' }}</p>
          </div>
          <button class="close-btn" @click="emit('close')"><X :size="15" /></button>
        </header>

        <div class="prop-tabs">
          <button
            v-for="item in tabs"
            :key="item.key"
            class="prop-tab"
            :class="{ active: tab === item.key }"
            @click="tab = item.key"
          >{{ item.label }}</button>
        </div>

        <div class="prop-body">
          <!-- 详情 -->
          <template v-if="tab === 'details'">
            <label class="field-row">
              <span>名称</span>
              <input v-model="draftName" type="text" placeholder="名称" />
            </label>
            <template v-if="!isFolderMode">
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
            </template>
            <div v-if="folderStats" class="stat-line">
              {{ folderStats.folders }} 个文件夹 · {{ folderStats.requests }} 个请求
            </div>
          </template>

          <!-- Headers -->
          <template v-else-if="tab === 'headers'">
            <p class="hint-line">与请求自身 Headers 合并发送,同名 key 以请求自身为准。</p>
            <div v-for="(header, index) in draftHeaders" :key="index" class="kv-row">
              <input v-model="header.enabled" type="checkbox" title="启用" />
              <input v-model="header.key" type="text" placeholder="Header 名称" class="kv-key" />
              <input v-model="header.value" type="text" placeholder="值" class="kv-value" />
              <button class="kv-remove" @click="removeHeader(index)"><X :size="13" /></button>
            </div>
            <button class="btn btn-sm" @click="addHeader">+ 添加 Header</button>
          </template>

          <!-- Auth -->
          <template v-else-if="tab === 'auth'">
            <template v-if="isFolderMode">
              <label class="inherit-toggle">
                <input v-model="draftAuthOverride" type="checkbox" />
                <span>此文件夹显式定义 Auth(取消勾选 = 继承父级)</span>
              </label>
            </template>
            <p v-else class="hint-line">请求的 Auth 类型为「继承父级」时,使用此处定义(最近的显式定义生效)。</p>
            <AuthConfig v-if="draftAuthOverride || !isFolderMode" v-model="draftAuth" />
          </template>

          <!-- 变量 -->
          <template v-else-if="tab === 'variables'">
            <p class="hint-line">initialValue 为持久默认值,currentValue 为会话运行值(脚本可改),secret 变量导出时剥离取值。</p>
            <div v-for="(variable, index) in draftVariables" :key="index" class="kv-row var-row">
              <input v-model="variable.enabled" type="checkbox" title="启用" />
              <input v-model="variable.key" type="text" placeholder="变量名" class="kv-key" />
              <input v-model="variable.initialValue" type="text" placeholder="初始值" class="kv-value" />
              <input v-model="variable.currentValue" :type="variable.secret ? 'password' : 'text'" placeholder="当前值" class="kv-value" />
              <label class="secret-check" title="Secret:导出时剥离取值">
                <input v-model="variable.secret" type="checkbox" /> secret
              </label>
              <button class="kv-remove" @click="removeVariable(index)"><X :size="13" /></button>
            </div>
            <button class="btn btn-sm" @click="addVariable">+ 添加变量</button>
          </template>

          <!-- 脚本(前置+后置子 tab) -->
          <template v-else-if="tab === 'scripts'">
            <label v-if="isFolderMode" class="inherit-toggle">
              <input v-model="draftScriptsInherit" type="checkbox" />
              <span>脚本继承父级(勾选 = 父级脚本 + 自身脚本都执行)</span>
            </label>
            <div class="script-sub-tabs">
              <button :class="['sub-tab', { active: scriptSubTab === 'pre' }]" @click="scriptSubTab = 'pre'">前置脚本</button>
              <button :class="['sub-tab', { active: scriptSubTab === 'post' }]" @click="scriptSubTab = 'post'">后置脚本</button>
            </div>
            <div class="script-editor-wrap">
              <CodeMirrorEditor
                v-if="scriptSubTab === 'pre'"
                v-model="draftPreScript"
                language="javascript"
                placeholder="// 对该范围所有请求生效(先执行)。例如:&#10;pm.environment.set('baseUrl', 'https://api.example.com')"
                class="script-editor"
              />
              <CodeMirrorEditor
                v-else
                v-model="draftPostScript"
                language="javascript"
                placeholder="// 响应后执行(后执行)。例如:&#10;pm.test('状态码 200', () => pm.expect(pm.response.code).to.equal(200))"
                class="script-editor"
              />
            </div>
          </template>
        </div>

        <footer class="modal-actions">
          <button class="btn btn-sm" @click="emit('close')">取消</button>
          <button class="btn btn-sm btn-primary" :disabled="!draftName.trim()" @click="save">保存</button>
        </footer>
      </div>
    </div>
  </Teleport>
</template>

<style scoped>
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

.properties-modal {
  display: flex;
  flex-direction: column;
  gap: 12px;
  width: min(640px, calc(100vw - 32px));
  height: min(600px, 86vh);
  padding: 16px;
  border: 1px solid var(--divider-dark-color);
  border-radius: var(--radius-lg);
  background: var(--popover-color);
  box-shadow: var(--shadow-lg);
}

.modal-header {
  display: flex;
  align-items: flex-start;
  justify-content: space-between;
  gap: 12px;
}

.modal-header h3 {
  font-size: 14px;
}

.modal-header p {
  margin-top: 3px;
  color: var(--secondary-color);
  font-size: var(--font-size-tiny);
}

.close-btn {
  display: inline-flex;
  padding: 4px;
  border-radius: var(--radius-sm);
  color: var(--secondary-color);
}

.close-btn:hover {
  background: var(--primary-dark-color);
  color: var(--secondary-dark-color);
}

.prop-tabs {
  display: flex;
  gap: 2px;
  border-bottom: 1px solid var(--divider-color);
}

.prop-tab {
  padding: 6px 10px;
  border: none;
  border-bottom: 2px solid transparent;
  background: transparent;
  color: var(--secondary-color);
  font-size: var(--font-size-body);
}

.prop-tab:hover {
  color: var(--secondary-dark-color);
}

.prop-tab.active {
  color: var(--accent-color);
  border-bottom-color: var(--accent-color);
}

.prop-body {
  flex: 1;
  min-height: 0;
  overflow-y: auto;
  display: flex;
  flex-direction: column;
  gap: 10px;
  padding-right: 2px;
}

.field-row {
  display: flex;
  flex-direction: column;
  gap: 5px;
  font-size: var(--font-size-tiny);
  color: var(--secondary-color);
}

.field-row > span {
  font-weight: 600;
}

.field-row input[type='text'],
.field-row select {
  height: 32px;
  padding: 0 10px;
  font-size: var(--font-size-body);
}

.color-row {
  display: flex;
  gap: 6px;
  flex-wrap: wrap;
}

.color-dot {
  width: 18px;
  height: 18px;
  border-radius: 50%;
  border: 2px solid transparent;
  padding: 0;
}

.color-dot.active {
  border-color: var(--secondary-dark-color);
}

.stat-line {
  color: var(--secondary-light-color);
  font-size: var(--font-size-tiny);
}

.hint-line {
  margin: 0;
  padding: 8px 10px;
  border: 1px solid var(--divider-color);
  border-radius: var(--radius-md);
  background: var(--primary-light-color);
  color: var(--secondary-color);
  font-size: var(--font-size-tiny);
  line-height: 1.6;
}

.inherit-toggle {
  display: flex;
  align-items: center;
  gap: 7px;
  font-size: var(--font-size-body);
  color: var(--secondary-color);
  cursor: pointer;
}

.kv-row {
  display: flex;
  align-items: center;
  gap: 6px;
}

.kv-row input[type='text'] {
  height: 30px;
  padding: 0 8px;
  font-size: var(--font-size-body);
}

.kv-key {
  width: 150px;
  flex-shrink: 0;
}

.kv-value {
  flex: 1;
  min-width: 0;
}

.var-row .kv-value {
  flex: 0.8;
}

.secret-check {
  display: inline-flex;
  align-items: center;
  gap: 4px;
  font-size: var(--font-size-tiny);
  color: var(--secondary-light-color);
  flex-shrink: 0;
  cursor: pointer;
}

.kv-remove {
  display: inline-flex;
  padding: 4px;
  color: var(--secondary-light-color);
  flex-shrink: 0;
}

.kv-remove:hover {
  color: var(--status-critical-error-color);
}

.script-sub-tabs {
  display: flex;
  gap: 4px;
}

.sub-tab {
  padding: 4px 10px;
  border-radius: var(--radius-sm);
  color: var(--secondary-color);
  font-size: var(--font-size-tiny);
}

.sub-tab.active {
  background: color-mix(in srgb, var(--accent-color) 14%, transparent);
  color: var(--accent-color);
}

.script-editor-wrap {
  flex: 1;
  min-height: 200px;
  display: flex;
  flex-direction: column;
}

.script-editor {
  flex: 1;
}

.modal-actions {
  display: flex;
  justify-content: flex-end;
  gap: 8px;
}
</style>
