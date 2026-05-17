import type { AuthConfig } from '@/types'

export function createDefaultAuthConfig(): AuthConfig {
  return {
    type: 'none',
    bearerToken: '',
    basicUsername: '',
    basicPassword: '',
    apiKeyName: '',
    apiKeyValue: '',
    apiKeyIn: 'header',
    digestUsername: '',
    digestPassword: '',
    oauth2GrantType: 'authorization_code',
    oauth2AccessTokenUrl: '',
    oauth2ClientId: '',
    oauth2ClientSecret: '',
    oauth2Scope: '',
    oauth2Token: '',
    oauth2Username: '',
    oauth2Password: '',
  }
}

export function normalizeAuthConfig(auth?: Partial<AuthConfig> | null): AuthConfig {
  return {
    ...createDefaultAuthConfig(),
    ...(auth || {}),
    type: auth?.type || 'none',
    apiKeyIn: auth?.apiKeyIn === 'query' ? 'query' : 'header',
    oauth2GrantType: auth?.oauth2GrantType || 'authorization_code',
  }
}
