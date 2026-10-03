import type { User } from './users.interface'

import { redirect } from 'react-router'

import { api } from '@/core/api'
import { toastApiError } from '@/core/utilities/http-error'

/** The Angular `usersResolver`: load the list before the page opens; on failure, toast and go home. */
export async function usersLoader(): Promise<User[] | Response> {
  try {
    return await api.get<User[]>('/users')
  } catch (error) {
    console.error(error)
    toastApiError(error)
    return redirect('/')
  }
}
