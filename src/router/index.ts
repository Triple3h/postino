import type { RouteRecordRaw } from 'vue-router'

const MainView = () => import('@/views/MainView.vue')

export const routes: RouteRecordRaw[] = [
  {
    path: '/',
    name: 'main',
    component: MainView,
  },
]
