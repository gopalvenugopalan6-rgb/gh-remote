# gh-remote

A full remote control for **LG webOS TVs** (UHD / AI ThinQ — 43UR80 and friends)
that runs in a browser tab. Open a web page on your phone, press Allow on the
TV once, and you have a remote.

There is no server, no app to install, no account, and nothing running on your
PC. The web page talks to the TV directly.

---

## How it works

```
   your phone                          your TV
  ┌──────────────┐   WebSocket over    ┌──────────────┐
  │ browser tab  │ ───── your Wi-Fi ──▶│  webOS :3001 │
  │ (static site)│ ◀───────────────────│              │
  └──────────────┘                     └──────────────┘
         ▲
         │ page loaded once from GitHub Pages
         │ (and cached — it works offline after that)
```

The static page is served from anywhere (GitHub Pages by default). Once it is
open, **every TV command goes straight from your browser to the TV over your
local Wi-Fi.** The host never sees your TV or your traffic.

Two sockets are involved, which is the part most remote projects get wrong:

1. **Control socket** (`wss://tv:3001`) — pairing, plus every `ssap://` service
   call: volume, apps, inputs, channels, power.
2. **Pointer socket** — its URL has to be requested *through* the control socket
   via `getPointerInputSocket`. Button presses (UP/OK/BACK/HOME) and cursor
   movement are newline-delimited text frames sent there, **not** JSON on the
   control socket. Sending button JSON to the control socket fails silently.

---

## Getting started

1. **Put your phone on the same Wi-Fi as the TV.** They must be on the same
   network — see [Network notes](#network-notes) if yours is split by an extender.
2. Open the site.
3. Enter the TV's IP address (**Settings → Network → Wi-Fi Connection →
   Advanced**), or use **Scan the network**.
4. **Trust the TV's certificate** — see below. This is the step everyone trips on.
5. Press **Connect**. The TV shows a prompt; press **Allow** with the physical
   remote. That happens once — the key is saved in your browser.

### The certificate step

LG secures port 3001 with a certificate it signed itself. Your browser does not
trust it, and from an `https://` page it refuses the connection **silently** —
no prompt, no error, it just never connects.

One-time fix, once per device:

1. Visit `https://<TV-IP>:3001` in the same browser.
2. Privacy warning → **Advanced** → **Proceed anyway**.
3. The page will look blank or broken. That is expected — the exception is stored.
4. Go back to the remote and press Connect.

---

## What it does

| Area | Controls |
|---|---|
| **Remote** | Power off, input, mute, Home/Back/Exit/Menu, D-pad + OK, volume & channel rockers with hold-to-repeat, live volume slider, colour keys, number pad, Guide/Info/Settings |
| **Touch** | Trackpad driving the TV's magic-remote pointer, tap to click, two-finger scroll, mouse wheel, arrow-key fallback |
| **Typing** | Send text into TV search boxes, Enter, Delete, optional live per-keystroke typing |
| **Apps** | Live list pulled from the TV, search, tap to launch, pin favourites, current app highlighted |
| **Sources** | HDMI input switcher (shows what's actually plugged in), channel list with search, media transport (play/pause/stop/rewind/FF) |
| **Live state** | Volume level and mute follow the TV in real time via subscriptions, not blind fire-and-forget |
| **Themes** | Three complete looks — Tactile, Clean, Panel — switchable at any time |
| **PWA** | Installs to your home screen, opens fullscreen, shell cached for offline |

### What it deliberately does not do

**Power ON.** Waking a sleeping TV requires a Wake-on-LAN magic packet, which
is UDP. Browsers cannot send UDP — not with any library, permission, or trick.
The only fix is a small always-on machine on your network, which is exactly the
thing this project exists to avoid. Power *off* works fine.

---

## Network notes

Your phone and your TV must be on the **same network**. Not merely "both have
internet" — the same subnet.

A Wi-Fi extender running in **router/NAT mode** creates a *second* network. The
TV ends up on `192.168.2.x` while your phone is on `192.168.1.x`, and nothing on
one side can reach the other. Discovery will find nothing, and a manually typed
IP will time out.

**Fix: put the extender in bridge / access-point mode.** If your extender is a
repurposed router:

1. Open the spare router's admin page (usually `192.168.1.1` *of that device*,
   reached while connected to its Wi-Fi).
2. **Turn off its DHCP server.** This is the setting that creates the second
   network.
3. Give it a **static IP on the main network** — e.g. `192.168.1.2`, outside your
   main router's DHCP pool.
4. Look for a mode setting named **AP mode / Bridge mode / Access Point / "Use
   as a wireless extender"** and select it.
5. Reboot. The TV now gets a `192.168.1.x` address from your main router.

This costs you **no speed.** The throughput drop you feel from an extender comes
from the wireless backhaul — the extender talks to the router and to the TV over
the same radio — and that happens in either mode. Bridge mode only removes the
subnet split.

---

## Development

```bash
npm install
npm run dev      # app on :8080, a fake webOS TV on :3000
npm test         # 53 browser tests, phone + desktop viewports
```

`dev/mock-tv.js` is a fake LG TV. It speaks the real protocol — register and
pairing handshake, pointer-socket indirection, subscriptions, and the `ssap://`
URIs the app uses — so the whole app can be tested with no TV switched on. It
records every frame it receives at `/__log`, which is how the tests assert that
a button press actually reached the wire rather than merely rendering.

### Layout

```
index.html            markup + inline SVG sprite; one tree serves all 3 themes
css/theme.css         the three design directions, entirely as custom properties
css/app.css           layout, components, responsive rules
js/webos.js           the protocol: sockets, pairing, ssap calls, pointer frames
js/app.js             controller — wiring, rendering, connection lifecycle
js/ui.js              toast, haptics, theme, panel switching, hold-to-repeat
js/store.js           localStorage: client keys, favourites, preferences
js/discover.js        subnet scanning and address validation
sw.js                 service worker — caches the shell for offline use
dev/mock-tv.js        fake TV + static server for development and tests
tests/remote.spec.js  Playwright suite, phone and desktop projects
```

---

## Privacy and security

- The **client key** the TV issues is stored in your browser's localStorage. It
  never leaves your device — there is no server to send it to.
- The site is static. It collects nothing, has no analytics, and makes no
  outbound requests other than to the TV you point it at.
- There is **no password on the remote itself**, by design. The real gate is the
  TV's own pairing prompt: a new device cannot control the TV until someone
  physically presses Allow on the TV with the actual remote. A PIN in the page
  would be theatre — anyone on your Wi-Fi could open the same public URL and pair
  themselves the same way.
- The network scan probes your own LAN from your own browser, only when you press
  Scan. Nothing is scanned automatically and no result is transmitted anywhere.
