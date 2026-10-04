/** A file in an off-site backup folder. */
export interface RemoteFile {
  name: string
  size: number
}

/** What every off-site destination can do. */
export interface RemoteDestination {
  upload: (localPath: string, name: string) => Promise<void>
  list: () => Promise<RemoteFile[]>
  delete: (name: string) => Promise<void>
  /** Check the folder (or bucket) is reachable with these settings; throws with the reason. */
  test: () => Promise<void>
}
