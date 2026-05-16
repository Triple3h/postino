import { defineStore } from 'pinia'
import { ref } from 'vue'
import { db } from '@/db'
import type { Category } from '@/types'

function createId(): string {
  return crypto.randomUUID()
}

export const useCategoryStore = defineStore('category', () => {
  const categories = ref<Category[]>([])
  let initialized = false

  async function init(): Promise<void> {
    if (initialized) return
    initialized = true
    categories.value = await db.categories.orderBy('order').toArray()
  }

  async function addCategory(input: Omit<Category, 'id' | 'createdAt' | 'updatedAt'> & Partial<Pick<Category, 'id' | 'createdAt' | 'updatedAt'>>): Promise<Category> {
    const now = Date.now()
    const category: Category = {
      id: input.id ?? createId(),
      name: input.name,
      order: input.order,
      createdAt: input.createdAt ?? now,
      updatedAt: input.updatedAt ?? now,
    }

    await db.categories.put(category)
    categories.value = [...categories.value.filter(item => item.id !== category.id), category]
      .sort((a, b) => a.order - b.order)
    return category
  }

  async function updateCategory(id: string, updates: Partial<Omit<Category, 'id' | 'createdAt'>>): Promise<void> {
    const updatedAt = Date.now()
    await db.categories.update(id, { ...updates, updatedAt })
    categories.value = categories.value
      .map(item => item.id === id ? { ...item, ...updates, updatedAt } : item)
      .sort((a, b) => a.order - b.order)
  }

  async function deleteCategory(id: string): Promise<void> {
    await db.categories.delete(id)
    categories.value = categories.value.filter(item => item.id !== id)
  }

  async function replaceCategories(nextCategories: Category[]): Promise<void> {
    await db.transaction('rw', db.categories, async () => {
      await db.categories.clear()
      await db.categories.bulkPut(nextCategories)
    })
    categories.value = [...nextCategories].sort((a, b) => a.order - b.order)
  }

  return {
    categories,
    init,
    addCategory,
    updateCategory,
    deleteCategory,
    replaceCategories,
  }
})
