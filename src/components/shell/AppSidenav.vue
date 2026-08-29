<script setup lang="ts">
import { computed } from 'vue'
import { useRoute, useRouter } from 'vue-router'
import { Globe, PanelLeftClose, PanelLeftOpen, Settings } from '@lucide/vue'
import { useSettings } from '@/composables/useSettings'
import { useAppStore } from '@/stores/app'

const route = useRoute()
const router = useRouter()
const { settings } = useSettings()
const store = useAppStore()

function toggleExpanded() {
  settings.value.expandNavigation = !settings.value.expandNavigation
  store.saveSettings().catch(err => console.error('Failed to save navigation setting:', err))
}

const expanded = computed(() => settings.value.expandNavigation)

const items = computed(() => [
  { name: 'main', label: '请求', icon: Globe, to: '/' },
  { name: 'settings', label: '设置', icon: Settings, to: '/settings' },
])

function isActive(to: string): boolean {
  if (to === '/') return route.name === 'main'
  return route.path.startsWith(to)
}

function go(to: string) {
  if (route.path !== to) void router.push(to)
}
</script>

<template>
  <nav
    class="sidenav"
    :class="{ expanded }"
    :aria-label="'主导航'"
  >
    <div class="flex flex-col gap-1">
      <button
        v-for="item in items"
        :key="item.name"
        v-tippy="expanded ? undefined : { content: item.label, placement: 'right' }"
        class="sidenav-item"
        :class="{ active: isActive(item.to) }"
        :aria-current="isActive(item.to) ? 'page' : undefined"
        @click="go(item.to)"
      >
        <component :is="item.icon" :size="18" />
        <span v-if="expanded" class="truncate">{{ item.label }}</span>
      </button>
    </div>

    <button
      v-tippy="expanded ? undefined : { content: expanded ? '收起导航' : '展开导航', placement: 'right' }"
      class="sidenav-item mt-auto"
      :aria-label="expanded ? '收起导航' : '展开导航'"
      @click="toggleExpanded"
    >
      <PanelLeftClose v-if="expanded" :size="18" />
      <PanelLeftOpen v-else :size="18" />
      <span v-if="expanded" class="truncate">收起导航</span>
    </button>
  </nav>
</template>

<style scoped>
.sidenav {
  display: flex;
  flex-direction: column;
  width: 56px;
  flex-shrink: 0;
  border-right: 1px solid var(--divider-color);
  background: var(--primary-color);
  padding: 8px;
  overflow: hidden;
}

.sidenav.expanded {
  width: 200px;
}

.sidenav-item {
  position: relative;
  display: flex;
  align-items: center;
  gap: 10px;
  height: 40px;
  padding: 0 10px;
  border-radius: var(--radius-md);
  color: var(--secondary-color);
  font-size: var(--font-size-body);
  white-space: nowrap;
  transition: background 0.12s ease, color 0.12s ease;
}

.sidenav-item:hover {
  background: var(--primary-dark-color);
  color: var(--secondary-dark-color);
}

.sidenav-item.active {
  background: var(--primary-light-color);
  color: var(--secondary-dark-color);
}

.sidenav-item.active::before {
  content: '';
  position: absolute;
  left: -8px;
  top: 8px;
  bottom: 8px;
  width: 2px;
  border-radius: 1px;
  background: var(--accent-color);
}

/* 窄窗:Sidenav 转底部固定栏 */
@media (max-width: 767px) {
  .sidenav {
    position: fixed;
    left: 0;
    right: 0;
    bottom: 0;
    z-index: 40;
    flex-direction: row;
    width: 100%;
    height: 48px;
    padding: 4px 8px;
    border-right: none;
    border-top: 1px solid var(--divider-color);
  }

  .sidenav.expanded {
    width: 100%;
  }

  .sidenav-item {
    flex: 1;
    justify-content: center;
    height: 40px;
  }

  .sidenav-item.active::before {
    left: 8px;
    right: 8px;
    top: auto;
    bottom: -4px;
    width: auto;
    height: 2px;
  }

  .sidenav-item.mt-auto {
    margin-top: 0;
    margin-left: auto;
    flex: 0 0 40px;
  }
}
</style>
