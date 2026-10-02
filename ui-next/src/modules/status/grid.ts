import type { LayoutItem, ResizeHandleAxis } from 'react-grid-layout'

import type { Widget } from './widgets/widget.types'

/*
 * angular-gridster2's options, reproduced on react-grid-layout:
 *   gridType 'verticalFixed', minCols = maxCols = 20, fixedRowHeight 36,
 *   margin 8 (14 in glass mode), outer margin left/right (the `py-0` class
 *   cancelled gridster's top/bottom one), minRows 20, maxRows 40,
 *   compactType 'compactUp', pushItems, resize from s / e / se,
 *   mobileBreakpoint 1023 (below it: no grid, items stacked in order).
 */
export const GRID_COLS = 20
export const GRID_ROW_HEIGHT = 36
export const GRID_MIN_ROWS = 20
export const GRID_MAX_ROWS = 40
export const GRID_MOBILE_BREAKPOINT = 1023
export const RESIZE_HANDLES: ResizeHandleAxis[] = ['s', 'e', 'se']

export function gridMargin(glassMode: boolean): number {
  // Glass cards have large rounded corners, which need wider gutters to read as separate panes
  return glassMode ? 14 : 8
}

/** Saved widget → react-grid-layout item (cols/rows are w/h, `component` is the key). */
export function toGridItem(widget: Widget): LayoutItem {
  return { i: widget.component, x: widget.x ?? 0, y: widget.y ?? 0, w: widget.cols ?? 1, h: widget.rows ?? 1 }
}
