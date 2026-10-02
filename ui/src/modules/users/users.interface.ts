export interface User {
  id: number
  name: string
  username: string
  admin: boolean
  otpActive: boolean
  otpLegacySecret?: boolean
  password?: string
  passwordConfirm?: string
}
