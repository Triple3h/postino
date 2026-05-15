export function resolveTemplateVars(str: string, envVars: Record<string, unknown>): string {
  if (typeof str !== 'string') return str
  return str.replace(/\{\{([^}]+)\}\}/g, (match, expr: string) => {
    const parts = expr.split(':')
    const key = parts[0].trim()
    const defaultVal = parts.length > 1 ? parts.slice(1).join(':').trim() : match
    if (Object.prototype.hasOwnProperty.call(envVars, key)) {
      return String(envVars[key])
    }
    return defaultVal
  })
}

export function resolveObject<T extends Record<string, unknown>>(obj: T, envVars: Record<string, unknown>): T {
  const result = { ...obj }
  for (const key of Object.keys(result)) {
    if (typeof result[key] === 'string') {
      (result as any)[key] = resolveTemplateVars(result[key] as string, envVars)
    }
  }
  return result
}
