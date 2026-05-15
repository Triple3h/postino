<script setup lang="ts">
import { ref, computed } from 'vue'
import { useAppStore } from '@/stores/app'
import { importCurl, importPostman } from '@/utils/import'
import type { ApiConfig, HttpMethod } from '@/types'

const store = useAppStore()
const searchQuery = ref('')
const showImportModal = ref(false)
const importType = ref<'curl' | 'postman'>('curl')
const importText = ref('')
const contextMenu = ref<{ x: number; y: number; apiId?: string; groupName?: string } | null>(null)

const filteredGroupOrder = computed(() => {
  if (!searchQuery.value.trim()) return store.groupOrder
  const q = searchQuery.value.toLowerCase()
  return store.groupOrder.filter(name => {
    const group = store.groups[name]
    if (!group) return false
    return group.apiIds.some(id => {
      const api = store.apis[id]
      return api && (api.name.toLowerCase().includes(q) || api.url.toLowerCase().includes(q))
    })
  })
})

function getFilteredApiIds(groupName: string): string[] {
  const group = store.groups[groupName]
  if (!group) return []
  if (!searchQuery.value.trim()) return group.apiIds
  const q = searchQuery.value.toLowerCase()
  return group.apiIds.filter(id => {
    const api = store.apis[id]
    return api && (api.name.toLowerCase().includes(q) || api.url.toLowerCase().includes(q))
  })
}

function generateId(): string {
  return Date.now().toString(36) + Math.random().toString(36).slice(2, 8)
}

function createNewApi() {
  const api: ApiConfig = {
    id: generateId(),
    name: 'New Request',
    method: 'GET' as HttpMethod,
    url: '',
    headers: [],
    params: [],
    body: { type: 'none', raw: '', formData: [], urlEncoded: [], binaryFile: null, contentType: '' },
    auth: { type: 'none', bearerToken: '', basicUsername: '', basicPassword: '', apiKeyName: '', apiKeyValue: '', apiKeyIn: 'header' as const },
    preRequestScript: '',
    postRequestScript: '',
    folder: null,
    createdAt: Date.now(),
    updatedAt: Date.now(),
  }
  store.addApi(api)
  store.currentApiId = api.id
}

function selectApi(id: string) {
  store.currentApiId = id
}

function deleteApi(id: string) {
  store.deleteApi(id)
}

function addGroup() {
  const name = prompt('输入分组名称：')
  if (!name?.trim()) return
  if (store.groups[name]) return
  store.groups[name] = { name, apiIds: [] }
  store.groupOrder.push(name)
}

function deleteGroup(name: string) {
  const group = store.groups[name]
  if (group) {
    for (const id of group.apiIds) {
      deleteApi(id)
    }
  }
  delete store.groups[name]
  store.groupOrder = store.groupOrder.filter(g => g !== name)
}

function toggleFolder(name: string) {
  const idx = store.expandedFolders.indexOf(name)
  if (idx >= 0) {
    store.expandedFolders.splice(idx, 1)
  } else {
    store.expandedFolders.push(name)
  }
}

function isFolderExpanded(name: string): boolean {
  return store.expandedFolders.includes(name)
}

function handleContextMenu(e: MouseEvent, apiId?: string, groupName?: string) {
  e.preventDefault()
  contextMenu.value = { x: e.clientX, y: e.clientY, apiId, groupName }
}

function closeContextMenu() {
  contextMenu.value = null
}

function doImport() {
  if (!importText.value.trim()) return

  if (importType.value === 'curl') {
    const api = importCurl(importText.value)
    if (api) {
      store.addApi(api)
      store.currentApiId = api.id
    }
  } else {
    const apis = importPostman(importText.value)
    for (const api of apis) {
      store.addApi(api)
    }
    if (apis.length > 0) {
      store.currentApiId = apis[0].id
    }
  }

  showImportModal.value = false
  importText.value = ''
}
</script>

<template>
  <div class="sidebar" @click="closeContextMenu">
    <div class="sidebar-header">
      <input
        v-model="searchQuery"
        type="text"
        placeholder="搜索接口..."
        class="sidebar-search"
      />
    </div>
    <div class="sidebar-actions">
      <button class="btn btn-sm" @click="createNewApi">+ 新建请求</button>
      <button class="btn btn-sm" @click="addGroup">+ 新建分组</button>
      <button class="btn btn-sm" @click="showImportModal = true">导入</button>
    </div>
    <div class="sidebar-content">
      <div v-for="groupName in filteredGroupOrder" :key="groupName" class="group-section">
        <div class="group-header" @click="toggleFolder(groupName)" @contextmenu="handleContextMenu($event, undefined, groupName)">
          <span class="expand-icon">{{ isFolderExpanded(groupName) ? '▼' : '▶' }}</span>
          <span class="group-name">{{ groupName }}</span>
          <span class="group-count">{{ store.groups[groupName]?.apiIds.length || 0 }}</span>
        </div>
        <template v-if="isFolderExpanded(groupName)">
          <div
            v-for="apiId in getFilteredApiIds(groupName)"
            :key="apiId"
            :class="['api-item', { active: store.currentApiId === apiId }]"
            @click="selectApi(apiId)"
            @contextmenu="handleContextMenu($event, apiId)"
          >
            <span :class="['method-badge', store.apis[apiId]?.method?.toLowerCase()]">
              {{ store.apis[apiId]?.method }}
            </span>
            <span class="api-name">{{ store.apis[apiId]?.name }}</span>
          </div>
        </template>
      </div>
      <div v-if="filteredGroupOrder.length === 0" class="sidebar-empty">
        暂无接口，点击"新建请求"开始
      </div>
    </div>

    <!-- Context Menu -->
    <div
      v-if="contextMenu"
      class="context-menu"
      :style="{ left: contextMenu.x + 'px', top: contextMenu.y + 'px' }"
    >
      <button v-if="contextMenu.apiId" class="context-item" @click="deleteApi(contextMenu.apiId); closeContextMenu()">删除请求</button>
      <button v-if="contextMenu.groupName" class="context-item" @click="deleteGroup(contextMenu.groupName); closeContextMenu()">删除分组</button>
    </div>

    <!-- Import Modal -->
    <div v-if="showImportModal" class="modal-overlay" @click.self="showImportModal = false">
      <div class="modal-content">
        <h3>导入请求</h3>
        <div class="import-type-select">
          <button :class="['btn btn-sm', { active: importType === 'curl' }]" @click="importType = 'curl'">cURL</button>
          <button :class="['btn btn-sm', { active: importType === 'postman' }]" @click="importType = 'postman'">Postman</button>
        </div>
        <textarea
          v-model="importText"
          class="import-textarea"
          :placeholder="importType === 'curl' ? '粘贴 cURL 命令...' : '粘贴 Postman Collection JSON...'"
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
  border-right: 1px solid var(--border);
  display: flex;
  flex-direction: column;
  overflow: hidden;
  position: relative;
}

.sidebar-header {
  padding: 8px;
  border-bottom: 1px solid var(--divider);
}

.sidebar-search {
  width: 100%;
  height: 28px;
  font-size: var(--font-size-small);
}

.sidebar-actions {
  display: flex;
  gap: 4px;
  padding: 6px 8px;
  border-bottom: 1px solid var(--divider);
}

.sidebar-actions .btn {
  flex: 1;
  font-size: var(--font-size-small);
}

.sidebar-content {
  flex: 1;
  overflow-y: auto;
  padding: 4px 0;
}

.group-section {
  margin-bottom: 2px;
}

.group-header {
  display: flex;
  align-items: center;
  padding: 6px 8px;
  font-size: var(--font-size-title);
  font-weight: 600;
  color: var(--text-secondary);
  cursor: pointer;
  gap: 4px;
}

.group-header:hover {
  background: var(--bg-hover);
}

.expand-icon {
  font-size: 10px;
  width: 14px;
  text-align: center;
}

.group-name {
  flex: 1;
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
}

.group-count {
  font-size: var(--font-size-small);
  color: var(--text-tertiary);
  font-weight: 400;
}

.api-item {
  padding: 4px 8px 4px 22px;
  display: flex;
  align-items: center;
  gap: 6px;
  cursor: pointer;
  font-size: var(--font-size-body);
}

.api-item:hover {
  background: var(--bg-hover);
}

.api-item.active {
  background: var(--primary-light);
}

.api-name {
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
  flex: 1;
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
  border-radius: var(--radius-md);
  box-shadow: 0 4px 12px rgba(0, 0, 0, 0.15);
  padding: 4px 0;
  z-index: 1000;
  min-width: 120px;
}

.context-item {
  display: block;
  width: 100%;
  padding: 6px 12px;
  border: none;
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
  background: rgba(0, 0, 0, 0.5);
  display: flex;
  align-items: center;
  justify-content: center;
  z-index: 1001;
}

.modal-content {
  background: var(--bg-panel);
  border-radius: var(--radius-lg);
  padding: 20px;
  width: 500px;
  max-height: 80vh;
  display: flex;
  flex-direction: column;
  gap: 12px;
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
  padding: 8px;
  border: 1px solid var(--border);
  border-radius: var(--radius-sm);
  background: var(--bg-code);
  color: var(--text-primary);
  font-family: var(--font-code);
  font-size: var(--font-size-code);
  resize: vertical;
  outline: none;
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