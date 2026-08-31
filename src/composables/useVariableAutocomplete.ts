import { ref, computed, type Ref } from 'vue'
import { useAppStore } from '@/stores/app'
import { useWorkspaceStore } from '@/stores/workspace'

interface AutocompleteItem {
  name: string
  preview: string
  source: string
}

const DYNAMIC_ITEMS: AutocompleteItem[] = [
  { name: '$timestamp', preview: '当前 Unix 时间戳', source: '动态函数' },
  { name: '$timestampMs', preview: '毫秒级时间戳', source: '动态函数' },
  { name: '$guid', preview: 'UUID v4', source: '动态函数' },
  { name: '$randomInt', preview: '0-1000 随机整数', source: '动态函数' },
  { name: '$randomFloat', preview: '0-100 随机浮点数', source: '动态函数' },
  { name: '$randomAlphaNumeric', preview: '8位随机字母数字', source: '动态函数' },
  { name: '$randomBoolean', preview: '随机布尔值', source: '动态函数' },
  { name: '$randomColor', preview: '随机十六进制颜色', source: '动态函数' },
  { name: '$randomIP', preview: '随机 IP 地址', source: '动态函数' },
  { name: '$randomURL', preview: '随机 URL', source: '动态函数' },
  { name: '$randomEmail', preview: '随机邮箱', source: '动态函数' },
  { name: '$randomPhone', preview: '随机手机号', source: '动态函数' },
  { name: '$date', preview: '当前日期 YYYY-MM-DD', source: '动态函数' },
  { name: '$isoTimestamp', preview: 'ISO 时间戳', source: '动态函数' },
  { name: '$localDatetime', preview: '本地时间', source: '动态函数' },
]

export function useVariableAutocomplete(inputRef: Ref<HTMLInputElement | HTMLTextAreaElement | null>) {
  const store = useAppStore()
  const workspace = useWorkspaceStore()
  const showAutocomplete = ref(false)
  const autocompletePosition = ref({ top: 0, left: 0 })
  const autocompleteFilter = ref('')
  const triggerStart = ref(-1)

  const envItems = computed<AutocompleteItem[]>(() => {
    const env = store.environments.find(e => e.id === store.currentEnvId)
    if (!env) return []
    return env.variables
      .filter(v => v.enabled && v.key)
      .map(v => ({ name: v.key, preview: v.value.slice(0, 40), source: '环境变量' }))
  })

  const requestItems = computed<AutocompleteItem[]>(() => {
    const api = store.getCurrentApi()
    return (api?.requestVariables ?? [])
      .filter(v => v.enabled && v.key)
      .map(v => ({ name: v.key, preview: v.value.slice(0, 40), source: '请求变量' }))
  })

  const currentModule = computed(() => {
    const node = workspace.interfaces.find(item => item.apiId === store.currentApiId || item.id === store.currentApiId)
    return node ? workspace.modules.find(item => item.id === node.moduleId) ?? null : null
  })

  function moduleEnvironmentId(moduleId: string): string | null {
    return workspace.collections.find(item => item.id === moduleId)?.selectedEnvId ?? store.currentEnvId
  }

  function moduleVariableValue(
    value: { remote?: string; local?: string; environmentValues?: Record<string, string> },
    environmentId: string | null,
  ): string {
    if (environmentId && value.environmentValues !== undefined) {
      return value.environmentValues[environmentId] ?? ''
    }
    return value.local || value.remote || ''
  }

  const moduleItems = computed<AutocompleteItem[]>(() => {
    const module = currentModule.value
    if (!module?.variables) return []
    return Object.entries(module.variables).map(([name, value]) => ({
      name,
      preview: moduleVariableValue(value, moduleEnvironmentId(module.id)).slice(0, 40),
      source: '模块变量',
    }))
  })

  const scopedModuleItems = computed<AutocompleteItem[]>(() => {
    return workspace.modules.flatMap(module => Object.entries(module.variables ?? {}).map(([key, value]) => ({
      name: `${module.name}.${key}`,
      preview: moduleVariableValue(value, moduleEnvironmentId(module.id)).slice(0, 40),
      source: '跨模块引用',
    })))
  })

  const allItems = computed(() => {
    const seen = new Set<string>()
    return [...requestItems.value, ...moduleItems.value, ...envItems.value, ...scopedModuleItems.value, ...DYNAMIC_ITEMS]
      .filter(item => {
        if (seen.has(item.name)) return false
        seen.add(item.name)
        return true
      })
  })

  function findTriggerPos(text: string, cursorPos: number): number {
    let pos = cursorPos - 1
    while (pos >= 0 && text[pos] !== '{') pos--
    if (pos < 0) return -1
    if (pos > 0 && text[pos - 1] === '{') return pos - 1
    return -1
  }

  function handleInput() {
    const el = inputRef.value
    if (!el) return
    const text = el.value
    const cursorPos = el.selectionStart ?? text.length

    const start = findTriggerPos(text, cursorPos)
    if (start >= 0 && start < cursorPos) {
      triggerStart.value = start
      autocompleteFilter.value = text.slice(start + 2, cursorPos)
      showAutocomplete.value = true
      calcPosition(el)
    } else {
      showAutocomplete.value = false
      triggerStart.value = -1
      autocompleteFilter.value = ''
    }
  }

  function calcPosition(el: HTMLElement) {
    const rect = el.getBoundingClientRect()
    autocompletePosition.value = {
      top: rect.bottom + 4,
      left: rect.left + 20,
    }
  }

  function handleKeydown(e: KeyboardEvent): boolean {
    if (!showAutocomplete.value) return false

    if (e.key === 'ArrowDown') {
      e.preventDefault()
      return true
    }
    if (e.key === 'ArrowUp') {
      e.preventDefault()
      return true
    }
    if (e.key === 'Enter') {
      e.preventDefault()
      return true
    }
    if (e.key === 'Escape') {
      showAutocomplete.value = false
      triggerStart.value = -1
      e.preventDefault()
      return true
    }
    return false
  }

  function insertVariable(name: string) {
    const el = inputRef.value
    if (!el || triggerStart.value < 0) return

    const text = el.value
    const cursorPos = el.selectionStart ?? text.length
    let endPos = cursorPos

    // Find closing }} after cursor
    const closeIdx = text.indexOf('}}', cursorPos)
    if (closeIdx >= 0 && closeIdx <= cursorPos + 2) {
      endPos = closeIdx + 2
    }

    const replacement = `{{${name}}}`
    const newText = text.slice(0, triggerStart.value) + replacement + text.slice(endPos)
    el.value = newText

    const newCursor = triggerStart.value + replacement.length
    el.setSelectionRange(newCursor, newCursor)
    el.dispatchEvent(new Event('input', { bubbles: true }))

    showAutocomplete.value = false
    triggerStart.value = -1
    autocompleteFilter.value = ''
  }

  function close() {
    showAutocomplete.value = false
    triggerStart.value = -1
    autocompleteFilter.value = ''
  }

  return {
    showAutocomplete,
    autocompletePosition,
    autocompleteFilter,
    allItems,
    handleInput,
    handleKeydown,
    insertVariable,
    close,
  }
}
