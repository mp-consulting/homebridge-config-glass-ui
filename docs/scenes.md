# Scenes

A scene sets several accessory values at once. Run it by hand from the Scenes
page, or let triggers run it; conditions can hold an automatic run back.

## Triggers ("Run it")

- **Schedule (cron)**: a node-schedule cron expression, server local time
  (`0 19 * * *` every day at 19:00, `30 6 * * 1-5` weekdays at 06:30).
- **Sunrise / sunset** with an offset in minutes (negative: before, -720 to
  720). Computed on the server (the sunrise equation, a minute or two from the
  published times; no sunrise or sunset near the poles in summer or winter)
  for the **location of the dashboard's Weather widget** (the first one; its
  city's coordinates). Without a weather widget, sun triggers are not
  scheduled and the editor says so. The next occurrence is scheduled, then the
  one after when it runs; every night at 00:05 they are recomputed, so a new
  weather city is picked up.
- **Accessory value**: when a characteristic **changes**, or **becomes**
  `=`, `≠`, `>`, `≥`, `<`, `≤` a value (it fires when the value starts to
  match, not again while it keeps matching), at most once every 5 seconds per
  scene. It uses the same live accessory feed as the accessory history, so it
  needs Homebridge in insecure mode (Settings, Startup Options).

## Conditions ("Only if")

Checked before every automatic run, never for a run by hand; all must hold.

- **Time window**: between two times of day, each `HH:mm`, `sunrise` or
  `sunset` (today's, at the weather widget's location). A window that ends
  before it starts spans midnight (`sunset` to `06:30`).
- **Accessory value**: a characteristic compared with a value (needs insecure
  mode to read it).

A run its conditions hold back is logged and recorded as the scene's
`lastSkipped` (`{ at, trigger, reason }`), shown in the scene list.

## Stored format and compatibility

`scenes.json` (storage directory) is now `{ "version": 2, "scenes": [...] }`,
each scene with `triggers` and `conditions`. Version 1 files (scenes with
`schedules`) are read as cron triggers and rewritten as version 2 on the next
change. The API still returns `schedules` (the cron triggers) for older
clients, and a body with only `schedules` replaces the cron triggers and
keeps the scene's other triggers.

## API

```
GET  /api/scenes                         every user
POST /api/scenes/:id/run                 every user (a manual run)
POST /api/scenes, PUT /api/scenes/:id     admin
{
  "name": "Evening",
  "actions": [{ "uniqueId": "…", "characteristicType": "On", "value": true }],
  "triggers": [
    { "type": "cron", "cron": "0 19 * * *", "enabled": true },
    { "type": "sun", "event": "sunset", "offsetMinutes": -30, "enabled": true },
    { "type": "characteristic", "uniqueId": "…", "characteristicType": "MotionDetected",
      "operator": "eq", "value": true, "enabled": true }        // operator: changes | eq | neq | gt | gte | lt | lte
  ],
  "conditions": [
    { "type": "time", "after": "sunset", "before": "23:30" },
    { "type": "characteristic", "uniqueId": "…", "characteristicType": "CurrentAmbientLightLevel", "operator": "lt", "value": 50 }
  ]
}
GET /api/scenes/automation               admin
→ { "location": { "lat": 48.85, "lon": 2.35, "name": "Paris" } | null,
    "nextSunrise": "…", "nextSunset": "…", "characteristicTriggers": true }
```

At most 10 triggers and 10 conditions per scene. `src/modules/scenes/scene-automation.dto.ts`
has class-validator shapes (`SceneTriggerDto`, `SceneConditionDto`) for a scene
body DTO to nest, so the global `whitelist` validation keeps these fields.
