import { ref } from 'vue'
import { toast } from 'vue-sonner'
import { useAppStore } from '@/stores/app'
import { useWorkspaceStore } from '@/stores/workspace'
import { importCurl, importHar, importPostman, importPostmanTree, importPostmanEnvironment } from '@/utils/import'
import { parseCollectionBackup } from '@/utils/export'
import { importOpenApi } from '@/utils/openapi-import'
import type { ApiConfig } from '@/types'

export type ImportType = 'curl' | 'postman' | 'openapi' | 'har'

/** 导入进度:phase 用于状态文案,percent 0-100(done 后隐藏) */
export interface ImportProgress {
  active: boolean
  fileName: string
  phase: 'parsing' | 'writing' | 'done'
  percent: number
}

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

// 导入进度必须是模块级单例:AppShell(进度条 UI)、AppHeader/SettingsView(导入入口)
// 各自调用 useFileImport(),共享同一份状态才能让触发方更新到 UI
const importProgress = ref<ImportProgress>({ active: false, fileName: '', phase: 'parsing', percent: 0 })

function setProgress(patch: Partial<ImportProgress>) {
  importProgress.value = { ...importProgress.value, ...patch }
}

export function useFileImport() {
  const dragImportDepth = ref(0)

  async function addImportedApis(apis: ApiConfig[]): Promise<void> {
    const store = useAppStore()
    const workspace = useWorkspaceStore()
    for (const [index, api] of apis.entries()) {
      if (api.folder) {
        const module = await workspace.ensureModuleForLegacyGroup(api.folder)
        await store.addApi(api, module.id)
      } else {
        await store.addApi(api, null)
      }
      setProgress({ phase: 'writing', percent: Math.round(((index + 1) / apis.length) * 100) })
    }
    if (apis.length > 0) {
      const first = apis[0]
      const node = workspace.interfaces.find(item => item.apiId === first.id)
      workspace.selectInterface(node?.id ?? first.id)
      store.openApiInTab(first.id)
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
    setProgress({ active: true, fileName: '', phase: 'parsing', percent: 0 })
    // 进度条最短展示时长:本地库写入极快,没有下限会一闪而过,用户感知不到反馈
    const minShowStart = Date.now()
    // 每个文件平分进度条区间,文件内部按条目数推进
    const fileSlice = 100 / fileArray.length
    for (const [fileIndex, file] of fileArray.entries()) {
      const fileBase = Math.round(fileIndex * fileSlice)
      setProgress({ fileName: file.name, phase: 'parsing', percent: fileBase })
      try {
        const content = await file.text()
        // 自有备份格式优先识别
        const backup = parseCollectionBackup(content)
        if (backup) {
          setProgress({ phase: 'writing' })
          const stats = await store.restoreCollectionBackup(backup)
          imported += stats.nodes
          continue
        }
        // Postman 树形集合 / 环境 JSON 优先(拖拽路径无类型选择器,靠内容探测)
        if (detectImportType(file.name, content) === 'postman') {
          const tree = importPostmanTree(content)
          if (tree) {
            const total = tree.folders.length + tree.requests.length
            const collectionId = await store.importPostmanCollectionTree(tree, (done) => {
              setProgress({ phase: 'writing', percent: Math.min(99, fileBase + Math.round((done / Math.max(total, 1)) * fileSlice)) })
            })
            if (!collectionId) {
              failed.push(file.name)
              continue
            }
            imported += tree.requests.length
            const first = tree.requests[0]?.api
            if (first) {
              const node = workspace.interfaces.find(item => item.apiId === first.id)
              workspace.selectInterface(node?.id ?? first.id)
              store.openApiInTab(first.id)
            }
            continue
          }
          const envDraft = importPostmanEnvironment(content)
          if (envDraft) {
            setProgress({ phase: 'writing' })
            const targetCollection = workspace.activeCollection?.id ?? workspace.collections[0]?.id
            if (targetCollection) {
              await store.importCollectionEnvironment(targetCollection, envDraft.name, envDraft.variables)
              imported += 1
              continue
            }
          }
        }
        setProgress({ phase: 'writing' })
        const apis = parseImportedApis(file.name, content)
        if (apis.length === 0) {
          failed.push(file.name)
          continue
        }
        await addImportedApis(apis)
        imported += apis.length
      } catch {
        failed.push(file.name)
      } finally {
        setProgress({ percent: Math.round((fileIndex + 1) * fileSlice) })
      }
    }
    setProgress({ phase: 'done', percent: 100 })
    // 保证「100% 完成」至少可见一小段时间,再收起进度条
    const elapsed = Date.now() - minShowStart
    await new Promise(resolve => setTimeout(resolve, Math.max(400, 800 - elapsed)))
    setProgress({ active: false, fileName: '', percent: 0 })
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
    importProgress,
    importFiles,
    addImportedApis,
    bindWindowDragImport,
    unbindWindowDragImport,
  }
}
