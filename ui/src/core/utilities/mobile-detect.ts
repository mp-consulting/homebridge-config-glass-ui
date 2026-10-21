import MobileDetect from 'mobile-detect'

/**
 * The browser the app runs in.
 *
 * It used to lock touch scrolling (a `touchmove` listener cancelling every
 * move) while an editor page was open. CSS does that job now without blocking
 * the editors' own scrolling: `overscroll-behavior` keeps a scroll from
 * chaining out of an editor, a dialog or a menu into the page behind it
 * (base/layout.scss).
 */
export class MobileDetectService {
  public detect: MobileDetect

  constructor() {
    this.detect = new MobileDetect(window.navigator.userAgent)
  }
}

export const mobileDetect = new MobileDetectService()
