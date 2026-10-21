import { describe, expect, it } from 'vitest'

import { MobileDetectService } from '@/core/utilities/mobile-detect'

/**
 * The service that tells the app what browser it runs in.
 *
 * It no longer locks touch scrolling: a `touchmove` listener cancelling every
 * move also froze the editors it was meant to protect, and only a UA sniff
 * decided when it applied. `overscroll-behavior` in CSS does the job now.
 */
describe('mobileDetectService', () => {
  it('reads the browser it is running in', () => {
    // Everything the app asks it is a question about this
    const service = new MobileDetectService()

    expect(service.detect).toBeDefined()
    expect(typeof service.detect.mobile).toBe('function')
  })

  it('leaves touch scrolling alone', () => {
    const service = new MobileDetectService() as unknown as Record<string, unknown>

    expect(service.disableTouchMove).toBeUndefined()
    expect(service.enableTouchMove).toBeUndefined()
  })
})
