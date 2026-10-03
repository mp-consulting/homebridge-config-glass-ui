/**
 * The custom wallpaper is an image the upload (`POST /server/wallpaper`) saves
 * in the storage directory as `ui-wallpaper.<ext>`, and `ui.wallpaper` in
 * config.json names it. It is served without authentication (the login page
 * shows it) and deleted when replaced, so the name must never reach anything
 * but that file: a bare `ui-wallpaper.<image ext>` name, nothing else.
 * Pure functions only, so `config-safety.ts` can share them.
 */

import { extname, relative, resolve, sep } from 'node:path'

/** Image types a wallpaper may be uploaded as (lower case, with the dot) */
export const WALLPAPER_EXTENSIONS: readonly string[] = ['.jpg', '.jpeg', '.png', '.webp', '.gif']

/** The names the upload writes; the extension keeps the case it was uploaded with */
const RE_WALLPAPER_FILE_NAME = /^ui-wallpaper\.(?:jpe?g|png|webp|gif)$/i

export const WALLPAPER_RULE = `The wallpaper must be an image uploaded from the settings page (ui-wallpaper with one of the extensions ${WALLPAPER_EXTENSIONS.join(', ')}).`

/** Whether a `ui.wallpaper` value is a wallpaper file name the upload produces */
export function isValidWallpaperName(value: unknown): value is string {
  return typeof value === 'string' && RE_WALLPAPER_FILE_NAME.test(value)
}

/**
 * The extension (as uploaded) to save an uploaded wallpaper with, or
 * undefined when the file name does not carry an allowed image extension.
 */
export function wallpaperExtension(fileName: unknown): string | undefined {
  if (typeof fileName !== 'string') {
    return undefined
  }
  const ext = extname(fileName)
  return WALLPAPER_EXTENSIONS.includes(ext.toLowerCase()) ? ext : undefined
}

/**
 * The full path of the wallpaper file named by `value`, or undefined when the
 * value is not a valid wallpaper name or would resolve outside the storage
 * directory.
 */
export function resolveWallpaperPath(storagePath: string, value: unknown): string | undefined {
  if (!isValidWallpaperName(value)) {
    return undefined
  }
  const root = resolve(storagePath)
  const fullPath = resolve(root, value)
  const rel = relative(root, fullPath)
  if (!rel || rel.startsWith('..') || rel.includes(sep)) {
    return undefined
  }
  return fullPath
}
