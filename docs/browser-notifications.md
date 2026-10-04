# Browser notifications (Web Push)

Next to the webhook, ntfy, Pushover and Telegram, Settings, Notifications has a
**Browser** channel: the same events, delivered as push notifications to the
browsers (or the installed Glass UI app) where you turned them on. No outside
account is needed; the push goes through the browser vendor's push service
(Google, Mozilla, Apple, Microsoft).

## Setting it up

1. Open Glass UI over **HTTPS** (Settings, Security; push needs a secure
   origin and the service worker, which only production builds register).
2. Settings, Notifications, switch **Browser** on and **Save**.
3. On each device: **Turn on for this device**, allow notifications when the
   browser asks, then **Send test to this device**.

On iPhone and iPad (iOS 16.4+), add Glass UI to the Home Screen first and
turn it on from the app opened there: Safari only delivers push to installed
web apps.

A click on a notification opens (or focuses) Glass UI on the page it is about,
for example Plugins for a rollback suggestion. Devices can be removed from the
list; a device whose browser dropped the subscription is removed by itself
the next time a notification is sent.

## How it works

- The server's VAPID key pair is generated the first time it is needed and
  stored, with the subscriptions, in `.uix-web-push.json` in the storage
  directory (owner-only, `0600`). Deleting the file makes every device turn
  notifications on again.
- Messages are encrypted for each device (RFC 8291, `aes128gcm`) and signed
  with VAPID (RFC 8292), with Node's own crypto: no extra dependency. The body
  is cut at 1000 characters.
- The VAPID contact (`sub`) defaults to a no-reply address; set
  `UIX_WEB_PUSH_SUBJECT` (`mailto:…` or `https://…`) to use your own.
- The service worker (`ui/static/sw.js`) shows the notification (`push`) and
  handles the click (`notificationclick`).

## API (administrators)

```
GET  /api/notifications/web-push
     → { "publicKey": "B…", "subscriptions": [{ "id", "label", "username", "createdAt", "service" }] }
POST /api/notifications/web-push/subscriptions   PushSubscription.toJSON() + optional "label"
     { "endpoint": "https://…", "keys": { "p256dh": "…", "auth": "…" }, "label": "Safari on iPhone" }
     → { "id", "label", "username", "createdAt", "service" }
POST /api/notifications/web-push/unsubscribe     { "endpoint": "https://…" } → { "removed": true }
DELETE /api/notifications/web-push/subscriptions/:id → { "removed": true }   (404 when unknown)
POST /api/notifications/web-push/test            { "endpoint"?: "https://…" } → { "channel": "browser", "ok", "error"? }
```

The channel itself is `channels.browser.enabled` in `GET`/`PUT
/api/notifications/settings`, and `POST /api/notifications/test` with
`{ "channel": "browser" }` sends to every subscribed device.
