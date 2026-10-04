# Off-site backups and retention

Glass UI makes an instance backup every night (Settings, General, Backup) in
the instance backup path. Settings, General, **Off-site Backups** adds:

- **Destinations**: after each scheduled backup (and the one Update All makes
  before it starts), the archive is uploaded to every destination switched on:
  - **WebDAV**: a folder URL (Nextcloud/ownCloud:
    `https://cloud.example.com/remote.php/dav/files/<user>/homebridge/`,
    Synology, Apache mod_dav, …), user name and password (HTTP Basic). The folder
    must exist.
  - **S3-compatible**: endpoint, region, bucket, folder (prefix), access key
    ID and secret access key; AWS S3, MinIO, Cloudflare R2, Backblaze B2,
    Wasabi… **Path-style URLs** (on by default) suit MinIO and most compatible
    servers; turn it off for virtual-hosted buckets. Requests are signed with
    AWS Signature Version 4 (full payload hash), implemented on node:crypto.
  - **Test connection** checks the folder or bucket with the settings as typed,
    before saving.
- **Retention**: each destination keeps its newest **Copies to keep** (7 by
  default) of this instance's backups (`homebridge-backup-<instance>.<time>.tar.gz`)
  and deletes older ones; other files, and other instances' backups, are left
  alone. Locally, either the last 7 days (as before) or the newest N
  (counted per instance).
- **Notifications**: an upload that fails sends **A scheduled backup fails**
  (`backupFailed`, which now also covers a backup that could not be created:
  that was only logged before). **A scheduled backup is done (and uploaded)**
  (`backupSucceeded`, off by default) reports each success.

The settings are stored in `.uix-backup-destinations.json` in the storage
directory (owner-only, `0600`), with the result of the last upload. The WebDAV
password and S3 secret key are never sent back to the browser (they read as
`********`; sending that back keeps them) and are removed from error messages.

## API (administrators)

```
GET /api/backup/destinations
{
  "keepLocal": null,               // null: 7 days; or 1–365 copies
  "webdav": { "enabled": false, "url": "", "username": "", "password": "", "keep": 7 },
  "s3": { "enabled": false, "endpoint": "", "region": "us-east-1", "bucket": "", "prefix": "homebridge/",
          "accessKeyId": "", "secretAccessKey": "", "forcePathStyle": true, "keep": 7 },
  "lastRun": { "at": "…", "fileName": "…", "results": [{ "destination": "webdav", "ok": true, "removed": 1 }] } | null
}

PUT /api/backup/destinations       any part of the above (partial)
POST /api/backup/destinations/test { "destination": "webdav" | "s3", "settings"?: { …unsaved fields } }
     → { "destination": "s3", "ok": false, "error": "S3 GET answered HTTP 403 (SignatureDoesNotMatch)" }
```
