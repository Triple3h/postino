<script setup lang="ts">
import { computed, ref } from 'vue'
import { useRouter } from 'vue-router'
import { ChevronDown, Download, FileUp, Moon, Monitor, Search, Settings, Sun, Zap, Contrast } from '@lucide/vue'
import { Tippy } from 'vue-tippy'
import { toast } from 'vue-sonner'
import { useSettings } from '@/composables/useSettings'
import { useFileImport } from '@/composables/useFileImport'
import { generateCollectionBackup } from '@/utils/export'
import { useAppStore } from '@/stores/app'
import { useWorkspaceStore } from '@/stores/workspace'
import EnvSelector from '@/components/common/EnvSelector.vue'
import type { ThemeColorMode } from '@/types'

const router = useRouter()
const store = useAppStore()
const { settings, toggleTheme } = useSettings()
const { importFiles } = useFileImport()

const fileInput = ref<HTMLInputElement | null>(null)

const isMac = computed(() => /mac/i.test(navigator.platform))
const searchKbd = computed(() => (isMac.value ? '⌘K' : 'Ctrl+K'))

const themeIcon = computed(() => {
  switch (settings.value.theme as ThemeColorMode) {
    case 'light': return Sun
    case 'dark': return Moon
    case 'black': return Contrast
    default: return Monitor
  }
})
const themeLabel = computed(() => {
  switch (settings.value.theme as ThemeColorMode) {
    case 'light': return '亮色'
    case 'dark': return '暗色'
    case 'black': return '纯黑'
    default: return '跟随系统'
  }
})

function openSearch() {
  window.dispatchEvent(new CustomEvent('apifix:open-spotlight'))
}

function pickImportFile() {
  fileInput.value?.click()
}

async function handleImportFile(event: Event) {
  const input = event.target as HTMLInputElement
  if (input.files?.length) await importFiles(input.files)
  input.value = ''
}

function exportBackup() {
  const workspace = useWorkspaceStore()
  const doc = generateCollectionBackup({
    collections: [...workspace.collections],
    nodes: [...workspace.interfaces],
    environments: [...store.environments],
    apis: { ...store.apis },
  })
  const blob = new Blob([doc], { type: 'application/json' })
  const url = URL.createObjectURL(blob)
  const a = document.createElement('a')
  a.href = url
  a.download = `apifix-backup-${new Date().toISOString().slice(0, 10)}.json`
  a.click()
  URL.revokeObjectURL(url)
  toast.success('备份已导出')
}

function goToSettings() {
  void router.push('/settings')
}
</script>

<template>
  <header class="grid h-12 shrink-0 grid-cols-[minmax(180px,1fr)_minmax(0,2fr)_minmax(180px,1fr)] items-center gap-2 border-b border-divider bg-primary px-3">
    <!-- 左:品牌 -->
    <div class="flex items-center gap-2">
      <span class="grid h-7 w-7 place-items-center rounded-md bg-accent text-accentContrast">
        <Zap :size="16" :stroke-width="2.4" />
      </span>
      <span class="text-[13px] font-bold tracking-tight">ApiFix Bin</span>
    </div>

    <!-- 中:Spotlight 搜索条 -->
    <button
      class="flex h-8 w-full items-center gap-2 rounded-md border border-divider bg-primaryLight px-3 text-secondary transition-colors hover:border-dividerDark hover:text-secondaryDark"
      @click="openSearch"
    >
      <Search :size="14" />
      <span class="truncate text-[12px]">搜索请求、环境、历史、设置…</span>
      <kbd class="ml-auto rounded border border-dividerDark px-1.5 py-0.5 font-mono text-[10px] leading-none text-secondary">{{ searchKbd }}</kbd>
    </button>

    <!-- 右:环境切换(FR-6,Hoppscotch 式全局入口)/ 导入导出 / 主题 / 设置 -->
    <div class="flex items-center justify-end gap-1">
      <EnvSelector class="mr-1" />
      <Tippy interactive trigger="click" theme="popover" placement="bottom-end" :offset="[0, 6]">
        <button class="flex h-8 items-center gap-1 rounded-md px-2.5 text-[12px] text-secondary transition-colors hover:bg-primaryDark hover:text-secondaryDark">
          <FileUp :size="15" />
          <span class="hidden sm:inline">导入 / 导出</span>
          <ChevronDown :size="12" />
        </button>
        <template #content>
          <div class="flex w-60 flex-col">
            <button class="menu-item" @click="pickImportFile">
              <FileUp :size="14" />
              <span>导入接口文件…</span>
              <span class="ml-auto text-[10px] text-secondaryLight">cURL / Postman / OpenAPI / HAR / 备份</span>
            </button>
            <button class="menu-item" @click="exportBackup">
              <Download :size="14" />
              <span>导出全部数据(备份)</span>
            </button>
            <p class="border-t border-divider px-3 py-2 text-[10px] leading-relaxed text-secondaryLight">
              提示:直接把文件拖进窗口任意位置也可以导入。
            </p>
          </div>
        </template>
      </Tippy>

      <input ref="fileInput" type="file" class="hidden" multiple @change="handleImportFile" />

      <button
        v-tippy="{ content: `主题:${themeLabel}(点击切换)` }"
        class="btn-icon"
        @click="toggleTheme"
      >
        <component :is="themeIcon" :size="16" />
      </button>

      <button
        v-tippy="{ content: '设置' }"
        class="btn-icon"
        data-testid="header-settings"
        @click="goToSettings"
      >
        <Settings :size="16" />
      </button>
    </div>
  </header>
</template>

<style scoped>
.menu-item {
  display: flex;
  align-items: center;
  gap: 8px;
  width: 100%;
  padding: 7px 12px;
  border-radius: var(--radius-md);
  font-size: var(--font-size-body);
  color: var(--secondary-dark-color);
  text-align: left;
}

.menu-item:hover {
  background: var(--primary-dark-color);
}

.menu-item span:last-of-type {
  max-width: 96px;
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
}
</style>
