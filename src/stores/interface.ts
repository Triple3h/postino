import { defineStore } from 'pinia'
import { ref } from 'vue'
import { db } from '@/db'
import type { InterfaceNode } from '@/types'

function createId(): string {
  return crypto.randomUUID()
}

export const useInterfaceStore = defineStore('interface', () => {
  const interfaces = ref<InterfaceNode[]>([])
  let initialized = false

  async function init(): Promise<void> {
    if (initialized) return
    initialized = true
    interfaces.value = await db.interfaces.orderBy('order').toArray()
  }

  function getInterfacesByModule(moduleId: string): InterfaceNode[] {
    return interfaces.value
      .filter(item => item.moduleId === moduleId)
      .sort((a, b) => a.order - b.order)
  }

  async function addInterface(input: Omit<InterfaceNode, 'id' | 'createdAt' | 'updatedAt'> & Partial<Pick<InterfaceNode, 'id' | 'createdAt' | 'updatedAt'>>): Promise<InterfaceNode> {
    const now = Date.now()
    const interfaceNode: InterfaceNode = {
      id: input.id ?? createId(),
      moduleId: input.moduleId,
      apiId: input.apiId,
      name: input.name,
      method: input.method,
      url: input.url,
      order: input.order,
      createdAt: input.createdAt ?? now,
      updatedAt: input.updatedAt ?? now,
    }

    await db.interfaces.put(interfaceNode)
    interfaces.value = [...interfaces.value.filter(item => item.id !== interfaceNode.id), interfaceNode]
      .sort((a, b) => a.order - b.order)
    return interfaceNode
  }

  async function updateInterface(id: string, updates: Partial<Omit<InterfaceNode, 'id' | 'createdAt'>>): Promise<void> {
    const updatedAt = Date.now()
    await db.interfaces.update(id, { ...updates, updatedAt })
    interfaces.value = interfaces.value
      .map(item => item.id === id ? { ...item, ...updates, updatedAt } : item)
      .sort((a, b) => a.order - b.order)
  }

  async function deleteInterface(id: string): Promise<void> {
    await db.interfaces.delete(id)
    interfaces.value = interfaces.value.filter(item => item.id !== id)
  }

  async function replaceInterfaces(nextInterfaces: InterfaceNode[]): Promise<void> {
    await db.transaction('rw', db.interfaces, async () => {
      await db.interfaces.clear()
      await db.interfaces.bulkPut(nextInterfaces)
    })
    interfaces.value = [...nextInterfaces].sort((a, b) => a.order - b.order)
  }

  return {
    interfaces,
    init,
    getInterfacesByModule,
    addInterface,
    updateInterface,
    deleteInterface,
    replaceInterfaces,
  }
})
