import type { RouteRecordRaw } from 'vue-router'
import AppShell from '@/components/shell/AppShell.vue'

const MainView = () => import('@/views/MainView.vue')
const SettingsView = () => import('@/views/SettingsView.vue')
const SidePanelView = () => import('@/views/SidePanelView.vue')
const PopupView = () => import('@/views/PopupView.vue')

export const routes: RouteRecordRaw[] = [
  {
    path: '/',
    component: AppShell,
    children: [
      {
        path: '',
        name: 'main',
        component: MainView,
      },
      {
        path: 'settings',
        name: 'settings',
        component: SettingsView,
      },
    ],
  },
  {
    path: '/sidepanel',
    name: 'sidepanel',
    component: SidePanelView,
  },
  {
    path: '/popup',
    name: 'popup',
    component: PopupView,
  },
]
