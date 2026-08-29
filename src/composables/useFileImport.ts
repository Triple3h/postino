import { ref } from 'vue'
import { toast } from 'vue-sonner'
import { useAppStore } from '@/stores/app'
import { useWorkspaceStore } from '@/stores/workspace'
import { importCurl, importHar, importPostman, importPostmanTree, importPostmanEnvironment } from '@/utils/import'
import { parseCollectionBackup } from '@/utils/export'
import { importOpenApi } from '@/utils/openapi-import'
import type { ApiConfig } from '@/types'

export type ImportType = 'curl' | 'postman' | 'openapi' | 'har'

export function detectImportType(fileName: string, content: string): ImportType | null {
  const lowerName = fileName.toLowerCase()
  const trimmed = content.trim()
  if (!trimmed) return null
  if (lowerName.endsWith('.har')) return 'har'
  if (lowerName.endsWith('.yaml') || lowerName.endsWith('.yml')) return 'openapi'
  if (lowerName.endsWith('.curl') || /^curl\s+/i.test(trimmed)) return 'curl'
  if (lowerName.endsWith('.json') || trimmed.startsWith('{') || trimmed.startsWith('[')) {
    try {
      const parsed = JSON.parse(trimmed)
      if (parsed?.log?.entries) return 'har'
      if (parsed?.openapi || parsed?.swagger || parsed?.paths) return 'openapi'
      if (parsed?.info?.schema || parsed?.item) return 'postman'
    } catch {
      return null
    }
  }
  if (/^\s*(openapi|swagger|paths|info):/m.test(content)) return 'openapi'
  return null
}

function parseImportedApis(fileName: string, content: string): ApiConfig[] {
  const type = detectImportType(fileName, content)
  if (type === 'curl') {
    const api = importCurl(content)
    return api ? [api] : []
  }
  if (type === 'postman') return importPostman(content)
  if (type === 'openapi') return importOpenApi(content)
  if (type === 'har') return importHar(content)
  return []
}

/**
 * 文件导入(原 MainView 逻辑迁移):按内容探测 cURL / Postman / OpenAPI / HAR /
 * Postman 环境与自有备份,写入集合树。
 */
export function useFileImport() {
  const dragImportDepth = ref(0)

  async function addImportedApis(apis: ApiConfig[]): Promise<void> {
    const store = useAppStore()
    const workspace = useWorkspaceStore()
    for (const api of apis) {
      if (api.folder) {
        const module = await workspace.ensureModuleForLegacyGroup(api.folder)
        await store.addApi(api, module.id)
      } else {
        await store.addApi(api, null)
      }
    }
    if (apis.length > 0) {
      const first = apis[0]
      const node = workspace.interfaces.find(item => item.apiId === first.id)
      workspace.selectInterface(node?.id ?? first.id)
      store.currentApiId = first.id
      store.response = null
    }
  }

  async function importFiles(files: FileList | File[]): Promise<void> {
    const store = useAppStore()
    const workspace = useWorkspaceStore()
    const fileArray = Array.from(files).filter(file => file.size > 0)
    if (fileArray.length === 0) return
    let imported = 0
    const failed: string[] = []
    for (const file of fileArray) {
      try {
        const content = await file.text()
        // 自有备份格式优先识别
        const backup = parseCollectionBackup(content)
        if (backup) {
          const stats = await store.restoreCollectionBackup(backup)
          imported += stats.nodes
          continue
        }
        // Postman 树形集合 / 环境 JSON 优先(拖拽路径无类型选择器,靠内容探测)
        if (detectImportType(file.name, content) === 'postman') {
          const tree = importPostmanTree(content)
          if (tree) {
            const collectionId = await store.importPostmanCollectionTree(tree)
            if (!collectionId) {
              failed.push(file.name)
              continue
            }
            imported += tree.requests.length
            const first = tree.requests[0]?.api
            if (first) {
              const node = workspace.interfaces.find(item => item.apiId === first.id)
              workspace.selectInterface(node?.id ?? first.id)
              store.currentApiId = first.id
            }
            continue
          }
          const envDraft = importPostmanEnvironment(content)
          if (envDraft) {
            const targetCollection = workspace.activeCollection?.id ?? workspace.collections[0]?.id
            if (targetCollection) {
              await store.importCollectionEnvironment(targetCollection, envDraft.name, envDraft.variables)
              imported += 1
              continue
            }
          }
        }
        const apis = parseImportedApis(file.name, content)
        if (apis.length === 0) {
          failed.push(file.name)
          continue
        }
        await addImportedApis(apis)
        imported += apis.length
      } catch {
        failed.push(file.name)
      }
    }
    if (failed.length) {
      toast.warning(`已导入 ${imported} 个接口，${failed.length} 个文件未识别`, {
        description: failed.slice(0, 3).join('、'),
      })
    } else {
      toast.success(`已从文件导入 ${imported} 个接口`)
    }
  }

  function hasDroppedFiles(event: DragEvent): boolean {
    return Array.from(event.dataTransfer?.types || []).includes('Files')
  }

  function handleWindowDragEnter(event: DragEvent) {
    if (!hasDroppedFiles(event)) return
    event.preventDefault()
    dragImportDepth.value += 1
  }

  function handleWindowDragOver(event: DragEvent) {
    if (!hasDroppedFiles(event)) return
    event.preventDefault()
    if (event.dataTransfer) event.dataTransfer.dropEffect = 'copy'
  }

  function handleWindowDragLeave(event: DragEvent) {
    if (!hasDroppedFiles(event)) return
    event.preventDefault()
    dragImportDepth.value = Math.max(0, dragImportDepth.value - 1)
  }

  function handleWindowDrop(event: DragEvent) {
    if (!hasDroppedFiles(event)) return
    event.preventDefault()
    dragImportDepth.value = 0
    const files = event.dataTransfer?.files
    if (files?.length) void importFiles(files)
  }

  function bindWindowDragImport() {
    window.addEventListener('dragenter', handleWindowDragEnter)
    window.addEventListener('dragover', handleWindowDragOver)
    window.addEventListener('dragleave', handleWindowDragLeave)
    window.addEventListener('drop', handleWindowDrop)
  }

  function unbindWindowDragImport() {
    window.removeEventListener('dragenter', handleWindowDragEnter)
    window.removeEventListener('dragover', handleWindowDragOver)
    window.removeEventListener('dragleave', handleWindowDragLeave)
    window.removeEventListener('drop', handleWindowDrop)
  }

  return {
    dragImportDepth,
    importFiles,
    addImportedApis,
    bindWindowDragImport,
    unbindWindowDragImport,
  }
}
