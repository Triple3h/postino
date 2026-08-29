<script setup lang="ts">
import { computed, ref } from 'vue'
import { Check, Contrast, Monitor, Moon, Sun } from '@lucide/vue'
import { useAppStore } from '@/stores/app'
import { useWorkspaceStore } from '@/stores/workspace'
import { useSettings, ACCENT_COLORS, THEME_COLOR_MODES } from '@/composables/useSettings'
import { useDialog } from '@/composables/useDialog'
import { useFileImport } from '@/composables/useFileImport'
import { SHORTCUT_ACTIONS, DEFAULT_SHORTCUTS, getEffectiveShortcuts, eventToShortcut } from '@/utils/shortcuts'
import { generateCollectionBackup } from '@/utils/export'
import { toast } from 'vue-sonner'
import { db } from '@/db'
import type { AccentColor, AppShortcutAction, ThemeColorMode } from '@/types'

/**
 * 设置页(FR-6.1/6.2,参考 Hoppscotch pages/settings.vue):
 * 五分区(外观/通用/网络/快捷键/数据),每区左 1/3 标题 + 右 2/3 控件;
 * 全部写入 db.settings 经 useSettings 代理,即时生效。
 */
const store = useAppStore()
const workspace = useWorkspaceStore()
const { settings } = useSettings()
const dialog = useDialog()
const { importFiles } = useFileImport()

function persist() {
  store.saveSettings().catch(err => console.error('Failed to save settings:', err))
}

// ── 外观 ──
const themeOptions: Array<{ value: ThemeColorMode; label: string; icon: unknown }> = [
  { value: 'system', label: '跟随系统', icon: Monitor },
  { value: 'light', label: '亮色', icon: Sun },
  { value: 'dark', label: '暗色', icon: Moon },
  { value: 'black', label: '纯黑', icon: Contrast },
]

/** 九色 accent 的预览色(tailwind 500,与 accent-themes 一致) */
const ACCENT_PRESET_COLORS: Record<AccentColor, string> = {
  green: '#10b981',
  teal: '#14b8a6',
  blue: '#3b82f6',
  indigo: '#6366f1',
  purple: '#a855f7',
  yellow: '#f59e0b',
  orange: '#f97316',
  red: '#ef4444',
  pink: '#ec4899',
}

function setTheme(mode: ThemeColorMode) {
  store.setTheme(mode)
}

function setAccent(accent: AccentColor) {
  store.setAccent(accent)
}

// ── 通用 ──
const language = ref<'zh-CN' | 'en'>('zh-CN')

// ── 网络 ──
const corsOptions: Array<{ value: 'cors' | 'proxy' | 'no-cors'; label: string; hint: string }> = [
  { value: 'cors', label: '直连(CORS)', hint: '浏览器直连,要求服务端允许跨域' },
  { value: 'proxy', label: '公共代理', hint: '经公共 CORS 代理转发请求' },
  { value: 'no-cors', label: '扩展后台 / 桌面', hint: '扩展 Service Worker 或桌面 shell 直连' },
]

// ── 快捷键 ──
const shortcutDrafts = ref<Partial<Record<AppShortcutAction, string>>>({})
const recordingAction = ref<AppShortcutAction | null>(null)
const shortcutDirty = ref(false)

function beginRecord(action: AppShortcutAction) {
  recordingAction.value = action
}

function recordShortcut(action: AppShortcutAction, event: KeyboardEvent) {
  event.preventDefault()
  event.stopPropagation()
  const shortcut = eventToShortcut(event)
  if (!shortcut) return
  shortcutDrafts.value = { ...shortcutDrafts.value, [action]: shortcut }
  recordingAction.value = null
  shortcutDirty.value = true
}

function resetShortcut(action: AppShortcutAction) {
  shortcutDrafts.value = { ...shortcutDrafts.value, [action]: DEFAULT_SHORTCUTS[action] }
  shortcutDirty.value = true
}

function resetAllShortcuts() {
  shortcutDrafts.value = { ...DEFAULT_SHORTCUTS }
  shortcutDirty.value = true
}

async function saveShortcuts() {
  store.settings.customShortcuts = { ...getEffectiveShortcuts(shortcutDrafts.value) }
  await store.saveSettings()
  shortcutDrafts.value = {}
  shortcutDirty.value = false
  toast.success('快捷键已保存')
}

function shortcutValue(action: AppShortcutAction): string {
  return shortcutDrafts.value[action] || store.settings.customShortcuts?.[action] || DEFAULT_SHORTCUTS[action]
}

const shortcutGroups = computed(() => {
  const byGroup = new Map<string, typeof SHORTCUT_ACTIONS>()
  for (const meta of SHORTCUT_ACTIONS) {
    const list = byGroup.get(meta.group) ?? []
    list.push(meta)
    byGroup.set(meta.group, list)
  }
  return [...byGroup.entries()]
})

// ── 数据 ──
const restoreInput = ref<HTMLInputElement | null>(null)
const importInput = ref<HTMLInputElement | null>(null)

function exportBackup() {
  const doc = generateCollectionBackup({
    collections: [...workspace.collections],
    nodes: [...workspace.interfaces],
    environments: [...store.environments],
    apis: { ...store.apis },
  })
  downloadFile(`apifix-backup-${new Date().toISOString().slice(0, 10)}.json`, doc, 'application/json;charset=utf-8')
  toast.success('备份已导出(secret 值已剥离)')
}

function downloadFile(fileName: string, content: string, mime: string) {
  const blob = new Blob([content], { type: mime })
  const url = URL.createObjectURL(blob)
  const a = document.createElement('a')
  a.href = url
  a.download = fileName
  a.click()
  URL.revokeObjectURL(url)
}

async function handleRestoreFile(event: Event) {
  const input = event.target as HTMLInputElement
  const file = input.files?.[0]
  input.value = ''
  if (!file) return
  try {
    const content = await file.text()
    const { parseCollectionBackup } = await import('@/utils/export')
    const backup = parseCollectionBackup(content)
    if (!backup) {
      toast.error('无法识别的备份文件')
      return
    }
    const stats = await store.restoreCollectionBackup(backup)
    toast.success(`已恢复备份:集合 ${stats.collections} · 节点 ${stats.nodes} · 接口 ${stats.apis} · 环境 ${stats.environments}`)
  } catch (err) {
    console.error('Restore failed:', err)
    toast.error('恢复备份失败')
  }
}

async function handleImportFile(event: Event) {
  const input = event.target as HTMLInputElement
  if (input.files?.length) await importFiles(input.files)
  input.value = ''
}

async function clearAllData() {
  const ok = await dialog.confirm({
    title: '清空全部数据',
    message: '将删除全部集合、请求、环境与历史记录,并重置设置。此操作不可撤销,建议先导出备份。',
    confirmText: '清空全部',
    danger: true,
  })
  if (!ok) return
  await Promise.all([
    db.apis.clear(), db.groups.clear(), db.environments.clear(), db.history.clear(),
    db.categories.clear(), db.modules.clear(), db.interfaces.clear(), db.collections.clear(), db.settings.clear(),
  ])
  try { localStorage.clear() } catch { /* 忽略 */ }
  location.reload()
}
</script>

<template>
  <div class="settings-view">
    <header class="settings-header">
      <h1>设置</h1>
      <p>所有更改即时生效并保存到本地数据库。</p>
    </header>

    <!-- 外观 -->
    <section class="settings-section">
      <div class="section-head">
        <h2>外观</h2>
        <p>主题明暗四档与九色强调色,全局即时生效。</p>
      </div>
      <div class="section-body">
        <div class="control-row">
          <span class="control-label">主题</span>
          <div class="theme-grid">
            <button
              v-for="option in themeOptions"
              :key="option.value"
              class="theme-card"
              :class="{ active: settings.theme === option.value }"
              @click="setTheme(option.value)"
            >
              <component :is="option.icon" :size="16" />
              <span>{{ option.label }}</span>
              <Check v-if="settings.theme === option.value" :size="13" class="theme-check" />
            </button>
          </div>
        </div>
        <div class="control-row">
          <span class="control-label">强调色</span>
          <div class="accent-row">
            <button
              v-for="accent in ACCENT_COLORS"
              :key="accent"
              class="accent-swatch"
              :class="{ active: settings.accent === accent }"
              :style="{ backgroundColor: ACCENT_PRESET_COLORS[accent] }"
              :title="accent"
              @click="setAccent(accent)"
            >
              <Check v-if="settings.accent === accent" :size="13" />
            </button>
          </div>
        </div>
      </div>
    </section>

    <!-- 通用 -->
    <section class="settings-section">
      <div class="section-head">
        <h2>通用</h2>
        <p>语言、导航与布局偏好。</p>
      </div>
      <div class="section-body">
        <div class="control-row">
          <span class="control-label">语言</span>
          <select v-model="language" class="control-select" @change="persist">
            <option value="zh-CN">简体中文(zh-CN)</option>
            <option value="en" disabled>English(即将支持)</option>
          </select>
        </div>
        <label class="control-row toggle-row">
          <span class="control-label">展开导航栏</span>
          <input v-model="store.settings.expandNavigation" type="checkbox" @change="persist" />
        </label>
        <label class="control-row toggle-row">
          <span class="control-label">侧栏位于左侧</span>
          <input v-model="store.settings.sidebarOnLeft" type="checkbox" @change="persist" />
        </label>
        <div class="control-row">
          <span class="control-label">编辑区 / 响应区排布</span>
          <div class="segment">
            <button :class="{ active: settings.editorLayout === 'vertical' }" @click="store.settings.editorLayout = 'vertical'; persist()">上下分栏</button>
            <button :class="{ active: settings.editorLayout === 'horizontal' }" @click="store.settings.editorLayout = 'horizontal'; persist()">左右分栏</button>
          </div>
        </div>
      </div>
    </section>

    <!-- 网络 -->
    <section class="settings-section">
      <div class="section-head">
        <h2>网络</h2>
        <p>默认发送通道与代理地址(请求行失败占位中可临时切换)。</p>
      </div>
      <div class="section-body">
        <div class="control-row">
          <span class="control-label">发送通道</span>
          <div class="channel-list">
            <button
              v-for="opt in corsOptions"
              :key="opt.value"
              class="channel-card"
              :class="{ active: settings.corsMode === opt.value }"
              @click="store.settings.corsMode = opt.value; persist()"
            >
              <strong>{{ opt.label }}</strong>
              <small>{{ opt.hint }}</small>
            </button>
          </div>
        </div>
        <div v-if="settings.corsMode === 'proxy'" class="control-row">
          <span class="control-label">代理 URL</span>
          <input v-model="store.settings.proxyUrl" type="url" class="control-input" placeholder="https://corsproxy.io/?" @change="persist" />
        </div>
      </div>
    </section>

    <!-- 快捷键 -->
    <section class="settings-section">
      <div class="section-head">
        <h2>快捷键</h2>
        <p>点击组合键后按下新的按键即可重绑。</p>
      </div>
      <div class="section-body">
        <div v-for="[group, metas] in shortcutGroups" :key="group" class="shortcut-group">
          <h3>{{ group }}</h3>
          <div v-for="meta in metas" :key="meta.action" class="shortcut-row">
            <div class="shortcut-meta">
              <strong>{{ meta.label }}</strong>
              <small>{{ meta.description }}</small>
            </div>
            <input
              class="shortcut-input"
              readonly
              :value="recordingAction === meta.action ? '按下新组合键…' : shortcutValue(meta.action)"
              title="点击后按下新的快捷键"
              @keydown="recordShortcut(meta.action, $event)"
              @focus="beginRecord(meta.action)"
              @blur="recordingAction = null"
            />
            <button class="btn btn-sm" @click="resetShortcut(meta.action)">默认</button>
          </div>
        </div>
        <div class="shortcut-actions">
          <button class="btn btn-sm" @click="resetAllShortcuts">全部恢复默认</button>
          <button class="btn btn-sm btn-primary" :disabled="!shortcutDirty" @click="saveShortcuts">保存快捷键</button>
        </div>
      </div>
    </section>

    <!-- 数据 -->
    <section class="settings-section">
      <div class="section-head">
        <h2>数据</h2>
        <p>备份、恢复、导入导出与危险操作。</p>
      </div>
      <div class="section-body">
        <div class="control-row">
          <span class="control-label">备份 / 恢复</span>
          <div class="data-actions">
            <button class="btn btn-sm" @click="exportBackup">导出全部数据(备份)</button>
            <button class="btn btn-sm" @click="restoreInput?.click()">从备份恢复…</button>
            <input ref="restoreInput" type="file" accept="application/json,.json" class="hidden" @change="handleRestoreFile" />
          </div>
        </div>
        <div class="control-row">
          <span class="control-label">导入</span>
          <div class="data-actions">
            <button class="btn btn-sm" @click="importInput?.click()">导入接口文件…</button>
            <input ref="importInput" type="file" multiple class="hidden" @change="handleImportFile" />
            <small class="control-hint">支持 cURL、Postman(v2.1 树/环境)、OpenAPI、HAR、自有备份;旧版 localStorage 数据会在启动时自动提示迁移。</small>
          </div>
        </div>
        <div class="control-row">
          <span class="control-label">危险操作</span>
          <div class="data-actions">
            <button class="btn btn-sm danger" @click="clearAllData">清空全部数据…</button>
          </div>
        </div>
      </div>
    </section>
  </div>
</template>

<style scoped>
.settings-view {
  height: 100%;
  overflow-y: auto;
  padding: 24px 0 60px;
}

.settings-header {
  padding: 0 32px 18px;
}

.settings-header h1 {
  font-size: 20px;
  font-weight: 700;
}

.settings-header p {
  margin-top: 4px;
  color: var(--secondary-color);
  font-size: var(--font-size-body);
}

.settings-section {
  display: grid;
  grid-template-columns: minmax(200px, 1fr) minmax(0, 2fr);
  gap: 24px;
  padding: 20px 32px;
  border-top: 1px solid var(--divider-color);
}

.section-head h2 {
  font-size: 14px;
  font-weight: 700;
}

.section-head p {
  margin-top: 4px;
  color: var(--secondary-light-color);
  font-size: var(--font-size-tiny);
  line-height: 1.6;
}

.section-body {
  display: flex;
  flex-direction: column;
  gap: 14px;
}

.control-row {
  display: flex;
  align-items: flex-start;
  gap: 14px;
}

.control-row.toggle-row {
  align-items: center;
  cursor: pointer;
  user-select: none;
}

.control-label {
  width: 120px;
  flex-shrink: 0;
  padding-top: 4px;
  color: var(--secondary-color);
  font-size: var(--font-size-body);
  font-weight: 500;
}

.control-select,
.control-input {
  width: min(320px, 100%);
  height: 32px;
}

.control-hint {
  color: var(--secondary-light-color);
  font-size: var(--font-size-tiny);
  line-height: 1.6;
}

.theme-grid {
  display: flex;
  gap: 8px;
  flex-wrap: wrap;
}

.theme-card {
  display: flex;
  flex-direction: column;
  align-items: center;
  gap: 5px;
  width: 84px;
  padding: 12px 8px;
  border: 1px solid var(--divider-dark-color);
  border-radius: var(--radius-md);
  background: var(--primary-light-color);
  color: var(--secondary-color);
  font-size: var(--font-size-tiny);
}

.theme-card:hover {
  border-color: var(--secondary-light-color);
}

.theme-card.active {
  border-color: var(--accent-color);
  color: var(--accent-color);
  background: color-mix(in srgb, var(--accent-color) 8%, var(--primary-light-color));
}

.theme-check {
  color: var(--accent-color);
}

.accent-row {
  display: flex;
  gap: 8px;
  flex-wrap: wrap;
}

.accent-swatch {
  display: grid;
  place-items: center;
  width: 26px;
  height: 26px;
  border-radius: 50%;
  border: 2px solid transparent;
  color: #fff;
}

.accent-swatch:hover {
  transform: scale(1.1);
}

.accent-swatch.active {
  border-color: var(--secondary-dark-color);
}

.segment {
  display: inline-flex;
  border: 1px solid var(--divider-dark-color);
  border-radius: var(--radius-md);
  overflow: hidden;
}

.segment button {
  padding: 5px 12px;
  background: transparent;
  color: var(--secondary-color);
  font-size: var(--font-size-body);
  border-right: 1px solid var(--divider-dark-color);
}

.segment button:last-child {
  border-right: none;
}

.segment button.active {
  background: color-mix(in srgb, var(--accent-color) 14%, transparent);
  color: var(--accent-color);
}

.channel-list {
  display: flex;
  flex-direction: column;
  gap: 6px;
  width: min(360px, 100%);
}

.channel-card {
  display: flex;
  flex-direction: column;
  gap: 2px;
  padding: 8px 12px;
  border: 1px solid var(--divider-dark-color);
  border-radius: var(--radius-md);
  background: var(--primary-light-color);
  text-align: left;
}

.channel-card:hover {
  border-color: var(--secondary-light-color);
}

.channel-card.active {
  border-color: var(--accent-color);
  background: color-mix(in srgb, var(--accent-color) 8%, var(--primary-light-color));
}

.channel-card strong {
  font-size: var(--font-size-body);
  color: var(--secondary-dark-color);
}

.channel-card small {
  font-size: var(--font-size-tiny);
  color: var(--secondary-color);
}

.shortcut-group h3 {
  padding-bottom: 4px;
  color: var(--accent-color);
  font-size: var(--font-size-tiny);
  font-weight: 700;
  text-transform: uppercase;
  letter-spacing: 0.05em;
}

.shortcut-row {
  display: flex;
  align-items: center;
  gap: 12px;
  padding: 5px 0;
  border-bottom: 1px solid color-mix(in srgb, var(--divider-color) 60%, transparent);
}

.shortcut-meta {
  display: flex;
  flex-direction: column;
  gap: 1px;
  flex: 1;
  min-width: 0;
}

.shortcut-meta strong {
  font-size: var(--font-size-body);
  font-weight: 600;
}

.shortcut-meta small {
  color: var(--secondary-light-color);
  font-size: var(--font-size-tiny);
}

.shortcut-input {
  width: 150px;
  height: 28px;
  padding: 0 8px;
  border: 1px solid var(--divider-dark-color);
  border-radius: var(--radius-sm);
  background: var(--primary-color);
  color: var(--secondary-dark-color);
  font-family: var(--font-mono);
  font-size: var(--font-size-tiny);
  text-align: center;
  cursor: pointer;
}

.shortcut-input:focus {
  border-color: var(--accent-color);
}

.shortcut-actions {
  display: flex;
  justify-content: flex-end;
  gap: 8px;
}

.data-actions {
  display: flex;
  align-items: center;
  gap: 8px;
  flex-wrap: wrap;
}

.data-actions .danger {
  color: var(--status-critical-error-color);
  border-color: color-mix(in srgb, var(--status-critical-error-color) 40%, var(--divider-dark-color));
}

.data-actions .danger:hover {
  background: color-mix(in srgb, var(--status-critical-error-color) 10%, transparent);
}

.hidden {
  display: none;
}

@media (max-width: 860px) {
  .settings-section {
    grid-template-columns: 1fr;
    gap: 10px;
  }
}
</style>
