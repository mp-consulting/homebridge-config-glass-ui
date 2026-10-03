// The host elements Angular renders for each formworks component. They are
// kept in the React output so the DOM (and any CSS or plugin code keyed off
// these tags) stays the same.
import type { DetailedHTMLProps, HTMLAttributes } from 'react'

type HostElement = DetailedHTMLProps<HTMLAttributes<HTMLElement>, HTMLElement>

declare module 'react' {
  // eslint-disable-next-line ts/no-namespace
  namespace JSX {
    interface IntrinsicElements {
      'add-reference-widget': HostElement
      'bootstrap-5-framework': HostElement
      'button-widget': HostElement
      'checkbox-widget': HostElement
      'checkboxes-widget': HostElement
      'css-framework': HostElement
      'file-widget': HostElement
      'hidden-widget': HostElement
      'input-widget': HostElement
      'json-schema-form': HostElement & { framework?: string }
      'message-widget': HostElement
      'none-widget': HostElement
      'number-widget': HostElement
      'one-of-widget': HostElement
      'radios-widget': HostElement
      'root-widget': HostElement
      'section-widget': HostElement
      'select-framework-widget': HostElement
      'select-widget': HostElement
      'select-widget-widget': HostElement
      'selectcheckbox-widget': HostElement
      'submit-widget': HostElement
      'tabs-widget': HostElement
      'template-widget': HostElement
      'textarea-widget': HostElement
    }
  }
}
