import type { Transaction } from 'dexie'
import type {
  Category,
  Collection,
  CollectionVariable,
  EnvVariable,
  Environment,
  Module as ApiModule,
  ModuleVariables,
} from '@/types'
import { createDefaultAuthConfig } from '@/utils/auth'

/**
 * Collection 化迁移工具(Phase 0)。
 *
 * 唯一真源是 db.collections;db.categories / db.modules 在过渡期保留为旧 UI 的镜像,
 * 由 workspace store 双写维护,Phase 1 重写 Sidebar 后移除。
 * 纯函数不依赖 store/db 实例,便于单元测试;Dexie 升级入口除外(只操作 raw tx 表)。
 */

const ROOT_ORDER_MULTIPLIER = 10000

/** Module.variables(remote/local/environmentValues)→ Collection.variables 对应语义 */
export function moduleVarsToCollectionVars(vars?: ModuleVariables): CollectionVariable[] {
  if (!vars) return []
  return Object.entries(vars).map(([key, value]) => ({
    key,
    initialValue: value.remote ?? '',
    currentValue: value.local || value.remote || '',
    environmentValues: value.environmentValues ? { ...value.environmentValues } : undefined,
    secret: false,
    enabled: true,
    description: value.description,
  }))
}

/** 反向映射:currentValue 偏离 initialValue 时落到 local,并保留各环境值 */
export function collectionVarsToModuleVars(vars: CollectionVariable[]): ModuleVariables {
  const result: ModuleVariables = {}
  for (const item of vars) {
    result[item.key] = {
      remote: item.initialValue,
      local: item.currentValue && item.currentValue !== item.initialValue ? item.currentValue : '',
      description: item.description,
      environmentValues: item.environmentValues ? { ...item.environmentValues } : undefined,
    }
  }
  return result
}

/** 集合的全局排序:类目序在前,模块序在后(过渡期镜像用,Phase 1 后由拖拽直接决定) */
export function collectionOrderFor(module: ApiModule, category: Category | undefined): number {
  if (!category) return module.order
  return category.order * ROOT_ORDER_MULTIPLIER + module.order
}

/** Module → Collection(id 复用,零 ID 变动;迁移后 interfaces.moduleId 即 collectionId) */
export function collectionFromModule(module: ApiModule, category?: Category, order?: number): Collection {
  const now = Date.now()
  return {
    id: module.id,
    name: module.name,
    description: module.description,
    color: module.color ?? category?.color,
    icon: module.icon ?? category?.icon,
    order: order ?? collectionOrderFor(module, category),
    auth: createDefaultAuthConfig(),
    headers: [],
    variables: moduleVarsToCollectionVars(module.variables),
    preRequestScript: '',
    postRequestScript: '',
    selectedEnvId: null,
    meta: {
      dataSource: module.dataSource ?? null,
      exportConfig: module.exportConfig,
      moduleType: module.moduleType,
      type: module.type,
      openapiText: module.openapiText,
      legacyCategoryId: module.categoryId,
      legacyGroupId: module.legacyGroupName,
    },
    createdAt: module.createdAt ?? now,
    updatedAt: module.updatedAt ?? now,
  }
}

/** 给模块/集合列表重新计算连续 order(Dexie v10 升级与 derive 路径用) */
export function assignGlobalCollectionOrder(
  modules: ApiModule[],
  categories: Category[],
): Array<{ module: ApiModule; collection: Collection }> {
  const categoryMap = new Map(categories.map(category => [category.id, category]))
  const orderedCategories = [...categories].sort((a, b) => a.order - b.order)

  const result: Array<{ module: ApiModule; collection: Collection }> = []
  const seen = new Set<string>()
  let order = 0
  for (const category of orderedCategories) {
    const inCategory = modules
      .filter(module => module.categoryId === category.id)
      .sort((a, b) => a.order - b.order)
    for (const module of inCategory) {
      seen.add(module.id)
      result.push({ module, collection: collectionFromModule(module, category, order++) })
    }
  }
  for (const module of [...modules].sort((a, b) => a.order - b.order)) {
    if (seen.has(module.id)) continue
    result.push({ module, collection: collectionFromModule(module, categoryMap.get(module.categoryId), order++) })
  }
  return result
}

/**
 * Dexie v10 升级入口:modules → collections(一对一,id 不变),
 * interfaces 盖 collectionId 戳,存量环境归为全局环境。
 * 旧表(categories/modules/groups)保留数据不删,便于回滚。
 */
export async function upgradeToCollections(tx: Transaction): Promise<void> {
  const modules = await tx.table('modules').toArray() as ApiModule[]
  const categories = await tx.table('categories').toArray() as Category[]
  if (modules.length > 0) {
    const collections = assignGlobalCollectionOrder(modules, categories).map(item => item.collection)
    await tx.table('collections').bulkPut(collections)
  }
  await tx.table('interfaces').toCollection().modify((node: { moduleId: string; collectionId?: string }) => {
    node.collectionId = node.moduleId
  })
  await tx.table('environments').toCollection().modify((env: Environment) => {
    env.collectionId = 'global'
  })
}

/** 环境变量(旧 EnvVariable)→ CollectionVariable(备份导出等新格式路径用) */
export function envVarsToCollectionVars(vars: EnvVariable[]): CollectionVariable[] {
  return vars.map(item => ({
    key: item.key,
    initialValue: item.value,
    currentValue: item.value,
    secret: false,
    enabled: item.enabled !== false,
  }))
}
