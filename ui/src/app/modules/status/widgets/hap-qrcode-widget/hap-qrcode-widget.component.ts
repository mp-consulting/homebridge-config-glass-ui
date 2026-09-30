import { ChangeDetectionStrategy, Component, DestroyRef, ElementRef, inject, input, OnDestroy, OnInit, signal, viewChild } from '@angular/core'
import { takeUntilDestroyed } from '@angular/core/rxjs-interop'
import { TranslatePipe } from '@ngx-translate/core'
import { Subject } from 'rxjs'

import { AuthService } from '@/app/core/auth/auth.service'
import { IoNamespace, WsService } from '@/app/core/communication/ws.service'
import { QrcodeComponent } from '@/app/core/components/qrcode/qrcode.component'
import { HomebridgeStatusResponse } from '@/app/core/server.interfaces'
import { Widget } from '@/app/modules/status/widgets/widgets.interfaces'

@Component({
  selector: 'app-hap-qrcode-widget',
  imports: [
    QrcodeComponent,
    TranslatePipe,
  ],
  standalone: true,
  templateUrl: './hap-qrcode-widget.component.html',
  styleUrl: './hap-qrcode-widget.component.scss',
  changeDetection: ChangeDetectionStrategy.OnPush,
})
export class HapQrcodeWidgetComponent implements OnInit, OnDestroy {
  // Injected dependencies
  private destroyRef = inject(DestroyRef)
  private $ws = inject(WsService)
  private $auth = inject(AuthService)

  // Pairing codes are admin-only: the server leaves the pin and setup code out for
  // everyone else, so those users get a notice instead of an empty code area
  public readonly isAdmin = this.$auth.user.admin

  // Inputs (set by the dashboard's dynamic widget loader via setInput)
  public readonly widget = input.required<Widget>()

  // Signals
  readonly pincodeElement = viewChild<ElementRef>('pincode')
  readonly qrcodeContainerElement = viewChild<ElementRef>('qrcodecontainer')
  public readonly enabled = signal<boolean>(true)
  /**
   * True when the main bridge is in HAP externalsOnly mode — the bridge
   * accessory itself isn't published, but plugins may still publish external
   * HAP accessories. The widget hides the QR/PIN and shows an externalsOnly
   * notice instead, since there's no main bridge to pair.
   */
  public readonly externalsOnly = signal<boolean>(false)
  public readonly loading = signal<boolean>(true)
  public readonly paired = signal<boolean>(false)
  public readonly pin = signal<string>('')
  public readonly setupUri = signal<string | null>(null)
  public readonly qrCodeHeight = signal<number>(0)
  public readonly qrCodeWidth = signal<number>(0)
  public readonly pinCopied = signal<boolean>(false)

  // Other properties
  private io!: IoNamespace
  private statusHandler!: (data: HomebridgeStatusResponse) => void
  resizeEvent!: Subject<void> // Set directly by ComponentFactoryResolver

  public ngOnInit(): void {
    this.io = this.$ws.getExistingNamespace('status')

    this.statusHandler = (data: HomebridgeStatusResponse) => {
      this.applyHapStatus(data)
      this.scheduleResize()
    }

    this.io.socket.on('homebridge-status', this.statusHandler)

    // Subscribe to grid resize events
    this.resizeEvent.pipe(takeUntilDestroyed(this.destroyRef)).subscribe(() => {
      this.resizeQrCode()
    })

    // Fetch initial data if already connected - defer to avoid NG0100
    if (this.io.socket.connected) {
      queueMicrotask(() => this.getPairingPin())
    }
  }

  private applyHapStatus(data: HomebridgeStatusResponse): void {
    // HAP defaults to enabled when the status payload doesn't carry the flag.
    // externalsOnly is only meaningful when the bridge accessory is not being
    // published — in that mode we hide the QR/PIN since there's nothing to pair.
    const hapEnabled = data.hap ? data.hap.enabled : true
    const externalsOnly = data.hap?.externalsOnly === true
    this.enabled.set(hapEnabled)
    this.externalsOnly.set(externalsOnly)
    if (hapEnabled && !externalsOnly) {
      this.pin.set(data.pin)
      this.paired.set(data.paired)
      if (data.setupUri) {
        this.setupUri.set(data.setupUri)
      }
    } else {
      this.pin.set('')
      this.paired.set(false)
      this.setupUri.set(null)
    }
    this.loading.set(false)
  }

  public ngOnDestroy(): void {
    if (this.io && this.statusHandler) {
      this.io.socket.off('homebridge-status', this.statusHandler)
    }
    this.destroyed = true
    if (this.resizeFrame !== null) {
      cancelAnimationFrame(this.resizeFrame)
      this.resizeFrame = null
    }
  }

  /**
   * Copy the setup code, for pairing by typing it into the Home app instead of scanning.
   * The button shows a tick for a moment as confirmation.
   */
  public async copyPin(): Promise<void> {
    try {
      await navigator.clipboard.writeText(this.pin())
      this.pinCopied.set(true)
      setTimeout(() => this.pinCopied.set(false), 1500)
    } catch (error) {
      // Clipboard access needs a secure context (https or localhost); nothing to recover
      console.error('Could not copy the setup code', error)
    }
  }

  private resizeRetries = 0
  // The pending resize frame, cancelled on destroy: while the card has no height
  // the resize keeps re-scheduling itself, which must not outlive the widget
  private resizeFrame: number | null = null
  private destroyed = false

  private scheduleResize(): void {
    if (this.destroyed) {
      return
    }
    if (this.resizeFrame !== null) {
      cancelAnimationFrame(this.resizeFrame)
    }
    this.resizeFrame = requestAnimationFrame(() => {
      this.resizeFrame = null
      this.resizeQrCode()
    })
  }

  private resizeQrCode(): void {
    const containerHeight = (this.qrcodeContainerElement()!.nativeElement as HTMLElement).offsetHeight

    // The card can be measured before it has been laid out (for example right after
    // the dashboard is rebuilt for layout editing), which would size the code to
    // nothing; try again on the next few frames instead
    if (!containerHeight && this.resizeRetries < 10) {
      this.resizeRetries += 1
      this.scheduleResize()
      return
    }
    this.resizeRetries = 0
    const containerWidth = (this.qrcodeContainerElement()!.nativeElement as HTMLElement).offsetWidth
    const pinCodeHeight = (this.pincodeElement()!.nativeElement as HTMLElement).offsetHeight

    const newHeight = containerHeight - pinCodeHeight
    const newWidth = containerWidth > newHeight ? newHeight : containerWidth

    this.qrCodeHeight.set(newHeight)
    this.qrCodeWidth.set(newWidth)
  }

  private getPairingPin(): void {
    this.io.request('get-homebridge-pairing-pin')
      .subscribe({
        next: (data) => {
          this.applyHapStatus(data)
          // Resize after data is set and DOM updates
          this.scheduleResize()
        },
      })
  }
}
