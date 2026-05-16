<script setup lang="ts">
import { computed, ref, watch } from 'vue'
import { useAppStore } from '@/stores/app'
import { useWorkspaceStore } from '@/stores/workspace'

const store = useAppStore()
const workspace = useWorkspaceStore()

const categoryName = ref('')
const moduleName = ref('')
const moduleCategoryId = ref('')
const saveMessage = ref('')
let messageTimer: ReturnType<typeof setTimeout> | null = null

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

watch(activeCategory, (category) => {
  categoryName.value = category?.name ?? ''
  clearMessage()
}, { immediate: true })

watch(activeModule, (module) => {
  moduleName.value = module?.name ?? ''
  moduleCategoryId.value = module?.categoryId ?? ''
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

async function saveCategory() {
  const category = activeCategory.value
  if (!category) return
  const name = categoryName.value.trim()
  if (!name) return
  await workspace.updateCategory(category.id, { name })
  showSaved('分组设置已保存')
}

async function saveModule() {
  const module = activeModule.value
  if (!module) return
  const name = moduleName.value.trim()
  if (!name || !moduleCategoryId.value) return
  const moved = moduleCategoryId.value !== module.categoryId
  await workspace.updateModule(module.id, {
    name,
    categoryId: moduleCategoryId.value,
    order: moved
      ? workspace.modules.filter(item => item.categoryId === moduleCategoryId.value && item.id !== module.id).length
      : module.order,
  })
  workspace.selectModule(module.id)
  showSaved('模块设置已保存')
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
          <h2>{{ activeCategory.name }}</h2>
        </div>
        <button class="btn btn-primary" @click="saveCategory">保存</button>
      </header>

      <section class="settings-card">
        <h3>基础信息</h3>
        <label class="field-row">
          <span>分组名称</span>
          <input v-model="categoryName" type="text" placeholder="输入分组名称" @keydown.enter="saveCategory" />
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
            <small>{{ workspace.interfaces.filter(item => item.moduleId === module.id).length }} 个接口</small>
          </button>
          <div v-if="selectedCategoryModuleCount === 0" class="empty-hint">该分组下暂无模块。</div>
        </div>
      </section>
    </template>

    <template v-else-if="activeModule">
      <header class="settings-header">
        <div>
          <div class="eyebrow">模块设置</div>
          <h2>{{ activeModule.name }}</h2>
          <p>{{ selectedModuleCategoryName }}</p>
        </div>
        <button class="btn btn-primary" @click="saveModule">保存</button>
      </header>

      <section class="settings-card">
        <h3>基础信息</h3>
        <label class="field-row">
          <span>模块名称</span>
          <input v-model="moduleName" type="text" placeholder="输入模块名称" @keydown.enter="saveModule" />
        </label>
        <label class="field-row">
          <span>所属分组</span>
          <select v-model="moduleCategoryId">
            <option v-for="category in workspace.categories" :key="category.id" :value="category.id">
              {{ category.name }}
            </option>
          </select>
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
  background: var(--bg-base);
  position: relative;
}

.settings-header {
  display: flex;
  align-items: flex-start;
  justify-content: space-between;
  gap: 16px;
  margin-bottom: 18px;
}

.eyebrow {
  color: var(--primary);
  font-size: var(--font-size-small);
  font-weight: 700;
  margin-bottom: 4px;
}

.settings-header h2 {
  font-size: 22px;
  line-height: 1.3;
  margin-bottom: 4px;
}

.settings-header p {
  color: var(--text-secondary);
}

.settings-card {
  border: 1px solid var(--border);
  border-radius: var(--radius-lg);
  background: var(--bg-panel);
  padding: 16px;
  margin-bottom: 14px;
}

.settings-card h3 {
  font-size: var(--font-size-title);
  margin-bottom: 12px;
}

.field-row {
  display: grid;
  grid-template-columns: 96px minmax(0, 1fr);
  gap: 12px;
  align-items: center;
  margin-bottom: 12px;
  color: var(--text-secondary);
}

.field-row input,
.field-row select {
  width: 100%;
  height: 32px;
  border: 1px solid var(--border);
  border-radius: var(--radius-sm);
  background: var(--bg-base);
  color: var(--text-primary);
  padding: 4px 8px;
  outline: none;
}

.field-row input:focus,
.field-row select:focus {
  border-color: var(--primary);
}

.meta-grid {
  display: grid;
  grid-template-columns: repeat(3, minmax(0, 1fr));
  gap: 10px;
  margin-top: 14px;
}

.meta-grid div {
  background: var(--bg-sidebar);
  border-radius: var(--radius-md);
  padding: 12px;
  min-width: 0;
}

.meta-grid strong {
  display: block;
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
  font-size: 15px;
}

.meta-grid span {
  color: var(--text-tertiary);
  font-size: var(--font-size-small);
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
  border-radius: var(--radius-md);
  background: var(--bg-base);
  color: var(--text-primary);
  padding: 8px 10px;
  cursor: pointer;
  text-align: left;
}

.module-link:hover,
.interface-link:hover {
  background: var(--bg-hover);
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
</style>
