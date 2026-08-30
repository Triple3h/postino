import { createApp } from 'vue'
import { createPinia } from 'pinia'
import { createRouter, createWebHashHistory } from 'vue-router'
import VueTippy from 'vue-tippy'
import 'tippy.js/dist/tippy.css'
import 'tippy.js/animations/scale.css'
import '@fontsource-variable/inter'
import '@fontsource-variable/roboto-mono'
import App from './App.vue'
import { routes } from './router'
import { useAppStore } from './stores/app'
import { useWorkspaceStore } from './stores/workspace'

const pinia = createPinia()

const router = createRouter({
  history: createWebHashHistory(),
  routes,
})

const app = createApp(App)
app.use(pinia)
app.use(router)
app.use(VueTippy, {
  directive: 'tippy',
  component: 'tippy',
  defaultProps: { theme: 'tooltip', delay: [300, 0], touch: false },
})

const store = useAppStore()
store.init().then(async () => {
  await useWorkspaceStore().init()
  const basename = window.location.pathname.split('/').pop() || ''
  const routeMap: Record<string, string> = {
    'popup.html': '/popup',
    'sidepanel.html': '/sidepanel',
    'main.html': '/',
  }
  const route = routeMap[basename]
  if (route && route !== '/') {
    await router.replace(route)
  }
  app.mount('#app')
}).catch(err => {
  console.error('[Postino] init failed:', err)
  document.body.innerHTML = `<div style="padding:16px;color:red;font-size:13px;">
      <h3>初始化失败</h3>
      <pre>${err?.message || err}</pre>
    </div>`
})
