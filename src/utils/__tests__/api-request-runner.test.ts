import { beforeEach, describe, expect, it, vi } from 'vitest'
import { createDefaultAuthConfig } from '@/utils/auth'
import type { ApiConfig, ResponseData } from '@/types'

const mocks = vi.hoisted(() => ({
  sendRequest: vi.fn(),
  addHistory: vi.fn(),
  appStore: {
    apis: {},
    environments: [],
    currentEnvId: null,
    settings: { corsMode: 'cors' as const, proxyUrl: '' },
    autoCarryCookies: false,
    scriptLogs: [],
    scriptVisualizations: [],
    scriptTests: [],
    getEnvVariablesForApi: vi.fn(() => ({})),
    isGlobalEnv: vi.fn(() => false),
    addHistory: vi.fn(),
    upsertEnvironment: vi.fn(),
  },
  workspaceStore: {
    interfaces: [],
    collections: [],
    modules: [],
    categories: [],
    updateCollectionSettings: vi.fn(),
  },
}))

mocks.appStore.addHistory = mocks.addHistory

vi.mock('@/utils/http', () => ({ sendRequest: mocks.sendRequest }))
vi.mock('@/stores/app', () => ({ useAppStore: () => mocks.appStore }))
vi.mock('@/stores/workspace', () => ({ useWorkspaceStore: () => mocks.workspaceStore }))

import { runApiRequest } from '@/utils/api-request-runner'

function createApi(): ApiConfig {
  const now = Date.now()
  return {
    id: 'api-1',
    name: 'Test API',
    method: 'POST',
    url: 'https://example.com/events',
    headers: [],
    params: [],
    cookies: [],
    body: {
      type: 'json',
      raw: '{}',
      formData: [],
      urlEncoded: [],
      binaryFile: null,
      contentType: 'application/json',
    },
    auth: createDefaultAuthConfig(),
    preRequestScript: '',
    postRequestScript: '',
    folder: null,
    createdAt: now,
    updatedAt: now,
  }
}

function createResponse(overrides: Partial<ResponseData> = {}): ResponseData {
  return {
    status: 200,
    statusText: 'OK',
    headers: {},
    body: 'done',
    duration: 10,
    size: 4,
    url: 'https://example.com/events',
    method: 'POST',
    requestHeaders: {},
    requestBody: '{}',
    timestamp: Date.now(),
    ...overrides,
  }
}

describe('runApiRequest', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    mocks.sendRequest.mockResolvedValue(createResponse())
  })

  it('forwards cancellation and streaming updates to the HTTP transport', async () => {
    const controller = new AbortController()
    const onStreamingUpdate = vi.fn()

    await runApiRequest(createApi(), {
      signal: controller.signal,
      onStreamingUpdate,
      recordHistory: false,
    })

    expect(mocks.sendRequest).toHaveBeenCalledWith(expect.objectContaining({
      signal: controller.signal,
      onStreamingUpdate,
    }))
    expect(mocks.addHistory).not.toHaveBeenCalled()
  })

  it('records completed stream metadata by default', async () => {
    mocks.sendRequest.mockResolvedValue(createResponse({
      body: 'data: hello',
      chunks: [{ id: 'chunk-1', type: 'sse', event: 'message', data: 'hello', raw: 'data: hello', timestamp: Date.now() }],
      mergedText: 'hello',
      mergedReasoning: 'thinking',
    }))

    await runApiRequest(createApi())

    expect(mocks.addHistory).toHaveBeenCalledWith(expect.objectContaining({
      apiId: 'api-1',
      requestType: 'sse',
      mergedText: 'hello',
      mergedReasoning: 'thinking',
      rawPreview: 'data: hello',
    }))
  })
})
