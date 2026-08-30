import { describe, expect, it } from 'vitest'
import { StreamMerger, extractByPath, mergeChunkState, mergeChunks, REASONING_DATA_PATHS, STREAM_MERGE_PRESETS } from '@/utils/stream-merge'
import type { ResponseStreamChunk } from '@/types'

function sseChunk(data: string, event?: string): ResponseStreamChunk {
  // 真实管线中 http.ts 会把 SSE data 字段预解析进 chunk.json,这里保持一致
  let json: unknown
  try { json = JSON.parse(data) } catch { json = undefined }
  return { id: `${Math.random()}`, type: 'sse', raw: data, data, event, json, timestamp: 0 }
}

describe('extractByPath', () => {
  it('支持 a.b.c 点路径', () => {
    expect(extractByPath({ data: { content: 'hello' } }, 'data.content')).toBe('hello')
  })

  it('支持 a[0].b 括号路径', () => {
    expect(extractByPath({ choices: [{ delta: { content: 'x' } }] }, 'choices[0].delta.content')).toBe('x')
  })

  it('未命中返回 null', () => {
    expect(extractByPath({ a: 1 }, 'a.b.c')).toBeNull()
    expect(extractByPath(null, 'a')).toBeNull()
    expect(extractByPath({ a: 1 }, '')).toBeNull()
  })

  it('对象命中时 JSON 序列化', () => {
    expect(extractByPath({ data: { a: 1 } }, 'data')).toBe('{"a":1}')
  })
})

describe('StreamMerger', () => {
  it('mode=off 不产出内容', () => {
    const merger = new StreamMerger({ mode: 'off', dataPath: 'text' })
    expect(merger.push(sseChunk(JSON.stringify({ text: 'a' })))).toBe('')
  })

  it('custom 模式按 dataPath 拼接片段', () => {
    const merger = new StreamMerger({ mode: 'custom', dataPath: 'choices[0].delta.content' })
    merger.push(sseChunk(JSON.stringify({ choices: [{ delta: { content: '你' } }] })))
    merger.push(sseChunk(JSON.stringify({ choices: [{ delta: { content: '好' } }] })))
    expect(merger.state.merged).toBe('你好')
    expect(merger.state.mergedCount).toBe(2)
  })

  it('custom 模式支持自定义分隔符', () => {
    const merger = new StreamMerger({ mode: 'custom', dataPath: 'text', separator: '\n' })
    merger.push(sseChunk(JSON.stringify({ text: 'a' })))
    merger.push(sseChunk(JSON.stringify({ text: 'b' })))
    expect(merger.state.merged).toBe('a\nb')
  })

  it('auto 模式按预设顺序探测(OpenAI 路径)', () => {
    const merger = new StreamMerger({ mode: 'auto', dataPath: '' })
    merger.push(sseChunk(JSON.stringify({ choices: [{ delta: { content: 'hi' } }] })))
    expect(merger.state.merged).toBe('hi')
  })

  it('终止标记不并入结果且停止追加', () => {
    const merger = new StreamMerger({ mode: 'custom', dataPath: 'text', stopMarker: '[DONE]' })
    merger.push(sseChunk(JSON.stringify({ text: 'a' })))
    merger.push(sseChunk('[DONE]'))
    merger.push(sseChunk(JSON.stringify({ text: 'b' })))
    expect(merger.state.merged).toBe('a')
    expect(merger.state.stopped).toBe(true)
  })

  it('eventFilter 过滤非目标事件', () => {
    const merger = new StreamMerger({ mode: 'custom', dataPath: 'text', eventFilter: 'message' })
    merger.push(sseChunk(JSON.stringify({ text: 'keep' }), 'message'))
    merger.push(sseChunk(JSON.stringify({ text: 'drop' }), 'ping'))
    expect(merger.state.merged).toBe('keep')
  })

  it('auto 模式非 JSON 载荷按纯文本并入', () => {
    const merger = new StreamMerger({ mode: 'auto', dataPath: '' })
    merger.push({ id: 'x', type: 'sse', raw: 'plain', data: 'plain text', timestamp: 0 })
    expect(merger.state.merged).toBe('plain text')
  })
})

describe('mergeChunks', () => {
  it('一次性合并完整 chunk 数组', () => {
    const chunks = [
      sseChunk(JSON.stringify({ data: { content: 'x' } })),
      sseChunk(JSON.stringify({ data: { content: 'y' } })),
    ]
    expect(mergeChunks(chunks, { mode: 'custom', dataPath: 'data.content' })).toBe('xy')
  })
})

describe('思考过程(reasoning)提取', () => {
  const openaiReasoningChunk = (reasoning?: string, content?: string) => {
    const delta: Record<string, string> = {}
    if (reasoning !== undefined) delta.reasoning_content = reasoning
    if (content !== undefined) delta.content = content
    return sseChunk(JSON.stringify({ choices: [{ delta }] }))
  }

  it('auto 模式:reasoning_content 与正文分开累积', () => {
    const state = mergeChunkState([
      openaiReasoningChunk('让我想想'),
      openaiReasoningChunk(',先分析'),
      openaiReasoningChunk(undefined, '答案是'),
      openaiReasoningChunk(undefined, ' 42'),
    ], { mode: 'auto', dataPath: '' })
    expect(state.reasoning).toBe('让我想想,先分析')
    expect(state.merged).toBe('答案是 42')
  })

  it('custom 模式同样并行提取 reasoning', () => {
    const state = mergeChunkState([
      openaiReasoningChunk('思考中'),
      openaiReasoningChunk(undefined, '正文'),
    ], { mode: 'custom', dataPath: 'choices[0].delta.content' })
    expect(state.reasoning).toBe('思考中')
    expect(state.merged).toBe('正文')
  })

  it('OpenRouter 风格 delta.reasoning 也可命中', () => {
    const state = mergeChunkState([
      sseChunk(JSON.stringify({ choices: [{ delta: { reasoning: 'think', content: 'ans' } }] })),
    ], { mode: 'auto', dataPath: '' })
    expect(state.reasoning).toBe('think')
    expect(state.merged).toBe('ans')
  })

  it('普通 OpenAI 流(无 reasoning 字段)reasoning 保持为空', () => {
    const state = mergeChunkState([
      openaiReasoningChunk(undefined, 'hi'),
      sseChunk('[DONE]'),
    ], { mode: 'auto', dataPath: '' })
    expect(state.reasoning).toBe('')
    expect(state.merged).toBe('hi')
    expect(state.stopped).toBe(true)
  })

  it('mode=off 不提取 reasoning', () => {
    const merger = new StreamMerger({ mode: 'off', dataPath: 'text' })
    merger.push(openaiReasoningChunk('think'))
    expect(merger.state.reasoning).toBe('')
  })

  it('内置 reasoning 路径均可被 extractByPath 解析命中', () => {
    const samples: unknown[] = [
      { choices: [{ delta: { reasoning_content: 'a' } }] },
      { choices: [{ delta: { reasoning: 'b' } }] },
      { choices: [{ message: { reasoning_content: 'c' } }] },
      { delta: { reasoning_content: 'd' } },
      { delta: { reasoning: 'e' } },
    ]
    samples.forEach((sample, index) => {
      expect(extractByPath(sample, REASONING_DATA_PATHS[index])).not.toBeNull()
    })
  })
})

describe('STREAM_MERGE_PRESETS', () => {
  it('内置预设可被 extractByPath 解析命中', () => {
    const samples: Array<Record<string, unknown>> = [
      { choices: [{ delta: { content: 'a' } }] },
      { delta: { text: 'b' } },
      { candidates: [{ content: { parts: [{ text: 'c' }] } }] },
      { data: { content: 'd' } },
      { content: 'e' },
      { text: 'f' },
    ]
    samples.forEach((sample, index) => {
      expect(extractByPath(sample, STREAM_MERGE_PRESETS[index].dataPath)).not.toBeNull()
    })
  })
})
