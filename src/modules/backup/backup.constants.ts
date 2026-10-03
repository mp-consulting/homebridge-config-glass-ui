/**
 * File and directory names (matched at any depth) that a backup never
 * contains, and that a restore refuses to write even when a crafted or older
 * archive carries them. One list for both directions, so anything left out of
 * a backup cannot be planted through a restore either.
 */
export const BACKUP_EXCLUDED_NAMES: readonly string[] = [
  '.uix-secrets', // JWT signing secret - stays with the instance (a new one is made on start if missing)
  '.uix-hb-service-homebridge-startup.json', // hb-service startup flags and env (NODE_OPTIONS)
  'instance-backups', // scheduled backups
  'nssm.exe', // windows hb-service
  'homebridge.log', // hb-service
  'logs', // docker
  'node_modules', // docker
  'startup.sh', // docker
  '.docker.env', // docker
  'docker-compose.yml', // docker
  'pnpm-lock.yaml', // pnpm
  'package.json', // npm
  'package-lock.json', // npm
  '.npmrc', // npm
  '.npm', // npm
  'FFmpeg', // ffmpeg
  'fdk-aac', // ffmpeg
  '.git', // git
  'recordings', // homebridge-camera-ui recordings path
  '.homebridge.sock', // homebridge ipc socket
  '#recycle', // synology dsm recycle bin
  '@eaDir', // synology dsm metadata
  '.venv', // python venv
  '.cache', // cache
]

/** Backup archives hold credentials (auth.json hashes, HAP keys, SSL keys) */
export const BACKUP_FILE_MODE = 0o600
export const BACKUP_DIR_MODE = 0o700
