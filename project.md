# project.md — living state

**Project:** gh-remote — browser remote for LG webOS TVs
**Repo:** `gopalvenugopalan6-rgb/gh-remote` (private)
**Local:** `~/Projects/gh-remote`
**Status:** Phases 1–6 complete. Awaiting first run against the real TV.
**Last updated:** 2026-08-30 (design-audit pass)

---

## What this is

A static web page that controls an LG 43UR80 (webOS) TV directly from a phone or
desktop browser. No server, no app, no account.

## Targeting decisions (Phase 1, 2026-08-30)

| Question | Decision | Why |
|---|---|---|
| Architecture | **Serverless static PWA**, browser → TV directly | No always-on machine at home; a cloud server physically cannot reach a TV behind NAT |
| Server | **Deleted.** `server.js` removed | User's PC turns on and off; hosting was requested instead |
| Hosting | **GitHub Pages**, kept host-agnostic | Free, deploys on push; no host-specific config so Vercel/Netlify is a copy-paste away |
| Discovery | Manual IP + timing-based subnet scan + saved TVs | Browsers cannot do SSDP/mDNS (multicast) and no longer leak the local IP |
| Auth | **None.** TV's own pairing prompt is the gate | With no server a PIN is theatre — anyone on the Wi-Fi could open the same URL and pair themselves |
| Power | **Off only**, stated in the UI | Power-on needs Wake-on-LAN over UDP; browsers cannot send UDP. No workaround exists |
| Stack | Vanilla JS/CSS, zero runtime deps | ~10 screens of buttons; a framework buys nothing and costs a build step |
| Design | **Three themes shipped**, dark ("Tactile") default | User asked for the dark direction with easy switching in case of second thoughts |
| Scope | Full-featured | App launcher, trackpad + keyboard, live volume/state, inputs/channels/media, PWA |

## Phases

| # | Phase | Status |
|---|---|---|
| 1 | Targeting — 20 questions, architecture decision | ✅ done |
| 2 | Protocol client — sockets, pairing, pointer socket, ssap commands | ✅ done |
| 3 | UI — markup, three themes, responsive layout | ✅ done |
| 4 | Features — apps, inputs, channels, media, trackpad, typing, PWA | ✅ done |
| 5 | Test — mock TV + 53 Playwright tests, phone and desktop | ✅ done |
| 6 | Pentest + deploy — CSP, XSS audit, Pages workflow, docs | ✅ done |
| 6b | Design audit — motion and layout-thrash pass | ✅ done |
| 7 | **Real-TV verification** | ⏳ blocked — TV was off and on the extender's network |

## Verified

- 53/53 Playwright tests pass across phone (Pixel 7) and desktop (1440×900).
- Assertions are on what reached the wire, via a mock TV that speaks the real
  protocol — not on UI appearance.
- No horizontal overflow at 320/375/414/768/1024/1280/1600px.
- All touch targets ≥ 36px on phone (colour keys deliberately excluded).
- No console errors during a full session across all four panels.
- Screenshots reviewed for all three themes on phone and desktop.
- Design audit clean: no overshoot easing, no layout-property animation. Both
  findings were fixed rather than suppressed (`e539aa0`).

## Known bug fixed from the original code

`server.js` sent button presses as JSON to
`ssap://com.webos.service.networkinput/insert_1q` on the control socket. That is
not how webOS works — buttons go over a *separate* pointer socket as text
frames. Every button in the original UI was a silent no-op. Fixed in
`js/webos.js`.

## Next steps

1. **Put the extender in bridge/AP mode** so the TV joins `192.168.1.x`.
   (Spare router reused as extender → turn off its DHCP, give it a static
   `192.168.1.2`, switch to AP mode. Costs no speed — see README.)
2. Turn the TV on, re-scan, note its IP.
3. Trust `https://<TV-IP>:3001` once on the phone, then pair.
4. Confirm on real hardware: d-pad, trackpad, app launch, input switch, volume
   subscription, typing.
5. Enable GitHub Pages on the repo (Settings → Pages → Source: GitHub Actions).

## Open questions for the user

- Does the 43UR80 answer on 3001 (expected) or 3000? The endpoint fallback tries
  both, and the answer is shown in Settings → Connection → Endpoint.
- Are the app icons usable? They are served by the TV over plain http, which an
  https page blocks as mixed content. The initials fallback covers it; if the
  icons matter, the site can be served over http instead.
- Keep all three themes, or delete the two that lose?
