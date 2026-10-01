/* eslint-disable no-var, vars-on-top */

interface HomebridgeBackupDefaults {
  maxBackupSize: number
  maxBackupSizeText: string
  maxBackupFileSize: number
  maxBackupFileSizeText: string
}

interface HomebridgeTerminalDefaults {
  bufferSize: number
}

declare var backup: HomebridgeBackupDefaults
declare var terminal: HomebridgeTerminalDefaults
