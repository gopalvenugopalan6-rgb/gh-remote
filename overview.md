# overview.md — how gh-remote is built

Plain-language architecture. Read this before changing anything; it explains
*why* the pieces are shaped the way they are, which the code alone will not tell
you.

---

## The one-sentence version

A static web page that speaks LG's TV remote protocol directly from the
browser, so there is nothing to run and nothing to host beyond plain files.

---

## Why there is no server

The obvious design is a small Node server that talks to the TV, with the phone
talking to that server. The original version of this repo did exactly that. It
was thrown away, for two reasons:

1. **Nothing is always on.** The server has to live on a machine that is awake
   whenever you want to use the remote. A laptop is not that machine.
2. **A cloud server cannot reach the TV.** The TV sits behind home NAT on a
   private address. Nothing on the public internet can open a socket to it. So
   "just host it" is not an option for a server design — hosting only works if
   the thing being hosted is *static files*.

Removing the server removes both problems at once. The browser is already on the
right network and already speaks WebSocket, which is the only transport the TV
protocol needs.

**The cost of that choice**, paid up front and honestly:
- The phone must be on the same Wi-Fi as the TV.
- The user must trust the TV's self-signed certificate once per device.
- Power-on is impossible (needs UDP; browsers cannot send UDP).

All three are documented in the UI itself, not just the README.

---

## The protocol, in plain words

Two separate sockets do two separate jobs.

**Socket 1 — control** (`wss://tv:3001`, or `ws://tv:3000` on older sets).
Opens, then immediately sends a `register` message containing a permission
manifest. The TV replies twice: first "I am showing the user a prompt", then,
once a human presses Allow, "registered" with a **client key**. Save that key and
future connections skip the prompt entirely.

Everything else on this socket is a request with a `ssap://` URI and a JSON
payload — `ssap://audio/setVolume`, `ssap://system.launcher/launch`, and so on.
Some of them can be *subscribed* to instead of called once, which is how the
volume slider tracks the TV instead of guessing.

**Socket 2 — pointer.** This one is not a URL you can know in advance. You ask
the control socket for it (`getPointerInputSocket`), and it hands back a path.
You open a second WebSocket to that path, and then you speak a completely
different language: newline-delimited text.

```
type:button
name:UP

```

Every d-pad press, every cursor move, every click goes here. **This is the part
the original code got wrong** — it sent button presses as JSON on the control
socket, which the TV accepts and silently ignores. Every button in the old UI
was a no-op.

---

## The files

| File | What it owns |
|---|---|
| `js/webos.js` | All protocol knowledge. Connection, endpoint fallback, pairing, request/subscribe bookkeeping, the pointer socket, and one method per TV command. Nothing in here touches the DOM. |
| `js/app.js` | The controller. Connects the DOM to `webos.js`: button wiring, rendering apps/inputs/channels, the trackpad gesture logic, connection lifecycle, settings. |
| `js/ui.js` | Presentation helpers with no TV knowledge — toasts, haptics, theme switching, panel visibility, hold-to-repeat. |
| `js/store.js` | The only persistence. localStorage, wrapped so a private-mode browser degrades to defaults instead of throwing. |
| `js/discover.js` | Finding a TV from inside a browser tab, and being honest about how weak that is. |
| `css/theme.css` | Three design directions expressed purely as custom properties. |
| `css/app.css` | Layout and components. Reads tokens, never hardcodes a colour. |
| `index.html` | One markup tree, an inline SVG sprite, and every panel. |
| `sw.js` | Caches the shell so the remote opens instantly and survives bad internet. |
| `dev/mock-tv.js` | A fake TV that speaks enough real protocol to test against. |

---

## How the three themes work

Every visual decision — colour, radius, spacing, shadow, key height, font, even
press travel distance — is a CSS custom property defined in `theme.css` under a
`[data-theme='…']` block. `app.css` only ever reads them.

Switching themes sets one attribute on `<html>`. No JavaScript re-render, no
component variants, no duplicated markup. That is what makes "build all three
and let me choose" cheap rather than three codebases.

Adding a fourth theme = adding one block of tokens. Nothing else changes.

---

## How the layout adapts

Below 900px the four panels are **tabs** with a bottom tab bar — one panel
visible, thumb-reachable navigation.

At 900px and up the tab bar is removed entirely and the panels become
**columns**, all visible at once. Hiding three quarters of a remote behind tabs
on a wide screen would be worse than showing all of it.

At 1240px and up the Sources panel gets its own fourth column instead of being
dropped.

`syncPanels()` in `app.js` keeps the `hidden` attributes honest across those
breakpoints, because panel visibility is controlled by both CSS and JS and they
must not disagree.

---

## How it is tested

There is no TV in CI, and "it probably works" is not a test. `dev/mock-tv.js` is
a real WebSocket server that implements the handshake, the pointer-socket
indirection, subscriptions, and the `ssap://` URIs the app calls. It logs every
frame it receives.

The tests then assert on **what reached the wire**, not on what the UI looked
like: pressing the d-pad must produce a pointer frame of `type:button name:UP`;
launching Netflix must produce `ssap://system.launcher/launch` with
`id: netflix`. A silently broken button cannot pass.

The suite runs twice, once as a phone and once as a desktop, and includes a
horizontal-overflow check at seven widths and a 44px touch-target check.

---

## Extending it

**Add a TV command:** add one method to `WebOSTV` in `js/webos.js`, add the URI
to the mock's switch statement in `dev/mock-tv.js`, add a button with
`data-act="yourMethod"` in `index.html`. The wiring in `app.js` picks it up from
the `actions` map — no new event listener needed.

**Add a remote button:** `data-btn="NAME"` sends that name over the pointer
socket. Add `data-repeat` for hold-to-repeat.

**Add a theme:** one new `[data-theme='name']` block in `css/theme.css`, one new
swatch button in the settings drawer, and add the name to the cycle order in
`wireSettings()`.

**Add power-on later:** the only way is a device on the network that can send a
UDP magic packet. If a Raspberry Pi ever appears, a ~20-line service that
accepts an HTTP request and sends WoL is all that is needed; the UI hook belongs
next to `powerOff` in the actions map.
