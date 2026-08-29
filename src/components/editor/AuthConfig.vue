<script setup lang="ts">
import { computed, ref } from 'vue'
import { X } from '@lucide/vue'
import type { AuthConfig } from '@/types'

const props = defineProps<{
  modelValue: AuthConfig
  readonly?: boolean
  /** 显示"继承父级"选项(集合树内节点使用;集合根设置不显示) */
  allowInherit?: boolean
}>()

const emit = defineEmits<{
  'update:modelValue': [value: AuthConfig]
}>()

const auth = computed({
  get: () => props.modelValue,
  set: (val) => emit('update:modelValue', val),
})

const authTypes: { value: AuthConfig['type']; label: string }[] = [
  ...(props.allowInherit ? [{ value: 'inherit' as const, label: '继承父级(集合/文件夹)' }] : []),
  { value: 'none', label: '无认证' },
  { value: 'bearer', label: 'Bearer Token' },
  { value: 'basic', label: 'Basic Auth' },
  { value: 'digest', label: 'Digest Auth' },
  { value: 'oauth2', label: 'OAuth 2.0' },
  { value: 'apikey', label: 'API Key' },
]

const oauth2GrantTypes: { value: AuthConfig['oauth2GrantType']; label: string }[] = [
  { value: 'authorization_code', label: 'Authorization Code' },
  { value: 'client_credentials', label: 'Client Credentials' },
  { value: 'password', label: 'Password' },
]

const oauth2Fetching = ref(false)
const oauth2Error = ref('')

function update(partial: Partial<AuthConfig>) {
  if (props.readonly) return
  emit('update:modelValue', { ...props.modelValue, ...partial })
}

async function fetchOAuth2Token() {
  const a = props.modelValue
  if (!a.oauth2AccessTokenUrl || !a.oauth2ClientId) {
    oauth2Error.value = '请填写 Access Token URL 和 Client ID'
    return
  }

  oauth2Fetching.value = true
  oauth2Error.value = ''

  try {
    const bodyParams: Record<string, string> = {
      grant_type: a.oauth2GrantType,
      client_id: a.oauth2ClientId,
    }

    if (a.oauth2ClientSecret) {
      bodyParams.client_secret = a.oauth2ClientSecret
    }
    if (a.oauth2Scope) {
      bodyParams.scope = a.oauth2Scope
    }
    if (a.oauth2GrantType === 'password') {
      if (!a.oauth2Username) {
        oauth2Error.value = 'Password 授权模式需要填写用户名'
        oauth2Fetching.value = false
        return
      }
      bodyParams.username = a.oauth2Username
      bodyParams.password = a.oauth2Password
    }

    const formBody = Object.entries(bodyParams)
      .map(([k, v]) => `${encodeURIComponent(k)}=${encodeURIComponent(v)}`)
      .join('&')

    const headers: Record<string, string> = {
      'Content-Type': 'application/x-www-form-urlencoded',
    }

    const resp = await fetch(a.oauth2AccessTokenUrl, {
      method: 'POST',
      headers,
      body: formBody,
    })

    const data = await resp.json()

    if (data.access_token) {
      update({ oauth2Token: data.access_token })
      oauth2Error.value = ''
    } else {
      oauth2Error.value = data.error_description || data.error || '获取 Token 失败'
    }
  } catch (err: any) {
    oauth2Error.value = err.message || '请求 Token 失败'
  } finally {
    oauth2Fetching.value = false
  }
}
</script>

<template>
  <div class="auth-config">
    <div class="auth-type-select">
      <label>认证类型</label>
      <select :value="auth.type" :disabled="readonly" @change="update({ type: ($event.target as HTMLSelectElement).value as AuthConfig['type'] })">
        <option v-for="t in authTypes" :key="t.value" :value="t.value">{{ t.label }}</option>
      </select>
    </div>

    <div v-if="auth.type === 'bearer'" class="auth-fields">
      <div class="field">
        <label>Token</label>
        <input type="text" :value="auth.bearerToken" :disabled="readonly" @input="update({ bearerToken: ($event.target as HTMLInputElement).value })" placeholder="输入 Bearer Token" />
      </div>
      <div class="field-hint">
        将发送 <code>Authorization: Bearer {{ auth.bearerToken || 'token' }}</code>
      </div>
    </div>

    <div v-if="auth.type === 'basic'" class="auth-fields">
      <div class="field">
        <label>用户名</label>
        <input type="text" :value="auth.basicUsername" :disabled="readonly" @input="update({ basicUsername: ($event.target as HTMLInputElement).value })" placeholder="用户名" />
      </div>
      <div class="field">
        <label>密码</label>
        <input type="text" :value="auth.basicPassword" :disabled="readonly" @input="update({ basicPassword: ($event.target as HTMLInputElement).value })" placeholder="密码" />
      </div>
    </div>

    <div v-if="auth.type === 'digest'" class="auth-fields">
      <div class="field">
        <label>用户名</label>
        <input type="text" :value="auth.digestUsername" :disabled="readonly" @input="update({ digestUsername: ($event.target as HTMLInputElement).value })" placeholder="用户名" />
      </div>
      <div class="field">
        <label>密码</label>
        <input type="text" :value="auth.digestPassword" :disabled="readonly" @input="update({ digestPassword: ($event.target as HTMLInputElement).value })" placeholder="密码" />
      </div>
      <div class="field-hint">
        将自动处理 Digest 认证挑战-响应流程
      </div>
    </div>

    <div v-if="auth.type === 'oauth2'" class="auth-fields">
      <div class="field">
        <label>授权类型</label>
        <select :value="auth.oauth2GrantType" :disabled="readonly" @change="update({ oauth2GrantType: ($event.target as HTMLSelectElement).value as AuthConfig['oauth2GrantType'] })">
          <option v-for="g in oauth2GrantTypes" :key="g.value" :value="g.value">{{ g.label }}</option>
        </select>
      </div>
      <div class="field">
        <label>Token URL</label>
        <input type="text" :value="auth.oauth2AccessTokenUrl" :disabled="readonly" @input="update({ oauth2AccessTokenUrl: ($event.target as HTMLInputElement).value })" placeholder="Access Token URL" />
      </div>
      <div class="field">
        <label>Client ID</label>
        <input type="text" :value="auth.oauth2ClientId" :disabled="readonly" @input="update({ oauth2ClientId: ($event.target as HTMLInputElement).value })" placeholder="Client ID" />
      </div>
      <div class="field">
        <label>Client Secret</label>
        <input type="text" :value="auth.oauth2ClientSecret" :disabled="readonly" @input="update({ oauth2ClientSecret: ($event.target as HTMLInputElement).value })" placeholder="Client Secret" />
      </div>
      <div v-if="auth.oauth2GrantType === 'password'" class="field">
        <label>用户名</label>
        <input type="text" :value="auth.oauth2Username" :disabled="readonly" @input="update({ oauth2Username: ($event.target as HTMLInputElement).value })" placeholder="资源所有者用户名" />
      </div>
      <div v-if="auth.oauth2GrantType === 'password'" class="field">
        <label>密码</label>
        <input type="text" :value="auth.oauth2Password" :disabled="readonly" @input="update({ oauth2Password: ($event.target as HTMLInputElement).value })" placeholder="资源所有者密码" />
      </div>
      <div class="field">
        <label>Scope</label>
        <input type="text" :value="auth.oauth2Scope" :disabled="readonly" @input="update({ oauth2Scope: ($event.target as HTMLInputElement).value })" placeholder="可选，空格分隔的权限范围" />
      </div>
      <div v-if="auth.oauth2GrantType === 'authorization_code'" class="field-hint">
        Authorization Code 模式：请手动粘贴已获取的 Access Token，或使用下方按钮刷新
      </div>
      <div v-if="auth.oauth2GrantType !== 'authorization_code'" class="auth-actions">
        <button class="btn-fetch-token" :disabled="readonly || oauth2Fetching" @click="fetchOAuth2Token">
          {{ oauth2Fetching ? '获取中...' : '获取 Token' }}
        </button>
      </div>
      <div v-if="oauth2Error" class="field-error">{{ oauth2Error }}</div>
      <div class="field">
        <label>Access Token</label>
        <div class="token-field">
          <input type="text" :value="auth.oauth2Token" :disabled="readonly" @input="update({ oauth2Token: ($event.target as HTMLInputElement).value })" placeholder="手动输入或自动获取的 Token" />
          <button v-if="auth.oauth2Token" class="btn-clear-token" :disabled="readonly" @click="update({ oauth2Token: '' })" title="清除 Token"><X :size="14" /></button>
        </div>
      </div>
      <div v-if="auth.oauth2Token" class="field-hint">
        将发送 <code>Authorization: Bearer {{ auth.oauth2Token.substring(0, 12) }}{{ auth.oauth2Token.length > 12 ? '...' : '' }}</code>
      </div>
    </div>

    <div v-if="auth.type === 'apikey'" class="auth-fields">
      <div class="field">
        <label>Key 名称</label>
        <input type="text" :value="auth.apiKeyName" :disabled="readonly" @input="update({ apiKeyName: ($event.target as HTMLInputElement).value })" placeholder="Header 或 Query 参数名" />
      </div>
      <div class="field">
        <label>Key 值</label>
        <input type="text" :value="auth.apiKeyValue" :disabled="readonly" @input="update({ apiKeyValue: ($event.target as HTMLInputElement).value })" placeholder="API Key 值" />
      </div>
      <div class="field">
        <label>添加到</label>
        <select :value="auth.apiKeyIn" :disabled="readonly" @change="update({ apiKeyIn: ($event.target as HTMLSelectElement).value as AuthConfig['apiKeyIn'] })">
          <option value="header">Header</option>
          <option value="query">Query 参数</option>
        </select>
      </div>
    </div>
  </div>
</template>

<style scoped>
.auth-config {
  padding: 8px 0;
}

.auth-type-select {
  display: flex;
  align-items: center;
  gap: 12px;
  margin-bottom: 12px;
}

.auth-type-select label {
  font-size: var(--font-size-body);
  color: var(--text-secondary);
  min-width: 70px;
}

.auth-type-select select {
  font-size: var(--font-size-body);
  min-height: 34px;
}

.auth-fields {
  display: flex;
  flex-direction: column;
  gap: 8px;
}

.field {
  display: flex;
  align-items: center;
  gap: 12px;
}

.field label {
  font-size: var(--font-size-body);
  color: var(--text-secondary);
  min-width: 70px;
}

.field input,
.field select {
  flex: 1;
  min-height: 34px;
  font-size: var(--font-size-body);
}

.field input:focus,
.field select:focus {
  border-color: var(--primary);
}

.field-hint {
  padding-left: 82px;
  font-size: var(--font-size-small);
  color: var(--text-tertiary);
}

.field-hint code {
  background: var(--bg-code);
  padding: 1px 4px;
  border-radius: 2px;
  font-family: var(--font-code);
  font-size: var(--font-size-small);
}

.auth-actions {
  padding-left: 82px;
  margin-top: 4px;
}

.btn-fetch-token {
  font-size: var(--font-size-body);
  min-height: 32px;
  padding: 0 16px;
  border-radius: 4px;
  border: 1px solid var(--primary);
  background: var(--primary);
  color: #fff;
  cursor: pointer;
  transition: opacity 0.15s;
}

.btn-fetch-token:hover:not(:disabled) {
  opacity: 0.85;
}

.btn-fetch-token:disabled {
  opacity: 0.5;
  cursor: not-allowed;
}

.token-field {
  flex: 1;
  display: flex;
  align-items: center;
  gap: 4px;
}

.token-field input {
  flex: 1;
  min-height: 34px;
  font-size: var(--font-size-body);
}

.btn-clear-token {
  flex-shrink: 0;
  width: 28px;
  height: 28px;
  border: 1px solid var(--border-color);
  border-radius: 4px;
  background: var(--bg-secondary);
  color: var(--text-secondary);
  cursor: pointer;
  font-size: 16px;
  line-height: 1;
  display: flex;
  align-items: center;
  justify-content: center;
  transition: background 0.15s;
}

.btn-clear-token:hover:not(:disabled) {
  background: var(--bg-tertiary);
}

.btn-clear-token:disabled {
  opacity: 0.4;
  cursor: not-allowed;
}

.field-error {
  padding-left: 82px;
  font-size: var(--font-size-small);
  color: #e53e3e;
}
</style>
