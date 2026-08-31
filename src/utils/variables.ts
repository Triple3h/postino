import type { Collection, CollectionNode, CollectionVariable, Environment, EnvVariable } from '@/types'

/** 环境化变量缺少对应值时保持为空;旧数据未启用环境映射时沿用默认运行值。 */
export function collectionVariableValue(
  variable: CollectionVariable,
  environmentId: string | null | undefined,
): string {
  if (environmentId && variable.environmentValues !== undefined) {
    return variable.environmentValues[environmentId] ?? ''
  }
  return variable.currentValue || variable.initialValue
}

/** 变量解析来源:Postman 优先级从高到低 */
export type VariableSourceKind =
  | 'request'
  | 'collection-env'
  | 'folder'
  | 'collection'
  | 'global-env'

export interface VariableResolution {
  key: string
  value: string
  source: VariableSourceKind
  /** 来源显示名(环境名 / 文件夹名 / 集合名) */
  sourceName: string
  secret: boolean
}

export interface VariableResolutionInputs {
  requestVariables?: Array<Pick<EnvVariable, 'key' | 'value' | 'enabled'>>
  /** 近→远排序的祖先文件夹链(getAncestorFolders 的返回顺序) */
  folders?: Array<Pick<CollectionNode, 'id' | 'name' | 'variables'>>
  collection?: Pick<Collection, 'id' | 'name' | 'variables' | 'selectedEnvId'> | null
  environments?: Environment[]
  /** 全局环境(未选时回退第一个全局环境,与 getEnvVariablesForApi 一致) */
  globalEnvId?: string | null
}

/**
 * 按请求变量 > 集合所选环境 > 文件夹(近→远,近者覆盖)> 集合 > 全局环境的优先级,
 * 生成每个变量的最终取值及其定义来源,供 UI 提示(值 + 从哪里获取)。
 * 后写入覆盖先写入:全局 → 集合 → 文件夹(远→近)→ 集合环境 → 请求。
 */
export function resolveVariableResolutions(inputs: VariableResolutionInputs): Record<string, VariableResolution> {
  const resolutions: Record<string, VariableResolution> = {}
  const { requestVariables = [], folders = [], collection = null, environments = [] } = inputs

  const put = (key: string, value: string, source: VariableSourceKind, sourceName: string, secret: boolean) => {
    if (!key) return
    resolutions[key] = { key, value, source, sourceName, secret }
  }

  // 1) 全局环境变量(优先级最低)
  const globalEnv = environments.find(e => e.id === inputs.globalEnvId && isGlobalEnv(e))
    ?? environments.find(e => isGlobalEnv(e))
  if (globalEnv) {
    for (const v of globalEnv.variables) {
      if (v.enabled && v.key) put(v.key, v.value, 'global-env', globalEnv.name, Boolean(v.secret))
    }
  }

  // 2) 集合变量
  if (collection) {
    for (const v of collection.variables ?? []) {
      if (v.enabled && v.key) {
        put(v.key, collectionVariableValue(v, collection.selectedEnvId), 'collection', collection.name, v.secret)
      }
    }

    // 3) 祖先文件夹变量(folders 近→远,倒序写入使近者覆盖)
    for (let i = folders.length - 1; i >= 0; i--) {
      const folder = folders[i]
      for (const v of folder.variables ?? []) {
        if (v.enabled && v.key) {
          put(v.key, collectionVariableValue(v, collection.selectedEnvId), 'folder', folder.name, v.secret)
        }
      }
    }

    // 4) 部署/集合所选环境(如 BASE_PATH 定义在集合的 local 环境里)
    const selectedEnv = collection.selectedEnvId
      ? environments.find(e => e.id === collection.selectedEnvId)
      : null
    if (selectedEnv) {
      for (const v of selectedEnv.variables) {
        if (v.enabled && v.key) put(v.key, v.value, 'collection-env', selectedEnv.name, Boolean(v.secret))
      }
    }
  }

  // 5) 请求自身变量(优先级最高)
  for (const v of requestVariables) {
    if (v.enabled && v.key) put(v.key, v.value, 'request', '请求变量', false)
  }

  return resolutions
}

function isGlobalEnv(env: Environment): boolean {
  return !env.collectionId || env.collectionId === 'global'
}
