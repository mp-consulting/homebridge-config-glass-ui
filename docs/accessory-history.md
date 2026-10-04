# Accessory history

Glass UI records the numeric sensor readings of your HomeKit accessories
(temperature, humidity, light level, battery, CO2, PM2.5/PM10, VOC, and Eve
power/energy characteristics) as they change, at most one point a minute per
characteristic, into one JSON-lines file per day under
`<storage>/accessory-history/`. Days older than **Keep history for** (7 by
default, up to 365) are deleted.

Settings, Accessories, **Record Accessory History** (`accessoryHistory.enabled`,
`accessoryHistory.retentionDays` in the UI block of `config.json`).

## It needs insecure mode

The recorder reads the accessories the same way the Accessories page does:
over HAP, as an unpaired client, which Homebridge only allows in **insecure
mode** (`-I`, Settings, Startup Options, **Enable UI Accessory Control**).
Without it nothing is recorded. Glass UI says so:

- in Settings, under **Record Accessory History**, with an **Open the setting**
  link (administrators) to Startup Options;
- in an Accessory History dashboard widget that has nothing to show;
- once in the log when the UI starts;
- over the API:

```
GET /api/accessories/history/status
{
  "enabled": true,           // accessoryHistory.enabled
  "insecureMode": false,     // Homebridge runs with -I
  "recording": false,
  "reason": "insecureModeRequired", // "disabled" | "insecureModeRequired" | "starting" | "error" | null
  "error": "…",              // only with reason "error"
  "retentionDays": 7
}
```

Insecure mode is read when the UI starts: after switching it on, restart
Homebridge (with hb-service the UI restarts with it).

`/settings?section=<key>` opens and scrolls to a settings section
(`startup`, `notifications`, …), for links from other pages.

## Recording without insecure mode: findings

We looked at recording through the IPC channel Glass UI already has with the
Homebridge process instead, and did not implement it:

- **HAP accessories**: Homebridge's IPC (`ipcService`) only sends
  `serverStatusUpdate`, `childBridgeMetadataResponse`, `childBridgeStatusUpdate`
  and (Homebridge 2) `matterEvent`. There is no message carrying characteristic
  values or changes, and plugins cannot add one. Child bridges are separate
  processes with their own HAP servers and no IPC to the UI at all. Recording
  over IPC would need a change in Homebridge itself.
- **Matter accessories** (Homebridge 2): `matterEvent` does carry state
  changes once the UI arms Matter monitoring, without insecure mode. It only
  covers accessories a plugin exposes over Matter, whose clusters (for example
  `temperatureMeasurement.measuredValue` in hundredths of a degree) would need
  their own mapping to the recorded series. Possible later, but it would not
  remove the need for insecure mode for HAP accessories, which are most of them.
- **Pairing the UI as a HomeKit controller** (instead of insecure mode) would
  work without changes to Homebridge, but it uses one of the bridge's pairings,
  needs the setup code, must be done per child bridge, and breaks when a bridge
  is reset. Not robust enough to do silently.

So insecure mode stays a requirement, and Glass UI now explains it instead of
recording nothing without a word.
