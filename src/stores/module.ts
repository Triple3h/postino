import { defineStore } from 'pinia'
import { ref } from 'vue'
import { db } from '@/db'
import type { Module as ApiModule } from '@/types'

function createId(): string {
  return crypto.randomUUID()
}

export const useModuleStore = defineStore('module', () => {
  const modules = ref<ApiModule[]>([])
  let initialized = false

  async function init(): Promise<void> {
    if (initialized) return
    initialized = true
    modules.value = await db.modules.orderBy('order').toArray()
  }

  function getModulesByCategory(categoryId: string): ApiModule[] {
    return modules.value
      .filter(item => item.categoryId === categoryId)
      .sort((a, b) => a.order - b.order)
  }

  async function addModule(input: Omit<ApiModule, 'id' | 'createdAt' | 'updatedAt'> & Partial<Pick<ApiModule, 'id' | 'createdAt' | 'updatedAt'>>): Promise<ApiModule> {
    const now = Date.now()
    const module: ApiModule = {
      id: input.id ?? createId(),
      categoryId: input.categoryId,
      name: input.name,
      order: input.order,
      legacyGroupName: input.legacyGroupName,
      createdAt: input.createdAt ?? now,
      updatedAt: input.updatedAt ?? now,
    }

    await db.modules.put(module)
    modules.value = [...modules.value.filter(item => item.id !== module.id), module]
      .sort((a, b) => a.order - b.order)
    return module
  }

  async function updateModule(id: string, updates: Partial<Omit<ApiModule, 'id' | 'createdAt'>>): Promise<void> {
    const updatedAt = Date.now()
    await db.modules.update(id, { ...updates, updatedAt })
    modules.value = modules.value
      .map(item => item.id === id ? { ...item, ...updates, updatedAt } : item)
      .sort((a, b) => a.order - b.order)
  }

  async function deleteModule(id: string): Promise<void> {
    await db.modules.delete(id)
    modules.value = modules.value.filter(item => item.id !== id)
  }

  async function replaceModules(nextModules: ApiModule[]): Promise<void> {
    await db.transaction('rw', db.modules, async () => {
      await db.modules.clear()
      await db.modules.bulkPut(nextModules)
    })
    modules.value = [...nextModules].sort((a, b) => a.order - b.order)
  }

  return {
    modules,
    init,
    getModulesByCategory,
    addModule,
    updateModule,
    deleteModule,
    replaceModules,
  }
})
