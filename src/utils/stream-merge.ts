import type { ResponseStreamChunk, StreamMergeConfig } from '@/types'

/**
 * 流式合并引擎(Phase 3.3):
 * 逐 chunk 从 SSE/NDJSON 的 JSON 载荷中按 dataPath 提取字段并拼接,
 * 例如把 OpenAI 流的 choices[0].delta.content 逐段拼成完整回答。
 */

export interface StreamMergePreset {
  id: string
  label: string
  dataPath: string
}

export const STREAM_MERGE_PRESETS: StreamMergePreset[] = [
  { id: 'openai', label: 'OpenAI(choices[0].delta.content)', dataPath: 'choices[0].delta.content' },
  { id: 'anthropic', label: 'Anthropic(delta.text)', dataPath: 'delta.text' },
  { id: 'gemini', label: 'Gemini(candidates[0].content.parts[0].text)', dataPath: 'candidates[0].content.parts[0].text' },
  { id: 'data-content', label: 'data.content', dataPath: 'data.content' },
  { id: 'content', label: 'content', dataPath: 'content' },
  { id: 'text', label: 'text', dataPath: 'text' },
]

/**
 * 思考过程(reasoning)的常见载荷路径:DeepSeek/Qwen 系用 reasoning_content,
 * OpenRouter 等用 reasoning。与正文 dataPath 独立,命中即并行累积。
 */
export const REASONING_DATA_PATHS = [
  'choices[0].delta.reasoning_content',
  'choices[0].delta.reasoning',
  'choices[0].message.reasoning_content',
  'delta.reasoning_content',
  'delta.reasoning',
] as const

export function defaultStreamMergeConfig(): StreamMergeConfig {
  return { mode: 'off', dataPath: 'data.content', separator: '', stopMarker: '[DONE]' }
}

/** 把 "a.b[0].c" 解析为 ['a', 'b', 0, 'c'] 形态的路径段 */
function parsePathTokens(path: string): Array<string | number> {
  const tokens: Array<string | number> = []
  for (const rawSegment of path.split('.')) {
    const segment = rawSegment.trim()
    if (!segment) continue
    const bracketMatches = [...segment.matchAll(/\[(\d+)\]/g)]
    const baseKey = segment.split('[')[0].trim()
    if (baseKey) tokens.push(baseKey)
    for (const match of bracketMatches) {
      tokens.push(Number(match[1]))
    }
  }
  return tokens
}

/**
 * 按 dataPath 从(可能嵌套的)JSON 数据中提取字符串值。
 * 找到返回字符串(对象/数组会 JSON 序列化),未命中返回 null。
 */
export function extractByPath(data: unknown, path: string): string | null {
  if (path.trim() === '') return null
  let current: unknown = data
  for (const token of parsePathTokens(path)) {
    if (current == null) return null
    if (typeof token === 'number') {
      if (!Array.isArray(current) || token >= current.length) return null
      current = current[token]
      continue
    }
    if (typeof current !== 'object') return null
    current = (current as Record<string, unknown>)[token]
  }
  if (current == null) return null
  if (typeof current === 'string') return current
  if (typeof current === 'number' || typeof current === 'boolean') return String(current)
  try {
    return JSON.stringify(current)
  } catch {
    return null
  }
}

/** auto 模式:按预设顺序探测首个命中的字段路径 */
export function detectAutoPath(json: unknown): string | null {
  for (const preset of STREAM_MERGE_PRESETS) {
    if (extractByPath(json, preset.dataPath) != null) return preset.dataPath
  }
  return null
}

export interface StreamMergeState {
  merged: string
  /** 思考过程(reasoning_content / reasoning)拼接结果,与正文分开累积 */
  reasoning: string
  /** 已处理的 chunk 总数 */
  chunkCount: number
  /** 实际并入结果的 chunk 数 */
  mergedCount: number
  /** 是否已遇到终止标记 */
  stopped: boolean
}

function chunkJson(chunk: ResponseStreamChunk): unknown {
  if (chunk.json !== undefined) return chunk.json
  if (chunk.type === 'ndjson') {
    try {
      return JSON.parse(chunk.data)
    } catch {
      return undefined
    }
  }
  return undefined
}

export class StreamMerger {
  private config: StreamMergeConfig
  private fragments: string[] = []
  private reasoningFragments: string[] = []
  readonly state: StreamMergeState = { merged: '', reasoning: '', chunkCount: 0, mergedCount: 0, stopped: false }

  constructor(config?: Partial<StreamMergeConfig> | null) {
    this.config = { ...defaultStreamMergeConfig(), ...(config ?? {}) }
  }

  /** 逐 chunk 喂入,增量维护合并结果;返回当前累计文本 */
  push(chunk: ResponseStreamChunk): string {
    this.state.chunkCount += 1
    if (this.config.mode === 'off' || this.state.stopped) return this.state.merged

    const stopMarker = this.config.stopMarker?.trim()
    if (stopMarker && chunk.data.trim() === stopMarker) {
      this.state.stopped = true
      return this.state.merged
    }

    if (this.config.eventFilter && (chunk.event ?? 'message') !== this.config.eventFilter) {
      return this.state.merged
    }

    let extracted: string | null = null
    if (this.config.mode === 'custom') {
      const json = chunkJson(chunk)
      if (json === undefined) return this.state.merged
      extracted = extractByPath(json, this.config.dataPath)
      this.extractReasoning(json)
    } else {
      // auto:每个 chunk 独立探测(不同 chunk 结构可能不同)
      const json = chunkJson(chunk)
      if (json === undefined) {
        // 非 JSON 载荷直接并入(SSE 纯文本流)
        extracted = chunk.data || null
      } else {
        const path = detectAutoPath(json)
        extracted = path ? extractByPath(json, path) : null
        this.extractReasoning(json)
      }
    }

    if (extracted != null) {
      this.fragments.push(extracted)
      this.state.mergedCount += 1
      this.state.merged = this.fragments.join(this.config.separator ?? '')
    }
    return this.state.merged
  }

  /** 尝试从 chunk JSON 提取思考过程片段,命中则并行累积(不影响正文合并) */
  private extractReasoning(json: unknown): void {
    for (const path of REASONING_DATA_PATHS) {
      const value = extractByPath(json, path)
      if (value != null) {
        this.reasoningFragments.push(value)
        this.state.reasoning = this.reasoningFragments.join(this.config.separator ?? '')
        return
      }
    }
  }
}

/** 一次性对完整 chunk 数组求合并状态(历史回放/重算用):正文 + 思考过程 */
export function mergeChunkState(chunks: ResponseStreamChunk[], config?: Partial<StreamMergeConfig> | null): StreamMergeState {
  const merger = new StreamMerger(config)
  for (const chunk of chunks) merger.push(chunk)
  return merger.state
}

/** 一次性对完整 chunk 数组求合并正文(历史回放/重算用) */
export function mergeChunks(chunks: ResponseStreamChunk[], config?: Partial<StreamMergeConfig> | null): string {
  return mergeChunkState(chunks, config).merged
}
