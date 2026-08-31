import { beforeEach, describe, expect, it, vi } from 'vitest'
import { createDefaultAuthConfig } from '@/utils/auth'
import type { ApiConfig, Collection, CollectionNode, ResponseData } from '@/types'

const mocks = vi.hoisted(() => ({
  sendRequest: vi.fn(),
  addHistory: vi.fn(),
  appStore: {
    apis: {} as Record<string, ApiConfig>,
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
    updateApi: vi.fn(),
  },
  workspaceStore: {
    interfaces: [] as CollectionNode[],
    collections: [] as Collection[],
    modules: [],
    categories: [],
    updateCollectionSettings: vi.fn(),
    updateInterfaceNode: vi.fn(),
    getAncestorFolders: vi.fn(() => []),
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
    mocks.appStore.apis = {}
    mocks.workspaceStore.interfaces = []
    mocks.workspaceStore.collections = []
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

  it('extracts a response value into temporary request variables', async () => {
    const api = createApi()
    api.postResponseExtractors = [{
      id: 'extract-1',
      enabled: true,
      variableName: 'accessToken',
      variableScope: 'temporary',
      source: 'response-json',
      extractMode: 'jsonpath',
      jsonPath: '$.data.token',
      unwrapArray: false,
    }]
    mocks.appStore.apis[api.id] = api
    mocks.sendRequest.mockResolvedValue(createResponse({ body: '{"data":{"token":"abc123"}}' }))

    await runApiRequest(api, { recordHistory: false })

    expect(mocks.appStore.updateApi).toHaveBeenCalledWith(api.id, {
      requestVariables: [{ key: 'accessToken', value: 'abc123', enabled: true }],
    })
  })

  it('writes collection extraction into the selected collection environment', async () => {
    const api = createApi()
    api.postResponseExtractors = [
      {
        id: 'extract-1', enabled: true, variableName: 'accessToken', variableScope: 'collection',
        source: 'response-json', extractMode: 'jsonpath', jsonPath: '$.token', unwrapArray: false,
      },
      {
        id: 'extract-2', enabled: true, variableName: 'refreshToken', variableScope: 'collection',
        source: 'response-json', extractMode: 'jsonpath', jsonPath: '$.refresh', unwrapArray: false,
      },
    ]
    const collection = {
      id: 'collection-1', name: 'Auth', order: 0, auth: createDefaultAuthConfig(), headers: [], variables: [],
      preRequestScript: '', postRequestScript: '', selectedEnvId: 'env-local', createdAt: 1, updatedAt: 1,
    }
    mocks.workspaceStore.collections = [collection]
    mocks.workspaceStore.interfaces = [{
      id: 'node-1', moduleId: collection.id, collectionId: collection.id, apiId: api.id, nodeType: 'request' as const,
      parentId: null, name: api.name, method: api.method, url: api.url, order: 0, createdAt: 1, updatedAt: 1,
    }]
    mocks.sendRequest.mockResolvedValue(createResponse({ body: '{"token":"abc123","refresh":"xyz789"}' }))

    await runApiRequest(api, { recordHistory: false })

    expect(mocks.workspaceStore.updateCollectionSettings).toHaveBeenCalledWith(collection.id, {
      variables: expect.arrayContaining([
        expect.objectContaining({ key: 'accessToken', environmentValues: { 'env-local': 'abc123' }, enabled: true }),
        expect.objectContaining({ key: 'refreshToken', environmentValues: { 'env-local': 'xyz789' }, enabled: true }),
      ]),
    })
  })
})
