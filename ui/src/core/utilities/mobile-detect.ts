import MobileDetect from 'mobile-detect'

function preventDefault(e: Event) {
  e.preventDefault()
}

/** The browser the app runs in, and the touch-scroll lock modals take on a phone. */
export class MobileDetectService {
  public detect: MobileDetect
  public isTouchMoveLocked = false

  constructor() {
    this.detect = new MobileDetect(window.navigator.userAgent)
  }

  public disableTouchMove() {
    if (!this.isTouchMoveLocked) {
      document.body.addEventListener('touchmove', preventDefault, { passive: false })
      this.isTouchMoveLocked = true
    }
  }

  public enableTouchMove() {
    document.body.removeEventListener('touchmove', preventDefault)
    this.isTouchMoveLocked = false
  }
}

export const mobileDetect = new MobileDetectService()
