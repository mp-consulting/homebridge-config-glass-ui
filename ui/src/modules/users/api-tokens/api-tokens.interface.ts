export type ApiTokenScope = 'read' | 'admin'

/** A token as `GET /auth/tokens` lists it (never its value) */
export interface ApiToken {
  id: string
  name: string
  scope: ApiTokenScope
  createdAt: string
  expiresAt: string | null
  lastUsedAt: string | null
  createdBy?: string
}

/** `POST /auth/tokens`: the one response that carries the token itself */
export interface CreatedApiToken {
  id: string
  name: string
  scope: ApiTokenScope
  token: string
  createdAt: string
  expiresAt: string | null
}
