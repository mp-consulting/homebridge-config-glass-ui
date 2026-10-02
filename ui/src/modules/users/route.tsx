import type { User } from './users.interface'

import { Users } from './Users'
import { usersLoader } from './users.loader'

/** `/users` (guard: `requireAdmin`, owned by the router), with the list resolved by the loader. */
export function Component() {
  return <Users />
}

/** The Angular `usersResolver`. */

export async function loader(): Promise<User[] | Response> {
  return usersLoader()
}
