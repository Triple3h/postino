<script setup lang="ts">
import { computed, ref } from 'vue'
import {
  ChevronDown,
  ChevronRight,
  Copy,
  Download,
  FilePlus2,
  Folder,
  FolderPlus,
  Pencil,
  Plug,
  Radio,
  Settings2,
  SlidersHorizontal,
  Trash2,
  TriangleAlert,
} from '@lucide/vue'
import { useAppStore } from '@/stores/app'
import { useWorkspaceStore } from '@/stores/workspace'
import { useWsStore } from '@/stores/ws'
import { useDialog } from '@/composables/useDialog'
import { openContextMenu } from '@/composables/useContextMenu'
import { resolveInheritedProperties } from '@/utils/inheritance'
import { isWebSocketUrl } from '@/utils/http'
import { generateCurl, generatePostmanCollection, generatePostmanCollectionTree, generatePostmanEnvironmentFiles } from '@/utils/export'
import { toast } from 'vue-sonner'
import type { ApiConfig, Collection, CollectionNode, InterfaceNode } from '@/types'

const props = defineProps<{
  filter: string
}>()

const store = useAppStore()
const workspace = useWorkspaceStore()
const wsStore = useWsStore()
const dialog = useDialog()

interface TreeCollection extends Collection {
  nodes: InterfaceNode[]
  requestCount: number
}

const renaming = ref<{ kind: 'collection' | 'node'; id: string } | null>(null)
const renameValue = ref('')
const draggingNodeId = ref<string | null>(null)
const draggingCollectionId = ref<string | null>(null)
const dropTarget = ref<{ kind: 'collection-root' | 'folder' | 'row'; id: string } | null>(null)

const tree = computed<TreeCollection[]>(() => {
  const q = props.filter.toLowerCase().trim()
  const searching = q.length > 0
  return [...workspace.collections]
    .sort((a, b) => a.order - b.order)
    .map(collection => {
      const nodes = workspace.interfaces
        .filter(item => (item.collectionId ?? item.moduleId) === collection.id)
        .sort((a, b) => a.order - b.order)
      const requestCount = nodes.filter(item => !isFolderNode(item)).length
      return { ...collection, nodes, requestCount }
    })
    .filter(collection => !searching
      || collection.name.toLowerCase().includes(q)
      || collection.nodes.some(node => nodeOrDescendantMatches(node, collection.nodes, q)))
})

function getApi(node: InterfaceNode): ApiConfig | null {
  return node.apiId ? store.apis[node.apiId] ?? null : null
}

function isFolderNode(node: InterfaceNode): boolean {
  return (node.nodeType ?? 'request') === 'folder'
}

function nodeMatches(node: InterfaceNode, q: string): boolean {
  if (!q) return true
  if (isFolderNode(node)) return node.name.toLowerCase().includes(q)
  const api = getApi(node)
  return (api?.name ?? node.name).toLowerCase().includes(q)
    || (api?.url ?? node.url).toLowerCase().includes(q)
    || (api?.method ?? node.method).toLowerCase().includes(q)
}

function nodeOrDescendantMatches(node: InterfaceNode, all: InterfaceNode[], q: string): boolean {
  if (!q) return true
  if (nodeMatches(node, q)) return true
  return all
    .filter(item => (item.parentId ?? null) === node.id)
    .some(child => nodeOrDescendantMatches(child, all, q))
}

function visibleNodes(collection: TreeCollection): Array<{ node: InterfaceNode; depth: number }> {
  const q = props.filter.toLowerCase().trim()
  const rows: Array<{ node: InterfaceNode; depth: number }> = []
  const visit = (parentId: string | null, depth: number) => {
    const children = collection.nodes
      .filter(item => (item.parentId ?? null) === parentId)
      .sort((a, b) => a.order - b.order)
    for (const node of children) {
      if (!nodeOrDescendantMatches(node, collection.nodes, q)) continue
      rows.push({ node, depth })
      if (isFolderNode(node) && isExpanded(nodeKey(node.id))) visit(node.id, depth + 1)
    }
  }
  visit(null, 0)
  return rows
}

function collectionKey(id: string): string {
  return `module:${id}`
}

function nodeKey(id: string): string {
  return `node:${id}`
}

function isExpanded(key: string): boolean {
  return !store.expandedFolders.includes(`collapsed:${key}`)
}

function toggleExpanded(key: string) {
  const storageKey = `collapsed:${key}`
  const idx = store.expandedFolders.indexOf(storageKey)
  if (idx >= 0) store.expandedFolders.splice(idx, 1)
  else store.expandedFolders.push(storageKey)
}

function methodColor(method: string): string {
  const colors: Record<string, string> = {
    GET: 'var(--method-get-color)',
    POST: 'var(--method-post-color)',
    PUT: 'var(--method-put-color)',
    DELETE: 'var(--method-delete-color)',
    PATCH: 'var(--method-patch-color)',
    HEAD: 'var(--method-head-color)',
    OPTIONS: 'var(--method-options-color)',
  }
  return colors[method?.toUpperCase()] || 'var(--method-default-color)'
}

const isRequestOpen = (node: InterfaceNode): boolean => Boolean(node.apiId && store.openTabs.includes(node.apiId))

// FR-4:类型图标只认 ws/wss scheme(声明式 requestType 不再作为分支依据);SSE 无法从 URL 判定,不显示
function requestTypeOf(node: InterfaceNode): 'rest' | 'sse' | 'ws' {
  return isWebSocketUrl(node.url) ? 'ws' : 'rest'
}

const isWsConnected = (node: InterfaceNode): boolean =>
  requestTypeOf(node) === 'ws' && Boolean(node.apiId && wsStore.activeApiId === node.apiId && wsStore.isBusy)

// ── 继承标记(FR-2.2 增强项)──
interface InheritInfo { sourceName: string; details: string }
const inheritInfoByNode = computed<Map<string, InheritInfo>>(() => {
  const map = new Map<string, InheritInfo>()
  for (const collection of workspace.collections) {
    const nodes = workspace.interfaces.filter(item => (item.collectionId ?? item.moduleId) === collection.id)
    for (const node of nodes) {
      if (isFolderNode(node) && !nodeHasOverrides(node)) continue
      const inherited = resolveInheritedProperties(collection, nodes as CollectionNode[], node.id)
      const sources: string[] = []
      if (inherited.auth.source !== 'none' && inherited.auth.source !== 'node') sources.push(`Auth ← ${inherited.auth.sourceName}`)
      if (inherited.headers.length) sources.push(`Headers ×${inherited.headers.length}`)
      if (inherited.variables.length) sources.push(`变量 ×${inherited.variables.length}`)
      if (inherited.preScripts.length) sources.push(`Pre ×${inherited.preScripts.length}`)
      if (inherited.postScripts.length) sources.push(`Post ×${inherited.postScripts.length}`)
      if (sources.length) map.set(node.id, { sourceName: collection.name, details: sources.join('\n') })
    }
  }
  return map
})

function nodeHasOverrides(node: InterfaceNode): boolean {
  return Boolean(node.auth || (node.headers?.length) || (node.variables?.length) || node.preRequestScript || node.postRequestScript)
}

// ── 选择与打开 ──
function selectApi(apiId: string) {
  const node = workspace.interfaces.find(item => item.apiId === apiId)
  workspace.selectInterface(node?.id ?? apiId)
  store.openApiInTab(apiId)
}

function openNode(node: InterfaceNode) {
  if (isFolderNode(node)) {
    workspace.selectInterface(node.id)
    store.openPropertiesInTab({ type: 'folder', id: node.id })
    return
  }
  if (node.apiId) selectApi(node.apiId)
}

function openCollection(id: string) {
  workspace.selectModule(id)
  store.openPropertiesInTab({ type: 'collection', id })
}

// ── 新建 ──
async function createRequest(parentId: string | null, moduleId: string) {
  // 新建请求直接开新标签(不再先输名称);落点记到 pendingSaveTarget,首次 Cmd+S 时预选
  const api = await store.newRequestTab({ moduleId, parentId })
  if (parentId && !isExpanded(nodeKey(parentId))) toggleExpanded(nodeKey(parentId))
  return api
}

async function createFolder(parentId: string | null, moduleId: string) {
  const name = await dialog.prompt({ title: '新建文件夹', message: '文件夹名称', placeholder: '例如:登录流程', confirmText: '创建' })
  if (!name?.trim()) return
  const folder = await workspace.addFolder(moduleId, name.trim(), parentId)
  if (parentId && !isExpanded(nodeKey(parentId))) toggleExpanded(nodeKey(parentId))
  if (!isExpanded(nodeKey(folder.id))) toggleExpanded(nodeKey(folder.id))
  openNode(folder)
}

async function createCollection() {
  const name = await dialog.prompt({ title: '新建集合', message: '集合用于组织接口、环境与脚本。', placeholder: '例如:用户中心', confirmText: '创建' })
  if (!name?.trim()) return
  let categoryId = workspace.categories[0]?.id
  if (!categoryId) categoryId = (await workspace.ensureDefaultCategory()).id
  const module = await workspace.addModule(categoryId, name.trim())
  workspace.selectModule(module.id)
  store.openPropertiesInTab({ type: 'collection', id: module.id })
  if (!isExpanded(collectionKey(module.id))) toggleExpanded(collectionKey(module.id))
}

// ── 重命名(FR-2.3 编辑 E)──
function startRename(kind: 'collection' | 'node', id: string, currentName: string) {
  renaming.value = { kind, id }
  renameValue.value = currentName
}

async function commitRename() {
  const target = renaming.value
  const name = renameValue.value.trim()
  renaming.value = null
  if (!target || !name) return
  if (target.kind === 'collection') {
    await workspace.updateModule(target.id, { name })
  } else {
    const node = workspace.interfaces.find(item => item.id === target.id)
    if (!node) return
    if (isFolderNode(node)) {
      await workspace.updateInterfaceNode(node.id, { name })
    } else if (node.apiId) {
      await store.updateApiNow(node.apiId, { name })
    }
  }
}

function cancelRename() {
  renaming.value = null
}

// ── 复制 / 删除 / 导出 / 排序 ──
async function duplicateCollection(id: string) {
  const result = await workspace.duplicateModule(id)
  if (result) toast.success(`已复制集合:${result.name}`)
}

async function duplicateNode(node: InterfaceNode) {
  const result = await workspace.duplicateInterface(node.id)
  if (result) toast.success(`已复制:${result.name}`)
}

async function confirmDeleteCollection(id: string) {
  const collection = workspace.collections.find(item => item.id === id)
  const ok = await dialog.confirm({
    title: '删除集合',
    message: `确认删除集合「${collection?.name ?? id}」及其所有接口?此操作不可撤销。`,
    confirmText: '删除',
    danger: true,
  })
  if (!ok) return
  const apiIds = workspace.interfaces
    .filter(item => (item.collectionId ?? item.moduleId) === id && !isFolderNode(item) && item.apiId)
    .map(item => item.apiId)
  for (const apiId of apiIds) store.deleteApi(apiId)
  await workspace.deleteModule(id)
  toast.success('集合已删除')
}

async function confirmDeleteNode(node: InterfaceNode) {
  const ok = await dialog.confirm({
    title: isFolderNode(node) ? '删除文件夹' : '删除请求',
    message: `确认删除「${node.name}」${isFolderNode(node) ? '及其子接口' : ''}?此操作不可撤销。`,
    confirmText: '删除',
    danger: true,
  })
  if (!ok) return
  if (isFolderNode(node)) {
    const descendants = workspace.getDescendantNodes(node.id)
    for (const item of descendants) {
      if (!isFolderNode(item) && item.apiId) store.deleteApi(item.apiId)
    }
    await workspace.deleteInterfaceSubtree(node.id)
  } else if (node.apiId) {
    store.deleteApi(node.apiId)
  }
  toast.success('已删除')
}

function downloadTextFile(fileName: string, content: string, mime: string) {
  const blob = new Blob([content], { type: mime })
  const url = URL.createObjectURL(blob)
  const a = document.createElement('a')
  a.href = url
  a.download = fileName
  a.click()
  URL.revokeObjectURL(url)
}

function safeName(name: string): string {
  return name.replace(/[\\/:*?"<>|]/g, '_') || 'export'
}

function exportCollectionPostman(id: string) {
  const collection = workspace.collections.find(item => item.id === id)
  if (!collection) return
  const nodes = workspace.interfaces.filter(item => (item.collectionId ?? item.moduleId) === id)
  const json = generatePostmanCollectionTree({ collection, nodes, apis: store.apis })
  downloadTextFile(`${safeName(collection.name)}-postman-v21.json`, json, 'application/json;charset=utf-8')
  const envs = store.environments.filter(item => item.collectionId === id && !store.isGlobalEnv(item))
  for (const [index, content] of generatePostmanEnvironmentFiles(envs).entries()) {
    const envName = safeName(envs[index]?.name || `env-${index + 1}`)
    window.setTimeout(() => downloadTextFile(`${safeName(collection.name)}-${envName}-env.json`, content, 'application/json;charset=utf-8'), 150 * (index + 1))
  }
  toast.success(envs.length ? `已导出 Postman 集合与 ${envs.length} 个环境` : '已导出 Postman 集合')
}

function exportFolderCurl(node: InterfaceNode) {
  const descendants = workspace.getDescendantNodes(node.id)
    .filter(item => !isFolderNode(item) && item.apiId)
    .map(item => store.apis[item.apiId])
    .filter((api): api is ApiConfig => Boolean(api))
  const content = descendants.map(api => generateCurl(api, store.getEnvVariablesForApi(api.id))).join('\n\n') || node.name
  downloadTextFile(`${safeName(node.name)}-curl.txt`, content, 'text/plain;charset=utf-8')
  toast.success('已导出文件夹请求为 cURL')
}

function exportRequestPostman(node: InterfaceNode) {
  const api = getApi(node)
  if (!api) return
  const json = generatePostmanCollection([api], api.name)
  downloadTextFile(`${safeName(api.name)}-postman.json`, json, 'application/json;charset=utf-8')
  toast.success('已导出请求')
}

function sortChildren(node: InterfaceNode | null, moduleId: string) {
  const parentId = node?.id ?? null
  const children = workspace.interfaces
    .filter(item => (item.collectionId ?? item.moduleId) === moduleId && (item.parentId ?? null) === parentId)
    .sort((a, b) => a.name.localeCompare(b.name, 'zh-CN'))
  for (const [index, child] of children.entries()) {
    if (child.order !== index) void workspace.updateInterfaceNode(child.id, { order: index })
  }
  toast.success('已按名称排序')
}

function copyNodeCurl(node: InterfaceNode) {
  const api = getApi(node)
  if (!api) return
  void navigator.clipboard.writeText(generateCurl(api, store.getEnvVariablesForApi(api.id)))
  toast.success('已复制 cURL')
}

async function sendNode(node: InterfaceNode) {
  if (isFolderNode(node) || !node.apiId) return
  selectApi(node.apiId)
  window.dispatchEvent(new CustomEvent('postino:send-current-request'))
}

// ── 右键菜单(FR-2.3)──
function menuForCollection(event: MouseEvent, id: string) {
  const collection = workspace.collections.find(item => item.id === id)
  if (!collection) return
  openContextMenu(event, [
    { key: 'new-request', label: '新建请求', shortcut: 'R', icon: FilePlus2, handler: () => createRequest(null, id) },
    { key: 'new-folder', label: '新建文件夹', shortcut: 'N', icon: FolderPlus, handler: () => createFolder(null, id) },
    { key: 'edit', label: '编辑', shortcut: 'E', icon: Pencil, separatorBefore: true, handler: () => startRename('collection', id, collection.name) },
    { key: 'sort', label: '排序(按名称)', shortcut: 'S', icon: SlidersHorizontal, handler: () => sortChildren(null, id) },
    { key: 'duplicate', label: '复制集合', shortcut: 'D', icon: Copy, handler: () => duplicateCollection(id) },
    { key: 'export', label: '导出(Postman)', shortcut: 'X', icon: Download, handler: () => exportCollectionPostman(id) },
    { key: 'properties', label: '属性', shortcut: 'P', icon: Settings2, handler: () => openCollection(id) },
    { key: 'delete', label: '删除', shortcut: '⌫', icon: Trash2, danger: true, separatorBefore: true, handler: () => confirmDeleteCollection(id) },
  ])
}

function menuForFolder(event: MouseEvent, node: InterfaceNode) {
  openContextMenu(event, [
    { key: 'new-request', label: '新建请求', shortcut: 'R', icon: FilePlus2, handler: () => createRequest(node.id, node.moduleId) },
    { key: 'new-folder', label: '新建文件夹', shortcut: 'N', icon: FolderPlus, handler: () => createFolder(node.id, node.moduleId) },
    { key: 'edit', label: '编辑', shortcut: 'E', icon: Pencil, separatorBefore: true, handler: () => startRename('node', node.id, node.name) },
    { key: 'sort', label: '排序(按名称)', shortcut: 'S', icon: SlidersHorizontal, handler: () => sortChildren(node, node.moduleId) },
    { key: 'duplicate', label: '复制文件夹', shortcut: 'D', icon: Copy, handler: () => duplicateNode(node) },
    { key: 'export', label: '导出(cURL)', shortcut: 'X', icon: Download, handler: () => exportFolderCurl(node) },
    { key: 'properties', label: '属性', shortcut: 'P', icon: Settings2, handler: () => openNode(node) },
    { key: 'delete', label: '删除', shortcut: '⌫', icon: Trash2, danger: true, separatorBefore: true, handler: () => confirmDeleteNode(node) },
  ])
}

function menuForRequest(event: MouseEvent, node: InterfaceNode) {
  openContextMenu(event, [
    { key: 'send', label: '发送', shortcut: 'S', icon: Radio, handler: () => sendNode(node) },
    { key: 'edit', label: '编辑', shortcut: 'E', icon: Pencil, separatorBefore: true, handler: () => startRename('node', node.id, node.name) },
    { key: 'duplicate', label: '复制请求', shortcut: 'D', icon: Copy, handler: () => duplicateNode(node) },
    { key: 'curl', label: '复制为 cURL', shortcut: 'C', icon: Copy, handler: () => copyNodeCurl(node) },
    { key: 'export', label: '导出(Postman)', shortcut: 'X', icon: Download, handler: () => exportRequestPostman(node) },
    { key: 'delete', label: '删除', shortcut: '⌫', icon: Trash2, danger: true, separatorBefore: true, handler: () => confirmDeleteNode(node) },
  ])
}

// ── 拖拽(FR-2.4)──
function onCollectionDragStart(event: DragEvent, id: string) {
  draggingCollectionId.value = id
  event.dataTransfer?.setData('text/plain', id)
  if (event.dataTransfer) event.dataTransfer.effectAllowed = 'move'
}

function onNodeDragStart(event: DragEvent, node: InterfaceNode) {
  draggingNodeId.value = node.id
  event.dataTransfer?.setData('text/plain', node.id)
  if (event.dataTransfer) {
    event.dataTransfer.setData('application/x-postino-node-id', node.id)
    event.dataTransfer.effectAllowed = 'move'
  }
}

function onDragEnd() {
  draggingNodeId.value = null
  draggingCollectionId.value = null
  dropTarget.value = null
}

function isDescendantOf(candidateId: string, ancestorId: string): boolean {
  return workspace.getDescendantNodes(ancestorId).some(item => item.id === candidateId)
}

function onFolderDragOver(event: DragEvent, node: InterfaceNode) {
  if (!draggingNodeId.value && !draggingCollectionId.value) return
  event.preventDefault()
  if (event.dataTransfer) event.dataTransfer.dropEffect = 'move'
  if (draggingNodeId.value && (draggingNodeId.value === node.id || isDescendantOf(node.id, draggingNodeId.value))) return
  dropTarget.value = { kind: 'folder', id: node.id }
}

function onRowDragOver(event: DragEvent, node: InterfaceNode) {
  if (!draggingNodeId.value) return
  event.preventDefault()
  event.stopPropagation()
  if (event.dataTransfer) event.dataTransfer.dropEffect = 'move'
  if (draggingNodeId.value === node.id) return
  dropTarget.value = { kind: 'row', id: node.id }
}

async function onFolderDrop(event: DragEvent, node: InterfaceNode) {
  event.preventDefault()
  const dragged = draggingNodeId.value
  onDragEnd()
  if (!dragged || dragged === node.id || isDescendantOf(node.id, dragged)) return
  await workspace.moveInterfaceNode(dragged, node.moduleId, node.id)
}

async function onRowDrop(event: DragEvent, node: InterfaceNode) {
  event.preventDefault()
  event.stopPropagation()
  const dragged = draggingNodeId.value
  onDragEnd()
  if (!dragged || dragged === node.id) return
  if (isFolderNode(node)) {
    await workspace.moveInterfaceNode(dragged, node.moduleId, node.id)
    return
  }
  const siblings = workspace.interfaces
    .filter(item => item.moduleId === node.moduleId && (item.parentId ?? null) === (node.parentId ?? null))
    .sort((a, b) => a.order - b.order)
  const targetIndex = siblings.findIndex(item => item.id === node.id)
  await workspace.moveInterfaceNode(dragged, node.moduleId, node.parentId ?? null, targetIndex < 0 ? undefined : targetIndex)
}

async function onCollectionHeaderDrop(event: DragEvent, collectionId: string) {
  event.preventDefault()
  if (draggingCollectionId.value) {
    const dragged = draggingCollectionId.value
    onDragEnd()
    if (dragged === collectionId) return
    const targetModule = workspace.modules.find(item => item.id === collectionId)
    if (!targetModule) return
    const ordered = tree.value
    const insertAt = ordered.filter(item => item.id !== dragged).findIndex(item => item.id === collectionId)
    await workspace.moveModule(dragged, targetModule.categoryId, Math.max(0, insertAt))
    return
  }
  const dragged = draggingNodeId.value
  onDragEnd()
  if (!dragged) return
  await workspace.moveInterfaceNode(dragged, collectionId, null)
}
</script>

<template>
  <div class="collections-tree">
    <!-- 集合 -->
    <div v-for="collection in tree" :key="collection.id" class="collection-block">
      <div
        class="collection-row"
        :class="{ 'drop-into': dropTarget?.kind === 'collection-root' && dropTarget.id === collection.id }"
        draggable="true"
        @dragstart="onCollectionDragStart($event, collection.id)"
        @dragend="onDragEnd"
        @dragover.prevent="dropTarget = { kind: 'collection-root', id: collection.id }"
        @drop="onCollectionHeaderDrop($event, collection.id)"
        @click="openCollection(collection.id)"
        @contextmenu="menuForCollection($event, collection.id)"
      >
        <button class="chevron" @click.stop="toggleExpanded(collectionKey(collection.id))">
          <ChevronDown v-if="isExpanded(collectionKey(collection.id))" :size="13" />
          <ChevronRight v-else :size="13" />
        </button>
        <Folder :size="14" class="folder-icon" />
        <template v-if="renaming?.kind === 'collection' && renaming.id === collection.id">
          <input
            v-model="renameValue"
            class="rename-input"
            autofocus
            @keydown.enter="commitRename"
            @keydown.esc="cancelRename"
            @blur="commitRename"
            @click.stop
          />
        </template>
        <template v-else>
          <span class="collection-name" :title="collection.description || collection.name">{{ collection.name }}</span>
        </template>
        <span class="count-badge">{{ collection.requestCount }}</span>
        <span class="quick-actions" @click.stop>
          <button class="quick-btn" title="新建请求" @click.stop="createRequest(null, collection.id)"><FilePlus2 :size="13" /></button>
          <button class="quick-btn" title="新建文件夹" @click.stop="createFolder(null, collection.id)"><FolderPlus :size="13" /></button>
        </span>
      </div>

      <!-- 子节点 -->
      <template v-if="isExpanded(collectionKey(collection.id))">
        <div
          v-for="{ node, depth } in visibleNodes(collection)"
          :key="node.id"
          class="node-row"
          :class="[
            { folder: isFolderNode(node), 'drop-into': dropTarget?.kind === 'folder' && dropTarget.id === node.id, 'drop-before': dropTarget?.kind === 'row' && dropTarget.id === node.id },
          ]"
          :style="{ paddingLeft: 20 + depth * 14 + 'px' }"
          draggable="true"
          @dragstart="onNodeDragStart($event, node)"
          @dragend="onDragEnd"
          @dragover="isFolderNode(node) ? onFolderDragOver($event, node) : onRowDragOver($event, node)"
          @drop="isFolderNode(node) ? onFolderDrop($event, node) : onRowDrop($event, node)"
          @click="openNode(node)"
          @dblclick="startRename('node', node.id, node.name)"
          @contextmenu="isFolderNode(node) ? menuForFolder($event, node) : menuForRequest($event, node)"
        >
          <button v-if="isFolderNode(node)" class="chevron" @click.stop="toggleExpanded(nodeKey(node.id))">
            <ChevronDown v-if="isExpanded(nodeKey(node.id))" :size="13" />
            <ChevronRight v-else :size="13" />
          </button>
          <span v-else class="chevron-spacer"></span>

          <template v-if="renaming?.kind === 'node' && renaming.id === node.id">
            <input
              v-model="renameValue"
              class="rename-input"
              autofocus
              @keydown.enter="commitRename"
              @keydown.esc="cancelRename"
              @blur="commitRename"
              @click.stop
            />
          </template>
          <template v-else>
            <!-- 请求:method 彩色文本 + 类型小图标 + ping 圆点 -->
            <template v-if="!isFolderNode(node)">
              <span class="method-text" :style="{ color: methodColor(getApi(node)?.method ?? node.method) }">{{ (getApi(node)?.method ?? node.method) }}</span>
              <span v-if="requestTypeOf(node) === 'ws'" class="type-icon" title="WebSocket"><Plug :size="11" /></span>
              <span
                v-if="isRequestOpen(node)"
                class="ping-dot"
                :class="{ live: isWsConnected(node) }"
                title="打开中"
              ></span>
            </template>
            <Folder v-else :size="14" class="folder-icon" />

            <span class="node-name" :title="node.name">{{ node.name }}</span>
            <span
              v-if="inheritInfoByNode.get(node.id)"
              class="inherit-badge"
              :title="`继承自 ${inheritInfoByNode.get(node.id)!.sourceName}:\n${inheritInfoByNode.get(node.id)!.details}`"
            ><TriangleAlert :size="10" /> 继承</span>
          </template>

          <span v-if="isFolderNode(node)" class="quick-actions" @click.stop>
            <button class="quick-btn" title="新建请求" @click.stop="createRequest(node.id, node.moduleId)"><FilePlus2 :size="13" /></button>
            <button class="quick-btn" title="新建文件夹" @click.stop="createFolder(node.id, node.moduleId)"><FolderPlus :size="13" /></button>
          </span>
        </div>
      </template>
    </div>

    <div v-if="!tree.length" class="tree-empty">
      <p>没有匹配的集合</p>
      <button class="btn btn-sm" @click="createCollection">新建集合</button>
    </div>
  </div>
</template>

<style scoped>
.collections-tree {
  flex: 1;
  overflow-y: auto;
  padding: 4px 6px 12px;
}

.collection-block {
  margin-bottom: 2px;
}

.collection-row {
  display: flex;
  align-items: center;
  gap: 5px;
  height: 30px;
  padding: 0 6px;
  border-radius: var(--radius-md);
  cursor: pointer;
  font-size: var(--font-size-body);
  font-weight: 600;
  color: var(--secondary-dark-color);
  user-select: none;
}

.collection-row:hover,
.node-row:hover {
  background: var(--primary-dark-color);
}

.collection-row.drop-into,
.node-row.drop-into {
  background: color-mix(in srgb, var(--accent-color) 25%, transparent);
  outline: 1px dashed var(--accent-color);
}

.node-row.drop-before {
  box-shadow: inset 0 2px 0 var(--accent-color);
}

.chevron {
  display: inline-flex;
  align-items: center;
  justify-content: center;
  width: 16px;
  height: 16px;
  flex-shrink: 0;
  color: var(--secondary-light-color);
}

.chevron:hover {
  color: var(--secondary-dark-color);
}

.chevron-spacer {
  width: 16px;
  flex-shrink: 0;
}

.folder-icon {
  color: var(--accent-color);
  flex-shrink: 0;
}

.collection-name,
.node-name {
  flex: 1;
  min-width: 0;
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
}

.node-row {
  display: flex;
  align-items: center;
  gap: 5px;
  height: 28px;
  padding-right: 6px;
  border-radius: var(--radius-md);
  cursor: pointer;
  font-size: var(--font-size-body);
  color: var(--secondary-color);
  user-select: none;
}

.method-text {
  font-family: var(--font-code);
  font-size: var(--font-size-tiny);
  font-weight: 700;
  flex-shrink: 0;
  min-width: 30px;
}

.type-icon {
  color: var(--secondary-light-color);
  flex-shrink: 0;
  display: inline-flex;
}

.ping-dot {
  width: 6px;
  height: 6px;
  border-radius: 50%;
  background: var(--status-success-color);
  flex-shrink: 0;
}

.ping-dot.live {
  animation: ping 1.4s ease infinite;
}

.inherit-badge {
  display: inline-flex;
  align-items: center;
  gap: 2px;
  padding: 0 5px;
  border-radius: 999px;
  background: color-mix(in srgb, var(--accent-color) 12%, transparent);
  color: var(--accent-color);
  font-size: var(--font-size-tiny);
  flex-shrink: 0;
}

.count-badge {
  padding: 0 5px;
  border-radius: 999px;
  background: var(--primary-dark-color);
  color: var(--secondary-color);
  font-size: var(--font-size-tiny);
  flex-shrink: 0;
}

.quick-actions {
  display: none;
  align-items: center;
  gap: 2px;
  flex-shrink: 0;
}

.collection-row:hover .quick-actions,
.node-row:hover .quick-actions {
  display: inline-flex;
}

.quick-btn {
  display: inline-flex;
  align-items: center;
  justify-content: center;
  width: 20px;
  height: 20px;
  border-radius: var(--radius-sm);
  color: var(--secondary-color);
}

.quick-btn:hover {
  background: var(--primary-light-color);
  color: var(--accent-color);
}

.rename-input {
  flex: 1;
  min-width: 0;
  height: 22px;
  padding: 0 6px;
  font-size: var(--font-size-body);
}

.tree-empty {
  display: flex;
  flex-direction: column;
  align-items: center;
  gap: 10px;
  padding: 32px 12px;
  color: var(--secondary-light-color);
  font-size: var(--font-size-body);
}

@keyframes ping {
  0% { box-shadow: 0 0 0 0 color-mix(in srgb, var(--status-success-color) 60%, transparent); }
  70% { box-shadow: 0 0 0 5px transparent; }
  100% { box-shadow: 0 0 0 0 transparent; }
}
</style>
