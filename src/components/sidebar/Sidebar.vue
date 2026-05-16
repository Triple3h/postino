<script setup lang="ts">
import { ref, computed } from 'vue'
import { useAppStore } from '@/stores/app'
import { useWorkspaceStore } from '@/stores/workspace'
import { importCurl, importPostman } from '@/utils/import'
import { importOpenApi } from '@/utils/openapi-import'
import { db } from '@/db'
import { useDialog } from '@/composables/useDialog'
import type { ApiConfig, Category, HttpMethod, InterfaceNode, Module as ApiModule } from '@/types'

const store = useAppStore()
const workspace = useWorkspaceStore()
const dialog = useDialog()
const searchQuery = ref('')
const showImportModal = ref(false)
const importType = ref<'curl' | 'postman' | 'openapi'>('curl')
const importText = ref('')
const selectedCategoryId = computed(() => {
  if (workspace.activeSelectionType === 'category') return workspace.activeSelectionId
  if (workspace.activeSelectionType === 'module') {
    return workspace.modules.find(item => item.id === workspace.activeSelectionId)?.categoryId ?? null
  }
  if (workspace.activeSelectionType === 'interface') {
    const interfaceNode = workspace.interfaces.find(item => item.id === workspace.activeSelectionId || item.apiId === workspace.activeSelectionId)
    const module = interfaceNode ? workspace.modules.find(item => item.id === interfaceNode.moduleId) : null
    return module?.categoryId ?? null
  }
  return null
})
const selectedModuleId = computed(() => {
  if (workspace.activeSelectionType === 'module') return workspace.activeSelectionId
  if (workspace.activeSelectionType === 'interface') {
    return workspace.interfaces.find(item => item.id === workspace.activeSelectionId || item.apiId === workspace.activeSelectionId)?.moduleId ?? null
  }
  return null
})
const contextMenu = ref<{ x: number; y: number; apiId?: string; categoryId?: string; moduleId?: string } | null>(null)

interface SidebarModule extends ApiModule {
  interfaces: InterfaceNode[]
}

interface SidebarCategory extends Category {
  modules: SidebarModule[]
}

const sidebarTree = computed<SidebarCategory[]>(() => {
  const q = searchQuery.value.toLowerCase()
  const searching = q.trim().length > 0

  return [...workspace.categories]
    .sort((a, b) => a.order - b.order)
    .map(category => {
      const modules = workspace.modules
        .filter(module => module.categoryId === category.id)
        .sort((a, b) => a.order - b.order)
        .map(module => {
          const interfaces = workspace.interfaces
            .filter(item => item.moduleId === module.id)
            .filter(item => {
              if (!searching) return true
              const api = store.apis[item.apiId]
              const name = api?.name ?? item.name
              const url = api?.url ?? item.url
              const method = api?.method ?? item.method
              return name.toLowerCase().includes(q) ||
                url.toLowerCase().includes(q) ||
                method.toLowerCase().includes(q) ||
                module.name.toLowerCase().includes(q) ||
                category.name.toLowerCase().includes(q)
            })
            .sort((a, b) => a.order - b.order)
          return { ...module, interfaces }
        })
        .filter(module => !searching || module.interfaces.length > 0 || module.name.toLowerCase().includes(q))
      return { ...category, modules }
    })
    .filter(category => !searching || category.modules.length > 0 || category.name.toLowerCase().includes(q))
})

const hasVisibleItems = computed(() => sidebarTree.value.length > 0)

function getInterfaceApi(interfaceNode: InterfaceNode): ApiConfig | null {
  return store.apis[interfaceNode.apiId] ?? null
}

function getModuleStorageKey(moduleId: string): string {
  return `module:${moduleId}`
}

function getCategoryStorageKey(categoryId: string): string {
  return `category:${categoryId}`
}

function isExpanded(key: string): boolean {
  if (key.startsWith('category:') || key.startsWith('module:')) {
    return !store.expandedFolders.includes(`collapsed:${key}`)
  }
  return store.expandedFolders.includes(key)
}

function toggleExpanded(key: string) {
  const storageKey = key.startsWith('category:') || key.startsWith('module:')
    ? `collapsed:${key}`
    : key
  const idx = store.expandedFolders.indexOf(storageKey)
  if (idx >= 0) {
    store.expandedFolders.splice(idx, 1)
  } else {
    store.expandedFolders.push(storageKey)
  }
}

function generateId(): string {
  return Date.now().toString(36) + Math.random().toString(36).slice(2, 8)
}

async function addApiToLegacyGroup(apiId: string, groupName: string): Promise<void> {
  const group = store.groups[groupName] ?? { name: groupName, apiIds: [] }
  if (!group.apiIds.includes(apiId)) {
    group.apiIds.push(apiId)
  }
  store.groups[groupName] = group
  if (!store.groupOrder.includes(groupName)) {
    store.groupOrder.push(groupName)
  }
  await Promise.all([
    db.groups.put({ name: groupName, group }),
    store.saveGroupOrder(),
  ])
}

async function addApiToModule(api: ApiConfig, moduleName: string | null): Promise<void> {
  if (!moduleName) {
    store.addApi(api, selectedModuleId.value)
    return
  }

  const module = await workspace.ensureModuleForLegacyGroup(moduleName)
  store.addApi(api, module.id)
  await addApiToLegacyGroup(api.id, moduleName)
}

async function createNewApi() {
  const api: ApiConfig = {
    id: generateId(),
    name: 'New Request',
    method: 'GET' as HttpMethod,
    url: '',
    headers: [],
    params: [],
    cookies: [],
    body: { type: 'none', raw: '', formData: [], urlEncoded: [], binaryFile: null, contentType: '' },
    auth: { type: 'none', bearerToken: '', basicUsername: '', basicPassword: '', apiKeyName: '', apiKeyValue: '', apiKeyIn: 'header' as const },
    preRequestScript: '',
    postRequestScript: '',
    folder: null,
    createdAt: Date.now(),
    updatedAt: Date.now(),
  }
  await addApiToModule(api, null)
  selectApi(api.id)
}

function openCategory(categoryId: string) {
  workspace.selectCategory(categoryId)
  store.currentApiId = null
  store.response = null
}

function openModule(moduleId: string) {
  workspace.selectModule(moduleId)
  store.currentApiId = null
  store.response = null
}

function selectApi(id: string) {
  const interfaceNode = workspace.interfaces.find(item => item.apiId === id)
  workspace.selectInterface(interfaceNode?.id ?? id)
  store.currentApiId = id
}

function deleteApi(id: string) {
  store.deleteApi(id)
}

async function addGroup() {
  const name = await dialog.prompt({
    title: '新建分组',
    message: '分组用于组织多个模块与接口。',
    placeholder: '例如：用户中心',
    confirmText: '创建',
  })
  if (!name?.trim()) return
  const category = await workspace.addCategory(name.trim())
  openCategory(category.id)
}

async function addModule(categoryId?: string) {
  let targetCategoryId = categoryId ?? selectedCategoryId.value ?? workspace.categories[0]?.id
  if (!targetCategoryId) {
    targetCategoryId = (await workspace.ensureDefaultCategory()).id
  }

  const name = await dialog.prompt({
    title: '新建模块',
    message: '模块用于承载同一业务域下的接口。',
    placeholder: '例如：登录鉴权',
    confirmText: '创建',
  })
  if (!name?.trim()) return
  const module = await workspace.addModule(targetCategoryId, name.trim())
  openModule(module.id)
  const key = getCategoryStorageKey(module.categoryId)
  if (!isExpanded(key)) toggleExpanded(key)
}

async function deleteModule(moduleId: string) {
  const module = workspace.modules.find(item => item.id === moduleId)
  const apiIds = workspace.interfaces
    .filter(item => item.moduleId === moduleId)
    .map(item => item.apiId)

  for (const id of apiIds) {
    deleteApi(id)
  }

  if (module?.legacyGroupName) {
    delete store.groups[module.legacyGroupName]
    store.groupOrder = store.groupOrder.filter(name => name !== module.legacyGroupName)
    await Promise.all([
      db.groups.delete(module.legacyGroupName),
      store.saveGroupOrder(),
    ])
  }

  await workspace.deleteModule(moduleId)
}

async function deleteCategory(categoryId: string) {
  const modules = workspace.modules.filter(item => item.categoryId === categoryId)
  const moduleIds = modules.map(item => item.id)
  const apiIds = workspace.interfaces
    .filter(item => moduleIds.includes(item.moduleId))
    .map(item => item.apiId)

  for (const id of apiIds) {
    deleteApi(id)
  }

  const legacyGroupNames = modules
    .map(module => module.legacyGroupName)
    .filter((name): name is string => Boolean(name))
  for (const name of legacyGroupNames) {
    delete store.groups[name]
  }
  if (legacyGroupNames.length > 0) {
    store.groupOrder = store.groupOrder.filter(name => !legacyGroupNames.includes(name))
    await Promise.all([
      db.groups.bulkDelete(legacyGroupNames),
      store.saveGroupOrder(),
    ])
  }

  await workspace.deleteCategory(categoryId)
  if (workspace.activeSelectionId === categoryId || (workspace.activeSelectionId && moduleIds.includes(workspace.activeSelectionId))) {
    workspace.clearSelection()
  }
}

function handleCategoryContextMenu(e: MouseEvent, categoryId: string) {
  e.preventDefault()
  contextMenu.value = { x: e.clientX, y: e.clientY, categoryId }
}

function handleModuleContextMenu(e: MouseEvent, moduleId: string) {
  e.preventDefault()
  contextMenu.value = { x: e.clientX, y: e.clientY, moduleId }
}

function handleApiContextMenu(e: MouseEvent, apiId: string) {
  e.preventDefault()
  contextMenu.value = { x: e.clientX, y: e.clientY, apiId }
}

function closeContextMenu() {
  contextMenu.value = null
}

async function doImport() {
  if (!importText.value.trim()) return

  if (importType.value === 'curl') {
    const api = importCurl(importText.value)
    if (api) {
      await addApiToModule(api, null)
      selectApi(api.id)
    }
  } else if (importType.value === 'postman') {
    const apis = importPostman(importText.value)
    for (const api of apis) {
      await addApiToModule(api, api.folder)
    }
    if (apis.length > 0) {
      selectApi(apis[0].id)
    }
  } else if (importType.value === 'openapi') {
    const apis = importOpenApi(importText.value)
    for (const api of apis) {
      await addApiToModule(api, api.folder)
    }
    if (apis.length > 0) {
      selectApi(apis[0].id)
    }
  }

  showImportModal.value = false
  importText.value = ''
}
</script>

<template>
  <div class="sidebar" @click="closeContextMenu">
    <div class="sidebar-header">
      <div class="sidebar-title">
        <span class="sidebar-logo">⚡</span>
        <div>
          <strong>接口目录</strong>
          <small>{{ workspace.categories.length }} 分组 · {{ workspace.modules.length }} 模块</small>
        </div>
      </div>
      <label class="search-shell">
        <span>⌕</span>
        <input
          v-model="searchQuery"
          type="text"
          placeholder="搜索接口 / URL / 方法"
          class="sidebar-search"
        />
      </label>
    </div>
    <div class="sidebar-actions">
      <button class="btn btn-sm btn-primary" @click="createNewApi">+ 请求</button>
      <button class="btn btn-sm" @click="addGroup">分组</button>
      <button class="btn btn-sm" @click="addModule()">模块</button>
      <button class="btn btn-sm" @click="showImportModal = true">导入</button>
    </div>
    <div class="sidebar-content">
      <div v-for="category in sidebarTree" :key="category.id" class="category-section">
        <div
          :class="['category-header', { selected: selectedCategoryId === category.id }]"
          @click="openCategory(category.id)"
          @contextmenu="handleCategoryContextMenu($event, category.id)"
        >
          <span class="expand-icon" @click.stop="toggleExpanded(getCategoryStorageKey(category.id))">{{ isExpanded(getCategoryStorageKey(category.id)) ? '▼' : '▶' }}</span>
          <span class="category-color" :style="{ backgroundColor: category.color || '#6366f1' }"></span>
          <span class="category-name">{{ category.name }}</span>
        </div>
        <template v-if="isExpanded(getCategoryStorageKey(category.id))">
          <div v-for="module in category.modules" :key="module.id" class="group-section">
            <div
              :class="['group-header', { selected: selectedModuleId === module.id }]"
              @click="openModule(module.id)"
              @contextmenu="handleModuleContextMenu($event, module.id)"
            >
              <span class="expand-icon" @click.stop="toggleExpanded(getModuleStorageKey(module.id))">{{ isExpanded(getModuleStorageKey(module.id)) ? '▼' : '▶' }}</span>
              <span class="group-name">{{ module.name }}</span>
              <span class="group-count">{{ module.interfaces.length }}</span>
            </div>
            <template v-if="isExpanded(getModuleStorageKey(module.id))">
              <div
                v-for="interfaceNode in module.interfaces"
                :key="interfaceNode.id"
                :class="['api-item', { active: store.currentApiId === interfaceNode.apiId }]"
                @click="selectApi(interfaceNode.apiId)"
                @contextmenu="handleApiContextMenu($event, interfaceNode.apiId)"
              >
                <span :class="['method-badge', (getInterfaceApi(interfaceNode)?.method ?? interfaceNode.method).toLowerCase()]">
                  {{ getInterfaceApi(interfaceNode)?.method ?? interfaceNode.method }}
                </span>
                <span class="api-copy">
                  <span class="api-name">{{ getInterfaceApi(interfaceNode)?.name ?? interfaceNode.name }}</span>
                  <span class="api-url">{{ getInterfaceApi(interfaceNode)?.url ?? interfaceNode.url }}</span>
                </span>
              </div>
            </template>
          </div>
        </template>
      </div>
      <div v-if="!hasVisibleItems" class="sidebar-empty">
        {{ searchQuery.trim() ? '无匹配接口' : '暂无接口，点击"新建请求"开始' }}
      </div>
    </div>

    <!-- Context Menu -->
    <div
      v-if="contextMenu"
      class="context-menu"
      :style="{ left: contextMenu.x + 'px', top: contextMenu.y + 'px' }"
    >
      <button v-if="contextMenu.apiId" class="context-item" @click="deleteApi(contextMenu.apiId); closeContextMenu()">删除请求</button>
      <button v-if="contextMenu.categoryId" class="context-item" @click="openCategory(contextMenu.categoryId); closeContextMenu()">分组设置</button>
      <button v-if="contextMenu.categoryId" class="context-item" @click="addModule(contextMenu.categoryId); closeContextMenu()">新建模块</button>
      <button v-if="contextMenu.categoryId" class="context-item" @click="deleteCategory(contextMenu.categoryId); closeContextMenu()">删除分组</button>
      <button v-if="contextMenu.moduleId" class="context-item" @click="openModule(contextMenu.moduleId); closeContextMenu()">模块设置</button>
      <button v-if="contextMenu.moduleId" class="context-item" @click="deleteModule(contextMenu.moduleId); closeContextMenu()">删除模块</button>
    </div>

    <!-- Import Modal -->
    <div v-if="showImportModal" class="modal-overlay" @click.self="showImportModal = false">
      <div class="modal-content">
        <h3>导入请求</h3>
        <div class="import-type-select">
          <button :class="['btn btn-sm', { active: importType === 'curl' }]" @click="importType = 'curl'">cURL</button>
          <button :class="['btn btn-sm', { active: importType === 'postman' }]" @click="importType = 'postman'">Postman</button>
          <button :class="['btn btn-sm', { active: importType === 'openapi' }]" @click="importType = 'openapi'">OpenAPI</button>
        </div>
        <textarea
          v-model="importText"
          class="import-textarea"
          :placeholder="importType === 'curl' ? '粘贴 cURL 命令...' : importType === 'postman' ? '粘贴 Postman Collection JSON...' : '粘贴 OpenAPI / Swagger JSON...'"
          spellcheck="false"
        ></textarea>
        <div class="modal-actions">
          <button class="btn" @click="showImportModal = false">取消</button>
          <button class="btn btn-primary" @click="doImport">导入</button>
        </div>
      </div>
    </div>
  </div>
</template>

<style scoped>
.sidebar {
  width: var(--sidebar-width);
  height: 100%;
  background: var(--bg-sidebar);
  border: 1px solid var(--border);
  border-radius: var(--radius-2xl);
  display: flex;
  flex-direction: column;
  overflow: hidden;
  position: relative;
  box-shadow: var(--shadow-md);
  backdrop-filter: blur(16px);
}

.sidebar-header {
  padding: 12px;
  border-bottom: 1px solid var(--divider);
  background:
    linear-gradient(180deg, color-mix(in srgb, var(--primary-light) 52%, transparent), transparent);
}

.sidebar-title {
  display: flex;
  align-items: center;
  gap: 9px;
  margin-bottom: 10px;
}

.sidebar-logo {
  display: inline-flex;
  align-items: center;
  justify-content: center;
  width: 30px;
  height: 30px;
  border-radius: 11px;
  background: linear-gradient(135deg, var(--primary), var(--accent));
  color: #fff;
  box-shadow: 0 8px 16px rgba(79, 70, 229, 0.22);
}

.sidebar-title strong,
.sidebar-title small {
  display: block;
}

.sidebar-title strong {
  line-height: 1.2;
}

.sidebar-title small {
  color: var(--text-secondary);
  font-size: var(--font-size-small);
  margin-top: 2px;
}

.search-shell {
  display: flex;
  align-items: center;
  gap: 6px;
  height: 32px;
  padding: 0 9px;
  border: 1px solid var(--border);
  border-radius: 999px;
  background: var(--bg-panel);
  color: var(--text-tertiary);
  box-shadow: var(--shadow-sm);
}

.sidebar-search {
  width: 100%;
  height: 30px;
  padding: 0;
  border: none;
  background: transparent;
  font-size: var(--font-size-small);
  box-shadow: none !important;
}

.sidebar-actions {
  display: flex;
  gap: 4px;
  padding: 8px;
  border-bottom: 1px solid var(--divider);
  background: var(--bg-panel-elevated);
}

.sidebar-actions .btn {
  flex: 1;
  font-size: var(--font-size-small);
}

.sidebar-content {
  flex: 1;
  overflow-y: auto;
  padding: 8px;
}

.group-section {
  margin-bottom: 2px;
}

.category-section {
  margin-bottom: 4px;
}

.category-header {
  display: flex;
  align-items: center;
  padding: 8px;
  font-size: var(--font-size-title);
  font-weight: 700;
  color: var(--text-primary);
  cursor: pointer;
  gap: 4px;
  border-radius: var(--radius-lg);
  transition: background 0.15s ease, transform 0.15s ease;
}

.category-header:hover {
  background: var(--bg-hover);
  transform: translateX(1px);
}

.category-header.selected {
  background: var(--primary-soft);
  color: var(--primary);
}

.group-header {
  display: flex;
  align-items: center;
  padding: 7px 8px 7px 18px;
  font-size: var(--font-size-title);
  font-weight: 600;
  color: var(--text-secondary);
  cursor: pointer;
  gap: 4px;
  border-radius: var(--radius-lg);
  transition: background 0.15s ease, transform 0.15s ease;
}

.group-header:hover {
  background: var(--bg-hover);
  transform: translateX(1px);
}

.group-header.selected {
  background: var(--bg-selected);
  color: var(--text-primary);
}

.expand-icon {
  font-size: 10px;
  width: 14px;
  text-align: center;
}

.category-color {
  width: 8px;
  height: 8px;
  border-radius: 50%;
  flex-shrink: 0;
  box-shadow: 0 0 0 2px var(--bg-sidebar);
}

.category-name,
.group-name {
  flex: 1;
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
}

.group-count {
  font-size: var(--font-size-small);
  color: var(--primary);
  font-weight: 700;
  background: var(--primary-soft);
  border-radius: 999px;
  min-width: 22px;
  padding: 1px 6px;
  text-align: center;
}

.api-item {
  padding: 7px 8px 7px 36px;
  display: flex;
  align-items: center;
  gap: 6px;
  cursor: pointer;
  font-size: var(--font-size-body);
  border-radius: var(--radius-lg);
  border: 1px solid transparent;
  transition: background 0.15s ease, border-color 0.15s ease, transform 0.15s ease;
}

.api-item:hover {
  background: var(--bg-hover);
  transform: translateX(1px);
}

.api-item.active {
  background: var(--bg-panel);
  border-color: var(--primary);
  box-shadow: inset 3px 0 0 var(--primary), var(--shadow-sm);
}

.api-copy {
  min-width: 0;
  flex: 1;
}

.api-name,
.api-url {
  display: block;
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
}

.api-url {
  margin-top: 2px;
  color: var(--text-tertiary);
  font-family: var(--font-code);
  font-size: 10px;
}

.sidebar-empty {
  padding: 20px;
  text-align: center;
  color: var(--text-tertiary);
  font-size: var(--font-size-body);
}

.context-menu {
  position: fixed;
  background: var(--bg-panel);
  border: 1px solid var(--border);
  border-radius: var(--radius-lg);
  box-shadow: var(--shadow-lg);
  padding: 4px 0;
  z-index: 1000;
  min-width: 132px;
  overflow: hidden;
}

.context-item {
  display: block;
  width: 100%;
  padding: 7px 12px;
  background: transparent;
  color: var(--text-primary);
  text-align: left;
  cursor: pointer;
  font-size: var(--font-size-body);
}

.context-item:hover {
  background: var(--bg-hover);
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
  width: 500px;
  max-width: calc(100vw - 28px);
  max-height: 80vh;
  display: flex;
  flex-direction: column;
  gap: 12px;
  box-shadow: var(--shadow-lg);
}

.modal-content h3 {
  font-size: 16px;
  font-weight: 600;
}

.import-type-select {
  display: flex;
  gap: 4px;
}

.import-type-select .btn.active {
  background: var(--primary-light);
  color: var(--primary);
  border-color: var(--primary);
}

.import-textarea {
  width: 100%;
  min-height: 200px;
  background: var(--bg-code);
  color: var(--text-primary);
  font-family: var(--font-code);
  font-size: var(--font-size-code);
  resize: vertical;
}

.import-textarea:focus {
  border-color: var(--primary);
}

.modal-actions {
  display: flex;
  justify-content: flex-end;
  gap: 8px;
}
</style>
