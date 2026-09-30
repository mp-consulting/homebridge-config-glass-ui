import { ChangeDetectionStrategy, Component } from '@angular/core'
import { NgbAlert } from '@ng-bootstrap/ng-bootstrap/alert'
import { TranslatePipe } from '@ngx-translate/core'

@Component({
  selector: 'app-support-banner',
  imports: [TranslatePipe, NgbAlert],
  standalone: true,
  templateUrl: './support-banner.component.html',
  changeDetection: ChangeDetectionStrategy.OnPush,
})
export class SupportBannerComponent {
  public readonly linkGithub = '<a href="https://github.com/mp-consulting/homebridge-config-glass-ui/issues/new?template=feature-request.yml" target="_blank" rel="noopener noreferrer">GitHub</a>'
  public readonly linkDiscord = '<a href="https://discord.gg/kqNCe2D" target="_blank" rel="noopener noreferrer">Discord</a>'
}
