import { createApp } from 'vue'
import { createPinia } from 'pinia'
import { createRouter, createWebHashHistory } from 'vue-router'
import App from './App.vue'
import { routes } from './router'
import { useAppStore } from './stores/app'

const pinia = createPinia()

const router = createRouter({
  history: createWebHashHistory(),
  routes,
})

const app = createApp(App)
app.use(pinia)
app.use(router)

const store = useAppStore()
store.init().then(() => {
  app.mount('#app')
})
