import { ChangeDetectionStrategy, Component, DestroyRef, ElementRef, inject, input, OnDestroy, OnInit, signal, viewChild } from '@angular/core'
import { takeUntilDestroyed } from '@angular/core/rxjs-interop'
import { TranslatePipe } from '@ngx-translate/core'
import { Subject } from 'rxjs'

import { IoNamespace, WsService } from '@/app/core/communication/ws.service'
import { QrcodeComponent } from '@/app/core/components/qrcode/qrcode.component'
import { HomebridgeStatusResponse } from '@/app/core/server.interfaces'
import { Widget } from '@/app/modules/status/widgets/widgets.interfaces'

@Component({
  selector: 'app-matter-qrcode-widget',
  imports: [
    QrcodeComponent,
    TranslatePipe,
  ],
  standalone: true,
  templateUrl: './matter-qrcode-widget.component.html',
  styleUrl: './matter-qrcode-widget.component.scss',
  changeDetection: ChangeDetectionStrategy.OnPush,
})
export class MatterQrcodeWidgetComponent implements OnInit, OnDestroy {
  // Injected dependencies
  private destroyRef = inject(DestroyRef)
  private $ws = inject(WsService)

  // Inputs (set by the dashboard's dynamic widget loader via setInput)
  public readonly widget = input.required<Widget>()

  // Signals
  readonly pincodeElement = viewChild<ElementRef>('pincodeMatter')
  readonly qrcodeContainerElement = viewChild<ElementRef>('qrcodecontainerMatter')
  public readonly enabled = signal<boolean>(false)
  public readonly loading = signal<boolean>(true)
  public readonly commissioned = signal<boolean>(false)
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
    // Use existing status namespace instead of matter-bridges
    this.io = this.$ws.getExistingNamespace('status')

    // Listen to homebridge-status events for unified status updates
    this.statusHandler = (data: HomebridgeStatusResponse) => {
      this.applyMatterStatus(data)
      requestAnimationFrame(() => this.resizeQrCode())
    }

    this.io.socket.on('homebridge-status', this.statusHandler)

    // Subscribe to grid resize events
    this.resizeEvent.pipe(takeUntilDestroyed(this.destroyRef)).subscribe(() => {
      this.resizeQrCode()
    })

    // Fetch initial data if already connected - defer to avoid NG0100
    if (this.io.socket.connected) {
      queueMicrotask(() => this.getMatterInfo())
    }
  }

  public ngOnDestroy(): void {
    if (this.io && this.statusHandler) {
      this.io.socket.off('homebridge-status', this.statusHandler)
    }
  }

  /**
   * Copy the setup code, for pairing by typing it in instead of scanning.
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

  private resizeQrCode(): void {
    const containerHeight = (this.qrcodeContainerElement()!.nativeElement as HTMLElement).offsetHeight

    // The card can be measured before it has been laid out (for example right after
    // the dashboard is rebuilt for layout editing), which would size the code to
    // nothing; try again on the next few frames instead
    if (!containerHeight && this.resizeRetries < 10) {
      this.resizeRetries += 1
      requestAnimationFrame(() => this.resizeQrCode())
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

  private applyMatterStatus(data: HomebridgeStatusResponse): void {
    if (data.matter) {
      this.enabled.set(data.matter.enabled)
      if (data.matter.enabled) {
        this.pin.set(data.matter.pin || this.pin())
        this.commissioned.set(data.matter.commissioned || false)
        this.setupUri.set(data.matter.setupUri || null)
      } else {
        this.setupUri.set(null)
        this.commissioned.set(false)
      }
    } else {
      this.enabled.set(false)
      this.pin.set('')
      this.setupUri.set(null)
      this.commissioned.set(false)
    }
    this.loading.set(false)
  }

  private getMatterInfo(): void {
    // Request homebridge pairing pin which includes Matter info
    this.io.request('get-homebridge-pairing-pin')
      .subscribe({
        next: (data) => {
          this.applyMatterStatus(data)
          // Resize after data is set and DOM updates
          requestAnimationFrame(() => this.resizeQrCode())
        },
      })
  }
}
