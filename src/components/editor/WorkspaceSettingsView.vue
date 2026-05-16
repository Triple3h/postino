<script setup lang="ts">
import { computed, ref, watch } from 'vue'
import { useAppStore } from '@/stores/app'
import { useWorkspaceStore } from '@/stores/workspace'
import { generateMarkdownDoc, generateOpenApiSpec } from '@/utils/export'
import type { ApiConfig, ModuleType, ModuleVariables } from '@/types'

const store = useAppStore()
const workspace = useWorkspaceStore()

const categoryName = ref('')
const categoryColor = ref('#6366f1')
const categoryDescription = ref('')
const moduleName = ref('')
const moduleCategoryId = ref('')
const moduleDescription = ref('')
const moduleType = ref<ModuleType>('generic')
const activeModuleTab = ref<'overview' | 'variables' | 'settings'>('overview')
const saveMessage = ref('')
let messageTimer: ReturnType<typeof setTimeout> | null = null

interface VariableRow {
  key: string
  remote: string
  local: string
  description: string
}

const variableRows = ref<VariableRow[]>([])

const moduleTypes: Array<{ value: ModuleType; icon: string; title: string; desc: string }> = [
  { value: 'generic', icon: '🟦', title: '通用 API', desc: '通过可视化表单设计、调试和维护接口。' },
  { value: 'openapi-yaml', icon: '📄', title: 'OpenAPI YAML', desc: '面向已有 Swagger/OpenAPI 文档的 YAML/JSON 编辑模式。' },
  { value: 'readonly', icon: '🔒', title: '只读模式', desc: '禁止手动修改，适合通过导入或同步更新的接口。' },
]

const activeCategory = computed(() => workspace.activeCategory)
const activeModule = computed(() => workspace.activeModule)

const selectedCategoryModuleCount = computed(() => {
  if (!activeCategory.value) return 0
  return workspace.modules.filter(item => item.categoryId === activeCategory.value?.id).length
})

const selectedCategoryInterfaceCount = computed(() => {
  if (!activeCategory.value) return 0
  const moduleIds = workspace.modules
    .filter(item => item.categoryId === activeCategory.value?.id)
    .map(item => item.id)
  return workspace.interfaces.filter(item => moduleIds.includes(item.moduleId)).length
})

const categoryModules = computed(() => {
  if (!activeCategory.value) return []
  return workspace.modules
    .filter(item => item.categoryId === activeCategory.value?.id)
    .sort((a, b) => a.order - b.order)
})

const selectedModuleInterfaceCount = computed(() => {
  if (!activeModule.value) return 0
  return workspace.interfaces.filter(item => item.moduleId === activeModule.value?.id).length
})

const selectedModuleCategoryName = computed(() => {
  const category = workspace.categories.find(item => item.id === activeModule.value?.categoryId)
  return category?.name ?? '未选择分组'
})

const moduleInterfaces = computed(() => {
  if (!activeModule.value) return []
  return workspace.interfaces
    .filter(item => item.moduleId === activeModule.value?.id)
    .sort((a, b) => a.order - b.order)
})

const selectedModuleType = computed(() => moduleTypes.find(item => item.value === moduleType.value) ?? moduleTypes[0])

const moduleStats = computed(() => ({
  interfaceCount: selectedModuleInterfaceCount.value,
  docCount: 0,
  modelCount: 0,
  caseTotal: 0,
  caseCoverage: '0%',
  sceneCaseTotal: 0,
  sceneCoverage: '0%',
  avgCasePerInterface: '0.0',
  uncoveredInterfaceCount: selectedModuleInterfaceCount.value,
}))

watch(activeCategory, (category) => {
  categoryName.value = category?.name ?? ''
  categoryColor.value = category?.color || '#6366f1'
  categoryDescription.value = category?.description ?? ''
  clearMessage()
}, { immediate: true })

watch(activeModule, (module) => {
  moduleName.value = module?.name ?? ''
  moduleCategoryId.value = module?.categoryId ?? ''
  moduleDescription.value = module?.description ?? ''
  moduleType.value = module?.type ?? 'generic'
  variableRows.value = moduleVariablesToRows(module?.variables)
  activeModuleTab.value = 'overview'
  clearMessage()
}, { immediate: true })

function clearMessage() {
  if (messageTimer) {
    clearTimeout(messageTimer)
    messageTimer = null
  }
  saveMessage.value = ''
}

function showSaved(message = '已保存') {
  saveMessage.value = message
  if (messageTimer) clearTimeout(messageTimer)
  messageTimer = setTimeout(() => {
    saveMessage.value = ''
    messageTimer = null
  }, 1800)
}

function formatTime(timestamp?: number): string {
  if (!timestamp) return '-'
  return new Date(timestamp).toLocaleString()
}

function moduleVariablesToRows(variables?: ModuleVariables): VariableRow[] {
  return Object.entries(variables ?? {}).map(([key, value]) => ({
    key,
    remote: value.remote ?? '',
    local: value.local ?? '',
    description: value.description ?? '',
  }))
}

function rowsToModuleVariables(): ModuleVariables {
  const variables: ModuleVariables = {}
  for (const row of variableRows.value) {
    const key = row.key.trim()
    if (!key) continue
    variables[key] = {
      remote: row.remote,
      local: row.local,
      description: row.description,
    }
  }
  return variables
}

async function saveCategory() {
  const category = activeCategory.value
  if (!category) return
  const name = categoryName.value.trim()
  if (!name) return
  await workspace.updateCategory(category.id, {
    name,
    color: categoryColor.value || '#6366f1',
    description: categoryDescription.value.trim(),
  })
  showSaved('分组设置已保存')
}

async function saveModuleSettings(message = '模块设置已保存') {
  const module = activeModule.value
  if (!module) return
  const name = moduleName.value.trim()
  if (!name || !moduleCategoryId.value) return
  const moved = moduleCategoryId.value !== module.categoryId
  await workspace.updateModule(module.id, {
    name,
    categoryId: moduleCategoryId.value,
    type: moduleType.value,
    description: moduleDescription.value.trim(),
    order: moved
      ? workspace.modules.filter(item => item.categoryId === moduleCategoryId.value && item.id !== module.id).length
      : module.order,
  })
  workspace.selectModule(module.id)
  showSaved(message)
}

async function saveModuleVariables() {
  const module = activeModule.value
  if (!module) return
  await workspace.updateModule(module.id, { variables: rowsToModuleVariables() })
  showSaved('模块变量已保存')
}

function addVariableRow() {
  variableRows.value.push({ key: '', remote: '', local: '', description: '' })
}

function deleteVariableRow(index: number) {
  variableRows.value.splice(index, 1)
}

function useRemoteAsLocal(index: number) {
  const row = variableRows.value[index]
  if (row) row.local = row.remote
}

function getModuleApis(): ApiConfig[] {
  return moduleInterfaces.value
    .map(item => store.apis[item.apiId])
    .filter((api): api is ApiConfig => Boolean(api))
}

function safeFileName(name: string): string {
  return (name || 'module').replace(/[\\/:*?"<>|]+/g, '-')
}

function downloadText(filename: string, content: string, type = 'application/json') {
  const blob = new Blob([content], { type })
  const url = URL.createObjectURL(blob)
  const a = document.createElement('a')
  a.href = url
  a.download = filename
  a.click()
  URL.revokeObjectURL(url)
}

function exportModuleOpenApi() {
  const apis = getModuleApis()
  if (apis.length === 0) {
    showSaved('暂无可导出的接口')
    return
  }
  const name = activeModule.value?.name ?? 'module'
  downloadText(`${safeFileName(name)}.openapi.json`, generateOpenApiSpec(apis, name))
  showSaved('已导出 OpenAPI')
}

function exportModuleMarkdown() {
  const apis = getModuleApis()
  if (apis.length === 0) {
    showSaved('暂无可导出的接口')
    return
  }
  const name = activeModule.value?.name ?? 'module'
  const content = [`# ${name}`, '', ...apis.flatMap(api => [generateMarkdownDoc(api), ''])].join('\n')
  downloadText(`${safeFileName(name)}.md`, content, 'text/markdown')
  showSaved('已导出 Markdown')
}

function backupModule() {
  const module = activeModule.value
  if (!module) return
  const payload = {
    module,
    category: workspace.categories.find(item => item.id === module.categoryId) ?? null,
    interfaces: moduleInterfaces.value,
    apis: getModuleApis(),
    exportedAt: new Date().toISOString(),
  }
  downloadText(`${safeFileName(module.name)}.backup.json`, JSON.stringify(payload, null, 2))
  showSaved('已生成模块备份')
}

function openInterface(apiId: string) {
  const interfaceNode = workspace.interfaces.find(item => item.apiId === apiId)
  workspace.selectInterface(interfaceNode?.id ?? apiId)
  store.currentApiId = apiId
}
</script>

<template>
  <div class="workspace-settings">
    <template v-if="activeCategory">
      <header class="settings-header">
        <div>
          <div class="eyebrow">分组设置</div>
          <h2><span class="title-dot" :style="{ backgroundColor: categoryColor }"></span>{{ activeCategory.name }}</h2>
          <p>维护分组基础信息，并查看该分组下的模块。</p>
        </div>
        <button class="btn btn-primary" @click="saveCategory">保存</button>
      </header>

      <section class="settings-card">
        <h3>基础信息</h3>
        <label class="field-row">
          <span>分组名称</span>
          <input v-model="categoryName" type="text" placeholder="输入分组名称" @keydown.enter="saveCategory" />
        </label>
        <label class="field-row">
          <span>颜色标签</span>
          <div class="color-field">
            <input v-model="categoryColor" type="color" />
            <input v-model="categoryColor" type="text" placeholder="#6366f1" />
          </div>
        </label>
        <label class="field-row field-row-top">
          <span>说明</span>
          <textarea v-model="categoryDescription" rows="3" placeholder="补充分组用途、业务边界或维护说明"></textarea>
        </label>
        <div class="meta-grid">
          <div><strong>{{ selectedCategoryModuleCount }}</strong><span>模块数</span></div>
          <div><strong>{{ selectedCategoryInterfaceCount }}</strong><span>接口数</span></div>
          <div><strong>{{ formatTime(activeCategory.updatedAt) }}</strong><span>更新时间</span></div>
        </div>
      </section>

      <section class="settings-card">
        <h3>该分组下的模块</h3>
        <div class="module-list">
          <button
            v-for="module in categoryModules"
            :key="module.id"
            class="module-link"
            @click="workspace.selectModule(module.id)"
          >
            <span>{{ module.name }}</span>
            <small>{{ workspace.interfaces.filter(item => item.moduleId === module.id).length }} 个接口 · {{ moduleTypes.find(item => item.value === (module.type ?? 'generic'))?.title }}</small>
          </button>
          <div v-if="selectedCategoryModuleCount === 0" class="empty-hint">该分组下暂无模块。</div>
        </div>
      </section>
    </template>

    <template v-else-if="activeModule">
      <header class="settings-header sticky-header">
        <div>
          <div class="eyebrow">模块主页</div>
          <h2>{{ activeModule.name }}</h2>
          <p>{{ selectedModuleCategoryName }} · {{ selectedModuleType.title }}</p>
        </div>
        <div class="header-actions">
          <button v-if="activeModuleTab === 'variables'" class="btn btn-primary" @click="saveModuleVariables">保存变量</button>
          <button v-else class="btn btn-primary" @click="saveModuleSettings(activeModuleTab === 'settings' ? '模块设置已保存' : '模块概览已保存')">保存</button>
        </div>
      </header>

      <nav class="settings-tabs">
        <button :class="{ active: activeModuleTab === 'overview' }" @click="activeModuleTab = 'overview'">概览</button>
        <button :class="{ active: activeModuleTab === 'variables' }" @click="activeModuleTab = 'variables'">模块变量</button>
        <button :class="{ active: activeModuleTab === 'settings' }" @click="activeModuleTab = 'settings'">设置</button>
      </nav>

      <template v-if="activeModuleTab === 'overview'">
        <section class="settings-card">
          <h3>📊 统计</h3>
          <div class="stat-grid stat-grid-large">
            <div><strong>{{ moduleStats.interfaceCount }}</strong><span>接口数</span></div>
            <div><strong>{{ moduleStats.docCount }}</strong><span>文档数</span></div>
            <div><strong>{{ moduleStats.modelCount }}</strong><span>数据模型</span></div>
          </div>
        </section>

        <div class="overview-grid">
          <section class="settings-card">
            <h3>📋 单接口用例覆盖</h3>
            <div class="stat-grid">
              <div><strong>{{ moduleStats.caseTotal }}</strong><span>用例总数</span></div>
              <div><strong>{{ moduleStats.caseCoverage }}</strong><span>覆盖率</span></div>
              <div><strong>{{ moduleStats.avgCasePerInterface }}</strong><span>平均用例数</span></div>
              <div><strong>{{ moduleStats.uncoveredInterfaceCount }}</strong><span>无覆盖接口</span></div>
            </div>
          </section>
          <section class="settings-card">
            <h3>🔄 场景用例覆盖</h3>
            <div class="stat-grid">
              <div><strong>{{ moduleStats.sceneCaseTotal }}</strong><span>用例总数</span></div>
              <div><strong>{{ moduleStats.sceneCoverage }}</strong><span>覆盖率</span></div>
              <div><strong>{{ moduleStats.uncoveredInterfaceCount }}</strong><span>未覆盖接口</span></div>
              <div><strong>-</strong><span>更多指标</span></div>
            </div>
          </section>
        </div>

        <section class="settings-card">
          <h3>🧩 模块类型</h3>
          <div class="type-card-list">
            <button
              v-for="item in moduleTypes"
              :key="item.value"
              :class="['type-card', { active: moduleType === item.value }]"
              @click="moduleType = item.value"
            >
              <span class="type-icon">{{ item.icon }}</span>
              <span><strong>{{ item.title }}</strong><small>{{ item.desc }}</small></span>
            </button>
          </div>
        </section>

        <div class="overview-grid">
          <section class="settings-card muted-card">
            <h3>🔗 绑定数据源</h3>
            <p>暂无数据源。可先通过导入 OpenAPI/Swagger 创建接口树，后续可扩展自动同步。</p>
            <button class="btn btn-sm" disabled>+ 添加数据源</button>
          </section>
          <section class="settings-card muted-card">
            <h3>📦 导出/备份 API 规格</h3>
            <p>当前模块可继续使用导出与代码生成能力，备份目标可在后续设置中接入。</p>
            <div class="quick-actions">
              <button class="btn btn-sm" @click="exportModuleOpenApi">导出 OpenAPI</button>
              <button class="btn btn-sm" @click="exportModuleMarkdown">导出 Markdown</button>
              <button class="btn btn-sm" @click="backupModule">本地备份</button>
            </div>
          </section>
        </div>
      </template>

      <template v-else-if="activeModuleTab === 'variables'">
        <section class="settings-card">
          <h3>模块变量</h3>
          <div class="variable-table">
            <div class="variable-head">
              <span>变量名</span>
              <span>远程值</span>
              <span>本地值</span>
              <span>说明</span>
              <span></span>
            </div>
            <div v-for="(row, index) in variableRows" :key="index" class="variable-row">
              <input v-model="row.key" type="text" placeholder="baseUrl" />
              <input v-model="row.remote" type="text" placeholder="团队共享值" />
              <div class="local-value-cell">
                <input v-model="row.local" type="text" placeholder="本地覆盖值" />
                <button class="btn btn-icon" title="使用远程值" @click="useRemoteAsLocal(index)">↙</button>
              </div>
              <input v-model="row.description" type="text" placeholder="用途说明" />
              <button class="btn btn-icon danger" title="删除变量" @click="deleteVariableRow(index)">🗑</button>
            </div>
            <button class="add-row-btn" @click="addVariableRow">+ 添加变量</button>
          </div>
          <p class="help-text">远程值用于团队共享，本地值仅当前浏览器生效并优先覆盖远程值。URL、Header、Body 中可通过 <code>&#123;&#123;变量名&#125;&#125;</code> 引用。</p>
        </section>
      </template>

      <template v-else>
        <section class="settings-card">
          <h3>基础设置</h3>
          <label class="field-row">
            <span>模块名称</span>
            <input v-model="moduleName" type="text" placeholder="输入模块名称" @keydown.enter="saveModuleSettings()" />
          </label>
          <label class="field-row">
            <span>所属分组</span>
            <select v-model="moduleCategoryId">
              <option v-for="category in workspace.categories" :key="category.id" :value="category.id">
                {{ category.name }}
              </option>
            </select>
          </label>
          <label class="field-row">
            <span>模块类型</span>
            <select v-model="moduleType">
              <option v-for="item in moduleTypes" :key="item.value" :value="item.value">
                {{ item.title }}
              </option>
            </select>
          </label>
          <label class="field-row field-row-top">
            <span>模块说明</span>
            <textarea v-model="moduleDescription" rows="4" placeholder="记录模块用途、接口来源、同步策略或注意事项"></textarea>
          </label>
          <div class="meta-grid">
            <div><strong>{{ selectedModuleInterfaceCount }}</strong><span>接口数</span></div>
            <div><strong>{{ activeModule.legacyGroupName || 'planned' }}</strong><span>来源</span></div>
            <div><strong>{{ formatTime(activeModule.updatedAt) }}</strong><span>更新时间</span></div>
          </div>
        </section>

        <section class="settings-card">
          <h3>模块接口</h3>
          <div class="interface-list">
            <button
              v-for="item in moduleInterfaces"
              :key="item.id"
              class="interface-link"
              @click="openInterface(item.apiId)"
            >
              <span :class="['method-badge', item.method.toLowerCase()]">{{ item.method }}</span>
              <span>{{ store.apis[item.apiId]?.name ?? item.name }}</span>
              <small>{{ store.apis[item.apiId]?.url ?? item.url }}</small>
            </button>
            <div v-if="moduleInterfaces.length === 0" class="empty-hint">该模块下暂无接口。</div>
          </div>
        </section>
      </template>
    </template>

    <div v-else class="settings-empty">
      <div class="empty-icon">⚙️</div>
      <h2>选择分组或模块进行设置</h2>
      <p>点击左侧分组或模块即可进入对应设置页；点击具体接口则回到请求编辑器。</p>
    </div>

    <div v-if="saveMessage" class="save-toast">{{ saveMessage }}</div>
  </div>
</template>

<style scoped>
.workspace-settings {
  flex: 1;
  overflow: auto;
  padding: 24px;
  background:
    radial-gradient(circle at 18% 0%, var(--primary-soft), transparent 30%),
    var(--bg-base);
  position: relative;
}

.settings-header {
  display: flex;
  align-items: flex-start;
  justify-content: space-between;
  gap: 16px;
  margin-bottom: 14px;
}

.sticky-header {
  position: sticky;
  top: 0;
  z-index: 5;
  background: color-mix(in srgb, var(--bg-base) 88%, transparent);
  backdrop-filter: blur(14px);
  padding-bottom: 10px;
  border-bottom: 1px solid var(--divider);
}

.eyebrow {
  color: var(--primary);
  font-size: var(--font-size-small);
  font-weight: 700;
  margin-bottom: 4px;
}

.settings-header h2 {
  display: flex;
  align-items: center;
  gap: 8px;
  font-size: 22px;
  line-height: 1.3;
  margin-bottom: 4px;
}

.title-dot {
  width: 10px;
  height: 10px;
  border-radius: 50%;
  flex-shrink: 0;
}

.settings-header p {
  color: var(--text-secondary);
}

.header-actions {
  display: flex;
  gap: 8px;
}

.settings-tabs {
  display: flex;
  gap: 4px;
  margin: 0 0 14px;
  border-bottom: 1px solid var(--divider);
}

.settings-tabs button {
  border: 1px solid transparent;
  border-bottom: none;
  background: transparent;
  color: var(--text-secondary);
  cursor: pointer;
  padding: 8px 12px;
  border-radius: var(--radius-lg) var(--radius-lg) 0 0;
  font-weight: 700;
}

.settings-tabs button:hover {
  background: var(--bg-hover);
  color: var(--text-primary);
}

.settings-tabs button.active {
  color: var(--primary);
  background: var(--bg-panel);
  border-color: var(--border);
  box-shadow: 0 -2px 0 var(--primary) inset;
  font-weight: 700;
}

.settings-card {
  border: 1px solid var(--border);
  border-radius: var(--radius-xl);
  background: var(--bg-panel);
  padding: 16px;
  margin-bottom: 14px;
  box-shadow: var(--shadow-sm);
}

.settings-card h3 {
  font-size: var(--font-size-title);
  margin-bottom: 12px;
}

.settings-card p {
  color: var(--text-secondary);
  line-height: 1.7;
  margin-bottom: 10px;
}

.field-row {
  display: grid;
  grid-template-columns: 96px minmax(0, 1fr);
  gap: 12px;
  align-items: center;
  margin-bottom: 12px;
  color: var(--text-secondary);
}

.field-row-top {
  align-items: start;
}

.field-row input,
.field-row select,
.field-row textarea,
.variable-row input {
  width: 100%;
  min-height: 32px;
}

.field-row textarea {
  resize: vertical;
}

.field-row input:focus,
.field-row select:focus,
.field-row textarea:focus,
.variable-row input:focus {
  border-color: var(--primary);
  box-shadow: var(--focus-ring);
}

.color-field {
  display: grid;
  grid-template-columns: 44px minmax(0, 1fr);
  gap: 8px;
}

.color-field input[type="color"] {
  padding: 2px;
  cursor: pointer;
}

.meta-grid,
.stat-grid {
  display: grid;
  grid-template-columns: repeat(3, minmax(0, 1fr));
  gap: 10px;
  margin-top: 14px;
}

.stat-grid {
  grid-template-columns: repeat(2, minmax(0, 1fr));
  margin-top: 0;
}

.stat-grid-large {
  grid-template-columns: repeat(3, minmax(0, 1fr));
}

.meta-grid div,
.stat-grid div {
  background: linear-gradient(180deg, var(--bg-code), var(--bg-panel));
  border: 1px solid var(--divider);
  border-radius: var(--radius-lg);
  padding: 12px;
  min-width: 0;
}

.meta-grid strong,
.stat-grid strong {
  display: block;
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
  font-size: 18px;
}

.meta-grid span,
.stat-grid span {
  color: var(--text-tertiary);
  font-size: var(--font-size-small);
}

.overview-grid {
  display: grid;
  grid-template-columns: repeat(2, minmax(0, 1fr));
  gap: 14px;
}

.type-card-list {
  display: grid;
  grid-template-columns: repeat(3, minmax(0, 1fr));
  gap: 10px;
}

.type-card {
  display: flex;
  gap: 10px;
  align-items: flex-start;
  border: 1px solid var(--border);
  border-radius: var(--radius-xl);
  background: var(--bg-panel);
  color: var(--text-primary);
  padding: 12px;
  cursor: pointer;
  text-align: left;
}

.type-card.active {
  border-color: var(--primary);
  background: var(--primary-soft);
  box-shadow: inset 0 0 0 1px var(--primary-ring);
}

.type-card small {
  display: block;
  margin-top: 4px;
  color: var(--text-secondary);
  line-height: 1.5;
}

.type-icon {
  font-size: 20px;
}

.quick-actions {
  display: flex;
  flex-wrap: wrap;
  gap: 6px;
}

.module-list,
.interface-list {
  display: flex;
  flex-direction: column;
  gap: 6px;
}

.module-link,
.interface-link {
  display: flex;
  align-items: center;
  gap: 8px;
  border: 1px solid var(--border);
  border-radius: var(--radius-lg);
  background: var(--bg-panel);
  color: var(--text-primary);
  padding: 8px 10px;
  cursor: pointer;
  text-align: left;
}

.module-link:hover,
.interface-link:hover {
  background: var(--bg-hover);
  border-color: var(--border-strong);
}

.module-link span,
.interface-link span:nth-child(2) {
  flex: 1;
  min-width: 0;
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
}

.module-link small,
.interface-link small {
  color: var(--text-tertiary);
  min-width: 0;
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
}

.interface-link small {
  flex: 1.4;
  font-family: var(--font-code);
}

.variable-table {
  border: 1px solid var(--border);
  border-radius: var(--radius-md);
  overflow: hidden;
}

.variable-head,
.variable-row {
  display: grid;
  grid-template-columns: 1fr 1.2fr 1.2fr 1.2fr 42px;
  gap: 8px;
  align-items: center;
  padding: 8px;
  border-bottom: 1px solid var(--divider);
}

.variable-head {
  background: var(--bg-sidebar);
  color: var(--text-secondary);
  font-size: var(--font-size-small);
  font-weight: 700;
}

.local-value-cell {
  display: flex;
  gap: 4px;
}

.local-value-cell input {
  flex: 1;
}

.add-row-btn {
  width: 100%;
  border: none;
  background: transparent;
  color: var(--primary);
  padding: 10px;
  cursor: pointer;
  text-align: left;
}

.add-row-btn:hover {
  background: var(--bg-hover);
}

.help-text {
  margin-top: 12px;
  color: var(--text-secondary);
}

.help-text code {
  background: var(--bg-code);
  border-radius: var(--radius-sm);
  padding: 1px 4px;
  color: var(--primary);
}

.danger {
  color: var(--error);
}

.empty-hint {
  padding: 10px;
  color: var(--text-tertiary);
  text-align: center;
}

.settings-empty {
  min-height: 100%;
  display: flex;
  flex-direction: column;
  align-items: center;
  justify-content: center;
  text-align: center;
  color: var(--text-secondary);
}

.settings-empty h2 {
  color: var(--text-primary);
  margin-bottom: 8px;
}

.empty-icon {
  font-size: 34px;
  margin-bottom: 12px;
}

.save-toast {
  position: fixed;
  right: 24px;
  bottom: 24px;
  background: var(--success);
  color: #fff;
  padding: 8px 12px;
  border-radius: var(--radius-md);
  box-shadow: 0 8px 24px rgba(0, 0, 0, 0.18);
}

@media (max-width: 980px) {
  .overview-grid,
  .type-card-list {
    grid-template-columns: 1fr;
  }

  .variable-head,
  .variable-row {
    grid-template-columns: 1fr;
  }
}
</style>
