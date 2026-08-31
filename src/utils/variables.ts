import type { CollectionVariable } from '@/types'

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
