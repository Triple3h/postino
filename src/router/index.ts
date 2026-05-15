import type { RouteRecordRaw } from 'vue-router'

const MainView = () => import('@/views/MainView.vue')
const SidePanelView = () => import('@/views/SidePanelView.vue')
const PopupView = () => import('@/views/PopupView.vue')

export const routes: RouteRecordRaw[] = [
  {
    path: '/',
    name: 'main',
    component: MainView,
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
