# CLAUDE.md — gh-remote

Durable facts about this project. Read before changing code.

## What it is

A **static** web app. No server, no build step, no runtime dependencies. The
browser talks to the LG TV directly over WebSocket. `npm` is dev-only
(Playwright + `ws` for the mock TV).

## Non-negotiables

- **Never reintroduce a server.** It was deliberately deleted. A cloud host
  cannot reach a TV behind home NAT, and the user has no always-on machine. If
  something seems to need a server, it probably needs to not exist.
- **Never add a runtime dependency.** `package.json` dependencies must stay
  empty. devDependencies are fine.
- **Power-on is impossible and must not be faked.** It needs a Wake-on-LAN UDP
  packet; browsers cannot send UDP. Do not add a power-on button that silently
  does nothing.
- **Buttons go over the pointer socket, not the control socket.** Sending button
  JSON to `ssap://…/insert_1q` fails silently. This was the original bug.
- **TV-supplied strings are untrusted.** App titles, channel names and input
  labels go in via `textContent`, never `innerHTML`.

## Protocol gotchas that cost time

- Two sockets: control (`wss://tv:3001`) and pointer (path obtained from
  `getPointerInputSocket`). Pointer frames are newline text, not JSON:
  `type:button\nname:UP\n\n`.
- Register gets **two** replies: a `response` with `pairingType` (prompt is on
  screen), then a `registered` with the client key once a human presses Allow.
- 2018+ TVs use port 3001 with TLS; older ones 3000 plain. `endpointsFor()`
  tries both, and skips `ws://` when the page is https because the browser will
  block it anyway.
- A rejected self-signed certificate and an unreachable host produce the
  **identical** opaque error in page JS. That is why the cert help is always
  visible on the setup screen rather than shown only on a specific failure.
- `ssap://audio/getVolume` has shipped two payload shapes; handle both
  (`p.volumeStatus || p`, `muteStatus ?? muted`).
- App icon URLs are plain http from the TV — blocked as mixed content on an
  https page. The initials fallback is the normal path, not an edge case.

## Testing rules

- `dev/mock-tv.js` is the fake TV. Any new `ssap://` URI **must** be added to its
  switch statement or its test will fail with "unknown uri".
- Tests assert on what reached the wire (`/__log`), not on rendering. Keep it
  that way — a silently broken button must not be able to pass.
- The mock is shared across tests; `/__reset` clears both the log and mutated TV
  state. The top-level `beforeEach` already calls it.
- `seed()` must not clobber existing localStorage, or reload-persistence tests
  become meaningless.
- Use `openPanel(page, name)` rather than clicking a tab — the tab bar does not
  exist on desktop.

## Styling rules

- All visual values live in `css/theme.css` as custom properties, per theme.
  `css/app.css` reads tokens and must never hardcode a colour.
- Inline SVG icons use `<symbol viewBox="0 0 24 24">`. A `<g>` without a viewBox
  crops every icon to its top-left corner — this happened once already.
- Flex/grid children holding inputs need `min-width: 0` or they overflow their
  column.

## Network reality (this user's setup)

- PC: `192.168.1.86`, gateway `192.168.1.254`.
- The TV is on a **second network** created by a spare router reused as an
  extender in NAT mode. Fix is bridge/AP mode — see README. Bridge mode costs no
  speed; the throughput loss is from the wireless backhaul either way.
