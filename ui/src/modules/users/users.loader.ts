import type { User } from './users.interface'

import { redirect } from 'react-router'

import { api } from '@/core/api'
import { i18n } from '@/core/ui/i18n'
import { toast } from '@/core/ui/toast'
import { toToastMessage } from '@/core/utilities/http-error'

/** The Angular `usersResolver`: load the list before the page opens; on failure, toast and go home. */
export async function usersLoader(): Promise<User[] | Response> {
  try {
    return await api.get<User[]>('/users')
  } catch (error) {
    console.error(error)
    toast.error(toToastMessage(error), i18n.t('toast.title_error'))
    return redirect('/')
  }
}
