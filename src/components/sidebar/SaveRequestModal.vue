<script setup lang="ts">
import { computed, onMounted, onUnmounted, ref } from 'vue'
import { ChevronDown, ChevronRight, Folder, X } from '@lucide/vue'
import { toast } from 'vue-sonner'
import { useAppStore } from '@/stores/app'
import { useWorkspaceStore } from '@/stores/workspace'
import { useDialog } from '@/composables/useDialog'
import { createDefaultAuthConfig } from '@/utils/auth'
import type { ApiConfig, HttpMethod, InterfaceNode } from '@/types'

/**
 * Save 弹窗(FR-2.5,参考 Hoppscotch SaveRequest.vue):
 * 请求名输入 + 复用整棵集合树作单选 picker(选中集合/文件夹作为落点)。
 * 由 RequestBar 保存按钮派发的 apifix:save-request 事件唤起。
 */
const store = useAppStore()
const workspace = useWorkspaceStore()
const dialog = useDialog()

const visible = ref(false)
const requestName = ref('')
const selectedTarget = ref<string | null>(null) // collection id 或 folder node id
const expanded = ref<Set<string>>(new Set())

const currentApi = computed<ApiConfig | null>(() => store.getCurrentApi())
const currentNode = computed<InterfaceNode | null>(() =>
  currentApi.value ? workspace.interfaces.find(item => item.apiId === currentApi.value!.id) ?? null : null)
const isCurrentReadonly = computed(() => {
  const node = currentNode.value
  if (!node) return false
  return workspace.modules.find(item => item.id === (node.collectionId ?? node.moduleId))?.type === 'readonly'
})

/** 未命名请求保存时,从 URL 末段推导一个可读的默认名(可改) */
function deriveNameFromUrl(url: string): string {
  const cleaned = url.replace(/\{\{[^}]+\}\}/g, 'var')
  try {
    const parsed = new URL(cleaned.includes('://') ? cleaned : `https://${cleaned}`)
    const segment = parsed.pathname.split('/').filter(Boolean).pop()
    const name = segment ? decodeURIComponent(segment) : parsed.hostname
    return name.replace(/[-_]+/g, ' ').trim()
  } catch {
    return ''
  }
}

interface PickerCollection {
  id: string
  name: string
  children: Array<{ id: string; name: string; isFolder: boolean }>
}

const pickerTree = computed<PickerCollection[]>(() =>
  [...workspace.collections]
    .sort((a, b) => a.order - b.order)
    .map(collection => ({
      id: collection.id,
      name: collection.name,
      children: workspace.interfaces
        .filter(item => (item.collectionId ?? item.moduleId) === collection.id && (item.nodeType ?? 'request') === 'folder')
        .sort((a, b) => a.order - b.order)
        .map(folder => ({ id: folder.id, name: folder.name, isFolder: true })),
    })))

function open() {
  const api = currentApi.value
  if (!api) return

  // 已保存在集合树中的请求:Cmd+S / 保存按钮 = 直接静默保存,不再弹窗重选位置
  if (currentNode.value) {
    if (isCurrentReadonly.value) {
      toast.info('只读集合中的请求不可修改,已跳过保存')
      return
    }
    store.updateApi(api.id, { updatedAt: Date.now() })
    toast.success(`已保存「${api.name}」`)
    return
  }

  // 未保存的新请求:弹窗命名 + 选落点(唯一一次需要选择位置)
  requestName.value = api.name === '未命名请求'
    ? deriveNameFromUrl(api.url) || api.name
    : api.name
  const pending = store.pendingSaveTarget
  selectedTarget.value = pending?.parentId ?? pending?.moduleId
    ?? (workspace.collections[0]?.id ?? null)
  // 展开落点路径
  if (pending?.parentId) expanded.value.add(pending.parentId)
  if (pending?.moduleId) expanded.value.add(pending.moduleId)
  visible.value = true
}

function close() {
  visible.value = false
}

function targetLabel(id: string | null): string {
  if (!id) return '未选择'
  const folder = workspace.interfaces.find(item => item.id === id)
  if (folder) return folder.name
  return workspace.collections.find(item => item.id === id)?.name ?? id
}

async function save() {
  const name = requestName.value.trim()
  if (!name || !selectedTarget.value) return
  const targetNode = workspace.interfaces.find(item => item.id === selectedTarget.value)
  const targetIsFolder = Boolean(targetNode && (targetNode.nodeType ?? 'request') === 'folder')
  const moduleId = targetIsFolder ? targetNode!.moduleId : (workspace.collections.find(item => item.id === selectedTarget.value)?.id ?? null)
  const parentId = targetIsFolder ? targetNode!.id : null
  if (!moduleId) {
    toast.error('落点无效')
    return
  }

  if (currentApi.value && currentNode.value) {
    // 已存在于树中:重命名 + 必要时移动
    store.updateApi(currentApi.value.id, { name })
    if (currentNode.value.parentId !== parentId || currentNode.value.moduleId !== moduleId) {
      await workspace.moveInterfaceNode(currentNode.value.id, moduleId, parentId)
    }
    toast.success(`已保存「${name}」到 ${targetLabel(selectedTarget.value)}`)
  } else if (currentApi.value) {
    // 新建标签的首次保存:沿用当前请求(命名 + 落树),不新建,避免留下孤儿标签
    const api = currentApi.value
    store.updateApi(api.id, { name })
    await workspace.addInterfaceForApi(api, moduleId, parentId)
    const node = workspace.interfaces.find(item => item.apiId === api.id)
    workspace.selectInterface(node?.id ?? api.id)
    store.pendingSaveTarget = null
    toast.success(`已保存「${name}」到 ${targetLabel(selectedTarget.value)}`)
  } else {
    // 新建请求
    const now = Date.now()
    const api: ApiConfig = {
      id: Date.now().toString(36) + Math.random().toString(36).slice(2, 8),
      name,
      method: 'GET' as HttpMethod,
      url: '',
      headers: [],
      params: [],
      cookies: [],
      body: { type: 'none', raw: '', formData: [], urlEncoded: [], binaryFile: null, contentType: '' },
      auth: createDefaultAuthConfig(),
      preRequestScript: '',
      postRequestScript: '',
      folder: null,
      createdAt: now,
      updatedAt: now,
    }
    await store.addApi(api, moduleId, parentId)
    const node = workspace.interfaces.find(item => item.apiId === api.id)
    workspace.selectInterface(node?.id ?? api.id)
    store.openApiInTab(api.id)
    store.pendingSaveTarget = null
    store.response = null
    toast.success(`已创建「${name}」到 ${targetLabel(selectedTarget.value)}`)
  }
  close()
}

async function removeCurrentFromTree() {
  const api = currentApi.value
  const node = currentNode.value
  if (!api || !node) return
  const ok = await dialog.confirm({ title: '从集合中移除', message: `将「${api.name}」从集合树中移除?请求配置仍保留在编辑区。`, confirmText: '移除' })
  if (!ok) return
  store.deleteApi(api.id)
  close()
}

function onKeydown(e: KeyboardEvent) {
  if (!visible.value) return
  if (e.key === 'Escape') close()
  if (e.key === 'Enter' && (e.ctrlKey || e.metaKey)) void save()
}

onMounted(() => {
  window.addEventListener('apifix:save-request', open)
  document.addEventListener('keydown', onKeydown)
})
onUnmounted(() => {
  window.removeEventListener('apifix:save-request', open)
  document.removeEventListener('keydown', onKeydown)
})
</script>

<template>
  <Teleport to="body">
    <div v-if="visible" class="modal-overlay" @click.self="close">
      <div class="save-modal">
        <header class="modal-header">
          <h3>{{ currentApi ? '保存请求' : '新建请求' }}</h3>
          <button class="close-btn" @click="close"><X :size="15" /></button>
        </header>

        <label class="name-field">
          <span>请求名称</span>
          <input v-model="requestName" type="text" placeholder="例如:获取用户信息" autofocus @keydown.enter="save" />
        </label>

        <div class="picker">
          <div class="picker-title">选择保存位置</div>
          <div class="picker-tree">
            <div v-for="collection in pickerTree" :key="collection.id" class="picker-collection">
              <button
                class="picker-row"
                :class="{ active: selectedTarget === collection.id }"
                @click="selectedTarget = collection.id"
              >
                <button class="picker-chevron" @click.stop="expanded.has(collection.id) ? expanded.delete(collection.id) : expanded.add(collection.id)">
                  <ChevronDown v-if="expanded.has(collection.id)" :size="12" />
                  <ChevronRight v-else :size="12" />
                </button>
                <Folder :size="13" class="folder-icon" />
                <span class="picker-name">{{ collection.name }}</span>
              </button>
              <template v-if="expanded.has(collection.id)">
                <button
                  v-for="child in collection.children"
                  :key="child.id"
                  class="picker-row child"
                  :class="{ active: selectedTarget === child.id }"
                  @click="selectedTarget = child.id"
                >
                  <span class="picker-chevron-spacer"></span>
                  <Folder :size="13" class="folder-icon" />
                  <span class="picker-name">{{ child.name }}</span>
                </button>
              </template>
            </div>
            <div v-if="!pickerTree.length" class="picker-empty">暂无集合,先在侧栏新建一个集合。</div>
          </div>
          <p class="picker-hint">保存到:{{ targetLabel(selectedTarget) }}</p>
        </div>

        <footer class="modal-actions">
          <button v-if="currentApi && currentNode" class="btn btn-sm danger" @click="removeCurrentFromTree">从集合移除</button>
          <span class="flex-1"></span>
          <button class="btn btn-sm" @click="close">取消</button>
          <button class="btn btn-sm btn-primary" :disabled="!requestName.trim() || !selectedTarget" @click="save">保存</button>
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

.save-modal {
  display: flex;
  flex-direction: column;
  gap: 12px;
  width: min(420px, calc(100vw - 32px));
  max-height: 82vh;
  padding: 16px;
  border: 1px solid var(--divider-dark-color);
  border-radius: var(--radius-lg);
  background: var(--popover-color);
  box-shadow: var(--shadow-lg);
}

.modal-header {
  display: flex;
  align-items: center;
  justify-content: space-between;
}

.modal-header h3 {
  font-size: 14px;
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

.name-field {
  display: flex;
  flex-direction: column;
  gap: 5px;
  font-size: var(--font-size-tiny);
  color: var(--secondary-color);
}

.name-field input {
  height: 32px;
  font-size: var(--font-size-body);
}

.picker {
  display: flex;
  flex-direction: column;
  gap: 6px;
  min-height: 0;
}

.picker-title {
  font-size: var(--font-size-tiny);
  font-weight: 600;
  color: var(--secondary-color);
}

.picker-tree {
  max-height: 260px;
  overflow: auto;
  border: 1px solid var(--divider-color);
  border-radius: var(--radius-md);
  padding: 4px;
}

.picker-row {
  display: flex;
  align-items: center;
  gap: 5px;
  width: 100%;
  height: 28px;
  padding: 0 6px;
  border-radius: var(--radius-sm);
  color: var(--secondary-dark-color);
  font-size: var(--font-size-body);
  text-align: left;
}

.picker-row:hover {
  background: var(--primary-dark-color);
}

.picker-row.active {
  background: color-mix(in srgb, var(--accent-color) 16%, transparent);
  color: var(--accent-color);
}

.picker-row.child {
  padding-left: 26px;
}

.picker-chevron {
  display: inline-flex;
  align-items: center;
  color: var(--secondary-light-color);
}

.picker-chevron-spacer {
  width: 12px;
  flex-shrink: 0;
}

.folder-icon {
  color: var(--accent-color);
  flex-shrink: 0;
}

.picker-name {
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
}

.picker-empty {
  padding: 14px;
  text-align: center;
  color: var(--secondary-light-color);
  font-size: var(--font-size-body);
}

.picker-hint {
  margin: 0;
  font-size: var(--font-size-tiny);
  color: var(--secondary-light-color);
}

.modal-actions {
  display: flex;
  align-items: center;
  gap: 8px;
}

.flex-1 {
  flex: 1;
}

.danger {
  color: var(--status-critical-error-color);
}
</style>
