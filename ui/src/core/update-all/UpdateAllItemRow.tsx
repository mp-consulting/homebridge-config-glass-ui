import type { SyntheticEvent } from 'react'

/** The Homebridge logo, used for the UI and Homebridge themselves and for any plugin without an icon */
export const defaultIcon = 'assets/hb-icon.png'

export interface UpdateAllItemRowProps {
  displayName: string
  icon?: string | null
  /**
   * The already-translated line under the name, saying what is happening to
   * this item. It carries the version jump too when that is worth showing, so
   * the row is two lines rather than three.
   */
  note?: string | null
}

function handleIconError(event: SyntheticEvent<HTMLImageElement>): void {
  event.currentTarget.src = defaultIcon
}

/**
 * One row of an Update All list: the plugin's icon, its name, and a line
 * saying what is happening to it. Every list in the Update All modal renders
 * this, so they cannot drift apart - only the right-hand slot differs (a
 * toggle while choosing, a status while running).
 */
export function UpdateAllItemRow({ displayName, icon = null, note = null }: UpdateAllItemRowProps) {
  return (
    <div className="d-flex align-items-center text-start flex-grow-1 me-3">
      <img
        alt=""
        aria-hidden="true"
        className="plugin-icon-small me-3 flex-shrink-0"
        src={icon || defaultIcon}
        onError={handleIconError}
      />
      <div>
        {displayName}
        {note && (
          <>
            <br />
            <small className="grey-text">{note}</small>
          </>
        )}
      </div>
    </div>
  )
}
