import { randomInt } from 'node:crypto'

/**
 * Generates a new random HomeKit setup pin, e.g. `031-45-154`
 */
export function generatePin(): string {
  const digits = `${randomInt(10000000, 100000000)}`.split('')
  digits.splice(3, 0, '-')
  digits.splice(6, 0, '-')
  return digits.join('')
}

/**
 * Generates a new random bridge username (a MAC-style id), e.g. `0E:3C:A1:7F:22:9B`
 */
export function generateUsername(): string {
  const hexDigits = '0123456789ABCDEF'
  let username = '0E:'
  for (let i = 0; i < 5; i += 1) {
    username += hexDigits.charAt(randomInt(0, 16))
    username += hexDigits.charAt(randomInt(0, 16))
    if (i !== 4) {
      username += ':'
    }
  }
  return username
}
