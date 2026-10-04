# Rolling back a plugin update

Update All has always made an instance backup before it starts. A single
plugin update (from the plugin card, **Manage Version**, `POST /api/plugins/update`,
the homebridge-updater plugin, or Update All itself) now also records the
version it replaced, so the update can be undone in one click.

## What is recorded

When an install changes the version of an installed plugin, Glass UI keeps
`{ name, fromVersion, toVersion, updatedAt }` in `.uix-plugin-rollback.json` in
the storage directory, one record per plugin (its last update), for
**14 days**. Installing `fromVersion` again (the rollback, or any downgrade to
it) clears the record, and so does uninstalling the plugin. Homebridge and
Glass UI itself are not covered: they update through their own paths.

## Crash loops after an update

- **Child bridge**: when a plugin's child bridge enters a crash loop
  (3 crashes in 10 minutes, see Child Bridge Health) within 48 hours of the
  plugin's update, the record is marked as suspect. The crash loop
  notification says which version it was updated from and offers the rollback,
  the plugin card shows a red **roll back** icon beside its name, and the
  Child Bridge Health page shows a **Roll back to vX** button in its crash loop
  alert.
- **Main bridge**: Homebridge going down 3 times within 10 minutes counts as a
  crash loop of the main bridge. Plugins updated in the last 48 hours that run
  on the main bridge (no child bridge in their config) are marked as suspect,
  and the **Homebridge crash loops soon after a plugin update** notification
  (`rollbackSuggested`, on by default, Settings, Notifications) lists them.
  Restarts you ask for count as downs too, so three quick manual restarts after
  an update can also suggest a rollback.

## Rolling back

Within the 14 days the plugin card's menu has **Roll back to vX**. It asks
first, then installs vX through the usual plugin dialog (with its output);
restart Homebridge, or the child bridge, afterwards.

## API (administrators)

```
GET /api/plugins/rollback
[
  {
    "name": "homebridge-example",
    "fromVersion": "1.4.2",          // what a rollback installs
    "toVersion": "1.5.0",            // installed by the last update
    "updatedAt": "2026-10-04T08:00:00.000Z",
    "expiresAt": "2026-10-18T08:00:00.000Z",
    "suspect": null                  // or { "reason": "childBridgeCrashLoop" | "homebridgeCrashLoop", "at": "…", "bridge": "Kitchen" }
  }
]

POST /api/plugins/rollback   { "name": "homebridge-example" }
202 { "jobId": "…", "version": "1.4.2" }   // poll GET /api/plugins/jobs/:jobId
404 when there is nothing to roll back
```
