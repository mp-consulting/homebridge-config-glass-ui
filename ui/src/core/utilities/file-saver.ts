import { saveAs as fileSaverSaveAs } from 'file-saver'

/**
 * How a file is handed to the browser to download.
 *
 * Called through the `fileSaver` object rather than imported from file-saver
 * directly, so a spec can `vi.spyOn(fileSaver, 'saveAs')` and see what would
 * have been saved instead of triggering a real download.
 */
export type SaveAs = (data: Blob | string, filename?: string) => void

export const fileSaver: { saveAs: SaveAs } = {
  saveAs: (data, filename) => fileSaverSaveAs(data as Blob, filename),
}
