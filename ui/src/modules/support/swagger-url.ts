import { environment } from '@/environments/environment'

const swaggerEndpoint = '/swagger'

/** The API docs: in development mode, point to the backend server directly. */
export function swaggerUrl(): string {
  return environment.production
    ? swaggerEndpoint
    : `${environment.api.origin}${swaggerEndpoint}`
}
